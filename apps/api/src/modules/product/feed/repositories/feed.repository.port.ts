import type { PoolClient } from 'pg';
import type { PostRecord } from '../../posts/repositories/post.repository.port.js';

export const FEED_REPOSITORY = Symbol.for('mohalla.feed.repository');

export interface FeedCursor {
  createdAt: Date;
  id: string;
}

export interface FeedPage {
  posts: PostRecord[];
  nextCursor: FeedCursor | null;
}

export interface FeedQuery {
  viewerId: string;
  limit: number;
  cursor?: FeedCursor | undefined;
  /** FEED-FR-006: one category, or none. Filtering never changes ordering. */
  categorySlug?: string | undefined;
  /** FEED-FR-005: posts NEWER than this, for pull-to-refresh. */
  since?: Date | undefined;
}

/**
 * An announcement, in BOTH languages.
 *
 * ADMIN-FR-009 requires both versions "because a single-language announcement
 * fails half the audience", so the record carries both and the service picks
 * the reader's — the same shape as a notification template, and for the same
 * reason: LOCALE-FR-002 wants a language switch to change what is already on
 * screen, which pre-picking at the database would prevent.
 */
export interface AnnouncementRecord {
  id: string;
  titleEn: string;
  titleUr: string;
  bodyEn: string;
  bodyUr: string;
  expiresAt: Date;
  createdAt: Date;
}

export interface FeedRepository {
  /**
   * FEED-FR-001 — posts from accounts the viewer follows, newest first.
   *
   * BR-026: strictly reverse-chronological, never algorithmic. There is no
   * scoring column and no ranking parameter, so the ordering cannot quietly
   * become something else.
   */
  following(query: FeedQuery, client?: PoolClient): Promise<FeedPage>;

  /**
   * FEED-FR-003 — every visible post platform-wide, newest first.
   *
   * The answer to cold start: a brand-new account following nobody must still
   * see the platform. Same exclusions as the following feed.
   */
  discover(query: FeedQuery, client?: PoolClient): Promise<FeedPage>;

  /**
   * FEED-FR-002 — up to five unexpired announcements, newest first.
   *
   * Deliberately takes NO viewer and NO follow data. §240: "`FeaturedService`
   * must not depend on follow data … it is a separate query with its own cache
   * so a slow Following query cannot delay it." This is the cold-start
   * guarantee (RSK-001), so it must not be able to fail for a reason that
   * belongs to another query.
   */
  featured(limit: number, client?: PoolClient): Promise<AnnouncementRecord[]>;

  /** FEED-FR-007 (Could) — the viewer's saved posts, newest-saved-first. */
  saved(query: FeedQuery, client?: PoolClient): Promise<FeedPage>;

  savePost(userId: string, postId: string, client: PoolClient): Promise<boolean>;
  unsavePost(userId: string, postId: string, client: PoolClient): Promise<boolean>;
}
