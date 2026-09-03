import { Injectable } from '@nestjs/common';
import type { PoolClient, QueryResult, QueryResultRow } from 'pg';
import { DatabaseService } from '../../../../database/database.service.js';
import { notBlockedSql } from '../../safety/domain/visibility-policy.js';
import type { PostVisibilityState } from '../domain/post-visibility.js';
import type {
  CreatePostInput,
  PostPage,
  PostRecord,
  PostRepository,
} from './post.repository.port.js';

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

/**
 * Every post read selects these columns.
 *
 * `media_ids` is aggregated ORDER BY position, which is what preserves the
 * order the author chose (POST-FR-003: "the order chosen is preserved"). A
 * plain array_agg would return whatever order the planner happened to produce.
 */
const POST_COLUMNS = `
  p.id, p.author_id, p.body, p.category_id, c.slug AS category_slug,
  p.visibility_state, p.like_count, p.comment_count, p.edited_at, p.created_at,
  (
    SELECT array_agg(pm.media_id ORDER BY pm.position)
      FROM post_media pm WHERE pm.post_id = p.id
  ) AS media_ids`;

const POST_FROM = `
  FROM posts p
  LEFT JOIN categories c ON c.id = p.category_id`;

@Injectable()
export class PgPostRepository implements PostRepository {
  constructor(private readonly db: DatabaseService) {}

  private q<R extends QueryResultRow>(
    client: PoolClient | undefined,
    sql: string,
    params: unknown[],
  ): Promise<QueryResult<R>> {
    return client === undefined ? this.db.query<R>(sql, params) : client.query<R>(sql, params);
  }

  async create(input: CreatePostInput, client: PoolClient): Promise<PostRecord> {
    await client.query(
      'INSERT INTO posts (id, author_id, body, category_id) VALUES ($1, $2, $3, $4)',
      [input.id, input.authorId, input.body, input.categoryId],
    );

    // Position is the array index, so the author's chosen order is stored
    // rather than inferred later. Each insert fires the ADR-013 step-7 trigger:
    // non-READY media, or media belonging to someone else, aborts the whole
    // transaction and the post never exists.
    for (const [position, mediaId] of input.mediaIds.entries()) {
      await client.query(
        'INSERT INTO post_media (post_id, media_id, position) VALUES ($1, $2, $3)',
        [input.id, mediaId, position],
      );
    }

    const created = await this.findById(input.id, client);
    if (created === null) throw new Error('post vanished within its own transaction');
    return created;
  }

  async findById(id: string, client?: PoolClient): Promise<PostRecord | null> {
    const r = await this.q<Row>(client, `SELECT ${POST_COLUMNS} ${POST_FROM} WHERE p.id = $1`, [
      id,
    ]);
    const row = r.rows[0];
    return row ? toPost(row) : null;
  }

  async updateBodyAndCategory(
    id: string,
    input: { body: string; categoryId: string | null },
    client: PoolClient,
  ): Promise<PostRecord | null> {
    // `edited_at` is set here rather than by the caller, so the "edited"
    // marker (POST-FR-008) cannot be omitted by a future code path.
    const r = await client.query(
      `UPDATE posts
          SET body = $2, category_id = $3, edited_at = now()
        WHERE id = $1 AND visibility_state IN ('VISIBLE', 'AUTO_HIDDEN')`,
      [id, input.body, input.categoryId],
    );
    if ((r.rowCount ?? 0) === 0) return null;
    return this.findById(id, client);
  }

  async markAuthorDeleted(id: string, client: PoolClient): Promise<boolean> {
    // Idempotent: deleting an already-deleted post is a no-op, not an error
    // (POST-FR-007's error case).
    const r = await client.query(
      `UPDATE posts SET visibility_state = 'AUTHOR_DELETED'
        WHERE id = $1 AND visibility_state <> 'AUTHOR_DELETED'`,
      [id],
    );
    return (r.rowCount ?? 0) > 0;
  }

  async listAttachedMedia(postId: string, client?: PoolClient): Promise<string[]> {
    const r = await this.q<{ media_id: string }>(
      client,
      'SELECT media_id FROM post_media WHERE post_id = $1 ORDER BY position',
      [postId],
    );
    return r.rows.map((row) => row.media_id);
  }

  async listByAuthor(
    viewerId: string,
    authorId: string,
    limit: number,
    cursor: { createdAt: Date; id: string } | undefined,
    client?: PoolClient,
  ): Promise<PostPage> {
    // The author sees their own AUTO_HIDDEN posts marked under review
    // (BR-032); nobody else does. Applied in the QUERY rather than by filtering
    // afterwards, because a list that returns hidden rows and trusts the caller
    // to drop them is how hidden content leaks.
    const visibleStates = viewerId === authorId ? `('VISIBLE', 'AUTO_HIDDEN')` : `('VISIBLE')`;

    // Keyset pagination on (created_at DESC, id DESC) - the project-wide
    // convention. OFFSET would skip or repeat rows as posts are created.
    const r = await this.q<Row>(
      client,
      `SELECT ${POST_COLUMNS} ${POST_FROM}
         JOIN users u ON u.id = p.author_id
        WHERE p.author_id = $2
          AND p.visibility_state IN ${visibleStates}
          AND u.state IN ('ACTIVE', 'SUSPENDED')
          AND ${notBlockedSql('$1', 'p.author_id')}
          AND ($3::timestamptz IS NULL OR (p.created_at, p.id) < ($3, $4))
        ORDER BY p.created_at DESC, p.id DESC
        LIMIT $5`,
      [viewerId, authorId, cursor?.createdAt ?? null, cursor?.id ?? null, limit + 1],
    );

    const hasMore = r.rows.length > limit;
    const rows = hasMore ? r.rows.slice(0, limit) : r.rows;
    const last = rows[rows.length - 1];

    return {
      posts: rows.map(toPost),
      nextCursor: hasMore && last ? { createdAt: last.created_at, id: last.id } : null,
    };
  }
}
