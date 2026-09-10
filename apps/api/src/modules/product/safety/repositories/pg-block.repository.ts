import { Injectable } from '@nestjs/common';
import type { PoolClient, QueryResult, QueryResultRow } from 'pg';
import { DatabaseService } from '../../../../database/database.service.js';
import { blockedSql } from '../domain/visibility-policy.js';
import type { BlockRepository, BlockRow } from './block.repository.port.js';

@Injectable()
export class PgBlockRepository implements BlockRepository {
  constructor(private readonly db: DatabaseService) {}

  private q<Row extends QueryResultRow>(
    client: PoolClient | undefined,
    sql: string,
    params: unknown[],
  ): Promise<QueryResult<Row>> {
    return client === undefined ? this.db.query<Row>(sql, params) : client.query<Row>(sql, params);
  }

  async isBlockedEitherWay(userA: string, userB: string, client?: PoolClient): Promise<boolean> {
    // Composed from the SHARED fragment rather than written out again, so this
    // adapter cannot drift from the predicate every other read path uses.
    const r = await this.q<{ blocked: boolean }>(
      client,
      `SELECT ${blockedSql('$1', '$2')} AS blocked`,
      [userA, userB],
    );
    return r.rows[0]?.blocked === true;
  }

  async create(blockerId: string, blockedId: string, client: PoolClient): Promise<boolean> {
    // ON CONFLICT DO NOTHING makes a repeat block a no-op rather than an error:
    // the user's intent is already satisfied, and reporting a failure would
    // suggest the block had not taken effect.
    const r = await client.query(
      `INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1, $2)
       ON CONFLICT (blocker_id, blocked_id) DO NOTHING`,
      [blockerId, blockedId],
    );
    return (r.rowCount ?? 0) > 0;
  }

  async remove(blockerId: string, blockedId: string, client: PoolClient): Promise<boolean> {
    // Deletes only the row THIS user created. Unblocking must not lift a block
    // the other person placed - that block is theirs, and its existence is not
    // disclosed either.
    const r = await client.query('DELETE FROM blocks WHERE blocker_id = $1 AND blocked_id = $2', [
      blockerId,
      blockedId,
    ]);
    return (r.rowCount ?? 0) > 0;
  }

  async blockCounterparts(userId: string, client?: PoolClient): Promise<string[]> {
    // Both directions in one pass. A block is symmetric in its EFFECT even
    // though the row is not, which is the whole point of `isBlockedEitherWay`.
    const r = await this.q<{ other_id: string }>(
      client,
      `SELECT blocked_id AS other_id FROM blocks WHERE blocker_id = $1
       UNION
       SELECT blocker_id AS other_id FROM blocks WHERE blocked_id = $1`,
      [userId],
    );
    return r.rows.map((row) => row.other_id);
  }

  async listBlockedBy(
    blockerId: string,
    limit: number,
    before?: Date,
    client?: PoolClient,
  ): Promise<BlockRow[]> {
    // Keyset pagination on created_at, consistent with the rest of the system.
    const r = await this.q<{ blocker_id: string; blocked_id: string; created_at: Date }>(
      client,
      `SELECT blocker_id, blocked_id, created_at
         FROM blocks
        WHERE blocker_id = $1
          AND ($2::timestamptz IS NULL OR created_at < $2)
        ORDER BY created_at DESC
        LIMIT $3`,
      [blockerId, before ?? null, limit],
    );
    return r.rows.map((row) => ({
      blockerId: row.blocker_id,
      blockedId: row.blocked_id,
      createdAt: row.created_at,
    }));
  }
}
