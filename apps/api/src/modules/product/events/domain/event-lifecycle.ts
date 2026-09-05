import type { EventStatus } from './event-fields.js';

/**
 * What may still be changed, and by whom (EVENT-FR-002/004/007).
 *
 * Three rules that all protect the same person — not the creator, but the
 * neighbour who rearranged their evening.
 */

/**
 * EVENT-FR-004: "RSVP to a past event is refused."
 *
 * A past event is one that has already started. Not "ended" — an event has no
 * end time in V1, so the start is the only boundary there is, and it is the
 * right one: agreeing to attend something that began an hour ago is not a
 * commitment anybody can act on.
 */
export function canRsvp(facts: { startsAt: Date; status: EventStatus; now: Date }): boolean {
  if (facts.status === 'CANCELLED') return false;
  return facts.startsAt.getTime() > facts.now.getTime();
}

/**
 * EVENT-FR-002: "the type cannot be changed after RSVPs exist, because
 * attendees committed to a specific mode of attendance."
 *
 * Somebody who agreed to walk to a park has not agreed to join a video call,
 * and the reverse. The database enforces this too — it is a promise made to
 * people who are not the one making the edit, so it should not depend on this
 * function being called.
 */
export function canChangeType(facts: { rsvpCount: number }): boolean {
  return facts.rsvpCount === 0;
}

/**
 * EVENT-FR-007: "deletion outright is not offered once RSVPs exist."
 *
 * Cancellation and deletion are not the same act. A cancelled event stays
 * visible and marked, so attendees who never open the notification still find
 * out when they check; a deleted one simply vanishes, and the person who
 * planned their evening around it learns nothing. Once anybody has committed,
 * only the honest option remains.
 */
export function canDelete(facts: { rsvpCount: number }): boolean {
  return facts.rsvpCount === 0;
}

/**
 * EVENT-FR-007: "a cancelled event remains visible, marked cancelled, until its
 * original date passes."
 *
 * Which is to say cancellation changes the STATUS and nothing about visibility.
 * This function exists to make that explicit and to be somewhere the reasoning
 * lives — the upcoming list drops it when its own start time passes, exactly as
 * it would have if it had gone ahead.
 */
export function isVisibleAfterCancellation(facts: { startsAt: Date; now: Date }): boolean {
  return facts.startsAt.getTime() > facts.now.getTime();
}

/**
 * Which edits require telling everyone who RSVP'd (EVENT-FR-007).
 *
 * "Every user who has RSVP'd is notified of a TIME, LOCATION or CANCELLATION
 * change." Not every edit: fixing a typo in the description at midnight should
 * not wake fifty people. The list is the set of changes that would make someone
 * turn up at the wrong place, at the wrong time, or not at all.
 */
export interface EventChangeSet {
  startsAtChanged: boolean;
  locationChanged: boolean;
  meetingUrlChanged: boolean;
  cancelled: boolean;
}

export function requiresAttendeeNotice(change: EventChangeSet): boolean {
  return (
    change.startsAtChanged ||
    change.locationChanged ||
    // A changed meeting link is the online equivalent of a changed address:
    // without it, an attendee arrives at a room that is no longer the meeting.
    change.meetingUrlChanged ||
    change.cancelled
  );
}
