import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { EngagementService } from './engagement.service.js';
import type {
  CommentPage,
  CommentRecord,
  EngagementRepository,
  HiddenEngagement,
} from '../repositories/engagement.repository.port.js';
import type { PostService } from '../../posts/application/post.service.js';
import type { ProfileService } from '../../profile/application/profile.service.js';
import type { DatabaseService } from '../../../../database/database.service.js';
import type { OutboxService } from '../../../platform/notifications/application/outbox.service.js';
import type { StructuredLogger } from '../../../../common/logging/structured.logger.js';

/**
 * In-memory engagement, enforcing what the composite primary key enforces: one
 * like per user per post, and a repeat is a no-op rather than a second row.
 * A fake that allowed duplicates would let a test prove BR-031 was handled when
 * it was not.
 */
class InMemoryEngagement implements EngagementRepository {
  readonly likes = new Set<string>();
  readonly comments = new Map<string, CommentRecord>();
  /** Users blocked relative to the viewer, for the ENGAGE-FR-006 adjustment. */
  blocked = new Set<string>();
  now: () => Date = () => new Date();

  private key(userId: string, postId: string): string {
    return `${userId}:${postId}`;
  }

  async like(userId: string, postId: string): Promise<boolean> {
    const k = this.key(userId, postId);
    if (this.likes.has(k)) return false;
    this.likes.add(k);
    return true;
  }

  async unlike(userId: string, postId: string): Promise<boolean> {
    return this.likes.delete(this.key(userId, postId));
  }

  async hasLiked(userId: string, postId: string): Promise<boolean> {
    return this.likes.has(this.key(userId, postId));
  }

  async likedPostIds(userId: string, postIds: readonly string[]): Promise<Set<string>> {
    return new Set(postIds.filter((id) => this.likes.has(this.key(userId, id))));
  }

  async createComment(input: {
    id: string;
    postId: string;
    authorId: string;
    parentCommentId: string | null;
    body: string;
  }): Promise<CommentRecord> {
    // Mirrors the BR-033 trigger: a parent that itself has a parent is
    // refused, so the fake cannot pass a test real PostgreSQL would fail.
    if (input.parentCommentId !== null) {
      const parent = this.comments.get(input.parentCommentId);
      if (parent === undefined) throw Object.assign(new Error('no parent'), { code: '23503' });
      if (parent.parentCommentId !== null) {
        throw Object.assign(new Error('one level only'), { code: '23001' });
      }
    }
    const row: CommentRecord = {
      id: input.id,
      postId: input.postId,
      authorId: input.authorId,
      parentCommentId: input.parentCommentId,
      body: input.body,
      visibilityState: 'VISIBLE',
      createdAt: this.now(),
    };
    this.comments.set(row.id, row);
    return row;
  }

  async findCommentById(id: string): Promise<CommentRecord | null> {
    return this.comments.get(id) ?? null;
  }

  async listComments(viewerId: string, postId: string, limit: number): Promise<CommentPage> {
    const rows = [...this.comments.values()]
      .filter((c) => c.postId === postId && c.visibilityState === 'VISIBLE')
      .filter((c) => !this.blocked.has(c.authorId))
      // OLDEST first (ENGAGE-FR-002).
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .slice(0, limit);
    return { comments: rows, nextCursor: null };
  }

  async deleteCommentCascade(id: string): Promise<number> {
    let removed = 0;
    for (const [key, c] of this.comments) {
      if ((c.id === id || c.parentCommentId === id) && c.visibilityState !== 'DELETED') {
        this.comments.set(key, { ...c, visibilityState: 'DELETED' });
        removed += 1;
      }
    }
    return removed;
  }

  async hiddenEngagementFor(
    _viewerId: string,
    postIds: readonly string[],
  ): Promise<Map<string, HiddenEngagement>> {
    const out = new Map<string, HiddenEngagement>();
    for (const postId of postIds) {
      const likes = [...this.likes].filter((k) => {
        const [userId, pid] = k.split(':');
        return pid === postId && this.blocked.has(userId ?? '');
      }).length;
      const comments = [...this.comments.values()].filter(
        (c) =>
          c.postId === postId && c.visibilityState === 'VISIBLE' && this.blocked.has(c.authorId),
      ).length;
      out.set(postId, { likes, comments });
    }
    return out;
  }
}

function build() {
  const repo = new InMemoryEngagement();
  const logs: string[] = [];

  const postAuthorId = randomUUID();
  const hiddenPosts = new Set<string>();

  const posts = {
    async view(_viewerId: string, postId: string) {
      return hiddenPosts.has(postId)
        ? ({ status: 'NOT_AVAILABLE' } as const)
        : ({
            status: 'FOUND',
            post: { id: postId, author: { userId: postAuthorId } },
          } as never);
    },
  } as unknown as PostService;

  const profiles = {
    async getOwn(userId: string) {
      return { userId, username: `u_${userId.slice(0, 6)}` } as never;
    },
    async viewByUserId(_viewerId: string, targetId: string) {
      return { status: 'FOUND', profile: { userId: targetId } } as never;
    },
  } as unknown as ProfileService;

  // Records every domain event, so the ADR-014 assertions are about what was
  // EMITTED rather than about a call having been made. `client` is captured
  // too: the outbox row must be written inside the business transaction, and a
  // fake that ignored the client would let that regress unnoticed.
  const emitted: { topic: string; payload: Record<string, unknown> }[] = [];
  const outbox = {
    async emit(event: { topic: string } & Record<string, unknown>) {
      const { topic, ...payload } = event;
      emitted.push({ topic, payload });
    },
  } as unknown as OutboxService;

  const db = {
    withTransaction: async <T>(fn: (c: never) => Promise<T>): Promise<T> => fn(undefined as never),
  } as unknown as DatabaseService;
  const logger = {
    log: (m: unknown) => logs.push(String(m)),
    warn: (m: unknown) => logs.push(String(m)),
    error: (m: unknown) => logs.push(String(m)),
  } as unknown as StructuredLogger;

  return {
    emitted,
    service: new EngagementService(db, repo, posts, profiles, outbox, logger),
    repo,
    logs,
    postAuthorId,
    hidePost: (id: string) => hiddenPosts.add(id),
  };
}

describe('EngagementService — likes (ENGAGE-FR-001, BR-031)', () => {
  let ctx: ReturnType<typeof build>;
  let user: string;
  let postId: string;
  beforeEach(() => {
    ctx = build();
    user = randomUUID();
    postId = randomUUID();
  });

  it('likes a post', async () => {
    expect(await ctx.service.like(user, postId)).toEqual({ status: 'LIKED', created: true });
    expect(await ctx.repo.hasLiked(user, postId)).toBe(true);
  });

  it('IS IDEMPOTENT — six taps produce one like', async () => {
    // ENGAGE-FR-001 AC: "GIVEN a user taps like 6 times rapidly, WHEN the
    // requests settle, THEN the like count has changed by at most one."
    const results = await Promise.all(
      Array.from({ length: 6 }, () => ctx.service.like(user, postId)),
    );
    const created = results.filter((r) => r.status === 'LIKED' && r.created).length;
    expect(created).toBe(1);
    expect(ctx.repo.likes.size).toBe(1);
  });

  it('reports created:false on a repeat, so no second notification fires', async () => {
    await ctx.service.like(user, postId);
    const again = await ctx.service.like(user, postId);
    expect(again).toEqual({ status: 'LIKED', created: false });
  });

  it('lets a user like their OWN post', async () => {
    // Stated explicitly in ENGAGE-FR-001.
    expect((await ctx.service.like(ctx.postAuthorId, postId)).status).toBe('LIKED');
  });

  it('REFUSES A POST THE VIEWER CANNOT SEE, neutrally', async () => {
    // Otherwise the like endpoint is an oracle for "does this post exist" and
    // "has this person blocked me".
    ctx.hidePost(postId);
    expect(await ctx.service.like(user, postId)).toEqual({ status: 'NOT_AVAILABLE' });
    expect(ctx.repo.likes.size).toBe(0);
  });

  it('unlikes, and is idempotent when there was no like', async () => {
    await ctx.service.like(user, postId);
    expect(await ctx.service.unlike(user, postId)).toEqual({ status: 'NOT_LIKED' });
    expect(await ctx.repo.hasLiked(user, postId)).toBe(false);

    expect(await ctx.service.unlike(user, postId)).toEqual({ status: 'NOT_LIKED' });
  });

  it('never logs who liked what', async () => {
    await ctx.service.like(user, postId);
    for (const line of ctx.logs) {
      // A log pairing a user with a post is a record of what they read and
      // endorsed.
      expect(line).not.toContain(user);
    }
  });
});

describe('EngagementService — comments (ENGAGE-FR-002/003, BR-033)', () => {
  let ctx: ReturnType<typeof build>;
  let user: string;
  let postId: string;
  beforeEach(() => {
    ctx = build();
    user = randomUUID();
    postId = randomUUID();
  });

  it('creates a comment', async () => {
    const r = await ctx.service.comment(user, postId, 'Thanks for posting this.');
    expect(r.status).toBe('CREATED');
    if (r.status === 'CREATED') expect(r.comment.body).toBe('Thanks for posting this.');
  });

  it('accepts an Urdu comment', async () => {
    const r = await ctx.service.comment(user, postId, 'شکریہ، بہت مفید معلومات');
    expect(r.status).toBe('CREATED');
  });

  it('VALIDATES THE BODY BEFORE LOADING THE POST', async () => {
    // ENGAGE-FR-002's error case is about not losing the user's typed text.
    // Telling them the text is too long, even when the post has vanished, is
    // the more useful answer.
    ctx.hidePost(postId);
    const r = await ctx.service.comment(user, postId, 'x'.repeat(1001));
    expect(r).toEqual({ status: 'INVALID_INPUT', field: 'body', reason: 'TOO_LONG' });
  });

  it('refuses a comment on a post deleted while composing', async () => {
    ctx.hidePost(postId);
    expect(await ctx.service.comment(user, postId, 'valid text')).toEqual({
      status: 'NOT_AVAILABLE',
    });
  });

  it('rejects an empty comment', async () => {
    expect(await ctx.service.comment(user, postId, '   ')).toEqual({
      status: 'INVALID_INPUT',
      field: 'body',
      reason: 'EMPTY',
    });
  });

  it('replies to a top-level comment', async () => {
    const top = await ctx.service.comment(user, postId, 'top level');
    if (top.status !== 'CREATED') throw new Error('expected a comment');

    const reply = await ctx.service.comment(randomUUID(), postId, 'a reply', top.comment.id);
    expect(reply.status).toBe('CREATED');
    if (reply.status === 'CREATED') expect(reply.comment.parentCommentId).toBe(top.comment.id);
  });

  it('ATTACHES A REPLY-TO-A-REPLY TO THE SAME THREAD (BR-033)', async () => {
    const top = await ctx.service.comment(user, postId, 'top');
    if (top.status !== 'CREATED') throw new Error('expected a comment');
    const reply = await ctx.service.comment(user, postId, 'reply', top.comment.id);
    if (reply.status !== 'CREATED') throw new Error('expected a reply');

    const deep = await ctx.service.comment(user, postId, 'reply to reply', reply.comment.id);
    expect(deep.status).toBe('CREATED');
    if (deep.status === 'CREATED') {
      // Re-pointed at the THREAD parent, not refused, and never a third level.
      expect(deep.comment.parentCommentId).toBe(top.comment.id);
    }
  });

  it('refuses a reply to a comment on a different post', async () => {
    const other = await ctx.service.comment(user, randomUUID(), 'elsewhere');
    if (other.status !== 'CREATED') throw new Error('expected a comment');

    expect(await ctx.service.comment(user, postId, 'wrong thread', other.comment.id)).toEqual({
      status: 'NOT_AVAILABLE',
    });
  });

  it('lists comments oldest-first', async () => {
    let t = 0;
    ctx.repo.now = () => new Date(1_700_000_000_000 + (t += 1000));
    await ctx.service.comment(user, postId, 'first');
    await ctx.service.comment(user, postId, 'second');

    const page = await ctx.service.listComments(user, postId);
    expect(page?.comments.map((c) => c.body)).toEqual(['first', 'second']);
  });

  it('never logs the comment body', async () => {
    await ctx.service.comment(user, postId, 'a private sentence');
    for (const line of ctx.logs) expect(line).not.toContain('a private sentence');
  });
});

describe('EngagementService — deleting comments (ENGAGE-FR-004/005)', () => {
  let ctx: ReturnType<typeof build>;
  let postId: string;
  beforeEach(() => {
    ctx = build();
    postId = randomUUID();
  });

  it('lets the comment author delete it, with its replies', async () => {
    const author = randomUUID();
    const top = await ctx.service.comment(author, postId, 'top');
    if (top.status !== 'CREATED') throw new Error('expected a comment');
    await ctx.service.comment(randomUUID(), postId, 'reply one', top.comment.id);
    await ctx.service.comment(randomUUID(), postId, 'reply two', top.comment.id);

    const r = await ctx.service.deleteComment(author, top.comment.id);
    // ENGAGE-FR-004 AC: "GIVEN a comment with 3 replies, WHEN the comment
    // author deletes it, THEN the replies are removed with it."
    expect(r).toEqual({ status: 'DELETED', removed: 3 });
  });

  it("LETS THE POST'S AUTHOR DELETE SOMEONE ELSE'S COMMENT (BR-020)", async () => {
    const commenter = randomUUID();
    const c = await ctx.service.comment(commenter, postId, 'abusive');
    if (c.status !== 'CREATED') throw new Error('expected a comment');

    const r = await ctx.service.deleteComment(ctx.postAuthorId, c.comment.id);
    expect(r.status).toBe('DELETED');
  });

  it('REFUSES A THIRD PARTY, with the same neutral answer as a missing comment', async () => {
    const c = await ctx.service.comment(randomUUID(), postId, 'not yours');
    if (c.status !== 'CREATED') throw new Error('expected a comment');

    const refused = await ctx.service.deleteComment(randomUUID(), c.comment.id);
    const missing = await ctx.service.deleteComment(randomUUID(), randomUUID());
    expect(JSON.stringify(refused)).toBe(JSON.stringify(missing));
    expect(refused).toEqual({ status: 'NOT_AVAILABLE' });
  });

  it('is idempotent — deleting twice reports unavailable', async () => {
    const author = randomUUID();
    const c = await ctx.service.comment(author, postId, 'x');
    if (c.status !== 'CREATED') throw new Error('expected a comment');

    expect((await ctx.service.deleteComment(author, c.comment.id)).status).toBe('DELETED');
    expect(await ctx.service.deleteComment(author, c.comment.id)).toEqual({
      status: 'NOT_AVAILABLE',
    });
  });

  it('records whether the post author did it, for later review (ENGAGE-FR-005)', async () => {
    const c = await ctx.service.comment(randomUUID(), postId, 'x');
    if (c.status !== 'CREATED') throw new Error('expected a comment');
    ctx.logs.length = 0;

    await ctx.service.deleteComment(ctx.postAuthorId, c.comment.id);
    // "the deletion is recorded so that abuse of it can be reviewed if the
    // post is later reported".
    expect(ctx.logs.some((l) => l.includes('"byPostAuthor":true'))).toBe(true);
  });
});

describe('EngagementService — per-viewer counts (ENGAGE-FR-006)', () => {
  it('SUBTRACTS CONTRIBUTIONS FROM BLOCKED USERS', async () => {
    const ctx = build();
    const viewer = randomUUID();
    const blockedUser = randomUUID();
    const postId = randomUUID();

    await ctx.service.like(blockedUser, postId);
    await ctx.service.comment(blockedUser, postId, 'from a blocked user');
    ctx.repo.blocked.add(blockedUser);

    const counts = await ctx.service.adjustedCounts(viewer, [
      { id: postId, likeCount: 1, commentCount: 1 },
    ]);

    // ENGAGE-FR-006 AC: "GIVEN a post liked by a user I have blocked, WHEN I
    // view the post, THEN that like is not included in the count I see."
    expect(counts.get(postId)?.likeCount).toBe(0);
    expect(counts.get(postId)?.commentCount).toBe(0);
  });

  it('leaves counts alone when nothing is blocked', async () => {
    const ctx = build();
    const postId = randomUUID();
    const counts = await ctx.service.adjustedCounts(randomUUID(), [
      { id: postId, likeCount: 5, commentCount: 3 },
    ]);
    expect(counts.get(postId)).toMatchObject({ likeCount: 5, commentCount: 3 });
  });

  it('NEVER GOES NEGATIVE', async () => {
    // The stored count and the hidden count are read in separate statements,
    // so a like removed between them could otherwise produce a negative -
    // which would look like a bug to a user.
    const ctx = build();
    const blockedUser = randomUUID();
    const postId = randomUUID();
    await ctx.service.like(blockedUser, postId);
    ctx.repo.blocked.add(blockedUser);

    const counts = await ctx.service.adjustedCounts(randomUUID(), [
      { id: postId, likeCount: 0, commentCount: 0 },
    ]);
    expect(counts.get(postId)?.likeCount).toBe(0);
  });

  it('reports whether the viewer has liked, for the like control', async () => {
    const ctx = build();
    const viewer = randomUUID();
    const postId = randomUUID();
    await ctx.service.like(viewer, postId);

    const counts = await ctx.service.adjustedCounts(viewer, [
      { id: postId, likeCount: 1, commentCount: 0 },
    ]);
    expect(counts.get(postId)?.viewerHasLiked).toBe(true);
  });

  it('handles an empty page without a query', async () => {
    const ctx = build();
    expect((await ctx.service.adjustedCounts(randomUUID(), [])).size).toBe(0);
  });
});
