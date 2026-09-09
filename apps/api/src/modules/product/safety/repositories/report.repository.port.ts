import type { PoolClient } from 'pg';
import type { ReportReason, ReportSeverity, ReportTarget } from '../domain/report-policy.js';

export const REPORT_REPOSITORY = Symbol.for('mohalla.safety.reportRepository');

export type ModerationState =
  | 'OPEN'
  | 'RESOLVED_RESTORED'
  | 'RESOLVED_DELETED'
  | 'RESOLVED_NO_ACTION'
  | 'CLOSED_AUTHOR_DELETED';

export interface ReportRecord {
  id: string;
  reporterId: string;
  targetType: ReportTarget;
  targetId: string;
  targetOwnerId: string | null;
  reasonCode: ReportReason;
  severity: ReportSeverity;
  note: string | null;
  createdAt: Date;
}

export interface ModerationCase {
  id: string;
  targetType: ReportTarget;
  targetId: string;
  targetOwnerId: string | null;
  state: ModerationState;
  maxSeverity: ReportSeverity;
  distinctReportCount: number;
  autoHidden: boolean;
  resolutionReason: string | null;
  resolvedByAdminId: string | null;
  resolvedAt: Date | null;
  version: number;
  createdAt: Date;
}

/**
 * What a target looks like to the threshold check.
 *
 * Deliberately minimal: the owner (so a self-report is refused and BR-037 is
 * answerable), the current visibility, and the distinct count. The threshold
 * decision needs nothing else, and loading a whole post would mean this
 * repository knew about post shape.
 */
export interface ReportableTarget {
  targetId: string;
  ownerId: string | null;
  /** True when it is already hidden — so a later report does not re-hide it. */
  hidden: boolean;
  distinctReportCount: number;
  exists: boolean;
}

export interface ReportRepository {
  /**
   * THE ATOMIC THRESHOLD (mandatory test C · `13-moderation-audit.md` §2).
   *
   * "Report insert, distinct-count recompute and visibility change occur in ONE
   * TRANSACTION with `SELECT … FOR UPDATE` on the target. Two simultaneous
   * threshold-reaching reports cannot double-hide or miss."
   *
   * The lock is taken FIRST, before the count is read, and held to commit. Read
   * then lock would let two transactions both read 2, both decide 3 is not
   * reached, and both insert — leaving a post with three reports and no hide.
   * Lock then read serialises exactly the pair of operations that must not
   * interleave, and nothing else.
   *
   * @returns the target as it was AFTER the lock, or `exists: false`.
   */
  lockTarget(
    targetType: ReportTarget,
    targetId: string,
    /**
     * Who is reporting.
     *
     * Needed because one target type is only reportable BY A PARTICIPANT:
     * MSG-FR-007 says "a participant reports a conversation", and a stranger
     * who guessed a conversation id must get the same nothing every other
     * messaging path gives them. Every other type is public, so this is
     * ignored for them.
     */
    reporterId: string,
    client: PoolClient,
  ): Promise<ReportableTarget>;

  /**
   * Insert the report, or do nothing if this reporter already filed one.
   *
   * `ON CONFLICT DO NOTHING` on `(reporter_id, target_type, target_id)`.
   *
   * @returns false when the report already existed. The CALLER returns the same
   * acknowledgement either way — SAFETY-FR-001 requires that "the reporter
   * cannot infer the current tally", and an error on the second attempt would
   * tell them their first one counted.
   */
  insertReport(
    input: {
      id: string;
      reporterId: string;
      targetType: ReportTarget;
      targetId: string;
      targetOwnerId: string | null;
      reasonCode: ReportReason;
      severity: ReportSeverity;
      note: string | null;
    },
    client: PoolClient,
  ): Promise<boolean>;

  /** BR-030: DISTINCT reporting accounts. The UNIQUE constraint makes this a row count. */
  countDistinctReporters(
    targetType: ReportTarget,
    targetId: string,
    client: PoolClient,
  ): Promise<number>;

  /** Write the recomputed count back onto the content row. */
  setDistinctReportCount(
    targetType: ReportTarget,
    targetId: string,
    count: number,
    client: PoolClient,
  ): Promise<void>;

  /**
   * SAFETY-FR-004 — hide it from everyone but its author.
   *
   * AUTO_HIDDEN, never deleted (BR-032). PROFILE-FR-004 keeps it visible to the
   * author, marked under review, which every read path already implements.
   */
  autoHide(targetType: ReportTarget, targetId: string, client: PoolClient): Promise<boolean>;

  /** ADMIN-FR-003 — restore, and reset the count so the same accounts cannot re-hide it. */
  restore(targetType: ReportTarget, targetId: string, client: PoolClient): Promise<boolean>;

  /** ADMIN-FR-004 — the permanent decision, and only ever a human's. */
  adminRemove(targetType: ReportTarget, targetId: string, client: PoolClient): Promise<boolean>;

  /** Delete every report against a target — ADMIN-FR-003's count reset. */
  clearReports(targetType: ReportTarget, targetId: string, client: PoolClient): Promise<number>;

  // ---- cases -------------------------------------------------------------
  /**
   * Open a case, or fold this report into the open one.
   *
   * A partial UNIQUE index guarantees at most one OPEN case per target, so this
   * is an upsert. Without it the third and fourth report on a post would each
   * open a case, the queue would list the same item twice, and two admins could
   * resolve "it" differently.
   */
  upsertOpenCase(
    input: {
      id: string;
      targetType: ReportTarget;
      targetId: string;
      targetOwnerId: string | null;
      maxSeverity: ReportSeverity;
      distinctReportCount: number;
      autoHidden: boolean;
    },
    client: PoolClient,
  ): Promise<ModerationCase>;

  findCaseById(id: string, client?: PoolClient): Promise<ModerationCase | null>;

  findOpenCaseFor(
    targetType: ReportTarget,
    targetId: string,
    client?: PoolClient,
  ): Promise<ModerationCase | null>;

  /**
   * ADMIN-FR-002 — the queue: severity, then count, then age.
   *
   * Offset-based rather than keyset, because the ordering key is mutable: a new
   * report on an open case changes its severity or count and moves it. A keyset
   * cursor over a moving order silently skips rows.
   */
  listOpenCases(
    limit: number,
    offset: number,
    client?: PoolClient,
  ): Promise<{ cases: ModerationCase[]; total: number }>;

  /**
   * EDGE-024 — resolve, but only from the version the admin was shown.
   *
   * @returns null when the version did not match, meaning somebody resolved it
   * first. The caller re-reads and reports WHO and HOW, because §4 says a stale
   * decision is "rendered as information rather than an error".
   */
  resolveCase(
    input: {
      id: string;
      expectedVersion: number;
      state: Exclude<ModerationState, 'OPEN'>;
      resolutionReason: string;
      adminId: string;
    },
    client: PoolClient,
  ): Promise<ModerationCase | null>;

  /** BR-037 — confirmed deletions of this user's content inside the window. */
  countConfirmedDeletions(ownerId: string, since: Date, client?: PoolClient): Promise<number>;

  // ---- rate limiting (SAFETY-FR-009) -------------------------------------
  /**
   * How many of an action this user has taken in the window, and the oldest.
   *
   * The oldest is what makes the cool-down message honest: the window clears
   * when that one ages out, not 24 hours from now.
   */
  countInWindow(
    table: 'posts' | 'comments' | 'messages' | 'follows' | 'events' | 'reports',
    userColumn: string,
    userId: string,
    since: Date,
    client?: PoolClient,
  ): Promise<{ used: number; oldest: Date | null }>;
}
