import { describe, it, expect } from 'vitest';
import {
  checkDescription,
  checkEventFields,
  checkMeetingUrl,
  checkStartsAt,
  checkTitle,
} from './event-fields.js';
import {
  canChangeType,
  canDelete,
  canRsvp,
  isVisibleAfterCancellation,
  requiresAttendeeNotice,
} from './event-lifecycle.js';

const NOW = new Date('2026-09-05T12:00:00.000Z');
const LATER = new Date('2026-09-10T18:00:00.000Z');
const EARLIER = new Date('2026-09-01T18:00:00.000Z');

describe('field bounds (§12)', () => {
  it('accepts a title of 3 and refuses 2', () => {
    expect(checkTitle('abc')).toBeNull();
    expect(checkTitle('ab')).toEqual({ field: 'title', reason: 'TOO_SHORT' });
  });

  it('accepts 120 and refuses 121', () => {
    expect(checkTitle('a'.repeat(120))).toBeNull();
    expect(checkTitle('a'.repeat(121))).toEqual({ field: 'title', reason: 'TOO_LONG' });
  });

  it('refuses a whitespace-only title', () => {
    expect(checkTitle('    ')).toEqual({ field: 'title', reason: 'EMPTY' });
  });

  it('accepts a description of 10 and refuses 9', () => {
    expect(checkDescription('a'.repeat(10))).toBeNull();
    expect(checkDescription('a'.repeat(9))).toEqual({
      field: 'description',
      reason: 'TOO_SHORT',
    });
  });

  it('counts GRAPHEME CLUSTERS, so Urdu is not charged twice (BR-012)', () => {
    // Kaf plus zabar: one character to a reader, two code points in memory.
    const withDiacritic = 'کَ';
    expect(withDiacritic.length).toBe(2);
    expect(checkTitle(withDiacritic.repeat(120))).toBeNull();
    expect(checkTitle(withDiacritic.repeat(121))).toEqual({
      field: 'title',
      reason: 'TOO_LONG',
    });
  });
});

describe('checkStartsAt (EVENT-FR-001 E1)', () => {
  it('accepts the future and refuses the past', () => {
    expect(checkStartsAt(LATER, NOW)).toBeNull();
    expect(checkStartsAt(EARLIER, NOW)).toEqual({
      field: 'startsAt',
      reason: 'MUST_BE_IN_THE_FUTURE',
    });
  });

  it('refuses NOW exactly — an event that starts this instant cannot be planned', () => {
    expect(checkStartsAt(new Date(NOW), NOW)?.reason).toBe('MUST_BE_IN_THE_FUTURE');
  });

  it('refuses an invalid date rather than treating it as the epoch', () => {
    expect(checkStartsAt(new Date('nonsense'), NOW)).toEqual({
      field: 'startsAt',
      reason: 'NOT_A_DATE',
    });
  });
});

describe('checkMeetingUrl (§12 · EVENT-FR-001 E3 · SEC-016)', () => {
  it('accepts http and https', () => {
    expect(checkMeetingUrl('https://meet.example.com/abc-defg-hij')).toBeNull();
    expect(checkMeetingUrl('http://meet.example.com/room')).toBeNull();
  });

  it('REFUSES javascript: AND data:, which is the point of an allow-list', () => {
    // SEC-016 names the Admin Portal as the highest-value target for stored
    // XSS, and a moderator reviewing a reported event is the person most likely
    // to be shown this string. Refusing at the boundary means no surface has to
    // remember to escape it.
    expect(checkMeetingUrl('javascript:alert(1)')).toEqual({
      field: 'meetingUrl',
      reason: 'SCHEME_NOT_ALLOWED',
    });
    expect(checkMeetingUrl('data:text/html,<script>alert(1)</script>')).toEqual({
      field: 'meetingUrl',
      reason: 'SCHEME_NOT_ALLOWED',
    });
  });

  it('refuses other schemes too, rather than deny-listing the two famous ones', () => {
    for (const url of ['file:///etc/passwd', 'ftp://example.com/x', 'vbscript:msgbox']) {
      expect(checkMeetingUrl(url)?.reason).toBe('SCHEME_NOT_ALLOWED');
    }
  });

  it('refuses something that is not a URL at all', () => {
    expect(checkMeetingUrl('join my zoom')).toEqual({
      field: 'meetingUrl',
      reason: 'NOT_A_URL',
    });
  });

  it('refuses over 500 characters', () => {
    expect(checkMeetingUrl(`https://e.com/${'a'.repeat(500)}`)?.reason).toBe('TOO_LONG');
  });
});

describe('checkEventFields — the COMBINATION (EVENT-FR-002)', () => {
  const ok = {
    title: 'Mohalla clean-up',
    description: 'Bring gloves and a bag; we start at the corner shop.',
    startsAt: LATER,
  };

  it('an ONLINE event needs a link', () => {
    expect(checkEventFields({ ...ok, eventType: 'ONLINE' }, NOW)).toEqual({
      field: 'meetingUrl',
      reason: 'NOT_A_STRING',
    });
    expect(
      checkEventFields({ ...ok, eventType: 'ONLINE', meetingUrl: 'https://m.example/x' }, NOW),
    ).toBeNull();
  });

  it('a PHYSICAL event needs a location', () => {
    expect(checkEventFields({ ...ok, eventType: 'PHYSICAL' }, NOW)).toEqual({
      field: 'locationText',
      reason: 'NOT_A_STRING',
    });
    expect(
      checkEventFields({ ...ok, eventType: 'PHYSICAL', locationText: 'Gulberg Park' }, NOW),
    ).toBeNull();
  });

  it('REFUSES BOTH — V1 does not model a hybrid (A1)', () => {
    // "Both online and physical → the user selects Physical and includes the
    // link in the description." So supplying both is an error rather than a
    // convenience, and the message names the field that does not belong.
    expect(
      checkEventFields(
        {
          ...ok,
          eventType: 'PHYSICAL',
          locationText: 'Gulberg Park',
          meetingUrl: 'https://m.example/x',
        },
        NOW,
      ),
    ).toEqual({ field: 'meetingUrl', reason: 'NOT_FOR_PHYSICAL_EVENT' });

    expect(
      checkEventFields(
        {
          ...ok,
          eventType: 'ONLINE',
          meetingUrl: 'https://m.example/x',
          locationText: 'Gulberg Park',
        },
        NOW,
      ),
    ).toEqual({ field: 'locationText', reason: 'NOT_FOR_ONLINE_EVENT' });
  });

  it('catches an event that passes every field check and is still unattendable', () => {
    // This is why validation is one function rather than a loop over fields:
    // an ONLINE event with a location and no link has no individually invalid
    // field.
    const problem = checkEventFields(
      { ...ok, eventType: 'ONLINE', locationText: 'Gulberg Park' },
      NOW,
    );
    expect(problem).not.toBeNull();
  });
});

describe('lifecycle (EVENT-FR-002/004/007)', () => {
  it('refuses an RSVP to an event that has started', () => {
    expect(canRsvp({ startsAt: LATER, status: 'SCHEDULED', now: NOW })).toBe(true);
    expect(canRsvp({ startsAt: EARLIER, status: 'SCHEDULED', now: NOW })).toBe(false);
  });

  it('refuses an RSVP to a cancelled event', () => {
    expect(canRsvp({ startsAt: LATER, status: 'CANCELLED', now: NOW })).toBe(false);
  });

  it('FREEZES THE TYPE ONCE ANYBODY HAS RESPONDED (AC)', () => {
    // "GIVEN an event with 4 RSVPs, WHEN the creator attempts to change its
    // type, THEN the change is refused with the reason stated." Somebody who
    // agreed to walk to a park has not agreed to join a video call.
    expect(canChangeType({ rsvpCount: 0 })).toBe(true);
    expect(canChangeType({ rsvpCount: 4 })).toBe(false);
  });

  it('STOPS OFFERING DELETION once anybody has responded', () => {
    // "Deletion outright is not offered once RSVPs exist." A cancelled event
    // stays visible and marked; a deleted one vanishes, and the person who
    // planned their evening around it learns nothing.
    expect(canDelete({ rsvpCount: 0 })).toBe(true);
    expect(canDelete({ rsvpCount: 1 })).toBe(false);
  });

  it('keeps a cancelled event visible until its original date passes', () => {
    expect(isVisibleAfterCancellation({ startsAt: LATER, now: NOW })).toBe(true);
    expect(isVisibleAfterCancellation({ startsAt: EARLIER, now: NOW })).toBe(false);
  });
});

describe('requiresAttendeeNotice (EVENT-FR-007)', () => {
  const nothing = {
    startsAtChanged: false,
    locationChanged: false,
    meetingUrlChanged: false,
    cancelled: false,
  };

  it('notifies on a time, location, link or cancellation change', () => {
    expect(requiresAttendeeNotice({ ...nothing, startsAtChanged: true })).toBe(true);
    expect(requiresAttendeeNotice({ ...nothing, locationChanged: true })).toBe(true);
    expect(requiresAttendeeNotice({ ...nothing, meetingUrlChanged: true })).toBe(true);
    expect(requiresAttendeeNotice({ ...nothing, cancelled: true })).toBe(true);
  });

  it('DOES NOT notify for anything else', () => {
    // "Every user who has RSVP'd is notified of a TIME, LOCATION or
    // CANCELLATION change." Not every edit - fixing a typo in the description
    // at midnight must not wake fifty neighbours.
    expect(requiresAttendeeNotice(nothing)).toBe(false);
  });

  it('treats a changed meeting link as a changed address', () => {
    // Without it, an attendee arrives at a room that is no longer the meeting -
    // which is the same failure as turning up at the old venue.
    expect(requiresAttendeeNotice({ ...nothing, meetingUrlChanged: true })).toBe(true);
  });
});
