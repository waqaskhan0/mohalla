/**
 * REPORT REASONS, SEVERITY AND THRESHOLDS (SAFETY-FR-001…004 · BR-030/032/044).
 *
 * This file decides two things, and both are the kind of decision that is
 * trivially weaponised if it is wrong in the permissive direction.
 *
 * WHY AUTO-HIDE EXISTS AT ALL. SAFETY-FR-004: "this is the mechanism that lets
 * a small moderation team run an open platform safely." One human reviewer, one
 * pass a day, and content that reaches a threshold is hidden in the meantime.
 *
 * WHY IT ONLY EVER HIDES. BR-032: "nothing is ever deleted automatically. A
 * human always makes the permanent decision." RSK-010 names the risk this
 * guards against — coordinated reporting used to silence legitimate civic
 * criticism — and rates it MEDIUM likelihood, HIGH impact on a platform whose
 * whole purpose is civic criticism. So the automatic step is the reversible
 * one, and restoring resets the count so the same accounts cannot immediately
 * re-hide it.
 */

export const REPORT_REASONS = [
  'SPAM_OR_MISLEADING',
  'HARASSMENT_OR_BULLYING',
  'HATE_SPEECH',
  'VIOLENCE_OR_THREATS',
  'SEXUAL_OR_INAPPROPRIATE',
  'FALSE_INFORMATION',
  'IMPERSONATION',
  'SOMETHING_ELSE',
] as const;

export type ReportReason = (typeof REPORT_REASONS)[number];

export type ReportSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export const REPORT_TARGETS = ['POST', 'COMMENT', 'EVENT', 'PROFILE', 'CONVERSATION'] as const;
export type ReportTarget = (typeof REPORT_TARGETS)[number];

/** SAFETY-FR-001: "optionally adds a note of up to 500 characters". */
export const REPORT_NOTE_MAX_LENGTH = 500;

/** BR-038: "a reason is mandatory on every moderation and enforcement action". */
export const MODERATION_REASON_MIN_LENGTH = 5;
export const MODERATION_REASON_MAX_LENGTH = 500;

/**
 * Severity is DERIVED FROM THE REASON, never chosen by the reporter.
 *
 * SAFETY-FR-003 assigns each of the eight, and the mapping is what orders the
 * queue: "GIVEN a queue containing a Spam report and a Violence report, WHEN it
 * is opened, THEN the Violence report is ordered above the Spam report
 * REGARDLESS OF AGE."
 *
 * Letting a reporter set severity would make CRITICAL the rational choice every
 * time, and the ordering would stop carrying information — which would cost the
 * one reviewer the only signal they have about what to open first.
 */
const SEVERITY_BY_REASON: Record<ReportReason, ReportSeverity> = {
  VIOLENCE_OR_THREATS: 'CRITICAL',
  HARASSMENT_OR_BULLYING: 'HIGH',
  HATE_SPEECH: 'HIGH',
  SEXUAL_OR_INAPPROPRIATE: 'HIGH',
  FALSE_INFORMATION: 'MEDIUM',
  IMPERSONATION: 'MEDIUM',
  SPAM_OR_MISLEADING: 'LOW',
  SOMETHING_ELSE: 'LOW',
};

export function severityOf(reason: ReportReason): ReportSeverity {
  return SEVERITY_BY_REASON[reason];
}

/** Queue ordering, part one. Higher is more urgent. */
export const SEVERITY_RANK: Record<ReportSeverity, number> = {
  CRITICAL: 4,
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
};

export function moreSevere(a: ReportSeverity, b: ReportSeverity): ReportSeverity {
  return SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b;
}

/**
 * How many DISTINCT reporters hide each kind of thing — and which kinds never
 * hide at all.
 *
 * `null` is not "not implemented". It is the requirement:
 *
 *   PROFILE — SAFETY-FR-002: an account "is only ever actioned by an
 *   administrator, because hiding a whole person on report count would be
 *   trivially weaponised". Ten accounts can silence a person's post for a day;
 *   they must not be able to silence the person.
 *
 *   CONVERSATION — a direct message is private between two people, so the
 *   maximum possible distinct-reporter count is two and a threshold carries no
 *   information. MSG-FR-007 says it outright: conversations "are never
 *   auto-hidden, because they are private and a threshold has no meaning
 *   between two people".
 *
 * EVENT is 2 rather than 3 (BR-044, S2-CR-003) "because a fake gathering wastes
 * real travel and time" — the only place in the product where the safety bar is
 * deliberately lower, and the reason is that the cost of the false negative is
 * measured in somebody's journey rather than in their scroll.
 */
export const AUTO_HIDE_THRESHOLDS: Record<ReportTarget, number | null> = {
  POST: 3,
  COMMENT: 3,
  EVENT: 2,
  PROFILE: null,
  CONVERSATION: null,
};

export function autoHideThresholdFor(target: ReportTarget): number | null {
  return AUTO_HIDE_THRESHOLDS[target];
}

/**
 * Should this report hide the content?
 *
 * Takes the count AFTER the new report, and returns true only on the exact
 * transition — so a fourth report on an already-hidden post does not "hide it
 * again", which would emit a second notification to an author who has already
 * been told.
 */
export function reachesAutoHideThreshold(facts: {
  target: ReportTarget;
  distinctReportCount: number;
  alreadyHidden: boolean;
}): boolean {
  if (facts.alreadyHidden) return false;
  const threshold = autoHideThresholdFor(facts.target);
  if (threshold === null) return false;
  return facts.distinctReportCount >= threshold;
}

export type ReportRejection =
  'CANNOT_REPORT_OWN_CONTENT' | 'NOTE_TOO_LONG' | 'INVALID_REASON' | 'RATE_LIMITED';

export function checkReport(input: {
  reporterId: string;
  targetOwnerId: string | null;
  reason: unknown;
  note?: string | null;
}): ReportRejection | null {
  if (!REPORT_REASONS.includes(input.reason as ReportReason)) return 'INVALID_REASON';

  // SAFETY-FR-001: "a user cannot report their own content". Refused rather
  // than silently accepted, because somebody reporting their own post is
  // usually confused about what the button does.
  if (input.targetOwnerId !== null && input.targetOwnerId === input.reporterId) {
    return 'CANNOT_REPORT_OWN_CONTENT';
  }

  if (typeof input.note === 'string' && [...input.note].length > REPORT_NOTE_MAX_LENGTH) {
    return 'NOTE_TOO_LONG';
  }

  return null;
}

/**
 * BR-037 — the repeat-offender rule, and the word that matters is FLAGS.
 *
 * "Three administrator-confirmed deletions of one user's content within 30 days
 * FLAGS that account in the moderation queue for a suspension decision. IT IS
 * NOT AUTO-SUSPENDED."
 *
 * That distinction is the same one BR-032 makes about content, applied to
 * people: the automatic step surfaces a decision, and a human takes it. An
 * account suspended by arithmetic is an account a coordinated group can
 * suspend, and S2-DEC-013 chose not to build that.
 */
export const REPEAT_OFFENDER_DELETIONS = 3;
export const REPEAT_OFFENDER_WINDOW_DAYS = 30;

export function isRepeatOffender(confirmedDeletionsInWindow: number): boolean {
  return confirmedDeletionsInWindow >= REPEAT_OFFENDER_DELETIONS;
}
