import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DatabaseService } from '../../../../database/database.service.js';
import { StructuredLogger } from '../../../../common/logging/structured.logger.js';
import { CLOCK, type Clock } from '../../../platform/identity/ports/clock.port.js';
import { BlockService } from '../../safety/application/block.service.js';
import { OutboxService } from '../../../platform/notifications/application/outbox.service.js';
import {
  EVENT_QUOTA_WINDOW_HOURS,
  MAX_EVENTS_PER_DAY,
  checkEventFields,
  checkStartsAt,
  normalize,
  type EventFieldProblem,
  type EventType,
} from '../domain/event-fields.js';
import {
  canChangeType,
  canDelete,
  canRsvp,
  requiresAttendeeNotice,
} from '../domain/event-lifecycle.js';
import { decideJoin, type JoinDecision } from '../domain/join-link-policy.js';
import {
  EVENT_REPOSITORY,
  type EventRecord,
  type EventRepository,
  type RsvpResponse,
} from '../repositories/event.repository.port.js';

/**
 * An event as anyone but the join endpoint sees it.
 *
 * `meetingUrl` IS ABSENT BY CONSTRUCTION, not by remembering to delete it.
 * EVENT-FR-003 gates the link behind an RSVP and a 30-minute window, and that
 * gate is worthless if the URL rides along in the detail body while the client
 * merely declines to render it. The type not having the field is what makes it
 * impossible to leak from here.
 */
export interface EventView {
  id: string;
  creatorId: string;
  title: string;
  description: string;
  startsAt: Date;
  eventType: EventType;
  locationText: string | null;
  categorySlug: string | null;
  status: 'SCHEDULED' | 'CANCELLED';
  goingCount: number;
  interestedCount: number;
  /** EVENT-FR-003: whether the join control is active, never the link itself. */
  joinLinkAvailable: boolean;
  /** Stated when it is not yet available, because the criterion requires it. */
  joinLinkAvailableFrom: Date | null;
  myResponse: RsvpResponse | null;
  underReview: boolean;
  editedAt: Date | null;
  createdAt: Date;
}

export type CreateResult =
  | { status: 'CREATED'; event: EventView }
  | { status: 'INVALID_INPUT'; problem: EventFieldProblem }
  | { status: 'RATE_LIMITED' };

export type UpdateResult =
  | { status: 'UPDATED'; event: EventView; notifiedAttendees: number }
  | { status: 'INVALID_INPUT'; problem: EventFieldProblem }
  | { status: 'NOT_AVAILABLE' }
  | { status: 'TYPE_FROZEN' };

export type CancelResult =
  | { status: 'CANCELLED'; notifiedAttendees: number }
  | { status: 'DELETED' }
  | { status: 'NOT_AVAILABLE' };

export type RsvpResult =
  | { status: 'RECORDED'; event: EventView }
  | { status: 'NOT_AVAILABLE' }
  | { status: 'EVENT_HAS_STARTED' }
  | { status: 'EVENT_CANCELLED' };

export type JoinResult =
  | { status: 'AVAILABLE'; meetingUrl: string }
  | { status: 'NOT_AVAILABLE' }
  | Exclude<JoinDecision, { status: 'AVAILABLE' }>;

/**
 * Events (EVENT-FR-001…008 · BR-043/044/045 · ARCH-CONFLICT-006).
 *
 * O3: "Enable community gatherings to be organized and attended." EVENT-FR-001
 * calls events "the mobilization layer and the product's clearest
 * differentiator from a general social feed", and that is also why several
 * rules here are stricter than their equivalents on posts — a fake gathering
 * does not waste a scroll, it wastes a journey.
 *
 * FOUR THINGS THIS SERVICE IS CAREFUL ABOUT.
 *
 * 1. THE MEETING LINK IS NOT PART OF AN EVENT'S PUBLIC SHAPE. `EventView` has
 *    no field for it. The only way to obtain one is `join`, which applies
 *    EVENT-FR-003's two conditions. Anything else — including a helpful
 *    "include it for the creator" — would put a live meeting credential in a
 *    response body that gets logged, cached and screenshotted.
 *
 * 2. THERE IS NO ATTENDEE LIST, ANYWHERE. ARCH-CONFLICT-006 / D-17: the count
 *    is public, the list is not. `attendeeIdsForNotice` exists and returns ids
 *    to the notification pipeline; nothing here returns them to a caller, and
 *    there is no method that could.
 *
 * 3. CANCELLATION IS NOT DELETION (EVENT-FR-007). Once anyone has responded,
 *    deletion stops being offered — a cancelled event stays visible and marked
 *    so that somebody who never opens the notification still finds out, while a
 *    deleted one simply vanishes and teaches them nothing.
 *
 * 4. WHAT COUNTS AS "CHANGED" IS A JUDGEMENT ABOUT PEOPLE. Only a time,
 *    location, link or cancellation change notifies attendees. Fixing a typo at
 *    midnight must not wake fifty neighbours.
 */
@Injectable()
export class EventService {
  constructor(
    private readonly db: DatabaseService,
    @Inject(EVENT_REPOSITORY) private readonly repo: EventRepository,
    private readonly blocks: BlockService,
    private readonly outbox: OutboxService,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly logger: StructuredLogger,
  ) {}

  // ------------------------------------------------------------- creating
  /**
   * EVENT-FR-001 — create and publish immediately.
   *
   * "Published immediately, with no approval step." BR-043 is explicit that
   * creation is not restricted to verified organizations, so there is no role
   * check here — the absence is the rule, and adding one would quietly reverse
   * a decision (S2-DEC-006) somebody made on purpose.
   */
  async create(
    creatorId: string,
    input: {
      title: string;
      description: string;
      startsAt: Date;
      eventType: EventType;
      meetingUrl?: string | null;
      locationText?: string | null;
      categorySlug?: string | null;
    },
  ): Promise<CreateResult> {
    const now = this.clock.now();
    const problem = checkEventFields(
      {
        title: input.title,
        description: input.description,
        startsAt: input.startsAt,
        eventType: input.eventType,
        meetingUrl: input.meetingUrl ?? undefined,
        locationText: input.locationText ?? undefined,
      },
      now,
    );
    if (problem !== null) return { status: 'INVALID_INPUT', problem };

    // EVENT-FR-001 E4. Checked before the write, and counted from the table
    // rather than a counter so the limit cannot drift from the thing it limits.
    const since = new Date(now.getTime() - EVENT_QUOTA_WINDOW_HOURS * 60 * 60 * 1000);
    if ((await this.repo.countCreatedSince(creatorId, since)) >= MAX_EVENTS_PER_DAY) {
      this.log('event_rate_limited', {});
      return { status: 'RATE_LIMITED' };
    }

    const event = await this.db.withTransaction(async (client) =>
      this.repo.create(
        {
          id: randomUUID(),
          creatorId,
          title: normalize(input.title),
          description: normalize(input.description),
          startsAt: input.startsAt,
          eventType: input.eventType,
          meetingUrl: input.eventType === 'ONLINE' ? normalize(String(input.meetingUrl)) : null,
          locationText:
            input.eventType === 'PHYSICAL' ? normalize(String(input.locationText)) : null,
          categorySlug: input.categorySlug ?? null,
        },
        client,
      ),
    );

    this.log('event_created', { eventType: event.eventType });
    return { status: 'CREATED', event: this.toView(event, null, now) };
  }

  // -------------------------------------------------------------- reading
  /** EVENT-FR-006 — the detail view. Counts only; never an attendee list. */
  async findById(viewerId: string, eventId: string): Promise<EventView | null> {
    const event = await this.repo.findById(eventId);
    if (event === null) return null;
    if (!(await this.visibleTo(viewerId, event))) return null;

    const myResponse = await this.repo.findRsvp(eventId, viewerId);
    return this.toView(event, myResponse, this.clock.now());
  }

  /** EVENT-FR-005 — upcoming, soonest first, paginated at 20. */
  async listUpcoming(
    viewerId: string,
    limit = 20,
    cursor?: { startsAt: Date; id: string },
  ): Promise<{ events: EventView[]; nextCursor: { startsAt: Date; id: string } | null }> {
    const now = this.clock.now();
    const page = await this.repo.listUpcoming(viewerId, now, clampLimit(limit), cursor);
    const mine = await this.repo.rsvpsFor(
      viewerId,
      page.events.map((e) => e.id),
    );

    return {
      events: page.events.map((e) => this.toView(e, mine.get(e.id) ?? null, now)),
      nextCursor: page.nextCursor,
    };
  }

  async listByCreator(
    viewerId: string,
    creatorId: string,
    limit = 20,
    cursor?: { startsAt: Date; id: string },
  ): Promise<{ events: EventView[]; nextCursor: { startsAt: Date; id: string } | null }> {
    const now = this.clock.now();
    // The creator's own visibility is checked first, so a blocked or banned
    // creator's event list is as unavailable as their profile.
    if (viewerId !== creatorId && (await this.blocks.isBlockedEitherWay(viewerId, creatorId))) {
      return { events: [], nextCursor: null };
    }

    const page = await this.repo.listByCreator(viewerId, creatorId, clampLimit(limit), cursor);
    const mine = await this.repo.rsvpsFor(
      viewerId,
      page.events.map((e) => e.id),
    );
    return {
      events: page.events.map((e) => this.toView(e, mine.get(e.id) ?? null, now)),
      nextCursor: page.nextCursor,
    };
  }

  // ---------------------------------------------------------------- RSVP
  /**
   * EVENT-FR-004 — Going or Interested, one response per user.
   *
   * Changing from Interested to Going is an UPDATE against the composite
   * primary key, so the person is counted once. The requirement's acceptance
   * criterion is exactly that, and it holds under concurrency because the key
   * does the work rather than a read-then-write here.
   */
  async rsvp(viewerId: string, eventId: string, response: RsvpResponse): Promise<RsvpResult> {
    const event = await this.repo.findById(eventId);
    if (event === null || !(await this.visibleTo(viewerId, event))) {
      return { status: 'NOT_AVAILABLE' };
    }

    const now = this.clock.now();
    // Told apart rather than collapsed, and for the same reason the join
    // decision is: the event is already public, so neither answer discloses
    // anything, and "this was cancelled" and "this already started" lead the
    // user to different next actions.
    if (event.status === 'CANCELLED') return { status: 'EVENT_CANCELLED' };
    if (!canRsvp({ startsAt: event.startsAt, status: event.status, now })) {
      return { status: 'EVENT_HAS_STARTED' };
    }

    await this.db.withTransaction(async (client) => {
      await this.repo.setRsvp(eventId, viewerId, response, client);

      // EVENT-FR-004: "the creator is notified". In the same transaction as
      // the RSVP, so the count and the notification cannot disagree.
      await this.outbox.emit(
        { topic: 'event.rsvp', eventId, creatorId: event.creatorId, actorId: viewerId },
        client,
      );
    });

    // TODO(EPIC-11 reminders): the 24-hour and 1-hour reminders (EVENT-FR-008,
    // NOTIF-FR-006) are SCHEDULED work rather than reactive, so they belong to
    // the worker's scheduled sweep rather than to this transaction - it reads
    // `attendeeIdsForNotice(eventId, true)` for events whose start crosses
    // either mark, and NOTIF-FR-006 requires it to skip a cancelled one.
    const updated = await this.repo.findById(eventId);
    this.log('event_rsvp', { response });
    return {
      status: 'RECORDED',
      event: this.toView(updated ?? event, response, now),
    };
  }

  /** Withdraw entirely. Idempotent — the caller asked for a state. */
  async withdrawRsvp(viewerId: string, eventId: string): Promise<RsvpResult> {
    const event = await this.repo.findById(eventId);
    if (event === null || !(await this.visibleTo(viewerId, event))) {
      return { status: 'NOT_AVAILABLE' };
    }

    await this.db.withTransaction(async (client) => {
      await this.repo.clearRsvp(eventId, viewerId, client);
    });

    const updated = await this.repo.findById(eventId);
    this.log('event_rsvp_withdrawn', {});
    return {
      status: 'RECORDED',
      event: this.toView(updated ?? event, null, this.clock.now()),
    };
  }

  // ---------------------------------------------------------------- join
  /**
   * EVENT-FR-003 — the meeting link, if this viewer may have it now.
   *
   * The one place a `meetingUrl` leaves this module. Everything else about the
   * decision lives in `join-link-policy.ts`, including why the outcomes are
   * told apart here when they are collapsed everywhere else.
   */
  async join(viewerId: string, eventId: string): Promise<JoinResult> {
    const event = await this.repo.findById(eventId);
    if (event === null || !(await this.visibleTo(viewerId, event))) {
      return { status: 'NOT_AVAILABLE' };
    }

    const decision = decideJoin({
      eventType: event.eventType,
      status: event.status,
      startsAt: event.startsAt,
      viewerResponse: await this.repo.findRsvp(eventId, viewerId),
      now: this.clock.now(),
    });

    if (decision.status !== 'AVAILABLE') return decision;
    if (event.meetingUrl === null) {
      // Unreachable: the CHECK constraint requires a link on every ONLINE
      // event. Treated as unavailable rather than thrown, because a 500 here
      // would be a worse experience than a closed join button.
      return { status: 'NOT_AVAILABLE' };
    }

    this.log('event_join_link_issued', {});
    return { status: 'AVAILABLE', meetingUrl: event.meetingUrl };
  }

  // -------------------------------------------------------------- editing
  /** EVENT-FR-007 — edit. Only the creator, and only some fields matter. */
  async update(
    viewerId: string,
    eventId: string,
    changes: {
      title?: string;
      description?: string;
      startsAt?: Date;
      eventType?: EventType;
      meetingUrl?: string | null;
      locationText?: string | null;
      categorySlug?: string | null;
    },
  ): Promise<UpdateResult> {
    const event = await this.repo.findById(eventId);
    // A non-creator gets the same neutral answer as a missing event, so this
    // route cannot be used to discover which events exist.
    if (event === null || event.creatorId !== viewerId) return { status: 'NOT_AVAILABLE' };

    const now = this.clock.now();

    if (changes.startsAt !== undefined) {
      const problem = checkStartsAt(changes.startsAt, now);
      if (problem !== null) return { status: 'INVALID_INPUT', problem };
    }

    // EVENT-FR-002. Checked here so the caller gets a reason; the database
    // refuses it regardless, because it is a promise to people who are not the
    // one editing.
    if (changes.eventType !== undefined && changes.eventType !== event.eventType) {
      const rsvpCount = await this.repo.countRsvps(eventId);
      if (!canChangeType({ rsvpCount })) return { status: 'TYPE_FROZEN' };
    }

    // `??` WOULD BE WRONG HERE, and subtly. An explicit `null` means "clear
    // this field" and `undefined` means "leave it alone"; `??` collapses the
    // two, so a caller switching a PHYSICAL event to ONLINE - who must send a
    // link AND null the location - would have the old location merged back in
    // and be told they supplied both. The type change would be impossible, and
    // the error message would blame a field they had just cleared.
    const pick = <T>(given: T | null | undefined, current: T | null): T | undefined => {
      if (given === undefined) return current ?? undefined;
      return given ?? undefined;
    };

    const merged = {
      title: changes.title ?? event.title,
      description: changes.description ?? event.description,
      startsAt: changes.startsAt ?? event.startsAt,
      eventType: changes.eventType ?? event.eventType,
      meetingUrl: pick(changes.meetingUrl, event.meetingUrl),
      locationText: pick(changes.locationText, event.locationText),
    };
    // Validated as a WHOLE rather than field by field, because EVENT-FR-002 is
    // about the combination: an edit that clears the location on a PHYSICAL
    // event passes every individual check and leaves an event nobody can find.
    const problem = checkEventFields(
      {
        ...merged,
        // The start time is only re-checked against "must be in the future"
        // when the caller actually moved it. An event whose time has passed can
        // still have its description corrected.
        startsAt: changes.startsAt ?? new Date(now.getTime() + 60_000),
      },
      now,
    );
    if (problem !== null) return { status: 'INVALID_INPUT', problem };

    const updated = await this.db.withTransaction(async (client) =>
      this.repo.update(
        eventId,
        {
          ...(changes.title !== undefined ? { title: normalize(changes.title) } : {}),
          ...(changes.description !== undefined
            ? { description: normalize(changes.description) }
            : {}),
          ...(changes.startsAt !== undefined ? { startsAt: changes.startsAt } : {}),
          ...(changes.eventType !== undefined ? { eventType: changes.eventType } : {}),
          ...(changes.meetingUrl !== undefined
            ? { meetingUrl: changes.meetingUrl === null ? null : normalize(changes.meetingUrl) }
            : {}),
          ...(changes.locationText !== undefined
            ? {
                locationText:
                  changes.locationText === null ? null : normalize(changes.locationText),
              }
            : {}),
          ...(changes.categorySlug !== undefined ? { categorySlug: changes.categorySlug } : {}),
        },
        client,
      ),
    );
    if (updated === null) return { status: 'NOT_AVAILABLE' };

    // EVENT-FR-007: only a time, location or cancellation change notifies.
    const notice = requiresAttendeeNotice({
      startsAtChanged: changes.startsAt !== undefined,
      locationChanged:
        changes.locationText !== undefined && changes.locationText !== event.locationText,
      meetingUrlChanged:
        changes.meetingUrl !== undefined && changes.meetingUrl !== event.meetingUrl,
      cancelled: false,
    });

    let notifiedAttendees = 0;
    if (notice) {
      // Resolved HERE rather than in the pipeline, because this module owns the
      // rule about WHICH changes are worth a notification - and the count is
      // what the creator is shown ("42 people were told").
      const attendees = await this.repo.attendeeIdsForNotice(eventId, false);
      notifiedAttendees = attendees.length;
      if (attendees.length > 0) {
        await this.db.withTransaction(async (client) => {
          await this.outbox.emit(
            { topic: 'event.changed', eventId, recipientIds: attendees },
            client,
          );
        });
      }
    }

    this.log('event_updated', { notice, notifiedAttendees });
    return {
      status: 'UPDATED',
      event: this.toView(updated, await this.repo.findRsvp(eventId, viewerId), now),
      notifiedAttendees,
    };
  }

  /**
   * EVENT-FR-007 — cancel, or delete when nobody has committed.
   *
   * One method for both, because from the creator's side it is one intention:
   * "this is not happening". Which of the two it becomes is not their choice —
   * it depends on whether anybody is relying on it, and the requirement decides
   * that: "deletion outright is not offered once RSVPs exist".
   */
  async cancelOrDelete(viewerId: string, eventId: string): Promise<CancelResult> {
    const event = await this.repo.findById(eventId);
    if (event === null || event.creatorId !== viewerId) return { status: 'NOT_AVAILABLE' };

    const rsvpCount = await this.repo.countRsvps(eventId);

    if (canDelete({ rsvpCount })) {
      await this.db.withTransaction(async (client) => {
        await this.repo.deleteById(eventId, client);
      });
      this.log('event_deleted', {});
      return { status: 'DELETED' };
    }

    const attendees = await this.repo.attendeeIdsForNotice(eventId, false);
    await this.db.withTransaction(async (client) => {
      await this.repo.cancel(eventId, this.clock.now(), client);

      // Same transaction as the cancellation. An event that is cancelled while
      // the notice fails to enqueue is the worst of both: nobody is told, and
      // the event stops looking like it is happening.
      if (attendees.length > 0) {
        await this.outbox.emit(
          { topic: 'event.cancelled', eventId, recipientIds: attendees },
          client,
        );
      }
    });

    // The pending reminders need no cancelling: NOTIF-FR-006's criterion - "an
    // event cancelled 2 hours before its start... no reminder is sent" - is
    // satisfied because the reminder sweep reads the event's CURRENT status
    // rather than working from a queue of pre-scheduled jobs. There is nothing
    // to cancel, which is why the sweep is a sweep.
    this.log('event_cancelled', { notifiedAttendees: attendees.length });
    return { status: 'CANCELLED', notifiedAttendees: attendees.length };
  }

  // ------------------------------------------------------------ internals
  /**
   * Can this viewer see this event at all?
   *
   * Collapses missing, admin-removed, auto-hidden-and-not-yours, blocked and
   * banned-creator into one answer — the same neutral treatment every other
   * read path in the product uses. The join decision deliberately does NOT
   * collapse, but that only ever runs after this has said yes.
   */
  private async visibleTo(viewerId: string, event: EventRecord): Promise<boolean> {
    if (event.visibilityState === 'ADMIN_REMOVED') return false;
    if (event.visibilityState === 'AUTO_HIDDEN' && event.creatorId !== viewerId) return false;
    if (event.creatorId === viewerId) return true;
    return !(await this.blocks.isBlockedEitherWay(viewerId, event.creatorId));
  }

  private toView(event: EventRecord, myResponse: RsvpResponse | null, now: Date): EventView {
    const decision = decideJoin({
      eventType: event.eventType,
      status: event.status,
      startsAt: event.startsAt,
      viewerResponse: myResponse,
      now,
    });

    return {
      id: event.id,
      creatorId: event.creatorId,
      title: event.title,
      description: event.description,
      startsAt: event.startsAt,
      eventType: event.eventType,
      locationText: event.locationText,
      categorySlug: event.categorySlug,
      status: event.status,
      goingCount: event.goingCount,
      interestedCount: event.interestedCount,
      joinLinkAvailable: decision.status === 'AVAILABLE',
      // "The availability time is stated" (EVENT-FR-003 AC). Only when the
      // viewer is actually waiting for it — telling a non-attendee when a link
      // they cannot have becomes available is noise.
      joinLinkAvailableFrom: decision.status === 'TOO_EARLY' ? decision.availableFrom : null,
      myResponse,
      underReview: event.visibilityState === 'AUTO_HIDDEN',
      editedAt: event.editedAt,
      createdAt: event.createdAt,
    };
  }

  private log(event: string, extra: Record<string, unknown>): void {
    // No ids. An event is public, but who is attending which gathering is not —
    // ARCH-CONFLICT-006 keeps the attendee list out of every response, and a
    // log line pairing a user with an event would reinstate it in a file with
    // weaker access controls than the API.
    this.logger.log(JSON.stringify({ event, ...extra }), 'events');
  }
}

function clampLimit(limit: number, max = 50): number {
  if (!Number.isFinite(limit) || limit < 1) return 20;
  return Math.min(Math.floor(limit), max);
}
