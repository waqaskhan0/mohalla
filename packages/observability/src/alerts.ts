/**
 * WHAT IS WATCHED, AND WHEN SOMEBODY IS WOKEN (NFR-OBS-003 · §15.4).
 *
 * THRESHOLDS ARE DATA, NOT `if` STATEMENTS. Stated once, here, they can be
 * read by an operator, asserted by a test, and rendered into whatever the
 * provider's alerting actually is — without anybody having to find them spread
 * across the services that measure them.
 *
 * THE ONE WORTH EXPLAINING IS THE MODERATION QUEUE. §15.4: "Moderation queue
 * age is monitored as an operational metric BECAUSE A3 — that someone reviews
 * it daily — is a SEVERE assumption. If nobody does, the platform becomes
 * unsafe or over-censored, and monitoring is the only early warning."
 *
 * That is the difference between this alert and the rest. Error rate and
 * latency tell you the software is broken; the queue-age alert tells you a
 * PERSON has stopped doing something the design depends on, and no amount of
 * correct code substitutes for it. It is why the metric exists at all.
 *
 * SEVERITY IS ABOUT WHAT IS LOST, NOT HOW BAD IT LOOKS.
 *
 *   'page'  — data or safety is at risk NOW: backups failing, the moderation
 *             queue unattended, storage about to run out. Someone is woken.
 *   'warn'  — the product is degrading and will page if it continues.
 *
 * The technical owner is the named responder (§15.5) — and OD-020 means there
 * is not one yet, which is a gap in the release readiness rather than in this
 * file.
 */

export type AlertSeverity = 'page' | 'warn';

export interface AlertRule {
  /** Stable id: what an alert is called in a runbook and in a test. */
  readonly id: string;
  readonly metric: string;
  readonly severity: AlertSeverity;
  /** Fires when the metric is at or beyond this. */
  readonly threshold: number;
  readonly comparison: 'above' | 'below';
  /** How long it must hold before firing. Zero means immediately. */
  readonly forSeconds: number;
  readonly unit: string;
  /** Why this number. Read by whoever is deciding to change it at 3am. */
  readonly rationale: string;
  /** The requirement it serves, so a change can be traced to a decision. */
  readonly requirement: string;
}

export const ALERT_RULES: readonly AlertRule[] = [
  {
    id: 'api_error_rate',
    metric: 'api.error_rate',
    severity: 'page',
    threshold: 0.02,
    comparison: 'above',
    forSeconds: 300,
    unit: 'ratio',
    rationale:
      '§15.4: error rate above 2% for 5 minutes. Five minutes rather than one because a deploy, ' +
      'a restart or a single bad client can spike a short window, and an alert that cries wolf ' +
      'is an alert that gets muted.',
    requirement: 'NFR-OBS-003',
  },
  {
    id: 'api_latency_p95',
    metric: 'api.latency_p95_ms',
    severity: 'warn',
    threshold: 800,
    comparison: 'above',
    forSeconds: 600,
    unit: 'ms',
    rationale:
      'NFR-PERF-002 sets p95 at 800ms. A warning rather than a page: a slow API on a Pakistani ' +
      'mobile network is a bad experience, not a data-loss event, and waking somebody for it at ' +
      '3am trades a real cost for no recovered value.',
    requirement: 'NFR-PERF-002',
  },
  {
    id: 'database_connections',
    metric: 'db.connections_used_ratio',
    severity: 'page',
    threshold: 0.8,
    comparison: 'above',
    forSeconds: 300,
    unit: 'ratio',
    rationale:
      '§15.4: connections above 80%. Pages rather than warns because connection exhaustion is ' +
      'not gradual - the last 20% goes in seconds and takes every request with it.',
    requirement: 'NFR-OBS-003',
  },
  {
    id: 'queue_depth',
    metric: 'jobs.ready_count',
    severity: 'warn',
    threshold: 500,
    comparison: 'above',
    forSeconds: 600,
    unit: 'jobs',
    rationale:
      'A backlog this size means the drain is not keeping up, which delays notifications ' +
      '(ADR-014) rather than losing them. The outbox is durable, so this degrades before it ' +
      'breaks.',
    requirement: 'NFR-OBS-003',
  },
  {
    id: 'dead_letter_growth',
    metric: 'jobs.dead_letter_count',
    severity: 'page',
    // ZERO, so that ONE dead job breaches it. A threshold of 1 with an
    // `above` comparison would wait for the second, which is not what the
    // rationale below says and not what anybody reading it would expect.
    threshold: 0,
    comparison: 'above',
    forSeconds: 0,
    unit: 'jobs',
    rationale:
      'ONE dead job is the threshold, and it fires immediately. A job that exhausted its retries ' +
      'is work that was accepted and then permanently lost - a notification nobody got, an ' +
      'erasure that did not run. There is no "acceptable rate" of that.',
    requirement: 'NFR-OBS-003',
  },
  {
    id: 'backup_failure',
    metric: 'backup.hours_since_success',
    severity: 'page',
    threshold: 26,
    comparison: 'above',
    forSeconds: 0,
    unit: 'hours',
    rationale:
      'SEC-026 requires daily backups and §15.5 proposes an RPO of 24 hours. 26 rather than 24 ' +
      'allows a late run without a false page, while still catching a MISSED day. The failure ' +
      'this exists to prevent is silent: nobody notices a backup stopped until they need it.',
    requirement: 'SEC-026',
  },
  {
    id: 'storage_growth',
    metric: 'storage.used_ratio',
    severity: 'page',
    threshold: 0.8,
    comparison: 'above',
    forSeconds: 0,
    unit: 'ratio',
    rationale:
      '§15.4: storage above 80%. Pages because a full disk stops writes, and a database that ' +
      'cannot write cannot record that it could not write.',
    requirement: 'NFR-OBS-003',
  },
  {
    id: 'moderation_queue_age',
    metric: 'moderation.oldest_open_case_hours',
    severity: 'page',
    threshold: 24,
    comparison: 'above',
    forSeconds: 0,
    unit: 'hours',
    rationale:
      'THE ONE THAT WATCHES A PERSON RATHER THAN THE SOFTWARE. §15.4: A3 - that somebody reviews ' +
      'the queue daily - is a SEVERE assumption, and "if nobody does, the platform becomes unsafe ' +
      'or over-censored". Monitoring is the only early warning that a human process has stopped. ' +
      '24 hours is the SRS review target, so this fires the moment the target is missed rather ' +
      'than after a margin nobody agreed.',
    requirement: 'NFR-OBS-003',
  },
  {
    id: 'crash_free_sessions',
    metric: 'mobile.crash_free_ratio',
    severity: 'warn',
    threshold: 0.98,
    comparison: 'below',
    forSeconds: 0,
    unit: 'ratio',
    rationale:
      'NFR-OBS-002 targets 98% crash-free sessions. MEASURED ON THE DEVICE, not here: this rule ' +
      'is declared so the threshold lives with the others, and the metric is fed by the mobile ' +
      'crash reporter once it exists.',
    requirement: 'NFR-OBS-002',
  },
  {
    id: 'sms_failure_rate',
    metric: 'sms.failure_rate',
    severity: 'page',
    threshold: 0.1,
    comparison: 'above',
    forSeconds: 900,
    unit: 'ratio',
    rationale:
      'An OTP that does not arrive is a person who cannot register or log in at all - the whole ' +
      'front door (AUTH-FR-002). Pages because there is no degraded mode: it either works or ' +
      'nobody new can join.',
    requirement: 'NFR-OBS-003',
  },
];

/** Does this reading breach the rule? */
export function breaches(rule: AlertRule, value: number): boolean {
  return rule.comparison === 'above' ? value > rule.threshold : value < rule.threshold;
}

export interface AlertEvaluation {
  readonly id: string;
  readonly metric: string;
  readonly severity: AlertSeverity;
  readonly firing: boolean;
  /** `null` when the metric is not being collected yet - NOT the same as 0. */
  readonly value: number | null;
  readonly threshold: number;
}

/**
 * Evaluate every rule against a set of readings.
 *
 * A METRIC WITH NO READING IS NOT FIRING, AND IS NOT SILENT EITHER: its value
 * comes back `null`, which the caller reports as unmeasured. Treating a missing
 * reading as zero is how a stopped collector becomes a permanently green
 * dashboard — the exact failure the moderation-queue alert exists to catch,
 * arriving through the monitoring instead of through the people.
 */
export function evaluateAlerts(readings: Readonly<Record<string, number>>): AlertEvaluation[] {
  return ALERT_RULES.map((rule) => {
    const value = readings[rule.metric];
    return {
      id: rule.id,
      metric: rule.metric,
      severity: rule.severity,
      firing: value === undefined ? false : breaches(rule, value),
      value: value ?? null,
      threshold: rule.threshold,
    };
  });
}
