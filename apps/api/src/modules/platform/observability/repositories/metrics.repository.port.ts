import type { PoolClient } from 'pg';

export const METRICS_REPOSITORY = Symbol.for('mohalla.observability.metricsRepository');

/**
 * OPERATIONAL READINGS — what §15.4 says is monitored.
 *
 * Every field is a NUMBER OR NULL, and the distinction carries meaning: `null`
 * means "not collected here", not "zero". A stopped collector reported as zero
 * is a permanently green dashboard, which is the failure the moderation-queue
 * alert exists to catch arriving through the monitoring instead of the people.
 */
export interface OperationalReadings {
  /** SAFETY-FR: open cases waiting for a human (§15.4 "moderation queue size"). */
  moderationOpenCases: number;
  /**
   * Age of the OLDEST open case, in hours.
   *
   * The single most important number in this file, and the reason the endpoint
   * exists. §15.4: A3 - that somebody reviews the queue daily - is a SEVERE
   * assumption, and monitoring is "the only early warning" if they stop.
   *
   * `null` when the queue is empty, which is genuinely different from zero: an
   * empty queue has no oldest item, and reporting 0 would read as "reviewed
   * seconds ago" when nothing has been reviewed at all.
   */
  moderationOldestOpenCaseHours: number | null;

  /** pg-boss backlog and permanently-lost work (ADR-010, ADR-014). */
  jobsReady: number | null;
  jobsDeadLetter: number | null;

  /** Connection headroom. Exhaustion is not gradual (§15.4: 80%). */
  dbConnectionsUsed: number;
  dbConnectionsLimit: number;

  /** Database size in bytes. §15.4 monitors storage GROWTH, so this is the input. */
  databaseBytes: number;

  /**
   * Hours since the last successful backup (SEC-026).
   *
   * `null` when no backup has ever been recorded — which an operator must read
   * as "unknown, and therefore not proven", never as "fine".
   */
  backupHoursSinceSuccess: number | null;
}

/**
 * PRODUCT METRICS — NFR-OBS-004's Stage 1 success criteria.
 *
 * "Aggregate product metrics ... are measurable WITHOUT PROFILING INDIVIDUALS."
 * Every field here is a count or a ratio over the whole platform. There is no
 * per-user breakdown, no cohort small enough to be one person, and no way to
 * ask this interface about somebody. That is a property of the SHAPE, not of
 * the caller's manners, which is why the return type is numbers rather than
 * rows.
 */
export interface ProductReadings {
  registeredUsers: number;
  /** Distinct users with a session used in the last 24 hours / 7 days. */
  activeUsers24h: number;
  activeUsers7d: number;
  postsTotal: number;
  posts7d: number;
  eventsUpcoming: number;
  /**
   * URDU ADOPTION — the share of accounts that have CHOSEN Urdu (SET-FR-001).
   *
   * Measured against accounts that made a choice at all, because BR-040 means
   * no default is pre-selected: counting unset accounts as "English" would
   * report a preference nobody expressed and understate the number the Stage 1
   * criteria actually care about.
   */
  languageChosenCount: number;
  languageUrduCount: number;
  /** Median hours from report to resolution. `null` when nothing is resolved yet. */
  reportResolutionMedianHours: number | null;
}

export interface MetricsRepository {
  operational(client?: PoolClient): Promise<OperationalReadings>;
  product(client?: PoolClient): Promise<ProductReadings>;
}
