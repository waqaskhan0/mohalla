import { Injectable } from '@nestjs/common';
import type { PoolClient, QueryResult, QueryResultRow } from 'pg';
import { DatabaseService } from '../../../../database/database.service.js';
import { notBlockedSql } from '../../safety/domain/visibility-policy.js';
import type { PostRecord } from '../../posts/repositories/post.repository.port.js';
import type { PostVisibilityState } from '../../posts/domain/post-visibility.js';
import type {
  AnnouncementRecord,
  FeedPage,
  FeedQuery,
  FeedRepository,
} from './feed.repository.port.js';

interface Row {
  id: string;
  author_id: string;
  body: string;
  category_id: string | null;
  category_slug: string | null;
  visibility_state: PostVisibilityState;
  like_count: number;
  comment_count: number;
  edited_at: Date | null;
  created_at: Date;
  media_ids: string[] | null;
}

const toPost = (r: Row): PostRecord => ({
  id: r.id,
  authorId: r.author_id,
  body: r.body,
  categoryId: r.category_id,
  categorySlug: r.category_slug,
  visibilityState: r.visibility_state,
  likeCount: r.like_count,
  commentCount: r.comment_count,
  editedAt: r.edited_at,
  createdAt: r.created_at,
  mediaIds: r.media_ids ?? [],
});

const POST_COLUMNS = `
  p.id, p.author_id, p.body, p.category_id, cat.slug AS category_slug,
  p.visibility_state, p.like_count, p.comment_count, p.edited_at, p.created_at,
  (
    SELECT array_agg(pm.media_id ORDER BY pm.position)
      FROM post_media pm WHERE pm.post_id = p.id
  ) AS media_ids`;

/**
 * The exclusions every feed applies (BR-027, BR-028).
 *
 * ONE definition, shared by both feeds, because FEED-FR-003 says the discover
 * feed has the "same exclusions as FEED-FR-001" — and two copies of a rule
 * stated as "the same" is how they stop being the same.
 *
 *   - only VISIBLE posts (auto-hidden and deleted never appear)
 *   - author ACTIVE or SUSPENDED: "posts from suspended users remain visible,
 *     posts from banned users do not"
 *   - no block in either direction
 */
const FEED_EXCLUSIONS = (viewerParam: string): string => `
  p.visibility_state = 'VISIBLE'
  AND u.state IN ('ACTIVE', 'SUSPENDED')
  AND ${notBlockedSql(viewerParam, 'p.author_id')}`;

@Injectable()
export class PgFeedRepository implements FeedRepository {
  constructor(private readonly db: DatabaseService) {}

  private q<R extends QueryResultRow>(
    client: PoolClient | undefined,
    sql: string,
    params: unknown[],
  ): Promise<QueryResult<R>> {
    return client === undefined ? this.db.query<R>(sql, params) : client.query<R>(sql, params);
  }

  async following(query: FeedQuery, client?: PoolClient): Promise<FeedPage> {
    return this.page(
      client,
      query,
      `JOIN follows f ON f.followee_id = p.author_id AND f.follower_id = $1`,
      '',
    );
  }

  async discover(query: FeedQuery, client?: PoolClient): Promise<FeedPage> {
    // No follow join at all. FEED-FR-003's acceptance criterion is a
    // brand-new account following nobody seeing posts from across the
    // platform, so a join here would defeat the requirement.
    return this.page(client, query, '', '');
  }

  async saved(query: FeedQuery, client?: PoolClient): Promise<FeedPage> {
    // Ordered by when it was SAVED, not when it was posted (FEED-FR-007:
    // "newest-saved-first"). A deleted post disappears from the list because
    // the shared exclusions still apply.
    return this.page(
      client,
      query,
      `JOIN saved_posts sp ON sp.post_id = p.id AND sp.user_id = $1`,
      'sp.',
    );
  }

  /**
   * The one query shape behind all three feeds.
   *
   * Shared so the EXCLUSIONS cannot differ between them. That is the whole
   * point of the indirection: BR-027 and BR-028 apply to every surface, and a
   * per-feed copy is how one of them ends up missing a clause.
   *
   * @param orderPrefix which table supplies the ordering timestamp — the post
   * for the feeds, the save for the saved list.
   */
  private async page(
    client: PoolClient | undefined,
    query: FeedQuery,
    joinClause: string,
    orderPrefix: '' | 'sp.',
  ): Promise<FeedPage> {
    const orderTable = orderPrefix === 'sp.' ? 'sp' : 'p';
    const orderCol = `${orderTable}.created_at`;

    const params: unknown[] = [
      query.viewerId,
      query.cursor?.createdAt ?? null,
      query.cursor?.id ?? null,
      query.limit + 1,
      query.categorySlug ?? null,
      query.since ?? null,
    ];

    const r = await this.q<Row>(
      client,
      `SELECT ${POST_COLUMNS}, ${orderCol} AS order_at
         FROM posts p
         JOIN users u ON u.id = p.author_id
         LEFT JOIN categories cat ON cat.id = p.category_id
         ${joinClause}
        WHERE ${FEED_EXCLUSIONS('$1')}
          -- FEED-FR-006: filtering never changes ordering, only membership.
          AND ($5::text IS NULL OR cat.slug = $5)
          -- FEED-FR-005: pull-to-refresh asks for what is NEWER than the top.
          AND ($6::timestamptz IS NULL OR ${orderCol} > $6)
          -- Keyset (EDGE-017). Compares the PAIR, so posts sharing a
          -- timestamp cannot be skipped or repeated - which OFFSET would do
          -- as soon as anyone posts while a reader is scrolling.
          AND ($2::timestamptz IS NULL OR (${orderCol}, p.id) < ($2, $3))
        ORDER BY ${orderCol} DESC, p.id DESC
        LIMIT $4`,
      params,
    );

    const hasMore = r.rows.length > query.limit;
    const rows = hasMore ? r.rows.slice(0, query.limit) : r.rows;
    const last = rows[rows.length - 1] as (Row & { order_at?: Date }) | undefined;

    return {
      posts: rows.map(toPost),
      nextCursor:
        hasMore && last ? { createdAt: last.order_at ?? last.created_at, id: last.id } : null,
    };
  }

  async featured(limit: number, client?: PoolClient): Promise<AnnouncementRecord[]> {
    // No viewer, no follow data, no join to anything (§240). This is the
    // cold-start guarantee, so it must not be able to fail for a reason that
    // belongs to another query.
    const r = await this.q<{
      id: string;
      title_en: string;
      title_ur: string;
      body_en: string;
      body_ur: string;
      expires_at: Date;
      created_at: Date;
    }>(
      client,
      `SELECT id, title_en, title_ur, body_en, body_ur, expires_at, created_at
         FROM announcements
        WHERE expires_at > now()
        ORDER BY created_at DESC
        LIMIT $1`,
      [limit],
    );

    return r.rows.map((row) => ({
      id: row.id,
      titleEn: row.title_en,
      titleUr: row.title_ur,
      bodyEn: row.body_en,
      bodyUr: row.body_ur,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
    }));
  }

  async savePost(userId: string, postId: string, client: PoolClient): Promise<boolean> {
    const r = await client.query(
      `INSERT INTO saved_posts (user_id, post_id) VALUES ($1, $2)
       ON CONFLICT (user_id, post_id) DO NOTHING`,
      [userId, postId],
    );
    return (r.rowCount ?? 0) > 0;
  }

  async unsavePost(userId: string, postId: string, client: PoolClient): Promise<boolean> {
    const r = await client.query('DELETE FROM saved_posts WHERE user_id = $1 AND post_id = $2', [
      userId,
      postId,
    ]);
    return (r.rowCount ?? 0) > 0;
  }
}
