import { countGraphemes } from '../../profile/domain/profile-fields.js';

/**
 * Event field rules (EVENT-FR-001/002 · §12 validation table).
 *
 * Counted in GRAPHEME CLUSTERS, as everywhere else, so an event announced in
 * Urdu is not charged for diacritics a reader never sees (BR-012).
 */

export const EVENT_TITLE_MIN = 3;
export const EVENT_TITLE_MAX = 120;
export const EVENT_DESCRIPTION_MIN = 10;
export const EVENT_DESCRIPTION_MAX = 2000;
export const EVENT_LOCATION_MIN = 3;
export const EVENT_LOCATION_MAX = 200;
export const EVENT_MEETING_URL_MAX = 500;

/** EVENT-FR-001 E4: "a maximum of 5 events per user per day". */
export const MAX_EVENTS_PER_DAY = 5;
export const EVENT_QUOTA_WINDOW_HOURS = 24;

export type EventType = 'ONLINE' | 'PHYSICAL';
export type EventStatus = 'SCHEDULED' | 'CANCELLED';
export type EventVisibilityState = 'VISIBLE' | 'AUTO_HIDDEN' | 'ADMIN_REMOVED';

export interface EventFieldProblem {
  field: string;
  reason: string;
}

export function checkTitle(title: unknown): EventFieldProblem | null {
  if (typeof title !== 'string') return { field: 'title', reason: 'NOT_A_STRING' };
  const trimmed = title.trim();
  if (trimmed === '') return { field: 'title', reason: 'EMPTY' };
  const n = countGraphemes(trimmed);
  if (n < EVENT_TITLE_MIN) return { field: 'title', reason: 'TOO_SHORT' };
  if (n > EVENT_TITLE_MAX) return { field: 'title', reason: 'TOO_LONG' };
  return null;
}

export function checkDescription(description: unknown): EventFieldProblem | null {
  if (typeof description !== 'string') {
    return { field: 'description', reason: 'NOT_A_STRING' };
  }
  const trimmed = description.trim();
  if (trimmed === '') return { field: 'description', reason: 'EMPTY' };
  const n = countGraphemes(trimmed);
  if (n < EVENT_DESCRIPTION_MIN) return { field: 'description', reason: 'TOO_SHORT' };
  if (n > EVENT_DESCRIPTION_MAX) return { field: 'description', reason: 'TOO_LONG' };
  return null;
}

/**
 * The start time must be in the future (EVENT-FR-001 E1).
 *
 * Takes `now` rather than reading the clock, so "an event two seconds from now"
 * and "an event two seconds ago" are both testable without waiting. The same
 * reason `Clock` exists at all.
 */
export function checkStartsAt(startsAt: unknown, now: Date): EventFieldProblem | null {
  if (!(startsAt instanceof Date) || Number.isNaN(startsAt.getTime())) {
    return { field: 'startsAt', reason: 'NOT_A_DATE' };
  }
  if (startsAt.getTime() <= now.getTime()) {
    return { field: 'startsAt', reason: 'MUST_BE_IN_THE_FUTURE' };
  }
  return null;
}

/**
 * Validate the meeting link (§12 · EVENT-FR-001 E3).
 *
 * "Valid http or https URL", and nothing else. The scheme allow-list is the
 * point rather than a formality: `javascript:` and `data:` URLs are the classic
 * stored-XSS vector, and SEC-016 names the Admin Portal as the highest-value
 * target for exactly that — a moderator reviewing a reported event is the
 * person most likely to be shown this string. Refusing at the boundary means no
 * surface has to remember to escape it.
 *
 * A URL is NOT normalised or rewritten. Whatever the creator typed is what
 * attendees are shown, because silently altering a link somebody has to trust
 * is worse than refusing one.
 */
export function checkMeetingUrl(url: unknown): EventFieldProblem | null {
  if (typeof url !== 'string') return { field: 'meetingUrl', reason: 'NOT_A_STRING' };
  const trimmed = url.trim();
  if (trimmed === '') return { field: 'meetingUrl', reason: 'EMPTY' };
  if (trimmed.length > EVENT_MEETING_URL_MAX) {
    return { field: 'meetingUrl', reason: 'TOO_LONG' };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { field: 'meetingUrl', reason: 'NOT_A_URL' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { field: 'meetingUrl', reason: 'SCHEME_NOT_ALLOWED' };
  }
  if (parsed.hostname === '') return { field: 'meetingUrl', reason: 'NOT_A_URL' };
  return null;
}

export function checkLocation(location: unknown): EventFieldProblem | null {
  if (typeof location !== 'string') return { field: 'locationText', reason: 'NOT_A_STRING' };
  const trimmed = location.trim();
  if (trimmed === '') return { field: 'locationText', reason: 'EMPTY' };
  const n = countGraphemes(trimmed);
  if (n < EVENT_LOCATION_MIN) return { field: 'locationText', reason: 'TOO_SHORT' };
  if (n > EVENT_LOCATION_MAX) return { field: 'locationText', reason: 'TOO_LONG' };
  return null;
}

/**
 * Validate the whole event, type-aware.
 *
 * EVENT-FR-002: the type "determines whether a meeting link or a location is
 * required". Checked as one function rather than field by field, because the
 * requirement is about the COMBINATION — an ONLINE event with a location and no
 * link passes every individual field check and is still not an event anyone can
 * attend.
 *
 * A1 in the requirement settles the hybrid case: "the user selects Physical and
 * includes the link in the description. A hybrid type is not modelled in V1."
 * So supplying both is an error rather than a convenience, and the message says
 * which field does not belong.
 */
export function checkEventFields(
  input: {
    title: unknown;
    description: unknown;
    startsAt: unknown;
    eventType: unknown;
    meetingUrl?: unknown;
    locationText?: unknown;
  },
  now: Date,
): EventFieldProblem | null {
  const titleProblem = checkTitle(input.title);
  if (titleProblem !== null) return titleProblem;

  const descriptionProblem = checkDescription(input.description);
  if (descriptionProblem !== null) return descriptionProblem;

  const startsAtProblem = checkStartsAt(input.startsAt, now);
  if (startsAtProblem !== null) return startsAtProblem;

  if (input.eventType !== 'ONLINE' && input.eventType !== 'PHYSICAL') {
    return { field: 'eventType', reason: 'INVALID' };
  }

  if (input.eventType === 'ONLINE') {
    if (input.locationText !== undefined && input.locationText !== null) {
      return { field: 'locationText', reason: 'NOT_FOR_ONLINE_EVENT' };
    }
    return checkMeetingUrl(input.meetingUrl);
  }

  if (input.meetingUrl !== undefined && input.meetingUrl !== null) {
    return { field: 'meetingUrl', reason: 'NOT_FOR_PHYSICAL_EVENT' };
  }
  return checkLocation(input.locationText);
}

export function normalize(value: string): string {
  return value.trim();
}
