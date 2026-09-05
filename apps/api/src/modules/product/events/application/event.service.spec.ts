import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { EventService } from './event.service.js';
import { FixedClock } from '../../../platform/identity/ports/clock.port.js';
import type { EventType } from '../domain/event-fields.js';
import type {
  EventPage,
  EventRecord,
  EventRepository,
  RsvpResponse,
} from '../repositories/event.repository.port.js';
import type { BlockService } from '../../safety/application/block.service.js';
import type { DatabaseService } from '../../../../database/database.service.js';
import type { StructuredLogger } from '../../../../common/logging/structured.logger.js';

/**
 * In-memory events.
 *
 * Enforces the composite primary key on RSVPs and maintains the counts the way
 * the trigger does — including the Interested-to-Going case, which is the one
 * EVENT-FR-004's acceptance criterion is about. A fake that let a person be
 * counted twice would make the tests agree with an implementation the database
 * would not.
 */
class InMemoryEvents implements EventRepository {
  events: EventRecord[] = [];
  rsvps: { eventId: string; userId: string; response: RsvpResponse }[] = [];
  clock: () => Date = () => new Date();

  async create(input: {
    id: string;
    creatorId: string;
    title: string;
    description: string;
    startsAt: Date;
    eventType: EventType;
    meetingUrl: string | null;
    locationText: string | null;
    categorySlug: string | null;
  }): Promise<EventRecord> {
    const event: EventRecord = {
      id: input.id,
      creatorId: input.creatorId,
      title: input.title,
      description: input.description,
      startsAt: input.startsAt,
      eventType: input.eventType,
      meetingUrl: input.meetingUrl,
      locationText: input.locationText,
      categoryId: input.categorySlug === null ? null : `cat-${input.categorySlug}`,
      categorySlug: input.categorySlug,
      status: 'SCHEDULED',
      visibilityState: 'VISIBLE',
      goingCount: 0,
      interestedCount: 0,
      editedAt: null,
      cancelledAt: null,
      createdAt: this.clock(),
    };
    this.events.push(event);
    return event;
  }

  async findById(id: string): Promise<EventRecord | null> {
    return this.events.find((e) => e.id === id) ?? null;
  }

  async listUpcoming(_viewerId: string, now: Date, limit: number): Promise<EventPage> {
    const rows = this.events
      .filter((e) => e.visibilityState === 'VISIBLE' && e.startsAt > now)
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
      .slice(0, limit);
    return { events: rows, nextCursor: null };
  }

  async listByCreator(viewerId: string, creatorId: string, limit: number): Promise<EventPage> {
    const rows = this.events
      .filter((e) => e.creatorId === creatorId)
      .filter(
        (e) =>
          e.visibilityState === 'VISIBLE' ||
          (e.visibilityState === 'AUTO_HIDDEN' && e.creatorId === viewerId),
      )
      .sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime())
      .slice(0, limit);
    return { events: rows, nextCursor: null };
  }

  async update(id: string, changes: Record<string, unknown>): Promise<EventRecord | null> {
    const event = this.events.find((e) => e.id === id);
    if (event === undefined) return null;
    Object.assign(event, changes, { editedAt: this.clock() });
    return event;
  }

  async cancel(id: string, at: Date): Promise<boolean> {
    const event = this.events.find((e) => e.id === id);
    if (event === undefined || event.status === 'CANCELLED') return false;
    event.status = 'CANCELLED';
    event.cancelledAt = at;
    return true;
  }

  async deleteById(id: string): Promise<boolean> {
    const i = this.events.findIndex((e) => e.id === id);
    if (i === -1) return false;
    this.events.splice(i, 1);
    this.rsvps = this.rsvps.filter((r) => r.eventId !== id);
    return true;
  }

  async countCreatedSince(creatorId: string, since: Date): Promise<number> {
    return this.events.filter((e) => e.creatorId === creatorId && e.createdAt >= since).length;
  }

  async setRsvp(eventId: string, userId: string, response: RsvpResponse): Promise<void> {
    const existing = this.rsvps.find((r) => r.eventId === eventId && r.userId === userId);
    if (existing !== undefined) {
      existing.response = response;
    } else {
      this.rsvps.push({ eventId, userId, response });
    }
    this.recount(eventId);
  }

  async clearRsvp(eventId: string, userId: string): Promise<boolean> {
    const i = this.rsvps.findIndex((r) => r.eventId === eventId && r.userId === userId);
    if (i === -1) return false;
    this.rsvps.splice(i, 1);
    this.recount(eventId);
    return true;
  }

  async findRsvp(eventId: string, userId: string): Promise<RsvpResponse | null> {
    return this.rsvps.find((r) => r.eventId === eventId && r.userId === userId)?.response ?? null;
  }

  async rsvpsFor(userId: string, eventIds: readonly string[]): Promise<Map<string, RsvpResponse>> {
    return new Map(
      this.rsvps
        .filter((r) => r.userId === userId && eventIds.includes(r.eventId))
        .map((r) => [r.eventId, r.response]),
    );
  }

  async countRsvps(eventId: string): Promise<number> {
    return this.rsvps.filter((r) => r.eventId === eventId).length;
  }

  async attendeeIdsForNotice(eventId: string, onlyGoing: boolean): Promise<string[]> {
    return this.rsvps
      .filter((r) => r.eventId === eventId && (!onlyGoing || r.response === 'GOING'))
      .map((r) => r.userId);
  }

  /** What the count trigger does. */
  private recount(eventId: string): void {
    const event = this.events.find((e) => e.id === eventId);
    if (event === undefined) return;
    const mine = this.rsvps.filter((r) => r.eventId === eventId);
    event.goingCount = mine.filter((r) => r.response === 'GOING').length;
    event.interestedCount = mine.filter((r) => r.response === 'INTERESTED').length;
  }
}

const NOW = new Date('2026-09-05T12:00:00.000Z');
const IN_A_WEEK = new Date('2026-09-12T18:00:00.000Z');

function build() {
  const repo = new InMemoryEvents();
  const clock = new FixedClock(NOW);
  repo.clock = () => clock.now();

  const logs: string[] = [];
  const blocked = new Set<string>();
  const key = (a: string, b: string): string => [a, b].sort().join('|');

  const blocks = {
    async isBlockedEitherWay(a: string, b: string) {
      return blocked.has(key(a, b));
    },
  } as unknown as BlockService;

  const db = {
    withTransaction: async <T>(fn: (c: never) => Promise<T>): Promise<T> => fn(undefined as never),
  } as unknown as DatabaseService;

  const logger = {
    log: (m: unknown) => logs.push(String(m)),
    debug: (m: unknown) => logs.push(String(m)),
    warn: (m: unknown) => logs.push(String(m)),
    error: (m: unknown) => logs.push(String(m)),
  } as unknown as StructuredLogger;

  return {
    service: new EventService(db, repo, blocks, clock, logger),
    repo,
    clock,
    logs,
    block: (a: string, b: string) => blocked.add(key(a, b)),
  };
}

let ctx: ReturnType<typeof build>;
let creator: string;
let neighbour: string;

beforeEach(() => {
  ctx = build();
  creator = randomUUID();
  neighbour = randomUUID();
});

const physical = {
  title: 'Mohalla clean-up',
  description: 'Bring gloves and a bag; we start at the corner shop.',
  startsAt: IN_A_WEEK,
  eventType: 'PHYSICAL' as const,
  locationText: 'Gulberg Park, Block C',
};

const online = {
  title: 'Water committee meeting',
  description: 'Discussing the supply schedule for the next month.',
  startsAt: IN_A_WEEK,
  eventType: 'ONLINE' as const,
  meetingUrl: 'https://meet.example.com/abc-defg-hij',
};

const createPhysical = () => ctx.service.create(creator, physical);
const createOnline = () => ctx.service.create(creator, online);

describe('EventService.create (EVENT-FR-001, BR-043)', () => {
  it('publishes immediately, with no approval step', async () => {
    const r = await createPhysical();
    expect(r.status).toBe('CREATED');
    if (r.status === 'CREATED') {
      expect(r.event.status).toBe('SCHEDULED');
      expect(r.event.underReview).toBe(false);
    }
  });

  it('ANY active user may create one — there is no role check (BR-043)', async () => {
    // S2-DEC-006 decided creation is not restricted to verified organizations.
    // Asserted as its own test because the rule is an ABSENCE, and an absence
    // is what a later "improvement" quietly reverses.
    const anybody = randomUUID();
    expect((await ctx.service.create(anybody, physical)).status).toBe('CREATED');
  });

  it('refuses a date in the past (E1)', async () => {
    const r = await ctx.service.create(creator, {
      ...physical,
      startsAt: new Date('2026-09-01T10:00:00.000Z'),
    });
    expect(r.status).toBe('INVALID_INPUT');
    if (r.status === 'INVALID_INPUT') expect(r.problem.reason).toBe('MUST_BE_IN_THE_FUTURE');
  });

  it('refuses an online event with no link (E2)', async () => {
    const { meetingUrl: _omitted, ...withoutLink } = online;
    const r = await ctx.service.create(creator, withoutLink);
    expect(r.status).toBe('INVALID_INPUT');
    if (r.status === 'INVALID_INPUT') expect(r.problem.field).toBe('meetingUrl');
  });

  it('LIMITS CREATION TO 5 A DAY (E4)', async () => {
    for (let i = 0; i < 5; i += 1) {
      expect((await createPhysical()).status).toBe('CREATED');
    }
    expect((await createPhysical()).status).toBe('RATE_LIMITED');
  });

  it('the window rolls forward', async () => {
    for (let i = 0; i < 5; i += 1) await createPhysical();
    ctx.clock.advance(25 * 60 * 60 * 1000);
    expect((await ctx.service.create(creator, { ...physical, startsAt: IN_A_WEEK })).status).toBe(
      'CREATED',
    );
  });

  it('NEVER RETURNS THE MEETING LINK, even to its creator', async () => {
    const r = await createOnline();
    expect(r.status).toBe('CREATED');
    if (r.status === 'CREATED') {
      // The URL is not a field on the view AT ALL. This asserts the shape
      // rather than the value, because the risk is a future field that carries
      // a live meeting credential into a body that gets logged and cached.
      expect(Object.keys(r.event)).not.toContain('meetingUrl');
      expect(JSON.stringify(r.event)).not.toContain('meet.example.com');
    }
  });
});

describe('EventService.rsvp (EVENT-FR-004)', () => {
  let eventId: string;
  beforeEach(async () => {
    const r = await createPhysical();
    eventId = r.status === 'CREATED' ? r.event.id : '';
  });

  it('records Going and moves the count', async () => {
    const r = await ctx.service.rsvp(neighbour, eventId, 'GOING');
    expect(r.status).toBe('RECORDED');
    if (r.status === 'RECORDED') {
      expect(r.event.goingCount).toBe(1);
      expect(r.event.myResponse).toBe('GOING');
    }
  });

  it('COUNTS A PERSON ONCE WHEN THEY CHANGE INTERESTED TO GOING (AC)', async () => {
    // "GIVEN a user changes from Interested to Going, WHEN the event is viewed,
    // THEN they are counted once, under Going."
    await ctx.service.rsvp(neighbour, eventId, 'INTERESTED');
    const r = await ctx.service.rsvp(neighbour, eventId, 'GOING');

    expect(r.status).toBe('RECORDED');
    if (r.status === 'RECORDED') {
      expect(r.event.goingCount).toBe(1);
      expect(r.event.interestedCount).toBe(0);
    }
    expect(await ctx.repo.countRsvps(eventId)).toBe(1);
  });

  it('is idempotent — repeating the same response changes nothing', async () => {
    await ctx.service.rsvp(neighbour, eventId, 'GOING');
    await ctx.service.rsvp(neighbour, eventId, 'GOING');
    const detail = await ctx.service.findById(neighbour, eventId);
    expect(detail?.goingCount).toBe(1);
  });

  it('withdraws', async () => {
    await ctx.service.rsvp(neighbour, eventId, 'GOING');
    const r = await ctx.service.withdrawRsvp(neighbour, eventId);
    expect(r.status).toBe('RECORDED');
    if (r.status === 'RECORDED') {
      expect(r.event.goingCount).toBe(0);
      expect(r.event.myResponse).toBeNull();
    }
  });

  it('withdrawing when nothing was recorded still succeeds', async () => {
    expect((await ctx.service.withdrawRsvp(neighbour, eventId)).status).toBe('RECORDED');
  });

  it('REFUSES AN RSVP TO A PAST EVENT', async () => {
    ctx.clock.advance(30 * 24 * 60 * 60 * 1000);
    expect((await ctx.service.rsvp(neighbour, eventId, 'GOING')).status).toBe('EVENT_HAS_STARTED');
  });

  it('refuses an RSVP to a cancelled event, and says which it is', async () => {
    await ctx.service.rsvp(neighbour, eventId, 'GOING');
    await ctx.service.cancelOrDelete(creator, eventId);

    // Told apart from EVENT_HAS_STARTED rather than collapsed: the event is
    // already public, so neither answer discloses anything, and the two lead to
    // different next actions.
    expect((await ctx.service.rsvp(randomUUID(), eventId, 'GOING')).status).toBe('EVENT_CANCELLED');
  });

  it('refuses across a block, with the neutral answer', async () => {
    ctx.block(creator, neighbour);
    expect((await ctx.service.rsvp(neighbour, eventId, 'GOING')).status).toBe('NOT_AVAILABLE');
  });
});

describe('EventService.join (EVENT-FR-003)', () => {
  let eventId: string;
  beforeEach(async () => {
    const r = await createOnline();
    eventId = r.status === 'CREATED' ? r.event.id : '';
  });

  it('refuses somebody who has not responded', async () => {
    ctx.clock.set(new Date(IN_A_WEEK.getTime() - 10 * 60 * 1000));
    expect((await ctx.service.join(neighbour, eventId)).status).toBe('NOT_ATTENDING');
  });

  it('refuses an attendee who is too early, and says when (AC)', async () => {
    await ctx.service.rsvp(neighbour, eventId, 'GOING');
    ctx.clock.set(new Date(IN_A_WEEK.getTime() - 3 * 60 * 60 * 1000));

    const r = await ctx.service.join(neighbour, eventId);
    expect(r.status).toBe('TOO_EARLY');
    if (r.status === 'TOO_EARLY') {
      expect(r.availableFrom).toEqual(new Date(IN_A_WEEK.getTime() - 30 * 60 * 1000));
    }
  });

  it('gives the link inside the window', async () => {
    await ctx.service.rsvp(neighbour, eventId, 'GOING');
    ctx.clock.set(new Date(IN_A_WEEK.getTime() - 10 * 60 * 1000));

    const r = await ctx.service.join(neighbour, eventId);
    expect(r).toEqual({ status: 'AVAILABLE', meetingUrl: online.meetingUrl });
  });

  it('THE CREATOR IS NOT EXEMPT FROM THE WINDOW', async () => {
    // Tempting to exempt them - they wrote the link. But the control is about
    // the link's exposure, not the person's entitlement, and an exemption is a
    // second code path that a future refactor can widen.
    ctx.clock.set(new Date(IN_A_WEEK.getTime() - 3 * 60 * 60 * 1000));
    expect((await ctx.service.join(creator, eventId)).status).toBe('NOT_ATTENDING');
  });

  it('refuses for a physical event', async () => {
    const p = await createPhysical();
    const physicalId = p.status === 'CREATED' ? p.event.id : '';
    expect((await ctx.service.join(neighbour, physicalId)).status).toBe('NOT_AN_ONLINE_EVENT');
  });

  it('refuses across a block with the neutral answer, not a reason', async () => {
    await ctx.service.rsvp(neighbour, eventId, 'GOING');
    ctx.block(creator, neighbour);
    ctx.clock.set(new Date(IN_A_WEEK.getTime() - 10 * 60 * 1000));

    // The 403/404 split applies only once the event is visible. A blocked
    // viewer must not learn that it exists.
    expect((await ctx.service.join(neighbour, eventId)).status).toBe('NOT_AVAILABLE');
  });
});

describe('EventService.update (EVENT-FR-002/007)', () => {
  let eventId: string;
  beforeEach(async () => {
    const r = await createPhysical();
    eventId = r.status === 'CREATED' ? r.event.id : '';
  });

  it('only the creator may edit; anybody else gets the neutral 404', async () => {
    expect((await ctx.service.update(neighbour, eventId, { title: 'Hijacked' })).status).toBe(
      'NOT_AVAILABLE',
    );
  });

  it('FREEZES THE TYPE ONCE ANYBODY HAS RESPONDED (AC)', async () => {
    await ctx.service.rsvp(neighbour, eventId, 'GOING');
    const r = await ctx.service.update(creator, eventId, {
      eventType: 'ONLINE',
      meetingUrl: 'https://meet.example.com/x',
      locationText: null,
    });
    expect(r.status).toBe('TYPE_FROZEN');
  });

  it('allows a type change while nobody has responded', async () => {
    const r = await ctx.service.update(creator, eventId, {
      eventType: 'ONLINE',
      meetingUrl: 'https://meet.example.com/x',
      locationText: null,
    });
    expect(r.status).toBe('UPDATED');
  });

  it('NOTIFIES ATTENDEES OF A TIME CHANGE (AC)', async () => {
    // "GIVEN an event with RSVPs, WHEN the creator changes the start time, THEN
    // every user who RSVP'd receives a notification of the change."
    await ctx.service.rsvp(neighbour, eventId, 'GOING');
    await ctx.service.rsvp(randomUUID(), eventId, 'INTERESTED');

    const r = await ctx.service.update(creator, eventId, {
      startsAt: new Date(IN_A_WEEK.getTime() + 60 * 60 * 1000),
    });
    expect(r.status).toBe('UPDATED');
    if (r.status === 'UPDATED') expect(r.notifiedAttendees).toBe(2);
  });

  it('DOES NOT NOTIFY FOR A DESCRIPTION FIX', async () => {
    // Fixing a typo at midnight must not wake fifty neighbours.
    await ctx.service.rsvp(neighbour, eventId, 'GOING');
    const r = await ctx.service.update(creator, eventId, {
      description: 'Bring gloves and a bag; we start at the corner shop by the bakery.',
    });
    expect(r.status).toBe('UPDATED');
    if (r.status === 'UPDATED') expect(r.notifiedAttendees).toBe(0);
  });

  it('marks the event edited', async () => {
    await ctx.service.update(creator, eventId, { title: 'Mohalla clean-up drive' });
    const detail = await ctx.service.findById(creator, eventId);
    expect(detail?.editedAt).not.toBeNull();
  });
});

describe('EventService.cancelOrDelete (EVENT-FR-007)', () => {
  let eventId: string;
  beforeEach(async () => {
    const r = await createPhysical();
    eventId = r.status === 'CREATED' ? r.event.id : '';
  });

  it('DELETES when nobody has responded', async () => {
    expect(await ctx.service.cancelOrDelete(creator, eventId)).toEqual({ status: 'DELETED' });
    expect(await ctx.service.findById(creator, eventId)).toBeNull();
  });

  it('CANCELS rather than deletes once anybody has responded', async () => {
    await ctx.service.rsvp(neighbour, eventId, 'GOING');
    const r = await ctx.service.cancelOrDelete(creator, eventId);
    expect(r.status).toBe('CANCELLED');
    if (r.status === 'CANCELLED') expect(r.notifiedAttendees).toBe(1);
  });

  it('A CANCELLED EVENT STAYS VISIBLE, MARKED', async () => {
    // "So attendees who do not open the notification still learn of it." A
    // deleted event teaches them nothing; a cancelled one is still there when
    // they check.
    await ctx.service.rsvp(neighbour, eventId, 'GOING');
    await ctx.service.cancelOrDelete(creator, eventId);

    const detail = await ctx.service.findById(neighbour, eventId);
    expect(detail?.status).toBe('CANCELLED');

    const upcoming = await ctx.service.listUpcoming(neighbour);
    expect(upcoming.events.some((e) => e.id === eventId)).toBe(true);
  });

  it('and drops out of the upcoming list once its original date passes', async () => {
    await ctx.service.rsvp(neighbour, eventId, 'GOING');
    await ctx.service.cancelOrDelete(creator, eventId);
    ctx.clock.advance(30 * 24 * 60 * 60 * 1000);

    const upcoming = await ctx.service.listUpcoming(neighbour);
    expect(upcoming.events).toHaveLength(0);
  });

  it('only the creator may cancel', async () => {
    expect((await ctx.service.cancelOrDelete(neighbour, eventId)).status).toBe('NOT_AVAILABLE');
  });
});

describe('EventService.listUpcoming (EVENT-FR-005)', () => {
  it('is SOONEST first, unlike every other list', async () => {
    const later = await ctx.service.create(creator, {
      ...physical,
      startsAt: new Date('2026-09-20T10:00:00.000Z'),
    });
    const sooner = await ctx.service.create(creator, {
      ...physical,
      startsAt: new Date('2026-09-07T10:00:00.000Z'),
    });

    const page = await ctx.service.listUpcoming(neighbour);
    expect(page.events.map((e) => e.id)).toEqual([
      sooner.status === 'CREATED' ? sooner.event.id : '',
      later.status === 'CREATED' ? later.event.id : '',
    ]);
  });

  it('DROPS AN EVENT WHOSE START TIME HAS PASSED (AC)', async () => {
    await createPhysical();
    expect((await ctx.service.listUpcoming(neighbour)).events).toHaveLength(1);

    ctx.clock.advance(30 * 24 * 60 * 60 * 1000);
    expect((await ctx.service.listUpcoming(neighbour)).events).toHaveLength(0);
  });

  it('carries the viewer’s own response', async () => {
    const r = await createPhysical();
    const eventId = r.status === 'CREATED' ? r.event.id : '';
    await ctx.service.rsvp(neighbour, eventId, 'INTERESTED');

    const page = await ctx.service.listUpcoming(neighbour);
    expect(page.events[0]?.myResponse).toBe('INTERESTED');
  });

  it('NEVER CARRIES A MEETING LINK', async () => {
    await createOnline();
    const page = await ctx.service.listUpcoming(neighbour);
    expect(JSON.stringify(page)).not.toContain('meet.example.com');
  });
});

describe('EventService — what is never returned or logged', () => {
  it('has no method that returns an attendee list (ARCH-CONFLICT-006)', () => {
    // D-17: the COUNT is public, the LIST is not. Asserted against the service
    // surface, because the guarantee is that no such method exists rather than
    // that nobody calls one.
    const surface = Object.getOwnPropertyNames(Object.getPrototypeOf(ctx.service));
    expect(surface).not.toContain('attendees');
    expect(surface).not.toContain('listAttendees');
    expect(surface.some((m) => /attendee/i.test(m))).toBe(false);
  });

  it('never logs who is attending what', async () => {
    const r = await createPhysical();
    const eventId = r.status === 'CREATED' ? r.event.id : '';
    await ctx.service.rsvp(neighbour, eventId, 'GOING');

    for (const line of ctx.logs) {
      expect(line).not.toContain(neighbour);
      expect(line).not.toContain(eventId);
    }
  });

  it('never logs a meeting link', async () => {
    const r = await createOnline();
    const eventId = r.status === 'CREATED' ? r.event.id : '';
    await ctx.service.rsvp(neighbour, eventId, 'GOING');
    ctx.clock.set(new Date(IN_A_WEEK.getTime() - 10 * 60 * 1000));
    await ctx.service.join(neighbour, eventId);

    for (const line of ctx.logs) {
      expect(line).not.toContain('meet.example.com');
    }
  });
});
