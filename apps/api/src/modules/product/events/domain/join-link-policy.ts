import type { EventStatus, EventType } from './event-fields.js';

/**
 * WHO MAY SEE THE MEETING LINK, AND WHEN (EVENT-FR-003 · BR-045).
 *
 * The requirement states both halves and, unusually, states the reason for the
 * second: the link "is shown only to users who have RSVP'd, and only from 30
 * minutes before the start time, WHICH LIMITS SCRAPING OF OPEN MEETING ROOMS."
 *
 * That reason is what makes this a security control rather than a UI detail. A
 * Zoom or Meet room link is a credential — anyone holding it can walk in. On a
 * civic platform the people most likely to be targeted are the ones organising
 * a neighbourhood meeting about something contentious, and a link harvested a
 * week in advance gives an unlimited window to arrange a disruption. Thirty
 * minutes does not make that impossible; it makes it expensive and late.
 *
 * SO THE LINK IS NOT A FIELD ON THE EVENT. It is a separate decision with its
 * own endpoint, and the detail response carries only whether the link is
 * available yet. A response body that included the URL "but hid it in the UI"
 * would defeat the whole control, because the client is not where this is
 * enforced.
 *
 * THE THREE OUTCOMES ARE DELIBERATELY DISTINCT, which is the opposite of the
 * rule everywhere else in this codebase. Elsewhere missing, blocked and
 * forbidden collapse into one neutral answer so a caller cannot probe what
 * exists. Here the event is ALREADY PUBLIC — its existence, title, time and
 * attendee count are visible to anyone — so refusing the link discloses
 * nothing new, and telling somebody WHY they cannot join is the difference
 * between a usable product and a broken one. EVENT-FR-003's acceptance
 * criterion demands it outright: "the join control is not yet active and THE
 * AVAILABILITY TIME IS STATED".
 *
 * The 404 case still collapses, because that one IS about existence.
 */

/** EVENT-FR-003: "only from 30 minutes before the start time". */
export const JOIN_WINDOW_MINUTES = 30;

export type JoinDecision =
  /** Here is the link. */
  | { status: 'AVAILABLE' }
  /** Public event, but this viewer has not committed to attending. */
  | { status: 'NOT_ATTENDING' }
  /** Attending, but too early. Carries WHEN, because the requirement says so. */
  | { status: 'TOO_EARLY'; availableFrom: Date }
  /** Not an online event at all — there is no link to give. */
  | { status: 'NOT_AN_ONLINE_EVENT' }
  /** EVENT-FR-007: a cancelled event is still visible, but nobody joins it. */
  | { status: 'CANCELLED' };

export function joinWindowOpensAt(startsAt: Date): Date {
  return new Date(startsAt.getTime() - JOIN_WINDOW_MINUTES * 60 * 1000);
}

/**
 * Decide whether this viewer may have the link right now.
 *
 * ORDER MATTERS, and not for cost. `CANCELLED` is checked before the RSVP and
 * the clock so that somebody who did RSVP is told the event is off rather than
 * "not yet" — being told to wait for a meeting that will never start is worse
 * than being told nothing.
 *
 * `NOT_AN_ONLINE_EVENT` comes first because it is a statement about the event
 * rather than about the viewer, and it is true regardless of who is asking.
 */
export function decideJoin(facts: {
  eventType: EventType;
  status: EventStatus;
  startsAt: Date;
  viewerResponse: 'GOING' | 'INTERESTED' | null;
  now: Date;
}): JoinDecision {
  if (facts.eventType !== 'ONLINE') return { status: 'NOT_AN_ONLINE_EVENT' };
  if (facts.status === 'CANCELLED') return { status: 'CANCELLED' };

  // "shown only to users who have RSVP'd" — either response counts. INTERESTED
  // is a weaker signal than GOING, but the requirement says RSVP'd, and someone
  // who marked Interested and then decided to attend should not be locked out
  // of a meeting that starts in ten minutes.
  if (facts.viewerResponse === null) return { status: 'NOT_ATTENDING' };

  const opensAt = joinWindowOpensAt(facts.startsAt);
  if (facts.now.getTime() < opensAt.getTime()) {
    return { status: 'TOO_EARLY', availableFrom: opensAt };
  }

  // NO UPPER BOUND. The window opens 30 minutes before and never closes: a
  // meeting that runs long, or starts late, must not lock out the people
  // attending it. The requirement gives an opening time and no closing one, and
  // that asymmetry is correct — the scraping risk is in the days beforehand,
  // not in the hour after.
  return { status: 'AVAILABLE' };
}
