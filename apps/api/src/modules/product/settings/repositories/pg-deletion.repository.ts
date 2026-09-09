import { Injectable } from '@nestjs/common';
import type { PoolClient, QueryResult, QueryResultRow } from 'pg';
import { DatabaseService } from '../../../../database/database.service.js';
import type { DeletionRepository, DeletionRequestRecord } from './deletion.repository.port.js';

interface Row {
  id: string;
  user_id: string;
  requested_at: Date;
  scheduled_erasure_at: Date;
  restored_at: Date | null;
  completed_at: Date | null;
}

const toRecord = (r: Row): DeletionRequestRecord => ({
  id: r.id,
  userId: r.user_id,
  requestedAt: r.requested_at,
  scheduledErasureAt: r.scheduled_erasure_at,
  restoredAt: r.restored_at,
  completedAt: r.completed_at,
});

const COLUMNS = 'id, user_id, requested_at, scheduled_erasure_at, restored_at, completed_at';

@Injectable()
export class PgDeletionRepository implements DeletionRepository {
  constructor(private readonly db: DatabaseService) {}

  private q<R extends QueryResultRow>(
    client: PoolClient | undefined,
    sql: string,
    params: unknown[],
  ): Promise<QueryResult<R>> {
    return client === undefined ? this.db.query<R>(sql, params) : client.query<R>(sql, params);
  }

  async createRequest(
    input: {
      id: string;
      userId: string;
      requestedAt: Date;
      scheduledErasureAt: Date;
    },
    client: PoolClient,
  ): Promise<DeletionRequestRecord> {
    const r = await client.query<Row>(
      `INSERT INTO deletion_requests (id, user_id, requested_at, scheduled_erasure_at)
       VALUES ($1, $2, $3, $4)
       RETURNING ${COLUMNS}`,
      [input.id, input.userId, input.requestedAt, input.scheduledErasureAt],
    );
    const row = r.rows[0];
    if (row === undefined) throw new Error('deletion request insert returned no row');
    return toRecord(row);
  }

  async findOpenRequest(
    userId: string,
    client?: PoolClient,
  ): Promise<DeletionRequestRecord | null> {
    const r = await this.q<Row>(
      client,
      `SELECT ${COLUMNS} FROM deletion_requests
        WHERE user_id = $1 AND restored_at IS NULL AND completed_at IS NULL`,
      [userId],
    );
    const row = r.rows[0];
    return row === undefined ? null : toRecord(row);
  }

  async lockOpenRequest(userId: string, client: PoolClient): Promise<DeletionRequestRecord | null> {
    // FOR UPDATE, and the CALLER re-checks the outcome columns afterwards.
    // Holding the lock is only half the guard: the row may have changed before
    // the lock was granted, and a lock without a re-read proves nothing.
    const r = await client.query<Row>(
      `SELECT ${COLUMNS} FROM deletion_requests
        WHERE user_id = $1 AND restored_at IS NULL AND completed_at IS NULL
        FOR UPDATE`,
      [userId],
    );
    const row = r.rows[0];
    return row === undefined ? null : toRecord(row);
  }

  async markRestored(id: string, at: Date, client: PoolClient): Promise<boolean> {
    // The outcome columns are in the WHERE clause as well as the CHECK. Two
    // guards for one rule, because this is the boundary between reversible and
    // not: an UPDATE that matched a row already marked completed would be a
    // restore of an account that no longer exists.
    const r = await client.query(
      `UPDATE deletion_requests SET restored_at = $2
        WHERE id = $1 AND restored_at IS NULL AND completed_at IS NULL`,
      [id, at],
    );
    return (r.rowCount ?? 0) > 0;
  }

  async withdrawMessageRequests(userId: string, client: PoolClient): Promise<number> {
    // The row updated is the RECIPIENT'S, because `request_state` records what
    // the receiving side is being asked to decide. The deleting user's own row
    // in the same conversation is ACCEPTED and is left alone — theirs goes when
    // the user row does (CASCADE, BR-046).
    const r = await client.query(
      `UPDATE conversation_participants AS recipient
          SET request_state = 'WITHDRAWN'
        FROM conversation_participants AS sender
       WHERE sender.conversation_id = recipient.conversation_id
         AND sender.user_id = $1
         AND recipient.user_id <> $1
         AND recipient.request_state = 'PENDING'`,
      [userId],
    );
    return r.rowCount ?? 0;
  }

  async reinstateMessageRequests(userId: string, client: PoolClient): Promise<number> {
    const r = await client.query(
      `UPDATE conversation_participants AS recipient
          SET request_state = 'PENDING'
        FROM conversation_participants AS sender
       WHERE sender.conversation_id = recipient.conversation_id
         AND sender.user_id = $1
         AND recipient.user_id <> $1
         AND recipient.request_state = 'WITHDRAWN'`,
      [userId],
    );
    return r.rowCount ?? 0;
  }

  async markCompleted(id: string, at: Date, client: PoolClient): Promise<boolean> {
    const r = await client.query(
      `UPDATE deletion_requests SET completed_at = $2
        WHERE id = $1 AND restored_at IS NULL AND completed_at IS NULL`,
      [id, at],
    );
    return (r.rowCount ?? 0) > 0;
  }

  async findDue(now: Date, limit: number, client?: PoolClient): Promise<DeletionRequestRecord[]> {
    const r = await this.q<Row>(
      client,
      `SELECT ${COLUMNS} FROM deletion_requests
        WHERE restored_at IS NULL
          AND completed_at IS NULL
          AND scheduled_erasure_at <= $1
        ORDER BY scheduled_erasure_at
        LIMIT $2`,
      [now, limit],
    );
    return r.rows.map(toRecord);
  }

  async setState(
    userId: string,
    state: 'ACTIVE' | 'PENDING_DELETION' | 'DELETED',
    client: PoolClient,
  ): Promise<boolean> {
    const r = await client.query(
      `UPDATE users SET state = $2, state_changed_at = now()
        WHERE id = $1 AND state <> 'DELETED'`,
      [userId, state],
    );
    return (r.rowCount ?? 0) > 0;
  }

  async identifierStatus(
    hash: Buffer,
    client?: PoolClient,
  ): Promise<'FREE' | 'RESERVED' | 'PENDING_DELETION'> {
    // RESERVED is checked first: it is terminal, while PENDING is not. An
    // identifier could in principle appear in both if a reservation were ever
    // written while a request was open, and the honest answer in that case is
    // the one the user cannot act on.
    const reserved = await this.q<{ ok: boolean }>(
      client,
      'SELECT EXISTS (SELECT 1 FROM reserved_identifiers WHERE identifier_hash = $1) AS ok',
      [hash],
    );
    if (reserved.rows[0]?.ok === true) return 'RESERVED';

    const pending = await this.q<{ ok: boolean }>(
      client,
      `SELECT EXISTS (
         SELECT 1
           FROM user_identifiers ui
           JOIN deletion_requests d ON d.user_id = ui.user_id
          WHERE ui.value_hash = $1
            AND d.restored_at IS NULL
            AND d.completed_at IS NULL
       ) AS ok`,
      [hash],
    );
    return pending.rows[0]?.ok === true ? 'PENDING_DELETION' : 'FREE';
  }
}
