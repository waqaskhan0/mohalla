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

export interface AnnouncementRecord {
  id: string;
  title: string;
  body: string;
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
