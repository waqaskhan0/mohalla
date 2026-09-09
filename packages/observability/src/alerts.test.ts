import { describe, it, expect } from 'vitest';
import { ALERT_RULES, breaches, evaluateAlerts } from './alerts.js';

const ruleFor = (id: string) => {
  const rule = ALERT_RULES.find((r) => r.id === id);
  if (rule === undefined) throw new Error(`no rule ${id}`);
  return rule;
};

describe('the thresholds §15.4 names', () => {
  it('sets error rate at 2% over five minutes', () => {
    const rule = ruleFor('api_error_rate');
    expect(rule.threshold).toBe(0.02);
    expect(rule.forSeconds).toBe(300);
  });

  it('sets p95 at NFR-PERF-002 over ten minutes', () => {
    const rule = ruleFor('api_latency_p95');
    expect(rule.threshold).toBe(800);
    expect(rule.forSeconds).toBe(600);
  });

  it('FIRES ON THE FIRST DEAD JOB, IMMEDIATELY', () => {
    // A job that exhausted its retries is work that was accepted and then
    // permanently lost. There is no acceptable rate of that, so there is no
    // window to wait out either.
    const rule = ruleFor('dead_letter_growth');
    expect(rule.forSeconds).toBe(0);
    expect(rule.severity).toBe('page');
    // Stated as a BREACH rather than as a threshold number: the number and the
    // comparison only mean something together, and asserting the number alone
    // is how a rule ends up firing on the second dead job while its comment
    // says the first.
    expect(breaches(rule, 1)).toBe(true);
    expect(breaches(rule, 0)).toBe(false);
  });

  it('catches a MISSED backup day without paging for a late one', () => {
    // SEC-026 is daily and §15.5 proposes a 24-hour RPO. 26 hours is the gap
    // that distinguishes "ran late" from "did not run" - and the failure this
    // exists to catch is silent: nobody notices backups stopped until they
    // need one.
    const rule = ruleFor('backup_failure');
    expect(rule.threshold).toBe(26);
    expect(rule.severity).toBe('page');
  });
});

describe('the moderation queue — the alert that watches a PERSON', () => {
  it('FIRES AT THE SRS REVIEW TARGET, NOT AFTER A MARGIN NOBODY AGREED', () => {
    // §15.4: A3 - that somebody reviews the queue daily - is a SEVERE
    // assumption, and monitoring is "the only early warning" that a human
    // process has stopped. Every other rule here says the software broke.
    const rule = ruleFor('moderation_queue_age');
    expect(rule.threshold).toBe(24);
    expect(rule.severity).toBe('page');
    expect(rule.forSeconds).toBe(0);
  });

  it('is breached by an item older than a day and not by one younger', () => {
    const rule = ruleFor('moderation_queue_age');
    expect(breaches(rule, 25)).toBe(true);
    expect(breaches(rule, 23.9)).toBe(false);
    // AT the threshold is not yet a breach: the target is "within 24 hours".
    expect(breaches(rule, 24)).toBe(false);
  });
});

describe('crash-free sessions read the other way round', () => {
  it('fires when the ratio falls BELOW the target (NFR-OBS-002)', () => {
    const rule = ruleFor('crash_free_sessions');
    expect(rule.comparison).toBe('below');
    expect(breaches(rule, 0.97)).toBe(true);
    expect(breaches(rule, 0.99)).toBe(false);
  });
});

describe('every rule is complete enough to act on', () => {
  it('has a unique id, a requirement and a rationale', () => {
    const ids = ALERT_RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);

    for (const rule of ALERT_RULES) {
      // A threshold with no stated reason is a number somebody will change at
      // 3am to stop the paging, and nobody will know what it cost.
      expect(rule.rationale.length).toBeGreaterThan(40);
      expect(rule.requirement).toMatch(/^(NFR|SEC|REL|PRIV)-/);
      expect(['page', 'warn']).toContain(rule.severity);
    }
  });
});

describe('evaluation', () => {
  it('fires only the rules whose readings breach them', () => {
    const out = evaluateAlerts({
      'api.error_rate': 0.05,
      'moderation.oldest_open_case_hours': 3,
    });

    expect(out.find((a) => a.id === 'api_error_rate')?.firing).toBe(true);
    expect(out.find((a) => a.id === 'moderation_queue_age')?.firing).toBe(false);
  });

  it('A MISSING READING IS NULL, NOT ZERO', () => {
    // Treating an absent metric as 0 makes a stopped collector look like a
    // permanently healthy system - the same failure the moderation alert
    // exists to catch, arriving through the monitoring instead of the people.
    const out = evaluateAlerts({});

    for (const alert of out) {
      expect(alert.value).toBeNull();
      expect(alert.firing).toBe(false);
    }

    // And a zero reading is genuinely zero, distinct from absent.
    const measured = evaluateAlerts({ 'jobs.dead_letter_count': 0 });
    expect(measured.find((a) => a.id === 'dead_letter_growth')?.value).toBe(0);
  });

  it('reports every rule, so nothing is silently unmonitored', () => {
    expect(evaluateAlerts({})).toHaveLength(ALERT_RULES.length);
  });
});
