/**
 * `@mohalla/observability` — the rules that must be identical everywhere.
 *
 * Deliberately small, and deliberately NOT a logger. The API and the worker
 * each keep their own logger, because they are separate deployables with
 * different context models (a request's correlation id is ambient; a job's
 * arrives in its payload). What they must not each keep is a separate idea of
 * WHAT MAY BE WRITTEN — two redaction rules that drift is one redaction rule
 * that does not work.
 */
export {
  REDACTED,
  REDACTED_KEY_EXACT,
  REDACTED_KEY_FRAGMENTS,
  REDACTION_RULES,
  isRedactedKey,
  redact,
  redactText,
} from './redaction.js';

export {
  ALERT_RULES,
  breaches,
  evaluateAlerts,
  type AlertEvaluation,
  type AlertRule,
  type AlertSeverity,
} from './alerts.js';
