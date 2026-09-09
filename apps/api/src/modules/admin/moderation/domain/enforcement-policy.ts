/**
 * ENFORCEMENT (ADMIN-FR-006/007/008 · BR-034/035/036 · BR-ADM-001 · SEC-021).
 *
 * THE MOST IMPORTANT THING IN THIS FILE IS A TYPE THAT CANNOT NAME AN
 * ADMINISTRATOR.
 *
 * BR-ADM-001: "No administrator may suspend, ban, delete or otherwise act upon
 * another administrator's account through the product." SEC-021 adds that this
 * "is enforced server-side and cannot be reached by any request, REGARDLESS OF
 * INTERFACE STATE."
 *
 * The reason is not politeness between colleagues. The SRS's own note on the
 * admin model says it: "All administrators equal, no hierarchy — requires
 * BR-ADM-001 and SEC-021 to CLOSE THE LOCKOUT RISK." With no hierarchy, one
 * compromised or angry administrator could suspend every other one and hold the
 * platform. There is no super-admin to undo it, because there is no hierarchy —
 * so the action has to be impossible rather than merely restricted.
 *
 * It is closed in three places, and each would be sufficient on its own:
 *
 *   SCHEMA  — `enforcement_actions.target_user_id` references `users`, and no
 *             column anywhere references `admins` as a target (0019).
 *   TYPE    — `EnforcementTarget` below carries a user id and an account state;
 *             an administrator has neither, because they are not in `users`.
 *   RUNTIME — `checkEnforceable` refuses a target that is not an ordinary user.
 *
 * Three, because SEC-021 says "cannot be reached by any request" and a single
 * check is one refactor away from being bypassed.
 */

import { MODERATION_REASON_MIN_LENGTH } from '../../../product/safety/domain/report-policy.js';

/** ADMIN-FR-006: "24 hours, 7 days or 30 days". Not a free-form duration. */
export const SUSPENSION_DURATIONS = {
  HOURS_24: 24 * 60 * 60 * 1000,
  DAYS_7: 7 * 24 * 60 * 60 * 1000,
  DAYS_30: 30 * 24 * 60 * 60 * 1000,
} as const;

export type SuspensionDuration = keyof typeof SUSPENSION_DURATIONS;

/**
 * A user account, as enforcement sees it.
 *
 * There is no variant of this that could describe an administrator. That is the
 * point: an admin has no row in `users` and no `UserState`, so the type itself
 * refuses to express the action BR-ADM-001 forbids.
 */
export interface EnforcementTarget {
  userId: string;
  state: 'UNVERIFIED' | 'ACTIVE' | 'SUSPENDED' | 'BANNED' | 'PENDING_DELETION' | 'DELETED';
}

export type EnforcementRejection =
  | 'TARGET_IS_ADMINISTRATOR'
  | 'TARGET_NOT_FOUND'
  | 'REASON_TOO_SHORT'
  | 'ALREADY_IN_STATE'
  | 'CANNOT_ACT_ON_DELETED';

/**
 * BR-038 — a reason is mandatory on every enforcement action.
 *
 * Five characters is not a meaningful bar on its own; what it stops is an empty
 * string and a single keystroke. The audit log is only worth having if it
 * cannot contain a blank, and the database enforces the same minimum so a path
 * that skipped this check still cannot write one.
 */
export function checkReason(reason: unknown): EnforcementRejection | null {
  if (typeof reason !== 'string') return 'REASON_TOO_SHORT';
  if (reason.trim().length < MODERATION_REASON_MIN_LENGTH) return 'REASON_TOO_SHORT';
  return null;
}

/**
 * May this account be acted upon at all?
 *
 * `targetIsAdministrator` is passed in rather than derived, because the caller
 * is the only layer that can ask both stores — `admins` and `users` are
 * deliberately separate (SEC-020), and a domain function that could query
 * either would be a domain function with a database.
 *
 * A DELETED account is refused too. Enforcement against an account that is
 * already gone records an action nobody can experience, and reinstating it
 * later would resurrect something the user asked to remove.
 */
export function checkEnforceable(facts: {
  target: EnforcementTarget | null;
  targetIsAdministrator: boolean;
  reason: unknown;
}): EnforcementRejection | null {
  // FIRST, and before the target is even required to exist. SEC-021 says the
  // prohibition holds "regardless of interface state", so it must not depend on
  // a lookup that could fail for another reason first.
  if (facts.targetIsAdministrator) return 'TARGET_IS_ADMINISTRATOR';
  if (facts.target === null) return 'TARGET_NOT_FOUND';
  if (facts.target.state === 'DELETED') return 'CANNOT_ACT_ON_DELETED';

  return checkReason(facts.reason);
}

/**
 * EDGE-027 — "re-suspending REPLACES the duration rather than accumulating."
 *
 * Accumulation is the intuitive implementation and the wrong one: two
 * administrators independently applying a 30-day suspension to the same account
 * would produce 60 days, which neither of them decided. Replacement means the
 * most recent decision is the one in force, which is also the one the audit log
 * shows as current.
 */
export function suspensionExpiry(duration: SuspensionDuration, now: Date): Date {
  return new Date(now.getTime() + SUSPENSION_DURATIONS[duration]);
}

/**
 * BR-034 — what a suspended user may still do.
 *
 * "A suspended user RETAINS READ ACCESS but cannot post, comment, like,
 * message, follow, create events or RSVP." Read access is the part worth
 * stating: a suspension is a pause, not an eviction, and somebody who cannot
 * read cannot see the banner explaining why they were suspended or when it
 * lifts.
 *
 * This is already enforced by the session guard's capability check — the
 * function exists so the RULE has somewhere to be read and tested, rather than
 * living only as a string comparison in a guard.
 */
export function suspendedCapability(): 'READ_ONLY' {
  return 'READ_ONLY';
}

/**
 * EDGE-028 — "a suspension expires while the user has the app open."
 *
 * "Full capability returns on the next request. NO RE-LOGIN IS NEEDED." That
 * falls out of the session design rather than needing a job: authority lives in
 * a row that is re-read on every request (ADR-008), so an expiry is simply a
 * comparison that starts coming out the other way. ADMIN-FR-006's criterion —
 * "24 hours elapse, THEN full capability returns WITHOUT ANY ADMINISTRATOR
 * INVOLVEMENT" — is satisfied by there being nothing to run.
 */
export function suspensionHasLifted(facts: { suspendedUntil: Date | null; now: Date }): boolean {
  if (facts.suspendedUntil === null) return false;
  return facts.now.getTime() >= facts.suspendedUntil.getTime();
}

/**
 * ADMIN-FR-010 — who may hold a verified badge.
 *
 * "Only Organization-type accounts are eligible", and S2-CR-006 makes
 * verification invitation-only in V1 — there is no request queue, so this is
 * the only gate. The acceptance criterion asks for the eligibility rule to be
 * STATED rather than a neutral refusal: an administrator who tries to verify an
 * individual has made a category error, not a security probe.
 */
export function canHoldVerifiedBadge(accountType: 'INDIVIDUAL' | 'ORGANIZATION'): boolean {
  return accountType === 'ORGANIZATION';
}

/**
 * NOTIF-FR-005 — broadcasts are capped at two per week.
 *
 * "Because over-use is a direct cause of uninstalls." A rolling seven days
 * rather than a calendar week, for the same reason the rate limits are rolling:
 * a calendar boundary lets four broadcasts land within a few hours of each
 * other, on Sunday night and Monday morning, which is precisely the pattern the
 * cap exists to prevent.
 */
export const BROADCASTS_PER_WEEK = 2;
export const BROADCAST_WINDOW_DAYS = 7;

export function canBroadcast(sentInWindow: number): boolean {
  return sentInWindow < BROADCASTS_PER_WEEK;
}
