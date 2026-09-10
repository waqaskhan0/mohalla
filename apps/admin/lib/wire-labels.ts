/**
 * Wire enum values, in words an administrator reads.
 *
 * WHY THIS FILE EXISTS. Running UX-ADM-004 in a browser produced a heading that
 * said "POST case" and a table cell that said
 * "2026-09-16T10:16:37.923Z". Both were the API's own values rendered
 * unchanged. Neither is wrong, exactly — and both are the sort of thing that
 * tells a reader they are looking at a database rather than a tool, which §40
 * objects to for error text and which applies just as much to a page heading.
 *
 * EVERY LABEL FALLS BACK TO THE VALUE ITSELF. The portal is a separate
 * deployable from the API, so a value added in a later release must appear as
 * itself rather than as whichever known label sits nearest. A case shown as a
 * "post" because the portal did not recognise "STORY" is a worse outcome than
 * one shown as "STORY" — the same rule the severity indicator follows, for the
 * same reason.
 */

/** `ReportTarget` — what was reported. */
const TARGET_TYPES: Record<string, string> = {
  POST: 'post',
  COMMENT: 'comment',
  EVENT: 'event',
  PROFILE: 'profile',
  CONVERSATION: 'conversation',
};

export function targetTypeLabel(targetType: string): string {
  return TARGET_TYPES[targetType] ?? targetType;
}

/**
 * `moderation_state` — where the case stands.
 *
 * The labels say what the outcome WAS rather than naming the enum, because on
 * the resolution panel this line is the answer to "what happened here".
 */
const MODERATION_STATES: Record<string, string> = {
  OPEN: 'Open — waiting for a decision',
  RESOLVED_RESTORED: 'Resolved — content restored',
  RESOLVED_DELETED: 'Resolved — content deleted permanently',
  RESOLVED_NO_ACTION: 'Resolved — closed with no action',
  CLOSED_AUTHOR_DELETED: 'Closed — the author deleted their account',
};

export function moderationStateLabel(state: string): string {
  return MODERATION_STATES[state] ?? state;
}

/**
 * `EnforcementKind` — what was done to an account.
 *
 * Past tense, because every one of these is a thing that already happened: the
 * enforcement history is a record, not a set of controls.
 *
 * THE FOUR VALUES ARE THE API'S, CHECKED AGAINST IT. The first draft of this
 * map invented `VERIFY_GRANT` and `VERIFY_REVOKE`, which do not exist —
 * `EnforcementKind` in `enforcement.repository.port.ts` is exactly
 * `SUSPEND | BAN | REINSTATE | CONTENT_DELETED`, and the database enum agrees.
 * Verification is recorded, but not as an enforcement action.
 *
 * `CONTENT_DELETED` is here because a deletion decided on one case appears in
 * the author's history when the NEXT case against them is judged, which is the
 * proportionality signal BR-037 counts.
 */
const ENFORCEMENT_KINDS: Record<string, string> = {
  SUSPEND: 'Suspended',
  BAN: 'Banned',
  REINSTATE: 'Reinstated',
  CONTENT_DELETED: 'Content deleted',
};

export function enforcementKindLabel(kind: string): string {
  return ENFORCEMENT_KINDS[kind] ?? kind;
}

/**
 * `UserState` — where an account stands.
 *
 * SIX VALUES, and the two that are easy to conflate are kept apart:
 * PENDING_DELETION is a person who asked to leave and is inside the grace
 * period; DELETED is one who has gone. An administrator looking at either must
 * not act as though it were the other, and the API refuses enforcement on a
 * deleted account outright (`CANNOT_ACT_ON_DELETED`).
 */
const USER_STATES: Record<string, string> = {
  UNVERIFIED: 'Unverified',
  ACTIVE: 'Active',
  SUSPENDED: 'Suspended',
  BANNED: 'Banned',
  PENDING_DELETION: 'Deletion requested',
  DELETED: 'Deleted',
};

export function userStateLabel(state: string): string {
  return USER_STATES[state] ?? state;
}

/**
 * `accountType` — an individual or an organization.
 *
 * It matters on more than one screen: only ORGANIZATION accounts are eligible
 * for the verified badge (ADMIN-FR-010), and the API's refusal for an
 * individual STATES that rule rather than being neutral, because an
 * administrator verifying a person has made a category error rather than
 * probed a boundary.
 */
const ACCOUNT_TYPES: Record<string, string> = {
  INDIVIDUAL: 'Individual',
  ORGANIZATION: 'Organization',
};

export function accountTypeLabel(accountType: string): string {
  return ACCOUNT_TYPES[accountType] ?? accountType;
}
