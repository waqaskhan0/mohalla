import { Injectable } from '@nestjs/common';
import type { PoolClient, QueryResult, QueryResultRow } from 'pg';
import { DatabaseService } from '../../../../database/database.service.js';
import { blockedSql, notBlockedSql } from '../../safety/domain/visibility-policy.js';
import type {
  CommentPage,
  CommentRecord,
  CommentVisibilityState,
  EngagementRepository,
  HiddenEngagement,
} from './engagement.repository.port.js';

interface CommentRow {
  id: string;
  post_id: string;
  author_id: string;
  parent_comment_id: string | null;
  body: string;
  visibility_state: CommentVisibilityState;
  created_at: Date;
}

const toComment = (r: CommentRow): CommentRecord => ({
  id: r.id,
  postId: r.post_id,
  authorId: r.author_id,
  parentCommentId: r.parent_comment_id,
  body: r.body,
  visibilityState: r.visibility_state,
  createdAt: r.created_at,
});

@Injectable()
export class PgEngagementRepository implements EngagementRepository {
  constructor(private readonly db: DatabaseService) {}

  private q<R extends QueryResultRow>(
    client: PoolClient | undefined,
    sql: string,
    params: unknown[],
  ): Promise<QueryResult<R>> {
    return client === undefined ? this.db.query<R>(sql, params) : client.query<R>(sql, params);
  }

  // ---- likes -------------------------------------------------------------
  async like(userId: string, postId: string, client: PoolClient): Promise<boolean> {
    // ON CONFLICT DO NOTHING, not a prior SELECT. Six concurrent taps all run
    // this and exactly one inserts, which is what ENGAGE-FR-001's acceptance
    // criterion needs under real concurrency.
    const r = await client.query(
      `INSERT INTO likes (user_id, post_id) VALUES ($1, $2)
       ON CONFLICT (user_id, post_id) DO NOTHING`,
      [userId, postId],
    );
    return (r.rowCount ?? 0) > 0;
  }

  async unlike(userId: string, postId: string, client: PoolClient): Promise<boolean> {
    const r = await client.query('DELETE FROM likes WHERE user_id = $1 AND post_id = $2', [
      userId,
      postId,
    ]);
    return (r.rowCount ?? 0) > 0;
  }

  async hasLiked(userId: string, postId: string, client?: PoolClient): Promise<boolean> {
    const r = await this.q<{ liked: boolean }>(
      client,
      'SELECT EXISTS (SELECT 1 FROM likes WHERE user_id = $1 AND post_id = $2) AS liked',
      [userId, postId],
    );
    return r.rows[0]?.liked === true;
  }

  async likedPostIds(
    userId: string,
    postIds: readonly string[],
    client?: PoolClient,
  ): Promise<Set<string>> {
    if (postIds.length === 0) return new Set();
    // One query for the whole page rather than one per post - a feed of 20
    // posts would otherwise be 20 round trips on a slow connection.
    const r = await this.q<{ post_id: string }>(
      client,
      'SELECT post_id FROM likes WHERE user_id = $1 AND post_id = ANY($2::uuid[])',
      [userId, [...postIds]],
    );
    return new Set(r.rows.map((row) => row.post_id));
  }

  // ---- comments ----------------------------------------------------------
  async createComment(
    input: {
      id: string;
      postId: string;
      authorId: string;
      parentCommentId: string | null;
      body: string;
    },
    client: PoolClient,
  ): Promise<CommentRecord> {
    const r = await client.query<CommentRow>(
      `INSERT INTO comments (id, post_id, author_id, parent_comment_id, body)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [input.id, input.postId, input.authorId, input.parentCommentId, input.body],
    );
    const row = r.rows[0];
    if (row === undefined) throw new Error('comment insert returned no row');
    return toComment(row);
  }

  async findCommentById(id: string, client?: PoolClient): Promise<CommentRecord | null> {
    const r = await this.q<CommentRow>(client, 'SELECT * FROM comments WHERE id = $1', [id]);
    const row = r.rows[0];
    return row ? toComment(row) : null;
  }

  async listComments(
    viewerId: string,
    postId: string,
    limit: number,
    cursor: { createdAt: Date; id: string } | undefined,
    client?: PoolClient,
  ): Promise<CommentPage> {
    // OLDEST first (ENGAGE-FR-002), so a thread reads as a conversation. The
    // keyset comparison is therefore `>` rather than `<`.
    const r = await this.q<CommentRow>(
      client,
      `SELECT c.* FROM comments c
         JOIN users u ON u.id = c.author_id
        WHERE c.post_id = $2
          AND c.visibility_state = 'VISIBLE'
          AND u.state IN ('ACTIVE', 'SUSPENDED')
          AND ${notBlockedSql('$1', 'c.author_id')}
          AND ($3::timestamptz IS NULL OR (c.created_at, c.id) > ($3, $4))
        ORDER BY c.created_at, c.id
        LIMIT $5`,
      [viewerId, postId, cursor?.createdAt ?? null, cursor?.id ?? null, limit + 1],
    );

    const hasMore = r.rows.length > limit;
    const rows = hasMore ? r.rows.slice(0, limit) : r.rows;
    const last = rows[rows.length - 1];

    return {
      comments: rows.map(toComment),
      nextCursor: hasMore && last ? { createdAt: last.created_at, id: last.id } : null,
    };
  }

  async deleteCommentCascade(id: string, client: PoolClient): Promise<number> {
    // Parent and replies in ONE statement, so a failure cannot leave replies
    // to a comment that no longer renders (ENGAGE-FR-004).
    const r = await client.query(
      `UPDATE comments SET visibility_state = 'DELETED'
        WHERE (id = $1 OR parent_comment_id = $1)
          AND visibility_state <> 'DELETED'`,
      [id],
    );
    return r.rowCount ?? 0;
  }

  // ---- per-viewer counts (ENGAGE-FR-006) ---------------------------------
  async hiddenEngagementFor(
    viewerId: string,
    postIds: readonly string[],
    client?: PoolClient,
  ): Promise<Map<string, HiddenEngagement>> {
    const result = new Map<string, HiddenEngagement>();
    if (postIds.length === 0) return result;

    // Counts what must be SUBTRACTED from the denormalised totals, rather than
    // recomputing them. Two reasons: the stored counters stay the platform-wide
    // truth that moderation and ranking use, and the correction is proportional
    // to the number of BLOCKS - which is small - instead of to the number of
    // likes, which is not.
    //
    // One query for the whole page. Per-post queries would make a 20-post feed
    // 40 round trips.
    const r = await this.q<{ post_id: string; hidden_likes: string; hidden_comments: string }>(
      client,
      `SELECT p.id AS post_id,
              (SELECT count(*) FROM likes l
                WHERE l.post_id = p.id AND ${blockedSql('$1', 'l.user_id')})    AS hidden_likes,
              (SELECT count(*) FROM comments c
                WHERE c.post_id = p.id AND c.visibility_state = 'VISIBLE'
                  AND ${blockedSql('$1', 'c.author_id')})                       AS hidden_comments
         FROM posts p
        WHERE p.id = ANY($2::uuid[])`,
      [viewerId, [...postIds]],
    );

    for (const row of r.rows) {
      result.set(row.post_id, {
        likes: Number(row.hidden_likes),
        comments: Number(row.hidden_comments),
      });
    }
    return result;
  }
}
