import { Injectable } from '@nestjs/common';
import type { PoolClient, QueryResult, QueryResultRow } from 'pg';
import { DatabaseService } from '../../../../database/database.service.js';
import { notBlockedSql } from '../../safety/domain/visibility-policy.js';
import type { EventStatus, EventType, EventVisibilityState } from '../domain/event-fields.js';
import type {
  EventPage,
  EventRecord,
  EventRepository,
  RsvpResponse,
} from './event.repository.port.js';

interface EventRow {
  id: string;
  creator_id: string;
  title: string;
  description: string;
  starts_at: Date;
  event_type: EventType;
  meeting_url: string | null;
  location_text: string | null;
  category_id: string | null;
  category_slug: string | null;
  status: EventStatus;
  visibility_state: EventVisibilityState;
  going_count: number;
  interested_count: number;
  edited_at: Date | null;
  cancelled_at: Date | null;
  created_at: Date;
}

const toEvent = (r: EventRow): EventRecord => ({
  id: r.id,
  creatorId: r.creator_id,
  title: r.title,
  description: r.description,
  startsAt: r.starts_at,
  eventType: r.event_type,
  meetingUrl: r.meeting_url,
  locationText: r.location_text,
  categoryId: r.category_id,
  categorySlug: r.category_slug,
  status: r.status,
  visibilityState: r.visibility_state,
  goingCount: r.going_count,
  interestedCount: r.interested_count,
  editedAt: r.edited_at,
  cancelledAt: r.cancelled_at,
  createdAt: r.created_at,
});

const EVENT_COLUMNS = `
  e.id, e.creator_id, e.title, e.description, e.starts_at, e.event_type,
  e.meeting_url, e.location_text, e.category_id, cat.slug AS category_slug,
  e.status, e.visibility_state, e.going_count, e.interested_count,
  e.edited_at, e.cancelled_at, e.created_at`;

@Injectable()
export class PgEventRepository implements EventRepository {
  constructor(private readonly db: DatabaseService) {}

  private q<R extends QueryResultRow>(
    client: PoolClient | undefined,
    sql: string,
    params: unknown[],
  ): Promise<QueryResult<R>> {
    return client === undefined ? this.db.query<R>(sql, params) : client.query<R>(sql, params);
  }

  async create(
    input: {
      id: string;
      creatorId: string;
      title: string;
      description: string;
      startsAt: Date;
      eventType: EventType;
      meetingUrl: string | null;
      locationText: string | null;
      categorySlug: string | null;
    },
    client: PoolClient,
  ): Promise<EventRecord> {
    const r = await client.query<EventRow>(
      `WITH inserted AS (
         INSERT INTO events (
           id, creator_id, title, description, starts_at, event_type,
           meeting_url, location_text, category_id
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8,
                 (SELECT id FROM categories WHERE slug = $9))
         RETURNING *
       )
       SELECT ${EVENT_COLUMNS}
         FROM inserted e
         LEFT JOIN categories cat ON cat.id = e.category_id`,
      [
        input.id,
        input.creatorId,
        input.title,
        input.description,
        input.startsAt,
        input.eventType,
        input.meetingUrl,
        input.locationText,
        input.categorySlug,
      ],
    );
    const row = r.rows[0];
    if (row === undefined) throw new Error('event insert returned no row');
    return toEvent(row);
  }

  async findById(id: string, client?: PoolClient): Promise<EventRecord | null> {
    const r = await this.q<EventRow>(
      client,
      `SELECT ${EVENT_COLUMNS}
         FROM events e
         LEFT JOIN categories cat ON cat.id = e.category_id
        WHERE e.id = $1`,
      [id],
    );
    const row = r.rows[0];
    return row === undefined ? null : toEvent(row);
  }

  async listUpcoming(
    viewerId: string,
    now: Date,
    limit: number,
    cursor: { startsAt: Date; id: string } | undefined,
    client?: PoolClient,
  ): Promise<EventPage> {
    const params: unknown[] = [viewerId, now, limit + 1];
    let keyset = '';
    if (cursor !== undefined) {
      params.push(cursor.startsAt, cursor.id);
      // Forwards in time, so the comparison is `>` — the opposite of every
      // other keyset in this codebase, and the reason the cursor carries
      // `starts_at` rather than `created_at`.
      keyset = ' AND (e.starts_at, e.id) > ($4, $5)';
    }

    const r = await this.q<EventRow>(
      client,
      `SELECT ${EVENT_COLUMNS}
         FROM events e
         JOIN users u ON u.id = e.creator_id
         LEFT JOIN categories cat ON cat.id = e.category_id
        WHERE e.visibility_state = 'VISIBLE'
          -- EVENT-FR-005: "past events drop off automatically". A CANCELLED
          -- event is NOT filtered here - EVENT-FR-007 says it "remains visible,
          -- marked cancelled, until its original date passes", so attendees who
          -- never opened the notification still find out.
          AND e.starts_at > $2
          AND u.state IN ('ACTIVE', 'SUSPENDED')
          AND ${notBlockedSql('$1', 'e.creator_id')}${keyset}
        ORDER BY e.starts_at ASC, e.id ASC
        LIMIT $3`,
      params,
    );

    return this.page(r.rows, limit);
  }

  async listByCreator(
    viewerId: string,
    creatorId: string,
    limit: number,
    cursor: { startsAt: Date; id: string } | undefined,
    client?: PoolClient,
  ): Promise<EventPage> {
    const params: unknown[] = [viewerId, creatorId, limit + 1];
    let keyset = '';
    if (cursor !== undefined) {
      params.push(cursor.startsAt, cursor.id);
      keyset = ' AND (e.starts_at, e.id) < ($4, $5)';
    }

    const r = await this.q<EventRow>(
      client,
      `SELECT ${EVENT_COLUMNS}
         FROM events e
         JOIN users u ON u.id = e.creator_id
         LEFT JOIN categories cat ON cat.id = e.category_id
        WHERE e.creator_id = $2
          AND u.state IN ('ACTIVE', 'SUSPENDED')
          -- The creator sees their own auto-hidden events, marked under review
          -- (BR-032); nobody else does.
          AND (
            e.visibility_state = 'VISIBLE'
            OR (e.visibility_state = 'AUTO_HIDDEN' AND e.creator_id = $1)
          )
          AND ${notBlockedSql('$1', 'e.creator_id')}${keyset}
        ORDER BY e.starts_at DESC, e.id DESC
        LIMIT $3`,
      params,
    );

    return this.page(r.rows, limit);
  }

  /**
   * Trim the extra row and build the cursor.
   *
   * The cursor is the LAST row of the page whichever direction the list runs,
   * so this is shared: `listUpcoming` walks forwards in time and
   * `listByCreator` backwards, and each supplies its own comparison operator.
   */
  private page(rows: EventRow[], limit: number): EventPage {
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];
    return {
      events: page.map(toEvent),
      nextCursor: hasMore && last !== undefined ? { startsAt: last.starts_at, id: last.id } : null,
    };
  }

  async update(
    id: string,
    changes: {
      title?: string;
      description?: string;
      startsAt?: Date;
      eventType?: EventType;
      meetingUrl?: string | null;
      locationText?: string | null;
      categorySlug?: string | null;
    },
    client: PoolClient,
  ): Promise<EventRecord | null> {
    // COALESCE against an explicit sentinel would make "clear this field"
    // unrepresentable, so each column is only named when the caller asked for
    // it. `edited_at` moves whenever anything does — POST-FR-008's convention,
    // applied here because an attendee deserves to see that the details have
    // changed since they committed.
    const sets: string[] = [];
    const params: unknown[] = [id];

    const push = (column: string, value: unknown): void => {
      params.push(value);
      sets.push(`${column} = $${params.length}`);
    };

    if (changes.title !== undefined) push('title', changes.title);
    if (changes.description !== undefined) push('description', changes.description);
    if (changes.startsAt !== undefined) push('starts_at', changes.startsAt);
    // Written BEFORE the two fields it governs, so the whole statement lands
    // in one UPDATE and the conditional CHECK sees a consistent row. Splitting
    // them would fail on whichever half went first.
    if (changes.eventType !== undefined) push('event_type', changes.eventType);
    if (changes.meetingUrl !== undefined) push('meeting_url', changes.meetingUrl);
    if (changes.locationText !== undefined) push('location_text', changes.locationText);
    if (changes.categorySlug !== undefined) {
      params.push(changes.categorySlug);
      sets.push(`category_id = (SELECT id FROM categories WHERE slug = $${params.length})`);
    }

    if (sets.length === 0) return this.findById(id, client);
    sets.push('edited_at = now()');

    const r = await client.query<EventRow>(
      `WITH updated AS (
         UPDATE events SET ${sets.join(', ')} WHERE id = $1 RETURNING *
       )
       SELECT ${EVENT_COLUMNS}
         FROM updated e
         LEFT JOIN categories cat ON cat.id = e.category_id`,
      params,
    );
    const row = r.rows[0];
    return row === undefined ? null : toEvent(row);
  }

  async cancel(id: string, at: Date, client: PoolClient): Promise<boolean> {
    // Idempotent: cancelling an already-cancelled event succeeds and does not
    // move the timestamp, so a double tap does not rewrite when it happened.
    const r = await client.query(
      `UPDATE events SET status = 'CANCELLED', cancelled_at = $2
        WHERE id = $1 AND status <> 'CANCELLED'`,
      [id, at],
    );
    return (r.rowCount ?? 0) > 0;
  }

  async deleteById(id: string, client: PoolClient): Promise<boolean> {
    const r = await client.query('DELETE FROM events WHERE id = $1', [id]);
    return (r.rowCount ?? 0) > 0;
  }

  async countCreatedSince(creatorId: string, since: Date, client?: PoolClient): Promise<number> {
    const r = await this.q<{ n: string }>(
      client,
      'SELECT COUNT(*) AS n FROM events WHERE creator_id = $1 AND created_at >= $2',
      [creatorId, since],
    );
    return Number(r.rows[0]?.n ?? 0);
  }

  // ---- RSVPs -------------------------------------------------------------
  async setRsvp(
    eventId: string,
    userId: string,
    response: RsvpResponse,
    client: PoolClient,
  ): Promise<void> {
    // One statement, so the count trigger sees exactly one INSERT or one
    // UPDATE. Read-then-write would let two concurrent taps both decide they
    // are inserting, and the person would be counted twice at the moment
    // turnout is being judged.
    await client.query(
      `INSERT INTO event_rsvps (event_id, user_id, response)
       VALUES ($1, $2, $3)
       ON CONFLICT (event_id, user_id)
       DO UPDATE SET response = EXCLUDED.response, updated_at = now()`,
      [eventId, userId, response],
    );
  }

  async clearRsvp(eventId: string, userId: string, client: PoolClient): Promise<boolean> {
    const r = await client.query('DELETE FROM event_rsvps WHERE event_id = $1 AND user_id = $2', [
      eventId,
      userId,
    ]);
    return (r.rowCount ?? 0) > 0;
  }

  async findRsvp(
    eventId: string,
    userId: string,
    client?: PoolClient,
  ): Promise<RsvpResponse | null> {
    const r = await this.q<{ response: RsvpResponse }>(
      client,
      'SELECT response FROM event_rsvps WHERE event_id = $1 AND user_id = $2',
      [eventId, userId],
    );
    return r.rows[0]?.response ?? null;
  }

  async rsvpsFor(
    userId: string,
    eventIds: readonly string[],
    client?: PoolClient,
  ): Promise<Map<string, RsvpResponse>> {
    if (eventIds.length === 0) return new Map();
    const r = await this.q<{ event_id: string; response: RsvpResponse }>(
      client,
      `SELECT event_id, response FROM event_rsvps
        WHERE user_id = $1 AND event_id = ANY($2::uuid[])`,
      [userId, [...eventIds]],
    );
    return new Map(r.rows.map((row) => [row.event_id, row.response]));
  }

  async countRsvps(eventId: string, client?: PoolClient): Promise<number> {
    const r = await this.q<{ n: string }>(
      client,
      'SELECT COUNT(*) AS n FROM event_rsvps WHERE event_id = $1',
      [eventId],
    );
    return Number(r.rows[0]?.n ?? 0);
  }

  async attendeeIdsForNotice(
    eventId: string,
    onlyGoing: boolean,
    client?: PoolClient,
  ): Promise<string[]> {
    const r = await this.q<{ user_id: string }>(
      client,
      `SELECT user_id FROM event_rsvps
        WHERE event_id = $1 AND ($2::boolean IS FALSE OR response = 'GOING')`,
      [eventId, onlyGoing],
    );
    return r.rows.map((row) => row.user_id);
  }
}
