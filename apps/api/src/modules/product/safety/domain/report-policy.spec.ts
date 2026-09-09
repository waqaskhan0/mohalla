import { describe, it, expect } from 'vitest';
import {
  AUTO_HIDE_THRESHOLDS,
  REPEAT_OFFENDER_DELETIONS,
  REPORT_REASONS,
  autoHideThresholdFor,
  checkReport,
  isRepeatOffender,
  moreSevere,
  reachesAutoHideThreshold,
  severityOf,
  type ReportTarget,
} from './report-policy.js';
import { RATE_LIMITS, checkRateLimit } from './rate-limits.js';

const NOW = new Date('2026-09-05T12:00:00.000Z');

describe('severity is derived from the reason (SAFETY-FR-003)', () => {
  it('assigns the severities the requirement names', () => {
    expect(severityOf('VIOLENCE_OR_THREATS')).toBe('CRITICAL');
    expect(severityOf('HARASSMENT_OR_BULLYING')).toBe('HIGH');
    expect(severityOf('HATE_SPEECH')).toBe('HIGH');
    expect(severityOf('SEXUAL_OR_INAPPROPRIATE')).toBe('HIGH');
    expect(severityOf('FALSE_INFORMATION')).toBe('MEDIUM');
    expect(severityOf('IMPERSONATION')).toBe('MEDIUM');
    expect(severityOf('SPAM_OR_MISLEADING')).toBe('LOW');
    expect(severityOf('SOMETHING_ELSE')).toBe('LOW');
  });

  it('covers all eight reasons and no more', () => {
    // SAFETY-FR-003 lists exactly eight and says the reporter picks one. A
    // ninth would be a reason with no Urdu translation (OD-016) and no place in
    // the severity table.
    expect(REPORT_REASONS).toHaveLength(8);
    for (const reason of REPORT_REASONS) {
      expect(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).toContain(severityOf(reason));
    }
  });

  it('ORDERS VIOLENCE ABOVE SPAM REGARDLESS OF AGE (AC)', () => {
    // "GIVEN a queue containing a Spam report and a Violence report, WHEN it is
    // opened, THEN the Violence report is ordered above the Spam report
    // regardless of age."
    expect(moreSevere(severityOf('SPAM_OR_MISLEADING'), severityOf('VIOLENCE_OR_THREATS'))).toBe(
      'CRITICAL',
    );
  });

  it('severity only ever rises on an open case', () => {
    // A later Spam report must not demote a case opened by a Violence report.
    expect(moreSevere('CRITICAL', 'LOW')).toBe('CRITICAL');
    expect(moreSevere('LOW', 'CRITICAL')).toBe('CRITICAL');
    expect(moreSevere('HIGH', 'HIGH')).toBe('HIGH');
  });
});

describe('auto-hide thresholds (BR-032, BR-044, SAFETY-FR-002)', () => {
  it('posts and comments hide at three', () => {
    expect(autoHideThresholdFor('POST')).toBe(3);
    expect(autoHideThresholdFor('COMMENT')).toBe(3);
  });

  it('EVENTS HIDE AT TWO — a fake gathering wastes real travel (BR-044)', () => {
    // The only place the safety bar is deliberately lower. The cost of the
    // false negative is somebody's journey rather than their scroll.
    expect(autoHideThresholdFor('EVENT')).toBe(2);
  });

  it('A PROFILE IS NEVER AUTO-HIDDEN (SAFETY-FR-002 AC)', () => {
    // "GIVEN an account reported by 10 distinct users, WHEN the reports are
    // recorded, THEN the account REMAINS VISIBLE and appears in the queue for
    // human review." Hiding a whole person on a report count would be
    // trivially weaponised.
    expect(autoHideThresholdFor('PROFILE')).toBeNull();
    expect(
      reachesAutoHideThreshold({
        target: 'PROFILE',
        distinctReportCount: 10,
        alreadyHidden: false,
      }),
    ).toBe(false);
  });

  it('nor is a CONVERSATION (MSG-FR-007)', () => {
    // Private between two people, so the maximum possible distinct-reporter
    // count is two and a threshold carries no information.
    expect(autoHideThresholdFor('CONVERSATION')).toBeNull();
    expect(
      reachesAutoHideThreshold({
        target: 'CONVERSATION',
        distinctReportCount: 2,
        alreadyHidden: false,
      }),
    ).toBe(false);
  });

  it('hides on the exact transition, not before', () => {
    expect(
      reachesAutoHideThreshold({ target: 'POST', distinctReportCount: 2, alreadyHidden: false }),
    ).toBe(false);
    expect(
      reachesAutoHideThreshold({ target: 'POST', distinctReportCount: 3, alreadyHidden: false }),
    ).toBe(true);
  });

  it('DOES NOT RE-HIDE SOMETHING ALREADY HIDDEN', () => {
    // A fourth report on a hidden post must not "hide it again" - that would
    // send a second "your content is under review" to an author already told.
    expect(
      reachesAutoHideThreshold({ target: 'POST', distinctReportCount: 9, alreadyHidden: true }),
    ).toBe(false);
  });

  it('every target type has a decided threshold, null included', () => {
    // A missing entry would read as `undefined` and quietly never hide. Listing
    // all five makes "never" a decision rather than an omission.
    const targets: ReportTarget[] = ['POST', 'COMMENT', 'EVENT', 'PROFILE', 'CONVERSATION'];
    for (const t of targets) {
      expect(Object.hasOwn(AUTO_HIDE_THRESHOLDS, t)).toBe(true);
    }
  });
});

describe('checkReport (SAFETY-FR-001)', () => {
  it('accepts an ordinary report', () => {
    expect(
      checkReport({
        reporterId: 'a',
        targetOwnerId: 'b',
        reason: 'SPAM_OR_MISLEADING',
      }),
    ).toBeNull();
  });

  it('REFUSES REPORTING YOUR OWN CONTENT', () => {
    expect(checkReport({ reporterId: 'a', targetOwnerId: 'a', reason: 'SPAM_OR_MISLEADING' })).toBe(
      'CANNOT_REPORT_OWN_CONTENT',
    );
  });

  it('refuses a reason that is not one of the eight', () => {
    expect(checkReport({ reporterId: 'a', targetOwnerId: 'b', reason: 'BECAUSE_I_SAID_SO' })).toBe(
      'INVALID_REASON',
    );
  });

  it('refuses a note over 500 characters', () => {
    expect(
      checkReport({
        reporterId: 'a',
        targetOwnerId: 'b',
        reason: 'SPAM_OR_MISLEADING',
        note: 'x'.repeat(501),
      }),
    ).toBe('NOTE_TOO_LONG');
    expect(
      checkReport({
        reporterId: 'a',
        targetOwnerId: 'b',
        reason: 'SPAM_OR_MISLEADING',
        note: 'x'.repeat(500),
      }),
    ).toBeNull();
  });

  it('allows a report against a target whose owner is unknown', () => {
    // A conversation has no single owner, and a deleted author leaves null.
    // Refusing here would make some content unreportable.
    expect(
      checkReport({ reporterId: 'a', targetOwnerId: null, reason: 'HARASSMENT_OR_BULLYING' }),
    ).toBeNull();
  });
});

describe('BR-037 — repeat offender FLAGS, never suspends', () => {
  it('flags at three confirmed deletions', () => {
    expect(isRepeatOffender(2)).toBe(false);
    expect(isRepeatOffender(3)).toBe(true);
    expect(REPEAT_OFFENDER_DELETIONS).toBe(3);
  });

  it('the module exposes no way to suspend from that flag', async () => {
    // "It is not auto-suspended." Asserted against the domain surface: there is
    // no function here that takes a count and returns an enforcement action,
    // because S2-DEC-013 decided an account suspended by arithmetic is an
    // account a coordinated group can suspend.
    const policy = await import('./report-policy.js');
    expect(Object.keys(policy).some((k) => /suspend|ban|enforce/i.test(k))).toBe(false);
  });
});

describe('rate limits (SAFETY-FR-009)', () => {
  it('carries the six limits the requirement proposes', () => {
    expect(RATE_LIMITS).toEqual({
      POSTS_PER_DAY: 20,
      COMMENTS_PER_DAY: 100,
      MESSAGES_PER_DAY: 200,
      FOLLOWS_PER_DAY: 100,
      EVENTS_PER_DAY: 5,
      REPORTS_PER_DAY: 20,
    });
  });

  it('allows up to the limit and refuses the next', () => {
    expect(checkRateLimit('POSTS_PER_DAY', 19, null, NOW).allowed).toBe(true);
    expect(checkRateLimit('POSTS_PER_DAY', 20, null, NOW).allowed).toBe(false);
  });

  it('STATES THE LIMIT AND THE RESET TIME (AC)', () => {
    // "THEN it is refused with the limit and reset time stated." A silent
    // failure teaches a user the app is broken, which on this platform is
    // indistinguishable from "nobody listened".
    const oldest = new Date('2026-09-05T08:00:00.000Z');
    const verdict = checkRateLimit('POSTS_PER_DAY', 20, oldest, NOW);

    expect(verdict.limit).toBe(20);
    expect(verdict.used).toBe(20);
    // The window clears when the OLDEST action ages out, not 24 hours from now
    // - otherwise a user one minute from their next slot is told to wait a day.
    expect(verdict.resetsAt).toEqual(new Date('2026-09-06T08:00:00.000Z'));
  });

  it('falls back to a full window when nothing is on record', () => {
    expect(checkRateLimit('REPORTS_PER_DAY', 0, null, NOW).resetsAt).toEqual(
      new Date('2026-09-06T12:00:00.000Z'),
    );
  });
});
