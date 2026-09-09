import { describe, it, expect } from 'vitest';
import { JOIN_WINDOW_MINUTES, decideJoin, joinWindowOpensAt } from './join-link-policy.js';

/**
 * EVENT-FR-003 — who gets the meeting link, and when.
 *
 * The requirement states the reason for the timing rule, which is what makes it
 * a security control rather than a UI nicety: the 30-minute window "limits
 * scraping of open meeting rooms". A meeting link is a credential — anyone
 * holding it can walk in — so these tests are about a door, not a button.
 */

const START = new Date('2026-09-10T18:00:00.000Z');
const minutesBefore = (n: number): Date => new Date(START.getTime() - n * 60 * 1000);

const base = {
  eventType: 'ONLINE' as const,
  status: 'SCHEDULED' as const,
  startsAt: START,
};

describe('joinWindowOpensAt', () => {
  it('opens exactly 30 minutes before the start', () => {
    expect(JOIN_WINDOW_MINUTES).toBe(30);
    expect(joinWindowOpensAt(START)).toEqual(minutesBefore(30));
  });
});

describe('decideJoin — the two conditions', () => {
  it('gives the link to somebody attending, inside the window', () => {
    expect(decideJoin({ ...base, viewerResponse: 'GOING', now: minutesBefore(29) })).toEqual({
      status: 'AVAILABLE',
    });
  });

  it('REFUSES SOMEBODY WHO HAS NOT RSVP’D, even one minute before', () => {
    // "shown only to users who have RSVP'd" - the timing rule alone would let
    // anyone scrape every link half an hour before every meeting.
    expect(decideJoin({ ...base, viewerResponse: null, now: minutesBefore(1) })).toEqual({
      status: 'NOT_ATTENDING',
    });
  });

  it('REFUSES SOMEBODY ATTENDING, TOO EARLY — and says when (AC)', () => {
    // "GIVEN an online event starting in 3 hours, WHEN a user who has RSVP'd
    // views it, THEN the join control is not yet active AND THE AVAILABILITY
    // TIME IS STATED."
    const decision = decideJoin({
      ...base,
      viewerResponse: 'GOING',
      now: minutesBefore(180),
    });
    expect(decision).toEqual({ status: 'TOO_EARLY', availableFrom: minutesBefore(30) });
  });

  it('accepts INTERESTED as an RSVP', () => {
    // The requirement says "RSVP'd", not "Going". Somebody who marked Interested
    // and then decided to attend should not be locked out of a meeting starting
    // in ten minutes.
    expect(decideJoin({ ...base, viewerResponse: 'INTERESTED', now: minutesBefore(10) })).toEqual({
      status: 'AVAILABLE',
    });
  });

  it('opens exactly ON the boundary, not a moment after', () => {
    expect(decideJoin({ ...base, viewerResponse: 'GOING', now: minutesBefore(30) })).toEqual({
      status: 'AVAILABLE',
    });
    expect(decideJoin({ ...base, viewerResponse: 'GOING', now: minutesBefore(31) }).status).toBe(
      'TOO_EARLY',
    );
  });

  it('NEVER CLOSES — a meeting that runs long stays joinable', () => {
    // The requirement gives an opening time and no closing one, and that
    // asymmetry is correct: the scraping risk is in the days beforehand, not in
    // the hour after. Locking out attendees of a meeting that started late
    // would be a bug with no security benefit.
    expect(decideJoin({ ...base, viewerResponse: 'GOING', now: minutesBefore(-120) })).toEqual({
      status: 'AVAILABLE',
    });
  });
});

describe('decideJoin — the order of the refusals', () => {
  it('says CANCELLED before it says TOO_EARLY', () => {
    // Being told to wait for a meeting that will never start is worse than
    // being told nothing, so cancellation is checked before the clock.
    expect(
      decideJoin({
        ...base,
        status: 'CANCELLED',
        viewerResponse: 'GOING',
        now: minutesBefore(180),
      }),
    ).toEqual({ status: 'CANCELLED' });
  });

  it('says CANCELLED before it says NOT_ATTENDING', () => {
    expect(
      decideJoin({
        ...base,
        status: 'CANCELLED',
        viewerResponse: null,
        now: minutesBefore(10),
      }),
    ).toEqual({ status: 'CANCELLED' });
  });

  it('says NOT_AN_ONLINE_EVENT first of all', () => {
    // A statement about the event rather than about the viewer, and true
    // regardless of who is asking - so it cannot depend on their RSVP.
    expect(
      decideJoin({
        ...base,
        eventType: 'PHYSICAL',
        status: 'CANCELLED',
        viewerResponse: null,
        now: minutesBefore(1),
      }),
    ).toEqual({ status: 'NOT_AN_ONLINE_EVENT' });
  });
});

describe('decideJoin — AVAILABLE is hard to reach by accident', () => {
  it('is the only outcome that yields a link, across the whole matrix', () => {
    const responses = ['GOING', 'INTERESTED', null] as const;
    const times = [minutesBefore(240), minutesBefore(31), minutesBefore(30), minutesBefore(0)];

    const available: string[] = [];
    for (const eventType of ['ONLINE', 'PHYSICAL'] as const) {
      for (const status of ['SCHEDULED', 'CANCELLED'] as const) {
        for (const viewerResponse of responses) {
          for (const now of times) {
            const d = decideJoin({ eventType, status, startsAt: START, viewerResponse, now });
            if (d.status === 'AVAILABLE') {
              available.push(`${eventType}/${status}/${viewerResponse}/${now.toISOString()}`);
            }
          }
        }
      }
    }

    // 1 type x 1 status x 2 responses x 2 in-window times.
    expect(available).toHaveLength(4);
    expect(available.every((k) => k.startsWith('ONLINE/SCHEDULED/'))).toBe(true);
    expect(available.every((k) => !k.includes('/null/'))).toBe(true);
  });
});
