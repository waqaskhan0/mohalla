import type { PoolClient } from 'pg';

export const ENGAGEMENT_REPOSITORY = Symbol.for('mohalla.engagement.repository');

export type CommentVisibilityState = 'VISIBLE' | 'AUTO_HIDDEN' | 'DELETED';

export interface CommentRecord {
  id: string;
  postId: string;
  authorId: string;
  parentCommentId: string | null;
  body: string;
  visibilityState: CommentVisibilityState;
  createdAt: Date;
}

export interface CommentPage {
  comments: CommentRecord[];
  nextCursor: { createdAt: Date; id: string } | null;
}

/**
 * How many likes and comments on this post come from people the VIEWER cannot
 * see (ENGAGE-FR-006).
 *
 * The requirement is explicit that this is per-viewer: "counts exclude likes
 * and comments from blocked users, so two users who have blocked each other may
 * see slightly different totals". The denormalised counters on `posts` are the
 * platform-wide truth; this is what the viewer is shown instead.
 */
export interface HiddenEngagement {
  likes: number;
  comments: number;
}

export interface EngagementRepository {
  // ---- likes -----------------------------------------------------------
  /**
   * @returns false when the like already existed. Idempotent by the composite
   * PRIMARY KEY (BR-031) rather than by a prior existence check, which is what
   * makes ENGAGE-FR-001's six-rapid-taps criterion hold under real concurrency.
   */
  like(userId: string, postId: string, client: PoolClient): Promise<boolean>;

  /** @returns false when no like existed. Idempotent for the same reason. */
  unlike(userId: string, postId: string, client: PoolClient): Promise<boolean>;

  hasLiked(userId: string, postId: string, client?: PoolClient): Promise<boolean>;

  /** Which of these posts the viewer has liked, for rendering feed state. */
  likedPostIds(
    userId: string,
    postIds: readonly string[],
    client?: PoolClient,
  ): Promise<Set<string>>;

  // ---- comments ---------------------------------------------------------
  createComment(
    input: {
      id: string;
      postId: string;
      authorId: string;
      parentCommentId: string | null;
      body: string;
    },
    client: PoolClient,
  ): Promise<CommentRecord>;

  findCommentById(id: string, client?: PoolClient): Promise<CommentRecord | null>;

  /**
   * A post's comments, OLDEST first (ENGAGE-FR-002).
   *
   * Oldest-first rather than newest-first, because a comment thread is a
   * conversation and reading it backwards makes replies precede what they
   * reply to.
   *
   * `viewerId` filters out comments from blocked users in either direction,
   * here rather than in the caller — a list endpoint that returns everything
   * and expects filtering later is how blocked content leaks.
   */
  listComments(
    viewerId: string,
    postId: string,
    limit: number,
    cursor: { createdAt: Date; id: string } | undefined,
    client?: PoolClient,
  ): Promise<CommentPage>;

  /**
   * Soft-delete a comment and its replies (ENGAGE-FR-004).
   *
   * Soft rather than a row delete, because a comment can be the subject of a
   * moderation report and the report must still resolve to something. The
   * count trigger follows the STATE, so the count moves either way.
   *
   * @returns how many rows changed, parent and replies together.
   */
  deleteCommentCascade(id: string, client: PoolClient): Promise<number>;

  // ---- per-viewer counts (ENGAGE-FR-006) --------------------------------
  hiddenEngagementFor(
    viewerId: string,
    postIds: readonly string[],
    client?: PoolClient,
  ): Promise<Map<string, HiddenEngagement>>;
}
