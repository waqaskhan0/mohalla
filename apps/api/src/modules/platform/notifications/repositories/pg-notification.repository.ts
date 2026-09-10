import { Injectable } from '@nestjs/common';
import type { PoolClient, QueryResult, QueryResultRow } from 'pg';
import type { Locale } from '@mohalla/localization';
import { DatabaseService } from '../../../../database/database.service.js';
import { TEMPLATE_KEYS } from '../domain/notification-category.js';
import type {
  NotificationCategory,
  NotificationTarget,
  PreferenceKey,
} from '../domain/notification-category.js';
import type {
  DeviceTokenRecord,
  NotificationPage,
  NotificationRecord,
  NotificationRepository,
  OutboxRow,
} from './notification.repository.port.js';

interface NotificationRow {
  id: string;
  recipient_id: string;
  category: NotificationCategory;
  actor_id: string | null;
  target_type: NotificationTarget;
  target_id: string | null;
  template_key: string;
  params: Record<string, string | number>;
  batch_count: number;
  read_at: Date | null;
  created_at: Date;
}

const toNotification = (r: NotificationRow): NotificationRecord => ({
  id: r.id,
  recipientId: r.recipient_id,
  category: r.category,
  actorId: r.actor_id,
  targetType: r.target_type,
  targetId: r.target_id,
  templateKey: r.template_key,
  params: r.params,
  batchCount: r.batch_count,
  readAt: r.read_at,
  createdAt: r.created_at,
});

const NOTIFICATION_COLUMNS = `id, recipient_id, category, actor_id, target_type, target_id,
  template_key, params, batch_count, read_at, created_at`;

@Injectable()
export class PgNotificationRepository implements NotificationRepository {
  constructor(private readonly db: DatabaseService) {}

  private q<R extends QueryResultRow>(
    client: PoolClient | undefined,
    sql: string,
    params: unknown[],
  ): Promise<QueryResult<R>> {
    return client === undefined ? this.db.query<R>(sql, params) : client.query<R>(sql, params);
  }

  // ---- outbox ------------------------------------------------------------
  async enqueue(
    input: { id: string; topic: string; payload: Record<string, unknown> },
    client: PoolClient,
  ): Promise<void> {
    await client.query('INSERT INTO outbox (id, topic, payload) VALUES ($1, $2, $3)', [
      input.id,
      input.topic,
      JSON.stringify(input.payload),
    ]);
  }

  async claimOutbox(limit: number, client: PoolClient): Promise<OutboxRow[]> {
    // SKIP LOCKED, so a second worker takes different rows rather than waiting
    // behind the first. Without it, two workers serialise into one and the
    // backlog never drains faster than a single consumer.
    const r = await client.query<{
      id: string;
      topic: string;
      payload: Record<string, unknown>;
      attempts: number;
      created_at: Date;
    }>(
      `SELECT id, topic, payload, attempts, created_at
         FROM outbox
        WHERE processed_at IS NULL
        ORDER BY created_at
        LIMIT $1
        FOR UPDATE SKIP LOCKED`,
      [limit],
    );
    return r.rows.map((row) => ({
      id: row.id,
      topic: row.topic,
      payload: row.payload,
      attempts: row.attempts,
      createdAt: row.created_at,
    }));
  }

  async markProcessed(id: string, client: PoolClient): Promise<void> {
    await client.query('UPDATE outbox SET processed_at = now() WHERE id = $1', [id]);
  }

  async markFailed(id: string, error: string, client: PoolClient): Promise<void> {
    // The row stays unprocessed so it is retried. `attempts` is what a
    // dead-letter policy reads; the error text is truncated because a stack
    // trace in a database column is a log, not a record.
    await client.query(
      'UPDATE outbox SET attempts = attempts + 1, last_error = left($2, 500) WHERE id = $1',
      [id, error],
    );
  }

  // ---- notification records ---------------------------------------------
  async create(
    input: {
      id: string;
      recipientId: string;
      category: NotificationCategory;
      actorId: string | null;
      targetType: NotificationTarget;
      targetId: string | null;
      templateKey: string;
      params: Record<string, string | number>;
      batchCount?: number;
    },
    client: PoolClient,
  ): Promise<NotificationRecord> {
    const r = await client.query<NotificationRow>(
      `INSERT INTO notifications (
         id, recipient_id, category, actor_id, target_type, target_id,
         template_key, params, batch_count
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING ${NOTIFICATION_COLUMNS}`,
      [
        input.id,
        input.recipientId,
        input.category,
        input.actorId,
        input.targetType,
        input.targetId,
        input.templateKey,
        JSON.stringify(input.params),
        input.batchCount ?? 1,
      ],
    );
    const row = r.rows[0];
    if (row === undefined) throw new Error('notification insert returned no row');
    return toNotification(row);
  }

  async list(
    recipientId: string,
    limit: number,
    cursor: { createdAt: Date; id: string } | undefined,
    excludeActorIds: readonly string[],
    client?: PoolClient,
  ): Promise<NotificationPage> {
    const params: unknown[] = [recipientId, limit + 1];
    let keyset = '';
    if (cursor !== undefined) {
      params.push(cursor.createdAt, cursor.id);
      keyset = ' AND (created_at, id) < ($3, $4)';
    }
    // `actor_id IS NULL` survives: a system notification has no actor to be
    // blocked and must not vanish because the reader blocked somebody.
    let blocked = '';
    if (excludeActorIds.length > 0) {
      params.push([...excludeActorIds]);
      blocked = ` AND (actor_id IS NULL OR actor_id <> ALL($${params.length}::uuid[]))`;
    }

    const r = await this.q<NotificationRow>(
      client,
      `SELECT ${NOTIFICATION_COLUMNS} FROM notifications
        WHERE recipient_id = $1${keyset}${blocked}
        ORDER BY created_at DESC, id DESC
        LIMIT $2`,
      params,
    );

    const hasMore = r.rows.length > limit;
    const rows = hasMore ? r.rows.slice(0, limit) : r.rows;
    const last = rows[rows.length - 1];
    return {
      notifications: rows.map(toNotification),
      nextCursor:
        hasMore && last !== undefined ? { createdAt: last.created_at, id: last.id } : null,
    };
  }

  async countUnread(
    recipientId: string,
    excludeActorIds: readonly string[],
    client?: PoolClient,
  ): Promise<number> {
    const params: unknown[] = [recipientId];
    let blocked = '';
    if (excludeActorIds.length > 0) {
      params.push([...excludeActorIds]);
      blocked = ` AND (actor_id IS NULL OR actor_id <> ALL($${params.length}::uuid[]))`;
    }
    const r = await this.q<{ n: string }>(
      client,
      `SELECT COUNT(*) AS n FROM notifications
        WHERE recipient_id = $1 AND read_at IS NULL${blocked}`,
      params,
    );
    return Number(r.rows[0]?.n ?? 0);
  }

  async markRead(
    recipientId: string,
    ids: readonly string[],
    at: Date,
    client: PoolClient,
  ): Promise<number> {
    if (ids.length === 0) return 0;
    // `recipient_id` is in the WHERE clause, so a caller passing somebody
    // else's notification id changes nothing rather than marking their mail
    // read.
    const r = await client.query(
      `UPDATE notifications SET read_at = $3
        WHERE recipient_id = $1 AND id = ANY($2::uuid[]) AND read_at IS NULL`,
      [recipientId, [...ids], at],
    );
    return r.rowCount ?? 0;
  }

  async markAllRead(recipientId: string, at: Date, client: PoolClient): Promise<number> {
    const r = await client.query(
      'UPDATE notifications SET read_at = $2 WHERE recipient_id = $1 AND read_at IS NULL',
      [recipientId, at],
    );
    return r.rowCount ?? 0;
  }

  async likeBatchState(
    recipientId: string,
    postId: string,
    since: Date,
    client: PoolClient,
  ): Promise<{ likesInWindow: number; summaryId: string | null; summaryCount: number }> {
    const r = await client.query<{
      individual_count: string;
      summary_id: string | null;
      summary_count: number | null;
    }>(
      // The summary is fetched by its own ORDERED subquery rather than with
      // `MAX(id) FILTER (...)`. PostgreSQL has no `max(uuid)` - uuid has no
      // ordering aggregate - so that form parses and then fails at execution
      // with "function max(uuid) does not exist". The unit tests could not
      // catch it: the in-memory fake picks the summary with `find`.
      //
      // Newest-first, because a window can only sensibly have one summary and
      // the newest is the live one if an older row ever survived a boundary.
      `WITH window_rows AS (
         SELECT id, template_key, batch_count, created_at
           FROM notifications
          WHERE recipient_id = $1
            AND category = 'LIKE'
            AND target_type = 'POST'
            AND target_id = $2
            AND created_at >= $3
       ),
       summary AS (
         SELECT id, batch_count
           FROM window_rows
          WHERE template_key = $4
          ORDER BY created_at DESC
          LIMIT 1
       )
       SELECT
         (SELECT COUNT(*) FROM window_rows WHERE template_key <> $4) AS individual_count,
         (SELECT id FROM summary) AS summary_id,
         (SELECT batch_count FROM summary) AS summary_count`,
      [recipientId, postId, since, TEMPLATE_KEYS.LIKE_BATCHED],
    );
    const row = r.rows[0];
    const summaryId = row?.summary_id ?? null;
    const summaryCount = Number(row?.summary_count ?? 0);

    return {
      // The summary is AUTHORITATIVE once it exists: it already covers the
      // individual rows that preceded it, so adding them again counts the same
      // likes twice.
      likesInWindow: summaryId === null ? Number(row?.individual_count ?? 0) : summaryCount,
      summaryId,
      summaryCount,
    };
  }

  async extendSummary(
    id: string,
    total: number,
    params: Record<string, string | number>,
    client: PoolClient,
  ): Promise<void> {
    // The summary moves back to UNREAD and to the top of the list. A summary
    // the user read at 3 likes and which now covers 20 is new information, and
    // leaving it read and buried would silently swallow the rest.
    await client.query(
      `UPDATE notifications
          SET batch_count = $2, params = $3, read_at = NULL, created_at = now()
        WHERE id = $1`,
      [id, total, JSON.stringify(params)],
    );
  }

  async pruneOlderThan(cutoff: Date, client: PoolClient): Promise<number> {
    const r = await client.query('DELETE FROM notifications WHERE created_at < $1', [cutoff]);
    return r.rowCount ?? 0;
  }

  // ---- preferences -------------------------------------------------------
  async preferencesFor(
    userId: string,
    client?: PoolClient,
  ): Promise<Partial<Record<PreferenceKey, boolean>>> {
    const r = await this.q<{ category: PreferenceKey; push_enabled: boolean }>(
      client,
      'SELECT category, push_enabled FROM notification_preferences WHERE user_id = $1',
      [userId],
    );
    const out: Partial<Record<PreferenceKey, boolean>> = {};
    for (const row of r.rows) out[row.category] = row.push_enabled;
    return out;
  }

  async setPreference(
    userId: string,
    key: PreferenceKey,
    pushEnabled: boolean,
    client: PoolClient,
  ): Promise<void> {
    await client.query(
      `INSERT INTO notification_preferences (user_id, category, push_enabled)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, category)
       DO UPDATE SET push_enabled = EXCLUDED.push_enabled, updated_at = now()`,
      [userId, key, pushEnabled],
    );
  }

  // ---- device tokens -----------------------------------------------------
  async registerDevice(
    input: { id: string; userId: string; token: string; platform: string; language: Locale },
    client: PoolClient,
  ): Promise<void> {
    // REASSIGNS on conflict. A token that moves to another account must stop
    // delivering the previous user's notifications, and clearing
    // `invalidated_at` is what lets a device that was marked dead come back
    // after a reinstall.
    await client.query(
      `INSERT INTO device_tokens (id, user_id, token, platform, language)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (token) DO UPDATE
         SET user_id = EXCLUDED.user_id,
             platform = EXCLUDED.platform,
             language = EXCLUDED.language,
             last_seen_at = now(),
             invalidated_at = NULL`,
      [input.id, input.userId, input.token, input.platform, input.language],
    );
  }

  async removeDevice(userId: string, token: string, client: PoolClient): Promise<boolean> {
    const r = await client.query('DELETE FROM device_tokens WHERE user_id = $1 AND token = $2', [
      userId,
      token,
    ]);
    return (r.rowCount ?? 0) > 0;
  }

  async invalidateDevice(token: string, at: Date, client?: PoolClient): Promise<void> {
    // Marked, not deleted. The row is evidence that a device existed, and a
    // reinstall re-registers the same token and clears the mark.
    await this.q(
      client,
      'UPDATE device_tokens SET invalidated_at = $2 WHERE token = $1 AND invalidated_at IS NULL',
      [token, at],
    );
  }

  async liveDevicesFor(userId: string, client?: PoolClient): Promise<DeviceTokenRecord[]> {
    const r = await this.q<{
      id: string;
      user_id: string;
      token: string;
      platform: string;
      language: Locale;
      invalidated_at: Date | null;
    }>(
      client,
      `SELECT id, user_id, token, platform, language, invalidated_at
         FROM device_tokens
        WHERE user_id = $1 AND invalidated_at IS NULL`,
      [userId],
    );
    return r.rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      token: row.token,
      platform: row.platform,
      language: row.language,
      invalidatedAt: row.invalidated_at,
    }));
  }

  async languageFor(userId: string, client?: PoolClient): Promise<Locale | null> {
    const r = await this.q<{ language: Locale | null }>(
      client,
      'SELECT language FROM users WHERE id = $1',
      [userId],
    );
    return r.rows[0]?.language ?? null;
  }
}
