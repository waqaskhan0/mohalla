/**
 * THE ACCOUNT DELETION LIFECYCLE (SET-FR-004/005 · BR-008/009 · PRIV-005/006/007).
 *
 * ADR-019's state machine, and the reason it is a state machine rather than a
 * flag: "a boolean CANNOT EXPRESS 'invisible but restorable', cannot drive the
 * day-30 job, and cannot distinguish restorable from terminal."
 *
 *   ACTIVE ──delete──► PENDING_DELETION ──30 days──► DELETED (terminal)
 *      ▲                      │
 *      └──── login + restore ─┘        within 30 days only
 *
 * THREE PHASES, AND THEY DIFFER IN WHAT THEY COST TO GET WRONG.
 *
 * Phase 1 costs nothing permanent: the account is invisible and every session
 * is gone, but everything is recoverable by logging in.
 *
 * Phase 2 is the grace period, and its whole purpose is that people delete
 * accounts in anger, at 2am, or by tapping the wrong thing. S2-CR-004 added it
 * for exactly that.
 *
 * Phase 3 is the only irreversible act in the product. Everything else here
 * hides, marks or reverses.
 *
 * WHAT THE USER MUST BE TOLD BEFORE CONFIRMING. PRIV-006: posts and comments
 * are anonymised rather than erased, and "USERS MUST BE TOLD THIS CLEARLY
 * BEFORE CONFIRMING, BECAUSE IT DIFFERS FROM THE ERASURE MANY WILL ASSUME."
 * That is a product obligation the API can support but not discharge — so the
 * consequences are enumerated here as data, and the delete endpoint returns
 * them, rather than leaving each client to write its own list and miss one.
 */

/** ADR-019 · S2-CR-004. Thirty days, and the reason is human error. */
export const DELETION_GRACE_DAYS = 30;

export type DeletionPhase = 'NONE' | 'PENDING' | 'ERASED';

/**
 * BR-008 — who may delete.
 *
 * "A user may delete their account at any time, IN ANY STATE EXCEPT
 * ALREADY-DELETED, INCLUDING WHILE SUSPENDED."
 *
 * The suspended case is the one worth stating: a suspension must not trap
 * somebody in the product. An account that cannot leave while it is being
 * punished is a hostage, and the punishment is supposed to be a pause on
 * posting rather than on existing.
 */
export type DeletionRefusal = 'ALREADY_DELETED' | 'ALREADY_PENDING' | 'PASSWORD_REQUIRED';

export function canRequestDeletion(state: string): DeletionRefusal | null {
  if (state === 'DELETED') return 'ALREADY_DELETED';
  if (state === 'PENDING_DELETION') return 'ALREADY_PENDING';
  // Every other state — ACTIVE, UNVERIFIED, SUSPENDED, BANNED — may leave.
  // BANNED included: a banned account has already lost the product, and
  // refusing their deletion would keep their data for the platform's
  // convenience rather than for any stated purpose.
  return null;
}

export function erasureDueAt(requestedAt: Date): Date {
  return new Date(requestedAt.getTime() + DELETION_GRACE_DAYS * 24 * 60 * 60 * 1000);
}

/**
 * SET-FR-005 — may this account still be restored?
 *
 * "Restoration is available for EXACTLY 30 DAYS and requires the account's own
 * credentials — NO ADMINISTRATOR INVOLVEMENT." The second half matters as much
 * as the first: a restoration that needed a support ticket would fail everybody
 * who deleted in a moment they regret and cannot face explaining.
 */
export function canRestore(facts: {
  scheduledErasureAt: Date;
  restoredAt: Date | null;
  completedAt: Date | null;
  now: Date;
}): boolean {
  if (facts.completedAt !== null) return false;
  if (facts.restoredAt !== null) return false;
  return facts.now.getTime() < facts.scheduledErasureAt.getTime();
}

/** Is this request due for erasure? The day-30 job asks exactly this. */
export function isDueForErasure(facts: {
  scheduledErasureAt: Date;
  restoredAt: Date | null;
  completedAt: Date | null;
  now: Date;
}): boolean {
  if (facts.completedAt !== null) return false;
  if (facts.restoredAt !== null) return false;
  return facts.now.getTime() >= facts.scheduledErasureAt.getTime();
}

/**
 * What deletion actually does, enumerated (PRIV-006 · UX-SET-009).
 *
 * Returned by the delete endpoint BEFORE confirmation, so every client shows
 * the same list and none of them quietly omits the one that surprises people.
 * The wording lives in the localization catalogue; these are the keys.
 *
 * The order is deliberate: the thing users do not expect comes SECOND, where it
 * is read, rather than last where it is skipped.
 */
export const DELETION_CONSEQUENCE_KEYS = [
  'deletion.consequence.profileRemoved',
  // PRIV-006's "differs from the erasure many will assume".
  'deletion.consequence.postsRemainAnonymised',
  'deletion.consequence.messagesRemainForTheOtherPerson',
  'deletion.consequence.sessionsEndImmediately',
  'deletion.consequence.restorableForThirtyDays',
  'deletion.consequence.permanentAfterThirtyDays',
] as const;

export type DeletionConsequenceKey = (typeof DELETION_CONSEQUENCE_KEYS)[number];
