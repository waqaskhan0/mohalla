import type { PoolClient } from 'pg';
import type { PostVisibilityState } from '../domain/post-visibility.js';

export const POST_REPOSITORY = Symbol.for('mohalla.posts.repository');

export interface PostRecord {
  id: string;
  authorId: string;
  body: string;
  categoryId: string | null;
  categorySlug: string | null;
  visibilityState: PostVisibilityState;
  likeCount: number;
  commentCount: number;
  editedAt: Date | null;
  createdAt: Date;
  /** Attachment ids in their stored order (BR-013). */
  mediaIds: string[];
}

export interface CreatePostInput {
  id: string;
  authorId: string;
  body: string;
  categoryId: string | null;
  /** In the order the author chose; position is the array index. */
  mediaIds: readonly string[];
}

export interface PostPage {
  posts: PostRecord[];
  /** Keyset cursor for the next page, or null at the end. */
  nextCursor: { createdAt: Date; id: string } | null;
}

export interface PostRepository {
  /**
   * Create the post and attach its media, in ONE transaction.
   *
   * The attachment insert is what triggers ADR-013 step 7 — a post cannot
   * reference media that is not `READY`, and cannot reference someone else's.
   * Both are raised by the database, so a failure here means the whole post
   * rolls back rather than existing with a missing image.
   */
  create(input: CreatePostInput, client: PoolClient): Promise<PostRecord>;

  findById(id: string, client?: PoolClient): Promise<PostRecord | null>;

  /**
   * Edit body and category only (POST-FR-008).
   *
   * Attachments are deliberately absent from this interface. BR-014 forbids
   * changing them by editing, "which prevents bait-and-switch on content that
   * others have already endorsed" — a post that gathered fifty likes as a
   * notice about water must not become an advertisement with the same likes.
   */
  updateBodyAndCategory(
    id: string,
    input: { body: string; categoryId: string | null },
    client: PoolClient,
  ): Promise<PostRecord | null>;

  /**
   * Mark a post deleted by its author (POST-FR-007).
   *
   * A state change, not a row delete. `AUTHOR_DELETED` is what tells an
   * administrator they may not restore it (BR-014); a deleted row would lose
   * that distinction, and the moderation trail with it.
   */
  markAuthorDeleted(id: string, client: PoolClient): Promise<boolean>;

  /**
   * Media attached to a post, for cleanup when it is deleted.
   *
   * POST-FR-007: "the post, its comments, its likes and its attachments are
   * removed".
   */
  listAttachedMedia(postId: string, client?: PoolClient): Promise<string[]>;

  /**
   * A profile's posts, newest first (PROFILE-FR-008, PROF-API-007).
   *
   * `viewerId` is required so the block predicate and the author-only
   * visibility of `AUTO_HIDDEN` are applied here rather than left to the
   * caller — a list endpoint that returned everything and expected filtering
   * later is how hidden content leaks.
   */
  listByAuthor(
    viewerId: string,
    authorId: string,
    limit: number,
    cursor: { createdAt: Date; id: string } | undefined,
    client?: PoolClient,
  ): Promise<PostPage>;
}
