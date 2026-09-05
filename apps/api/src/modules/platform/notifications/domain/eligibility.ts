import { pushPreferenceFor, type NotificationCategory } from './notification-category.js';

/**
 * WHO GETS WHAT (ADR-014 "Eligibility, applied in order" · NOTIF-FR-003/004/007).
 *
 * ADR-014 lists six rules and says they apply IN ORDER. The order is not a
 * performance hint — it decides which of two conflicting answers wins, and
 * getting it wrong produces a system that is right in every test and wrong for
 * the person it matters to.
 *
 *   1. Never notify a user of their OWN action
 *   2. Never notify ACROSS A BLOCK, in either direction
 *   3. A Message Request produces NO PUSH
 *   4. Apply the per-category preference — WHICH GATES PUSH ONLY
 *   5. Apply like-batching above 5 per post per hour
 *   6. Render in the RECIPIENT's language
 *
 * THE CRITICAL SPLIT IS BETWEEN RULES 1-2 AND RULES 3-4.
 *
 * Rules 1 and 2 suppress the NOTIFICATION ENTIRELY — there is no record, because
 * there is nothing the recipient should ever see. A blocked user's like must not
 * appear in the centre either; BR-025 says neither party sees the other's
 * activity, and a notification centre is a surface like any other.
 *
 * Rules 3 and 4 suppress only the PUSH. NOTIF-FR-007 is explicit: "preferences
 * apply to push only; the in-app centre always records everything, so disabling
 * push never loses information." Its acceptance criterion is exactly that —
 * likes disabled, "no push is sent BUT the entry appears in the in-app centre".
 *
 * Collapsing those two into one boolean is the mistake this file exists to
 * prevent, and it is an easy one: both look like "don't notify".
 */

export type Suppression =
  /** Rules 1-2. No record, no push, nothing. */
  | { record: false; push: false; reason: 'OWN_ACTION' | 'BLOCKED' | 'NO_RECIPIENT' }
  /** Rules 3-4. The record is kept; only the push is dropped. */
  | { record: true; push: false; reason: 'MESSAGE_REQUEST' | 'PREFERENCE_OFF' | 'NO_DEVICE' }
  /** Everything through. */
  | { record: true; push: true; reason: 'ELIGIBLE' };

export interface EligibilityFacts {
  recipientId: string | null;
  actorId: string | null;
  category: NotificationCategory;
  blockedEitherWay: boolean;
  /** MSG-FR-005 / BR-027 — true when this message landed as a Message Request. */
  isMessageRequest: boolean;
  /** The recipient's switch for this category. Absent means enabled. */
  pushPreferences: Partial<Record<string, boolean>>;
  /** Whether the recipient has any live device token at all. */
  hasLiveDevice: boolean;
}

export function decideEligibility(facts: EligibilityFacts): Suppression {
  if (facts.recipientId === null) {
    return { record: false, push: false, reason: 'NO_RECIPIENT' };
  }

  // 1 — NOTIF-FR-003: "no notification is generated for the user's own
  // actions". First, because it is the cheapest and the most embarrassing to
  // get wrong: being told you liked your own post.
  if (facts.actorId !== null && facts.actorId === facts.recipientId) {
    return { record: false, push: false, reason: 'OWN_ACTION' };
  }

  // 2 — BR-025, in either direction. NOT a push-only suppression: a blocked
  // user's activity must not reach the centre either. The notification centre
  // is a surface, and BR-025 says neither party sees the other's activity on
  // any surface.
  if (facts.blockedEitherWay) {
    return { record: false, push: false, reason: 'BLOCKED' };
  }

  // 3 — BR-027 / NOTIF-FR-004: "no notification is ever sent for a Message
  // Request". The RECORD survives, because the recipient's request COUNT still
  // has to update; what must not happen is the phone buzzing. MSG-FR-005 is
  // built entirely on a stranger's message being quiet.
  if (facts.isMessageRequest) {
    return { record: true, push: false, reason: 'MESSAGE_REQUEST' };
  }

  // 4 — NOTIF-FR-007. An ABSENT row means enabled: somebody who has never
  // opened settings should receive notifications, and defaulting to off would
  // silently disable the product's main retention mechanism for every new user.
  const key = pushPreferenceFor(facts.category);
  if (facts.pushPreferences[key] === false) {
    return { record: true, push: false, reason: 'PREFERENCE_OFF' };
  }

  // Not a rule from the list, but the same shape: no device, no push, and the
  // record still stands. NOTIF-FR-001's acceptance criterion is precisely this
  // case — "GIVEN a user who denied the push permission, WHEN someone comments
  // on their post, THEN the notification is present in the in-app centre".
  if (!facts.hasLiveDevice) {
    return { record: true, push: false, reason: 'NO_DEVICE' };
  }

  return { record: true, push: true, reason: 'ELIGIBLE' };
}
