import type { PoolClient } from 'pg';
import type { EventStatus, EventType, EventVisibilityState } from '../domain/event-fields.js';

export const EVENT_REPOSITORY = Symbol.for('mohalla.events.eventRepository');

export type RsvpResponse = 'GOING' | 'INTERESTED';

export interface EventRecord {
  id: string;
  creatorId: string;
  title: string;
  description: string;
  startsAt: Date;
  eventType: EventType;
  /**
   * NEVER included in a list or detail response.
   *
   * EVENT-FR-003 gates this behind an RSVP and a 30-minute window, and the
   * gate is worthless if the URL rides along in the detail body and the client
   * merely declines to render it. It lives on the record because the join
   * endpoint needs it; every projection drops it.
   */
  meetingUrl: string | null;
  locationText: string | null;
  categoryId: string | null;
  categorySlug: string | null;
  status: EventStatus;
  visibilityState: EventVisibilityState;
  goingCount: number;
  interestedCount: number;
  editedAt: Date | null;
  cancelledAt: Date | null;
  createdAt: Date;
}

export interface EventPage {
  events: EventRecord[];
  /** Keyset on `(starts_at ASC, id ASC)` — the list runs forwards in time. */
  nextCursor: { startsAt: Date; id: string } | null;
}

export interface EventRepository {
  create(
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
  ): Promise<EventRecord>;

  findById(id: string, client?: PoolClient): Promise<EventRecord | null>;

  /**
   * EVENT-FR-005 — upcoming events, SOONEST first.
   *
   * Ascending, unlike every other list in this product. A feed is read
   * newest-first because the newest thing is the most interesting; an events
   * list is read by what is about to happen.
   *
   * `viewerId` is required rather than optional: the list excludes events from
   * anyone blocked in either direction, and a signature that let the viewer be
   * omitted would make the unfiltered query the easy one to call.
   */
  listUpcoming(
    viewerId: string,
    now: Date,
    limit: number,
    cursor: { startsAt: Date; id: string } | undefined,
    client?: PoolClient,
  ): Promise<EventPage>;

  /**
   * A creator's own events (EVENT-FR-001 step 8).
   *
   * Newest start first here, because this is a history as much as a schedule —
   * the profile shows what somebody has organised, not what is next.
   */
  listByCreator(
    viewerId: string,
    creatorId: string,
    limit: number,
    cursor: { startsAt: Date; id: string } | undefined,
    client?: PoolClient,
  ): Promise<EventPage>;

  update(
    id: string,
    changes: {
      title?: string;
      description?: string;
      startsAt?: Date;
      /**
       * EVENT-FR-002. Writable only while no RSVP exists — the application
       * checks that so the caller gets a reason, and a trigger enforces it so
       * a missed check cannot break a promise made to attendees.
       *
       * The first version of this interface omitted the field entirely, so a
       * type change silently became "set a meeting link on a PHYSICAL event"
       * and the conditional CHECK turned it into a 500. Caught by the smoke
       * test, which exercised the one path the unit tests faked.
       */
      eventType?: EventType;
      meetingUrl?: string | null;
      locationText?: string | null;
      categorySlug?: string | null;
    },
    client: PoolClient,
  ): Promise<EventRecord | null>;

  /** EVENT-FR-007 — cancel. The row stays; only the status moves. */
  cancel(id: string, at: Date, client: PoolClient): Promise<boolean>;

  /** Only ever reachable while no RSVP exists (EVENT-FR-007). */
  deleteById(id: string, client: PoolClient): Promise<boolean>;

  /** EVENT-FR-001 E4 — five per user per day, counted from the table. */
  countCreatedSince(creatorId: string, since: Date, client?: PoolClient): Promise<number>;

  // ---- RSVPs -------------------------------------------------------------
  /**
   * Record or change this user's response (EVENT-FR-004).
   *
   * `INSERT ... ON CONFLICT DO UPDATE`, so changing Interested to Going is one
   * statement and the count trigger sees a single UPDATE. The acceptance
   * criterion — "they are counted once, under Going" — then holds under
   * concurrency rather than by luck.
   */
  setRsvp(
    eventId: string,
    userId: string,
    response: RsvpResponse,
    client: PoolClient,
  ): Promise<void>;

  /** Withdraw. @returns false when there was nothing to withdraw. */
  clearRsvp(eventId: string, userId: string, client: PoolClient): Promise<boolean>;

  findRsvp(eventId: string, userId: string, client?: PoolClient): Promise<RsvpResponse | null>;

  /** The viewer's own responses across a page of events, for rendering state. */
  rsvpsFor(
    userId: string,
    eventIds: readonly string[],
    client?: PoolClient,
  ): Promise<Map<string, RsvpResponse>>;

  countRsvps(eventId: string, client?: PoolClient): Promise<number>;

  /**
   * Everyone who must be told about a change (EVENT-FR-007, EVENT-FR-008).
   *
   * The ONE query that reads this table by event, and it returns ids for the
   * notification pipeline to address — never for a response body.
   * ARCH-CONFLICT-006: the count is public, the list is not.
   */
  attendeeIdsForNotice(eventId: string, onlyGoing: boolean, client?: PoolClient): Promise<string[]>;
}
