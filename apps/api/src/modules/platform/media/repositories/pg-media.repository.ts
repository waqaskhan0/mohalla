import { Injectable } from '@nestjs/common';
import type { PoolClient, QueryResult, QueryResultRow } from 'pg';
import { DatabaseService } from '../../../../database/database.service.js';
import type {
  MediaKind,
  MediaRecord,
  MediaRepository,
  MediaState,
} from './media.repository.port.js';

interface Row {
  id: string;
  owner_id: string;
  kind: MediaKind;
  state: MediaState;
  quarantine_key: string;
  storage_key: string | null;
  mime_verified: string | null;
  byte_size: number | null;
  width: number | null;
  height: number | null;
  rejection_reason: string | null;
  created_at: Date;
  ready_at: Date | null;
}

const toMedia = (r: Row): MediaRecord => ({
  id: r.id,
  ownerId: r.owner_id,
  kind: r.kind,
  state: r.state,
  quarantineKey: r.quarantine_key,
  storageKey: r.storage_key,
  mimeVerified: r.mime_verified,
  byteSize: r.byte_size,
  width: r.width,
  height: r.height,
  rejectionReason: r.rejection_reason,
  createdAt: r.created_at,
  readyAt: r.ready_at,
});

@Injectable()
export class PgMediaRepository implements MediaRepository {
  constructor(private readonly db: DatabaseService) {}

  private q<R extends QueryResultRow>(
    client: PoolClient | undefined,
    sql: string,
    params: unknown[],
  ): Promise<QueryResult<R>> {
    return client === undefined ? this.db.query<R>(sql, params) : client.query<R>(sql, params);
  }

  async createSlot(
    input: { id: string; ownerId: string; kind: MediaKind; quarantineKey: string },
    client?: PoolClient,
  ): Promise<MediaRecord> {
    const r = await this.q<Row>(
      client,
      `INSERT INTO media (id, owner_id, kind, state, quarantine_key)
       VALUES ($1, $2, $3, 'PENDING_UPLOAD', $4)
       RETURNING *`,
      [input.id, input.ownerId, input.kind, input.quarantineKey],
    );
    const row = r.rows[0];
    if (row === undefined) throw new Error('media slot insert returned no row');
    return toMedia(row);
  }

  async findById(id: string, client?: PoolClient): Promise<MediaRecord | null> {
    const r = await this.q<Row>(client, 'SELECT * FROM media WHERE id = $1', [id]);
    const row = r.rows[0];
    return row ? toMedia(row) : null;
  }

  async findByQuarantineKey(key: string, client?: PoolClient): Promise<MediaRecord | null> {
    const r = await this.q<Row>(client, 'SELECT * FROM media WHERE quarantine_key = $1', [key]);
    const row = r.rows[0];
    return row ? toMedia(row) : null;
  }

  async markProcessing(id: string, client?: PoolClient): Promise<boolean> {
    // The state guard is IN the UPDATE, not a read-then-write. Two concurrent
    // completions therefore cannot both start an inspection - exactly one
    // UPDATE matches, and the other gets rowCount 0.
    const r = await this.q(
      client,
      `UPDATE media SET state = 'PROCESSING'
        WHERE id = $1 AND state = 'PENDING_UPLOAD'`,
      [id],
    );
    return (r.rowCount ?? 0) > 0;
  }

  async markReady(
    id: string,
    result: {
      storageKey: string;
      mimeVerified: string;
      byteSize: number;
      width: number | null;
      height: number | null;
    },
    client?: PoolClient,
  ): Promise<void> {
    await this.q(
      client,
      `UPDATE media
          SET state = 'READY',
              storage_key = $2,
              mime_verified = $3,
              byte_size = $4,
              width = $5,
              height = $6,
              ready_at = now(),
              rejection_reason = NULL
        WHERE id = $1 AND state = 'PROCESSING'`,
      [id, result.storageKey, result.mimeVerified, result.byteSize, result.width, result.height],
    );
  }

  async markRejected(id: string, reason: string, client?: PoolClient): Promise<void> {
    // Clears the storage key as well as setting the reason: the CHECK forbids
    // a REJECTED row from holding a served key, and this is the one path that
    // could otherwise violate it after a partial promotion.
    await this.q(
      client,
      `UPDATE media
          SET state = 'REJECTED', rejection_reason = $2, storage_key = NULL
        WHERE id = $1`,
      [id, reason],
    );
  }

  async findSweepable(olderThan: Date, limit: number, client?: PoolClient): Promise<MediaRecord[]> {
    const r = await this.q<Row>(
      client,
      `SELECT * FROM media
        WHERE state IN ('PENDING_UPLOAD', 'PROCESSING', 'REJECTED')
          AND created_at < $1
        ORDER BY created_at
        LIMIT $2`,
      [olderThan, limit],
    );
    return r.rows.map(toMedia);
  }

  async deleteById(id: string, client?: PoolClient): Promise<void> {
    await this.q(client, 'DELETE FROM media WHERE id = $1', [id]);
  }
}
