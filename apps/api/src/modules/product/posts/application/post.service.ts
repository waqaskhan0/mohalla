import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DatabaseService } from '../../../../database/database.service.js';
import { StructuredLogger } from '../../../../common/logging/structured.logger.js';
import { BlockService } from '../../safety/application/block.service.js';
import { ProfileService } from '../../profile/application/profile.service.js';
import { checkAttachmentCounts } from '../../../platform/media/domain/upload-limits.js';
import { checkPostBody, normalizePostBody, type PostBodyRejection } from '../domain/post-body.js';
import {
  canAuthorModify,
  decidePostVisibility,
  type PostVisibility,
} from '../domain/post-visibility.js';
import {
  POST_REPOSITORY,
  type PostRecord,
  type PostRepository,
} from '../repositories/post.repository.port.js';
import { VIEWER_LIKES, type ViewerLikes } from '../ports/viewer-likes.port.js';
import type { PublicProfile } from '../../profile/domain/public-profile.js';

/** What a client receives for a post. */
export interface PostView {
  id: string;
  author: PublicProfile;
  body: string;
  categorySlug: string | null;
  mediaIds: string[];
  likeCount: number;
  commentCount: number;
  /**
   * So the like control renders in the right state without a second call —
   * the same reason `FeedItemResponse` carries it (INTEGRATION-006).
   */
  viewerHasLiked: boolean;
  /** POST-FR-008: an "edited" marker with the time of the most recent change. */
  editedAt: string | null;
  /** BR-032: true when the author is seeing their own hidden post. */
  underReview: boolean;
  createdAt: string;
}

export interface CreatePostCommand {
  authorId: string;
  body: string;
  categorySlug?: string | null;
  mediaIds?: readonly string[];
}

export interface UpdatePostCommand {
  postId: string;
  authorId: string;
  body?: string;
  categorySlug?: string | null;
}

export type PostField = 'body' | 'categorySlug' | 'mediaIds';

export type CreatePostResult =
  | { status: 'CREATED'; post: PostView }
  | { status: 'INVALID_INPUT'; field: PostField; reason: PostBodyRejection | string }
  | { status: 'MEDIA_NOT_READY' }
  | { status: 'NO_PROFILE' };

export type UpdatePostResult =
  | { status: 'UPDATED'; post: PostView }
  | { status: 'NOT_AVAILABLE' }
  | { status: 'INVALID_INPUT'; field: PostField; reason: string };

export type DeletePostResult = { status: 'DELETED' } | { status: 'NOT_AVAILABLE' };

export type ViewPostResult = { status: 'FOUND'; post: PostView } | { status: 'NOT_AVAILABLE' };

/**
 * Posts (POST-FR-001…010 · BR-012/013/014/017 · PRIV-003).
 *
 * FOUR DECISIONS WORTH KNOWING ABOUT.
 *
 * 1. `NOT_AVAILABLE` IS ONE ANSWER for a missing post, a deleted one, an
 *    admin-removed one, one hidden by moderation, one whose author is banned,
 *    and one behind a block (UX-STATE-001, BR-025). Distinguishing them would
 *    let anyone audit what has been removed and from whom.
 *
 * 2. EDITING CANNOT TOUCH ATTACHMENTS (BR-014), and the reason is in the
 *    requirement: it "prevents bait-and-switch on content that others have
 *    already endorsed". A notice about the water supply that gathered fifty
 *    likes must not become an advertisement carrying the same fifty. So
 *    `UpdatePostCommand` has no `mediaIds` field — it is unrepresentable
 *    rather than rejected.
 *
 * 3. DELETION IS A STATE CHANGE, NOT A ROW DELETE. `AUTHOR_DELETED` is what
 *    tells an administrator they may not restore it (BR-014); deleting the row
 *    would lose that distinction and the moderation trail with it.
 *
 * 4. THE AUTHOR PROJECTION COMES FROM `ProfileService`, so a post carries the
 *    same author shape as every other surface (§162) — and a badge revocation
 *    or a new block takes effect on posts without this module knowing.
 */
@Injectable()
export class PostService {
  constructor(
    private readonly db: DatabaseService,
    @Inject(POST_REPOSITORY) private readonly repo: PostRepository,
    private readonly profiles: ProfileService,
    private readonly blocks: BlockService,
    @Inject(VIEWER_LIKES) private readonly viewerLikes: ViewerLikes,
    private readonly logger: StructuredLogger,
  ) {}

  /** POST-API-001 — publish a post. */
  async create(cmd: CreatePostCommand): Promise<CreatePostResult> {
    const mediaIds = [...(cmd.mediaIds ?? [])];

    // BR-013 / BR-015. Also structural in `post_media`, but checked here so
    // the author gets a message rather than a constraint violation.
    const counts = checkAttachmentCounts({ images: mediaIds.length, documents: 0 });
    if (counts !== null) {
      return { status: 'INVALID_INPUT', field: 'mediaIds', reason: counts };
    }
    if (new Set(mediaIds).size !== mediaIds.length) {
      // The same image twice would occupy two positions and render twice.
      return { status: 'INVALID_INPUT', field: 'mediaIds', reason: 'DUPLICATE_MEDIA' };
    }

    const bodyProblem = checkPostBody(cmd.body, { hasAttachment: mediaIds.length > 0 });
    if (bodyProblem !== null) {
      return { status: 'INVALID_INPUT', field: 'body', reason: bodyProblem };
    }

    const categoryId = await this.resolveCategory(cmd.categorySlug);
    if (categoryId === 'UNKNOWN') {
      return { status: 'INVALID_INPUT', field: 'categorySlug', reason: 'UNKNOWN_CATEGORY' };
    }

    // An author needs a profile: a post renders its author, and there is
    // nothing to render before onboarding finishes.
    const author = await this.profiles.getOwn(cmd.authorId);
    if (author === null) return { status: 'NO_PROFILE' };

    try {
      return await this.db.withTransaction(async (client) => {
        const created = await this.repo.create(
          {
            id: randomUUID(),
            authorId: cmd.authorId,
            body: normalizePostBody(cmd.body),
            categoryId,
            mediaIds,
          },
          client,
        );

        this.log('post_created', { postId: created.id, attachments: mediaIds.length });
        // A post created a moment ago has no likes and no comments, least of
        // all the author's own — no query is worth making to learn that.
        return {
          status: 'CREATED',
          post: this.render(created, author, false, {
            likeCount: 0,
            commentCount: 0,
            viewerHasLiked: false,
          }),
        } as const;
      });
    } catch (e) {
      // ADR-013 step 7 raises when media is not READY, or belongs to someone
      // else. Reported as a usable answer rather than a 500 - the client needs
      // to know which attachment to retry (EDGE-013).
      if (isMediaNotReady(e)) {
        this.log('post_create_media_not_ready', { attachments: mediaIds.length });
        return { status: 'MEDIA_NOT_READY' };
      }
      throw e;
    }
  }

  /** POST-API-002 — read a post. */
  async view(viewerId: string, postId: string, isAdmin = false): Promise<ViewPostResult> {
    const post = await this.repo.findById(postId);
    if (post === null) return { status: 'NOT_AVAILABLE' };

    const visibility = await this.visibilityFor(viewerId, post, isAdmin);
    if (visibility === 'NOT_AVAILABLE') return { status: 'NOT_AVAILABLE' };

    // The author projection, through the profile module. Fetched as the AUTHOR
    // views themselves when the viewer IS the author, so a suspended author can
    // still read their own post.
    const author = await this.authorProjection(viewerId, post.authorId);
    if (author === null) return { status: 'NOT_AVAILABLE' };

    const adjusted = await this.viewerLikes.adjustedFor(viewerId, [post]);

    return {
      status: 'FOUND',
      post: this.render(
        post,
        author,
        visibility === 'VISIBLE_UNDER_REVIEW',
        adjusted.get(post.id) ?? {
          likeCount: post.likeCount,
          commentCount: post.commentCount,
          viewerHasLiked: false,
        },
      ),
    };
  }

  /** PROF-API-007 — a profile's posts, newest first, paginated at 20. */
  async listByAuthor(
    viewerId: string,
    authorId: string,
    limit = 20,
    cursor?: { createdAt: Date; id: string },
  ): Promise<{ posts: PostView[]; nextCursor: { createdAt: string; id: string } | null } | null> {
    // The subject's own visibility first: a banned author has no viewable post
    // list, and a blocked one must not expose here what the profile route
    // refuses to show.
    // A PROFILE'S post list, so the PROFILE question is the right one here:
    // a departed account has no profile page to list posts on, and its posts
    // are reached through the threads and feeds they are already in.
    if (viewerId !== authorId) {
      const profile = await this.profiles.viewByUserId(viewerId, authorId);
      if (profile.status === 'NOT_AVAILABLE') return null;
    }

    const author = await this.authorProjection(viewerId, authorId);
    if (author === null) return null;

    const page = await this.repo.listByAuthor(viewerId, authorId, clampLimit(limit), cursor);

    // ONE QUERY FOR THE PAGE, not one per post — see the port's comment.
    const adjusted = await this.viewerLikes.adjustedFor(viewerId, page.posts);

    return {
      posts: page.posts.map((p) =>
        this.render(
          p,
          author,
          p.visibilityState === 'AUTO_HIDDEN',
          adjusted.get(p.id) ?? {
            likeCount: p.likeCount,
            commentCount: p.commentCount,
            viewerHasLiked: false,
          },
        ),
      ),
      nextCursor:
        page.nextCursor === null
          ? null
          : { createdAt: page.nextCursor.createdAt.toISOString(), id: page.nextCursor.id },
    };
  }

  /** POST-API-003 — edit body and category. Never attachments (BR-014). */
  async update(cmd: UpdatePostCommand): Promise<UpdatePostResult> {
    const post = await this.repo.findById(cmd.postId);
    // Same neutral answer for "no such post" and "not yours", so a post id
    // cannot be used to probe what exists.
    if (
      post === null ||
      !canAuthorModify({ state: post.visibilityState, isAuthor: post.authorId === cmd.authorId })
    ) {
      return { status: 'NOT_AVAILABLE' };
    }

    const body = cmd.body ?? post.body;
    const bodyProblem = checkPostBody(body, { hasAttachment: post.mediaIds.length > 0 });
    if (bodyProblem !== null) {
      // POST-FR-008 error case: "edit exceeds the length limit → refused,
      // original preserved". Nothing has been written at this point.
      return { status: 'INVALID_INPUT', field: 'body', reason: bodyProblem };
    }

    const categoryId =
      cmd.categorySlug === undefined
        ? post.categoryId
        : await this.resolveCategory(cmd.categorySlug);
    if (categoryId === 'UNKNOWN') {
      return { status: 'INVALID_INPUT', field: 'categorySlug', reason: 'UNKNOWN_CATEGORY' };
    }

    const author = await this.profiles.getOwn(cmd.authorId);
    if (author === null) return { status: 'NOT_AVAILABLE' };

    // Read BEFORE the transaction: an edit changes neither the engagement nor
    // who is blocked, and the author is the viewer here.
    const adjusted = await this.viewerLikes.adjustedFor(cmd.authorId, [post]);
    const engagement = adjusted.get(cmd.postId) ?? {
      likeCount: post.likeCount,
      commentCount: post.commentCount,
      viewerHasLiked: false,
    };

    return this.db.withTransaction(async (client) => {
      const updated = await this.repo.updateBodyAndCategory(
        cmd.postId,
        { body: normalizePostBody(body), categoryId },
        client,
      );
      if (updated === null) return { status: 'NOT_AVAILABLE' } as const;

      this.log('post_edited', { postId: cmd.postId });
      return {
        status: 'UPDATED',
        post: this.render(updated, author, updated.visibilityState === 'AUTO_HIDDEN', engagement),
      } as const;
    });
  }

  /**
   * POST-API-004 — delete own post (POST-FR-007).
   *
   * Permanent and not user-reversible (BR-014). The attachments are swept
   * rather than deleted inline: the media module owns their lifecycle, and a
   * storage failure must not roll back the deletion the user asked for — from
   * their point of view the post must be gone.
   */
  async delete(postId: string, authorId: string): Promise<DeletePostResult> {
    const post = await this.repo.findById(postId);
    if (post === null || post.authorId !== authorId) return { status: 'NOT_AVAILABLE' };
    if (post.visibilityState === 'ADMIN_REMOVED') {
      // Already gone by moderation. Reported as unavailable rather than
      // deleted, so an author cannot convert a removal into a deletion and
      // put it beyond admin review.
      return { status: 'NOT_AVAILABLE' };
    }

    await this.db.withTransaction(async (client) => {
      // Idempotent: POST-FR-007's error case is "post already deleted →
      // idempotent no-op".
      await this.repo.markAuthorDeleted(postId, client);
    });

    this.log('post_deleted', { postId });
    return { status: 'DELETED' };
  }

  // ---- internals --------------------------------------------------------

  private async visibilityFor(
    viewerId: string,
    post: PostRecord,
    isAdmin: boolean,
  ): Promise<PostVisibility> {
    const isAuthor = post.authorId === viewerId;

    // Skipped for the author and for admins: neither can be blocked out of
    // their own content, and asking would be a wasted query on the hot path.
    const blockedEitherWay =
      isAuthor || isAdmin ? false : await this.blocks.isBlockedEitherWay(viewerId, post.authorId);

    // NOT "is the author publicly visible" - that is a different question, and
    // asking it here was a defect: a departed account's profile is gone while
    // its posts REMAIN, attributed to "Deleted User" (BR-009, PRIV-006). Only a
    // ban or a block takes the content with the account.
    const authorVisible =
      isAuthor || (await this.profiles.attributionFor(viewerId, post.authorId)).status !== 'HIDDEN';

    return decidePostVisibility({
      state: post.visibilityState,
      isAuthor,
      isAdmin,
      blockedEitherWay,
      authorHidden: !authorVisible,
    });
  }

  /** The author's public projection, or null when it cannot be rendered. */
  private async authorProjection(
    viewerId: string,
    authorId: string,
  ): Promise<PublicProfile | null> {
    if (viewerId === authorId) {
      const own = await this.profiles.getOwn(authorId);
      return own === null ? null : own;
    }
    // FOUND or ANONYMOUS both render; only HIDDEN removes the post.
    const view = await this.profiles.attributionFor(viewerId, authorId);
    return view.status === 'HIDDEN' ? null : view.profile;
  }

  /** `'UNKNOWN'` when the slug does not exist, so the caller can say so. */
  private async resolveCategory(
    slug: string | null | undefined,
  ): Promise<string | null | 'UNKNOWN'> {
    if (slug === null || slug === undefined || slug === '') return null;
    const categories = await this.profiles.listCategories();
    return categories.find((c) => c.slug === slug)?.id ?? 'UNKNOWN';
  }

  private render(
    post: PostRecord,
    author: PublicProfile,
    underReview: boolean,
    /**
     * What THIS viewer should be shown. Absent only where there is nothing to
     * adjust — a post created a moment ago.
     */
    engagement: { likeCount: number; commentCount: number; viewerHasLiked: boolean },
  ): PostView {
    return {
      id: post.id,
      author,
      body: post.body,
      categorySlug: post.categorySlug,
      mediaIds: post.mediaIds,
      // ENGAGE-FR-006: the counts the VIEWER should see, not the stored
      // platform-wide ones. The feed already did this and these paths did not,
      // so the same post reported different numbers depending on which screen
      // it was opened from (INTEGRATION-010).
      likeCount: engagement.likeCount,
      commentCount: engagement.commentCount,
      viewerHasLiked: engagement.viewerHasLiked,
      editedAt: post.editedAt?.toISOString() ?? null,
      underReview,
      createdAt: post.createdAt.toISOString(),
    };
  }

  private log(event: string, extra: Record<string, unknown>): void {
    // Never the body. A post body is user content, and an operational log is
    // not the place for it - it would also survive account erasure.
    this.logger.log(JSON.stringify({ event, ...extra }), 'posts');
  }
}

/**
 * Did the ADR-013 step-7 trigger refuse the attachment?
 *
 * Matched on SQLSTATE rather than message text, so a reworded exception does
 * not silently turn this into a 500.
 *
 * The three codes were READ OFF THE RUNNING DATABASE rather than assumed, and
 * the third was a genuine miss: a NONEXISTENT media id raises 23503, not one
 * of the two the trigger raises explicitly. Without it, attaching an id that
 * does not exist - a stale client, or a probe - would have been a 500 instead
 * of an answer the client can act on.
 *
 *   23001 restrict_violation      media exists but is not READY
 *   42501 insufficient_privilege  media belongs to somebody else
 *   23503 foreign_key_violation   no such media
 *
 * All three collapse to one answer for the caller: the attachment cannot be
 * used. Telling them WHICH would confirm whether a media id exists and who
 * owns it.
 */
function isMediaNotReady(e: unknown): boolean {
  if (typeof e !== 'object' || e === null) return false;
  const code = (e as { code?: string }).code;
  return code === '23001' || code === '42501' || code === '23503';
}

/** 20 per page by requirement, 100 as a ceiling. */
function clampLimit(limit: number): number {
  if (!Number.isFinite(limit) || limit < 1) return 20;
  return Math.min(Math.trunc(limit), 100);
}
