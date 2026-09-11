import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DatabaseService } from '../../../../database/database.service.js';
import { StructuredLogger } from '../../../../common/logging/structured.logger.js';
import { OutboxService } from '../../../platform/notifications/application/outbox.service.js';
import { PostService } from '../../posts/application/post.service.js';
import { ProfileService } from '../../profile/application/profile.service.js';
import type { PublicProfile } from '../../profile/domain/public-profile.js';
import {
  canDeleteComment,
  checkCommentBody,
  normalizeCommentBody,
  resolveThreadParent,
  type CommentBodyRejection,
} from '../domain/comment-body.js';
import { adjustCounts } from '../domain/adjusted-counts.js';
import {
  ENGAGEMENT_REPOSITORY,
  type EngagementRepository,
  type HiddenEngagement,
} from '../repositories/engagement.repository.port.js';

export interface CommentView {
  id: string;
  postId: string;
  author: PublicProfile;
  parentCommentId: string | null;
  body: string;
  createdAt: string;
}

export type LikeResult = { status: 'LIKED'; created: boolean } | { status: 'NOT_AVAILABLE' };

export type UnlikeResult = { status: 'NOT_LIKED' } | { status: 'NOT_AVAILABLE' };

export type CommentResult =
  | { status: 'CREATED'; comment: CommentView }
  | { status: 'NOT_AVAILABLE' }
  | { status: 'INVALID_INPUT'; field: 'body'; reason: CommentBodyRejection };

export type DeleteCommentResult =
  { status: 'DELETED'; removed: number } | { status: 'NOT_AVAILABLE' };

/**
 * Likes and comments (ENGAGE-FR-001…006 · BR-020/031/033).
 *
 * EVERY WRITE GOES THROUGH THE POST'S OWN VISIBILITY FIRST. Liking or
 * commenting on a post you cannot see must be refused, and refused the same way
 * as a post that does not exist — otherwise the like endpoint becomes a way to
 * discover which post ids are real, and whether a particular person has blocked
 * you (BR-023, BR-025).
 *
 * COUNTS ARE NOT MAINTAINED HERE. Database triggers move them on every insert
 * and delete, including the cascades from deleting a post or a parent comment.
 * ENGAGE-FR-001's acceptance criterion — six rapid taps change the count by at
 * most one — is a property of the composite primary key, not of this code.
 *
 * WHAT *IS* DONE HERE IS THE PER-VIEWER ADJUSTMENT (ENGAGE-FR-006). The stored
 * counters are the platform-wide truth; what a given person is shown excludes
 * contributions from anyone blocked in either direction, "so two users who have
 * blocked each other may see slightly different totals". That is the
 * requirement's own wording, and it is why a single stored number cannot be the
 * answer on its own.
 */
@Injectable()
export class EngagementService {
  constructor(
    private readonly db: DatabaseService,
    @Inject(ENGAGEMENT_REPOSITORY) private readonly repo: EngagementRepository,
    private readonly posts: PostService,
    private readonly profiles: ProfileService,
    private readonly outbox: OutboxService,
    private readonly logger: StructuredLogger,
  ) {}

  /** ENG-API-001 — like a post (ENGAGE-FR-001). */
  async like(userId: string, postId: string): Promise<LikeResult> {
    // Visibility first. A user may like their OWN post, which the requirement
    // says explicitly, and the post read path already allows that.
    const post = await this.visiblePost(userId, postId);
    if (post === null) return { status: 'NOT_AVAILABLE' };

    return this.db.withTransaction(async (client) => {
      const created = await this.repo.like(userId, postId, client);

      // NOTIF-FR-003, and ONLY when `created`: a repeat tap must not notify a
      // second time. The row goes in THIS transaction (ADR-014), so the
      // notification is exactly as durable as the like itself - a crash
      // between commit and enqueue cannot lose one.
      //
      // Nothing here decides whether the author will actually be notified.
      // Their own like, a block, a muted category and the six-per-hour
      // batching are all the pipeline's job; producers state what happened.
      if (created) {
        await this.outbox.emit(
          {
            topic: 'engagement.liked',
            postId,
            postAuthorId: post.author.userId,
            actorId: userId,
          },
          client,
        );
      }

      this.log(created ? 'like_created' : 'like_repeated', { postId });
      return { status: 'LIKED', created } as const;
    });
  }

  /**
   * ENG-API-002 — unlike (ENGAGE-FR-001).
   *
   * Silent: "unliking sends no notification". Reports the same result whether
   * or not a like existed, because the caller asked for a state and that state
   * now holds.
   */
  async unlike(userId: string, postId: string): Promise<UnlikeResult> {
    if ((await this.visiblePost(userId, postId)) === null) return { status: 'NOT_AVAILABLE' };

    await this.db.withTransaction(async (client) => {
      await this.repo.unlike(userId, postId, client);
    });
    this.log('unlike', { postId });
    return { status: 'NOT_LIKED' };
  }

  /** ENG-API-003 — comment on a post (ENGAGE-FR-002). */
  async comment(
    userId: string,
    postId: string,
    body: string,
    replyToCommentId?: string,
  ): Promise<CommentResult> {
    const bodyProblem = checkCommentBody(body);
    if (bodyProblem !== null) {
      // Validated BEFORE the post is loaded, so a user whose text is too long
      // learns that even if the post has since vanished - ENGAGE-FR-002's
      // error case is about not losing their typed text.
      return { status: 'INVALID_INPUT', field: 'body', reason: bodyProblem };
    }

    // ENGAGE-FR-002 error case: "post deleted while composing → submission
    // refused with a clear explanation". The refusal is the neutral one; the
    // client keeps the text.
    const post = await this.visiblePost(userId, postId);
    if (post === null) return { status: 'NOT_AVAILABLE' };

    let parentCommentId: string | null = null;
    if (replyToCommentId !== undefined) {
      const target = await this.repo.findCommentById(replyToCommentId);
      if (target === null || target.postId !== postId || target.visibilityState !== 'VISIBLE') {
        return { status: 'NOT_AVAILABLE' };
      }
      // BR-033: a reply to a reply attaches to the SAME parent thread, rather
      // than being refused. The database refuses a third level regardless.
      parentCommentId = resolveThreadParent(target);
    }

    const author = await this.profiles.getOwn(userId);
    if (author === null) return { status: 'NOT_AVAILABLE' };

    return this.db.withTransaction(async (client) => {
      const created = await this.repo.createComment(
        {
          id: randomUUID(),
          postId,
          authorId: userId,
          parentCommentId,
          body: normalizeCommentBody(body),
        },
        client,
      );

      // Two different notifications, because NOTIF-FR-003 lists them
      // separately: "a comment on their post" and "a reply to their comment"
      // reach different people. A reply notifies the PARENT COMMENT's author;
      // a top-level comment notifies the POST's author.
      if (parentCommentId === null) {
        await this.outbox.emit(
          {
            topic: 'engagement.commented',
            postId,
            postAuthorId: post.author.userId,
            commentId: created.id,
            actorId: userId,
          },
          client,
        );
      } else {
        const parent = await this.repo.findCommentById(parentCommentId, client);
        if (parent !== null) {
          await this.outbox.emit(
            {
              topic: 'engagement.replied',
              postId,
              parentAuthorId: parent.authorId,
              commentId: created.id,
              actorId: userId,
            },
            client,
          );
        }
      }

      this.log('comment_created', { postId, isReply: parentCommentId !== null });
      return {
        status: 'CREATED',
        comment: this.renderComment(created, author),
      } as const;
    });
  }

  /** ENG-API-004 — a post's comments, oldest first. */
  async listComments(
    viewerId: string,
    postId: string,
    limit = 20,
    cursor?: { createdAt: Date; id: string },
  ): Promise<{
    comments: CommentView[];
    nextCursor: { createdAt: string; id: string } | null;
  } | null> {
    if ((await this.visiblePost(viewerId, postId)) === null) return null;

    const page = await this.repo.listComments(viewerId, postId, clampLimit(limit), cursor);

    // Author projections, one lookup per distinct author rather than per
    // comment - a thread of thirty comments from three people is three
    // lookups.
    const authors = await this.authorsFor(
      viewerId,
      page.comments.map((c) => c.authorId),
    );

    const comments: CommentView[] = [];
    for (const c of page.comments) {
      const author = authors.get(c.authorId);
      // A comment whose author became invisible between the query and here is
      // dropped rather than rendered with a gap.
      if (author !== undefined) comments.push(this.renderComment(c, author));
    }

    return {
      comments,
      nextCursor:
        page.nextCursor === null
          ? null
          : { createdAt: page.nextCursor.createdAt.toISOString(), id: page.nextCursor.id },
    };
  }

  /**
   * ENG-API-006 — delete a comment (ENGAGE-FR-004/005, BR-020).
   *
   * Two people may: the comment's author, and THE POST'S author. The second
   * distributes moderation away from administrators, so somebody whose notice
   * attracts abuse can clear it themselves.
   */
  async deleteComment(viewerId: string, commentId: string): Promise<DeleteCommentResult> {
    const comment = await this.repo.findCommentById(commentId);
    if (comment === null || comment.visibilityState === 'DELETED') {
      return { status: 'NOT_AVAILABLE' };
    }

    const post = await this.posts.view(viewerId, comment.postId);
    if (post.status === 'NOT_AVAILABLE') return { status: 'NOT_AVAILABLE' };

    if (
      !canDeleteComment({
        viewerId,
        commentAuthorId: comment.authorId,
        postAuthorId: post.post.author.userId,
      })
    ) {
      // Same neutral answer as a missing comment, so a third party cannot
      // learn who wrote what by probing which deletions are refused.
      return { status: 'NOT_AVAILABLE' };
    }

    const removed = await this.db.withTransaction((client) =>
      this.repo.deleteCommentCascade(commentId, client),
    );

    // ENGAGE-FR-005: "the deletion is recorded so that abuse of it can be
    // reviewed if the post is later reported".
    this.log('comment_deleted', {
      byPostAuthor: viewerId !== comment.authorId,
      removed,
    });
    return { status: 'DELETED', removed };
  }

  /**
   * Which post does this comment belong to?
   *
   * The reply route resolves the post from the PARENT rather than taking it
   * from the caller, so a reply cannot be filed under a different post than
   * the comment it answers. The database refuses that too; this makes it a
   * clean 404 instead of a constraint violation.
   *
   * @returns the post id, or null when the comment is missing or deleted.
   */
  async findCommentPost(commentId: string): Promise<string | null> {
    const comment = await this.repo.findCommentById(commentId);
    if (comment === null || comment.visibilityState !== 'VISIBLE') return null;
    return comment.postId;
  }

  /**
   * Adjust stored counts for what this viewer may not see (ENGAGE-FR-006).
   *
   * Applied to a whole page at once. Returns the counts to DISPLAY, never
   * mutating the stored ones — those stay the platform-wide truth.
   */
  async adjustedCounts(
    viewerId: string,
    posts: readonly { id: string; likeCount: number; commentCount: number }[],
  ): Promise<Map<string, { likeCount: number; commentCount: number; viewerHasLiked: boolean }>> {
    const ids = posts.map((p) => p.id);
    const [hidden, liked] = await Promise.all([
      this.repo.hiddenEngagementFor(viewerId, ids),
      this.repo.likedPostIds(viewerId, ids),
    ]);

    // The arithmetic lives in `domain/adjusted-counts.ts` because the posts
    // module needs the same answer for a post's own screen, and a second copy
    // of it is what produced INTEGRATION-010 in the first place.
    return adjustCounts(posts, hidden, liked);
  }

  // ---- internals --------------------------------------------------------

  /** One question, asked the same way by every write path. */
  /**
   * The post, if this viewer may see it — otherwise null.
   *
   * Returns the POST rather than a boolean because every caller that needs the
   * visibility check also needs the author id, to address the notification.
   * Answering "yes" and then re-reading the row would be a second query for a
   * fact already in hand, and two lookups are two chances to disagree.
   */
  private async visiblePost(viewerId: string, postId: string) {
    const post = await this.posts.view(viewerId, postId);
    return post.status === 'FOUND' ? post.post : null;
  }

  private async authorsFor(
    viewerId: string,
    authorIds: readonly string[],
  ): Promise<Map<string, PublicProfile>> {
    const out = new Map<string, PublicProfile>();
    for (const id of new Set(authorIds)) {
      if (id === viewerId) {
        const own = await this.profiles.getOwn(id);
        if (own !== null) out.set(id, own);
        continue;
      }
      // BR-009: a departed commenter's replies stay in the thread under
      // "Deleted User". Removing them would take the other participants'
      // record of the conversation with them.
      const view = await this.profiles.attributionFor(viewerId, id);
      if (view.status !== 'HIDDEN') out.set(id, view.profile);
    }
    return out;
  }

  private renderComment(
    comment: {
      id: string;
      postId: string;
      parentCommentId: string | null;
      body: string;
      createdAt: Date;
    },
    author: PublicProfile,
  ): CommentView {
    return {
      id: comment.id,
      postId: comment.postId,
      author,
      parentCommentId: comment.parentCommentId,
      body: comment.body,
      createdAt: comment.createdAt.toISOString(),
    };
  }

  private log(event: string, extra: Record<string, unknown>): void {
    // Never the comment body, and never who liked what - a log pairing a user
    // with a post is a record of what they read and endorsed.
    this.logger.log(JSON.stringify({ event, ...extra }), 'engagement');
  }
}

function clampLimit(limit: number): number {
  if (!Number.isFinite(limit) || limit < 1) return 20;
  return Math.min(Math.trunc(limit), 100);
}
