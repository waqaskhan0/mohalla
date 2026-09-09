import { Injectable } from '@nestjs/common';
import type { PoolClient, QueryResult, QueryResultRow } from 'pg';
import { DatabaseService } from '../../../../database/database.service.js';
import { notBlockedSql } from '../../safety/domain/visibility-policy.js';
import type { FollowPage, FollowRepository } from './follow.repository.port.js';

/**
 * Account states whose profiles may appear in a list (PROFILE-FR-005).
 *
 * Suspended is INCLUDED: a suspension is temporary, and omitting a suspended
 * account from follower lists would silently rewrite the social graph for the
 * duration. Banned and deleted are excluded.
 */
const VISIBLE_STATES = `('ACTIVE', 'SUSPENDED')`;

@Injectable()
export class PgFollowRepository implements FollowRepository {
  constructor(private readonly db: DatabaseService) {}

  private q<Row extends QueryResultRow>(
    client: PoolClient | undefined,
    sql: string,
    params: unknown[],
  ): Promise<QueryResult<Row>> {
    return client === undefined ? this.db.query<Row>(sql, params) : client.query<Row>(sql, params);
  }

  async follow(followerId: string, followeeId: string, client: PoolClient): Promise<boolean> {
    // The composite PK does the idempotency (EDGE-015). No prior SELECT, so
    // two simultaneous follows cannot both insert.
    const r = await client.query(
      `INSERT INTO follows (follower_id, followee_id) VALUES ($1, $2)
       ON CONFLICT (follower_id, followee_id) DO NOTHING`,
      [followerId, followeeId],
    );
    return (r.rowCount ?? 0) > 0;
  }

  async unfollow(followerId: string, followeeId: string, client: PoolClient): Promise<boolean> {
    const r = await client.query(
      'DELETE FROM follows WHERE follower_id = $1 AND followee_id = $2',
      [followerId, followeeId],
    );
    return (r.rowCount ?? 0) > 0;
  }

  async isFollowing(followerId: string, followeeId: string, client?: PoolClient): Promise<boolean> {
    const r = await this.q<{ following: boolean }>(
      client,
      `SELECT EXISTS (
         SELECT 1 FROM follows WHERE follower_id = $1 AND followee_id = $2
       ) AS following`,
      [followerId, followeeId],
    );
    return r.rows[0]?.following === true;
  }

  async removeBothDirections(userA: string, userB: string, client: PoolClient): Promise<number> {
    const r = await client.query(
      `DELETE FROM follows
        WHERE (follower_id = $1 AND followee_id = $2)
           OR (follower_id = $2 AND followee_id = $1)`,
      [userA, userB],
    );
    return r.rowCount ?? 0;
  }

  async listFollowers(
    viewerId: string,
    subjectId: string,
    limit: number,
    before?: Date,
    client?: PoolClient,
  ): Promise<FollowPage> {
    return this.listEdges(
      client,
      'f.follower_id',
      'f.followee_id = $2',
      viewerId,
      subjectId,
      limit,
      before,
    );
  }

  async listFollowing(
    viewerId: string,
    subjectId: string,
    limit: number,
    before?: Date,
    client?: PoolClient,
  ): Promise<FollowPage> {
    return this.listEdges(
      client,
      'f.followee_id',
      'f.follower_id = $2',
      viewerId,
      subjectId,
      limit,
      before,
    );
  }

  /**
   * Both list directions, one query shape.
   *
   * Shared so the FILTERING cannot differ between them. That is the whole
   * reason for the indirection: SOCIAL-FR-003's acceptance criterion is about
   * a blocked user being absent from a follower list, and it would be easy to
   * apply the block predicate to one list and forget the other.
   */
  private async listEdges(
    client: PoolClient | undefined,
    selectColumn: string,
    subjectPredicate: string,
    viewerId: string,
    subjectId: string,
    limit: number,
    before?: Date,
  ): Promise<FollowPage> {
    // One extra row, to learn whether another page exists without a COUNT.
    const r = await this.q<{ user_id: string; created_at: Date }>(
      client,
      `SELECT ${selectColumn} AS user_id, f.created_at
         FROM follows f
         JOIN users u ON u.id = ${selectColumn}
        WHERE ${subjectPredicate}
          AND u.state IN ${VISIBLE_STATES}
          AND ${notBlockedSql('$1', selectColumn)}
          AND ($3::timestamptz IS NULL OR f.created_at < $3)
        ORDER BY f.created_at DESC
        LIMIT $4`,
      [viewerId, subjectId, before ?? null, limit + 1],
    );

    const hasMore = r.rows.length > limit;
    const page = hasMore ? r.rows.slice(0, limit) : r.rows;
    return {
      userIds: page.map((row) => row.user_id),
      nextBefore: hasMore ? (page[page.length - 1]?.created_at ?? null) : null,
    };
  }

  async suggestions(viewerId: string, limit: number, client?: PoolClient): Promise<string[]> {
    // Verified organizations first (the module spec's own test), then by
    // reach. Deliberately independent of interests: PROFILE-FR-011 requires a
    // non-empty default set even when nothing was selected, so making this
    // depend on interests would break that guarantee for most new users.
    const r = await this.q<{ user_id: string }>(
      client,
      `SELECT p.user_id
         FROM profiles p
         JOIN users u ON u.id = p.user_id
        WHERE p.user_id <> $1
          AND u.state IN ${VISIBLE_STATES}
          AND NOT EXISTS (
            SELECT 1 FROM follows f
             WHERE f.follower_id = $1 AND f.followee_id = p.user_id
          )
          AND ${notBlockedSql('$1', 'p.user_id')}
        ORDER BY (p.verified_badge AND u.account_type = 'ORGANIZATION') DESC,
                 p.follower_count DESC,
                 p.user_id
        LIMIT $2`,
      [viewerId, limit],
    );
    return r.rows.map((row) => row.user_id);
  }
}
