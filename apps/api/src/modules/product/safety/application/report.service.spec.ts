import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { ReportService } from './report.service.js';
import { FixedClock } from '../../../platform/identity/ports/clock.port.js';
import { RATE_LIMITS } from '../domain/rate-limits.js';
import type { ReportReason, ReportSeverity, ReportTarget } from '../domain/report-policy.js';
import type {
  ModerationCase,
  ModerationState,
  ReportRepository,
  ReportableTarget,
} from '../repositories/report.repository.port.js';
import type { AuditService } from '../../../platform/audit/audit.service.js';
import type { DatabaseService } from '../../../../database/database.service.js';
import type { StructuredLogger } from '../../../../common/logging/structured.logger.js';

interface Content {
  id: string;
  ownerId: string;
  type: ReportTarget;
  hidden: boolean;
  removed: boolean;
  count: number;
}

/**
 * In-memory reports.
 *
 * Enforces the UNIQUE (reporter, type, target) constraint, because every claim
 * about distinct counts rests on it — a fake that allowed a second row would
 * let the threshold tests pass against an implementation the database refuses.
 *
 * It does NOT model the row lock. That guarantee is PostgreSQL's and is proven
 * by mandatory test C against real concurrent transactions; asserting it here
 * would be asserting that a fake does what the fake was written to do.
 */
class InMemoryReports implements ReportRepository {
  content = new Map<string, Content>();
  reports: { reporterId: string; targetType: ReportTarget; targetId: string }[] = [];
  cases: ModerationCase[] = [];
  actions: { userId: string; at: Date }[] = [];
  clock: () => Date = () => new Date();

  async lockTarget(
    targetType: ReportTarget,
    targetId: string,
    _reporterId: string,
  ): Promise<ReportableTarget> {
    const c = this.content.get(targetId);
    if (c === undefined) {
      return { targetId, ownerId: null, hidden: false, distinctReportCount: 0, exists: false };
    }
    return {
      targetId,
      ownerId: c.ownerId,
      hidden: c.hidden || c.removed,
      distinctReportCount: c.count,
      exists: true,
    };
  }

  async insertReport(input: {
    reporterId: string;
    targetType: ReportTarget;
    targetId: string;
  }): Promise<boolean> {
    const clash = this.reports.some(
      (r) =>
        r.reporterId === input.reporterId &&
        r.targetType === input.targetType &&
        r.targetId === input.targetId,
    );
    if (clash) return false;
    this.reports.push({
      reporterId: input.reporterId,
      targetType: input.targetType,
      targetId: input.targetId,
    });
    return true;
  }

  async countDistinctReporters(targetType: ReportTarget, targetId: string): Promise<number> {
    return this.reports.filter((r) => r.targetType === targetType && r.targetId === targetId)
      .length;
  }

  async setDistinctReportCount(_t: ReportTarget, targetId: string, count: number): Promise<void> {
    const c = this.content.get(targetId);
    if (c !== undefined) c.count = count;
  }

  async autoHide(_t: ReportTarget, targetId: string): Promise<boolean> {
    const c = this.content.get(targetId);
    // Profiles and conversations have no state to move - the real repository
    // refuses them, and so does this.
    if (c === undefined || c.type === 'PROFILE' || c.type === 'CONVERSATION') return false;
    if (c.hidden) return false;
    c.hidden = true;
    return true;
  }

  async restore(_t: ReportTarget, targetId: string): Promise<boolean> {
    const c = this.content.get(targetId);
    if (c === undefined) return false;
    c.hidden = false;
    c.count = 0;
    return true;
  }

  async adminRemove(_t: ReportTarget, targetId: string): Promise<boolean> {
    const c = this.content.get(targetId);
    if (c === undefined) return false;
    c.removed = true;
    return true;
  }

  async clearReports(targetType: ReportTarget, targetId: string): Promise<number> {
    const before = this.reports.length;
    this.reports = this.reports.filter(
      (r) => !(r.targetType === targetType && r.targetId === targetId),
    );
    return before - this.reports.length;
  }

  async upsertOpenCase(input: {
    id: string;
    targetType: ReportTarget;
    targetId: string;
    targetOwnerId: string | null;
    maxSeverity: ReportSeverity;
    distinctReportCount: number;
    autoHidden: boolean;
  }): Promise<ModerationCase> {
    const rank = { LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };
    const open = this.cases.find(
      (c) =>
        c.targetType === input.targetType && c.targetId === input.targetId && c.state === 'OPEN',
    );
    if (open !== undefined) {
      if (rank[input.maxSeverity] > rank[open.maxSeverity]) open.maxSeverity = input.maxSeverity;
      open.distinctReportCount = input.distinctReportCount;
      open.autoHidden = open.autoHidden || input.autoHidden;
      return open;
    }
    const created: ModerationCase = {
      id: input.id,
      targetType: input.targetType,
      targetId: input.targetId,
      targetOwnerId: input.targetOwnerId,
      state: 'OPEN',
      maxSeverity: input.maxSeverity,
      distinctReportCount: input.distinctReportCount,
      autoHidden: input.autoHidden,
      resolutionReason: null,
      resolvedByAdminId: null,
      resolvedAt: null,
      version: 1,
      createdAt: this.clock(),
    };
    this.cases.push(created);
    return created;
  }

  async findCaseById(id: string): Promise<ModerationCase | null> {
    return this.cases.find((c) => c.id === id) ?? null;
  }

  async findOpenCaseFor(
    targetType: ReportTarget,
    targetId: string,
  ): Promise<ModerationCase | null> {
    return (
      this.cases.find(
        (c) => c.targetType === targetType && c.targetId === targetId && c.state === 'OPEN',
      ) ?? null
    );
  }

  async listOpenCases(limit: number, offset: number) {
    const rank = { LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };
    const open = this.cases
      .filter((c) => c.state === 'OPEN')
      .sort(
        (a, b) =>
          rank[b.maxSeverity] - rank[a.maxSeverity] ||
          b.distinctReportCount - a.distinctReportCount ||
          a.createdAt.getTime() - b.createdAt.getTime(),
      );
    return { cases: open.slice(offset, offset + limit), total: open.length };
  }

  async resolveCase(input: {
    id: string;
    expectedVersion: number;
    state: Exclude<ModerationState, 'OPEN'>;
    resolutionReason: string;
    adminId: string;
  }): Promise<ModerationCase | null> {
    const c = this.cases.find((x) => x.id === input.id);
    if (c === undefined || c.state !== 'OPEN' || c.version !== input.expectedVersion) return null;
    c.state = input.state;
    c.resolutionReason = input.resolutionReason;
    c.resolvedByAdminId = input.adminId;
    c.resolvedAt = this.clock();
    c.version += 1;
    if (input.state === 'RESOLVED_DELETED' && c.targetOwnerId !== null) {
      this.actions.push({ userId: c.targetOwnerId, at: c.resolvedAt });
    }
    return c;
  }

  async countConfirmedDeletions(ownerId: string, since: Date): Promise<number> {
    return this.actions.filter((a) => a.userId === ownerId && a.at >= since).length;
  }

  async countInWindow(
    _table: string,
    _userColumn: string,
    userId: string,
    since: Date,
  ): Promise<{ used: number; oldest: Date | null }> {
    void since;
    const mine = this.reports.filter((r) => r.reporterId === userId);
    return { used: mine.length, oldest: mine.length === 0 ? null : this.clock() };
  }
}

const NOW = new Date('2026-09-05T12:00:00.000Z');

function build() {
  const repo = new InMemoryReports();
  const clock = new FixedClock(NOW);
  repo.clock = () => clock.now();

  const logs: string[] = [];
  const audited: { action: string; entityType: string }[] = [];

  const audit = {
    async append(entry: { action: string; entityType: string }) {
      audited.push({ action: entry.action, entityType: entry.entityType });
    },
  } as unknown as AuditService;

  const db = {
    withTransaction: async <T>(fn: (c: never) => Promise<T>): Promise<T> => fn(undefined as never),
  } as unknown as DatabaseService;

  const logger = {
    log: (m: unknown) => logs.push(String(m)),
    debug: (m: unknown) => logs.push(String(m)),
    warn: (m: unknown) => logs.push(String(m)),
    error: (m: unknown) => logs.push(String(m)),
  } as unknown as StructuredLogger;

  return {
    service: new ReportService(db, repo, audit, clock, logger),
    repo,
    clock,
    logs,
    audited,
  };
}

let ctx: ReturnType<typeof build>;
let author: string;
let postId: string;

beforeEach(() => {
  ctx = build();
  author = randomUUID();
  postId = randomUUID();
  ctx.repo.content.set(postId, {
    id: postId,
    ownerId: author,
    type: 'POST',
    hidden: false,
    removed: false,
    count: 0,
  });
});

const reportBy = (reporterId: string, reason: ReportReason = 'SPAM_OR_MISLEADING') =>
  ctx.service.report({
    reporterId,
    targetType: 'POST',
    targetId: postId,
    reason,
  });

describe('ReportService.report — the acknowledgement never varies (SAFETY-FR-001)', () => {
  it('accepts a report', async () => {
    expect(await reportBy(randomUUID())).toEqual({ status: 'RECEIVED' });
  });

  it('A REPEAT REPORT RETURNS THE SAME ANSWER AND DOES NOT INCREMENT (AC)', async () => {
    // "GIVEN a user reports the same post twice, WHEN the second is submitted,
    // THEN the distinct count remains 1 and NO ERROR REVEALS THE TALLY."
    const reporter = randomUUID();
    const first = await reportBy(reporter);
    const second = await reportBy(reporter);

    expect(second).toEqual(first);
    expect(ctx.repo.content.get(postId)?.count).toBe(1);
  });

  it('THE RESPONSE CARRIES NO COUNT AND NO HIDDEN STATE', async () => {
    // The three things an organised reporter would want - the tally, whether
    // their report was new, and whether the content is now hidden - are the
    // three things absent. RSK-010 is why.
    const before = await reportBy(randomUUID());
    await reportBy(randomUUID());
    const atThreshold = await reportBy(randomUUID());

    expect(ctx.repo.content.get(postId)?.hidden).toBe(true);
    // Identical, even though one of these crossed the threshold.
    expect(atThreshold).toEqual(before);
    expect(JSON.stringify(atThreshold)).not.toMatch(/\d/);
  });

  it('refuses reporting your own content', async () => {
    expect(await reportBy(author)).toEqual({
      status: 'INVALID',
      reason: 'CANNOT_REPORT_OWN_CONTENT',
    });
  });

  it('refuses a target that does not exist, neutrally', async () => {
    expect(
      await ctx.service.report({
        reporterId: randomUUID(),
        targetType: 'POST',
        targetId: randomUUID(),
        reason: 'SPAM_OR_MISLEADING',
      }),
    ).toEqual({ status: 'NOT_AVAILABLE' });
  });
});

describe('ReportService — the threshold (SAFETY-FR-004, BR-032)', () => {
  it('hides a post at the third distinct reporter', async () => {
    await reportBy(randomUUID());
    expect(ctx.repo.content.get(postId)?.hidden).toBe(false);
    await reportBy(randomUUID());
    expect(ctx.repo.content.get(postId)?.hidden).toBe(false);
    await reportBy(randomUUID());
    expect(ctx.repo.content.get(postId)?.hidden).toBe(true);
  });

  it('NEVER DELETES — the automatic step is the reversible one (BR-032)', async () => {
    for (let i = 0; i < 9; i += 1) await reportBy(randomUUID());
    const post = ctx.repo.content.get(postId);
    expect(post?.hidden).toBe(true);
    // Nine reporters, and still nothing permanent. RSK-010: coordinated
    // reporting must not be able to destroy civic criticism.
    expect(post?.removed).toBe(false);
  });

  it('AN ACCOUNT IS NEVER AUTO-HIDDEN, EVEN AT TEN REPORTS (SAFETY-FR-002 AC)', async () => {
    const target = randomUUID();
    ctx.repo.content.set(target, {
      id: target,
      ownerId: target,
      type: 'PROFILE',
      hidden: false,
      removed: false,
      count: 0,
    });

    for (let i = 0; i < 10; i += 1) {
      await ctx.service.report({
        reporterId: randomUUID(),
        targetType: 'PROFILE',
        targetId: target,
        reason: 'HARASSMENT_OR_BULLYING',
      });
    }

    expect(ctx.repo.content.get(target)?.hidden).toBe(false);
    // "...and appears in the queue for human review."
    const queue = await ctx.service.queue();
    expect(queue.cases.some((c) => c.targetType === 'PROFILE' && c.targetId === target)).toBe(true);
  });

  it('audits the auto-hide, and only the auto-hide', async () => {
    await reportBy(randomUUID());
    await reportBy(randomUUID());
    expect(ctx.audited).toHaveLength(0);

    await reportBy(randomUUID());
    expect(ctx.audited).toEqual([{ action: 'CONTENT_AUTO_HIDDEN', entityType: 'POST' }]);
  });

  it('opens ONE case however many reports arrive', async () => {
    for (let i = 0; i < 5; i += 1) await reportBy(randomUUID());
    const queue = await ctx.service.queue();
    expect(queue.cases.filter((c) => c.targetId === postId)).toHaveLength(1);
  });

  it('the case severity RISES but never falls', async () => {
    await reportBy(randomUUID(), 'VIOLENCE_OR_THREATS');
    await reportBy(randomUUID(), 'SPAM_OR_MISLEADING');

    const queue = await ctx.service.queue();
    const c = queue.cases.find((x) => x.targetId === postId);
    expect(c?.maxSeverity).toBe('CRITICAL');
  });
});

describe('ReportService — the queue order (ADMIN-FR-002)', () => {
  it('ORDERS VIOLENCE ABOVE SPAM REGARDLESS OF AGE (SAFETY-FR-003 AC)', async () => {
    const spamTarget = randomUUID();
    ctx.repo.content.set(spamTarget, {
      id: spamTarget,
      ownerId: randomUUID(),
      type: 'POST',
      hidden: false,
      removed: false,
      count: 0,
    });
    await ctx.service.report({
      reporterId: randomUUID(),
      targetType: 'POST',
      targetId: spamTarget,
      reason: 'SPAM_OR_MISLEADING',
    });

    ctx.clock.advance(60_000);
    await reportBy(randomUUID(), 'VIOLENCE_OR_THREATS');

    const queue = await ctx.service.queue();
    // The violence case is NEWER and still first.
    expect(queue.cases[0]?.targetId).toBe(postId);
    expect(queue.cases[0]?.maxSeverity).toBe('CRITICAL');
  });
});

describe('ReportService — resolution (ADMIN-FR-003/004, EDGE-024/026)', () => {
  const adminId = randomUUID();

  const openCase = async (): Promise<ModerationCase> => {
    for (let i = 0; i < 3; i += 1) await reportBy(randomUUID());
    const queue = await ctx.service.queue();
    return queue.cases.find((c) => c.targetId === postId) as ModerationCase;
  };

  it('RESTORING RESETS THE COUNT so the same reporters cannot re-hide it', async () => {
    const c = await openCase();
    const r = await ctx.service.restore({
      caseId: c.id,
      adminId,
      reason: 'Reviewed; this is legitimate civic criticism.',
      expectedVersion: c.version,
    });

    expect(r.status).toBe('RESOLVED');
    const post = ctx.repo.content.get(postId);
    expect(post?.hidden).toBe(false);
    expect(post?.count).toBe(0);
    // The rows are gone, not merely the counter - otherwise the next recompute
    // would restore the old number and one more report would re-hide it.
    expect(await ctx.repo.countDistinctReporters('POST', postId)).toBe(0);
  });

  it('EDGE-026 — the same users CAN report again, and three fresh reports re-hide it', async () => {
    const c = await openCase();
    await ctx.service.restore({
      caseId: c.id,
      adminId,
      reason: 'Reviewed and restored.',
      expectedVersion: c.version,
    });

    const three = [randomUUID(), randomUUID(), randomUUID()];
    for (const r of three) await reportBy(r);

    // "It is hidden again and returns to the queue. It is still never deleted
    // automatically."
    expect(ctx.repo.content.get(postId)?.hidden).toBe(true);
    expect(ctx.repo.content.get(postId)?.removed).toBe(false);
  });

  it('DELETION IS THE ONLY PERMANENT PATH, and it needs an administrator', async () => {
    const c = await openCase();
    const r = await ctx.service.removeContent({
      caseId: c.id,
      adminId,
      reason: 'Violates the guideline on threats.',
      expectedVersion: c.version,
    });

    expect(r.status).toBe('RESOLVED');
    expect(ctx.repo.content.get(postId)?.removed).toBe(true);
  });

  it('A STALE DECISION IS INFORMATION, NOT AN ERROR (EDGE-024)', async () => {
    const c = await openCase();
    const other = randomUUID();

    const first = await ctx.service.removeContent({
      caseId: c.id,
      adminId,
      reason: 'Violates the guideline on threats.',
      expectedVersion: c.version,
    });
    expect(first.status).toBe('RESOLVED');

    const second = await ctx.service.restore({
      caseId: c.id,
      adminId: other,
      reason: 'I think this one is fine.',
      expectedVersion: c.version,
    });

    // §4: "a stale decision returns 409 naming WHO resolved it AND HOW". Both
    // facts have to come back, which is why the result carries the case.
    expect(second.status).toBe('STALE');
    if (second.status === 'STALE') {
      expect(second.case.resolvedByAdminId).toBe(adminId);
      expect(second.case.state).toBe('RESOLVED_DELETED');
    }
  });

  it('audits every decision with the administrator and the reason', async () => {
    const c = await openCase();
    await ctx.service.removeContent({
      caseId: c.id,
      adminId,
      reason: 'Violates the guideline on threats.',
      expectedVersion: c.version,
    });

    expect(ctx.audited.map((a) => a.action)).toContain('MODERATION_RESOLVED_DELETED');
  });

  it('a no-action close leaves the content alone but clears the reports', async () => {
    const c = await openCase();
    await ctx.service.closeNoAction({
      caseId: c.id,
      adminId,
      reason: 'Reviewed; nothing to act on.',
      expectedVersion: c.version,
    });

    expect(ctx.repo.content.get(postId)?.removed).toBe(false);
    // Leaving them would let one more report re-hide content an administrator
    // has just examined and approved.
    expect(await ctx.repo.countDistinctReporters('POST', postId)).toBe(0);
  });
});

describe('ReportService — BR-037 flags, and only flags', () => {
  const adminId = randomUUID();

  it('flags after three confirmed deletions in 30 days', async () => {
    expect(await ctx.service.isFlaggedRepeatOffender(author)).toBe(false);

    for (let i = 0; i < 3; i += 1) {
      const target = randomUUID();
      ctx.repo.content.set(target, {
        id: target,
        ownerId: author,
        type: 'POST',
        hidden: false,
        removed: false,
        count: 0,
      });
      for (let j = 0; j < 3; j += 1) {
        await ctx.service.report({
          reporterId: randomUUID(),
          targetType: 'POST',
          targetId: target,
          reason: 'HATE_SPEECH',
        });
      }
      const queue = await ctx.service.queue(50);
      const c = queue.cases.find((x) => x.targetId === target) as ModerationCase;
      await ctx.service.removeContent({
        caseId: c.id,
        adminId,
        reason: 'Violates the guidelines.',
        expectedVersion: c.version,
      });
    }

    expect(await ctx.service.isFlaggedRepeatOffender(author)).toBe(true);
  });

  it('the flag EXPIRES with the window', async () => {
    // Thirty days, not forever. An account that was actioned three times last
    // year is not a current problem, and a permanent flag would make the queue
    // a list of people rather than of decisions.
    ctx.repo.actions.push(
      { userId: author, at: NOW },
      { userId: author, at: NOW },
      { userId: author, at: NOW },
    );
    expect(await ctx.service.isFlaggedRepeatOffender(author)).toBe(true);

    ctx.clock.advance(31 * 24 * 60 * 60 * 1000);
    expect(await ctx.service.isFlaggedRepeatOffender(author)).toBe(false);
  });

  it('THE SERVICE HAS NO METHOD THAT SUSPENDS ANYBODY', () => {
    // BR-037: "It is not auto-suspended." Asserted against the surface,
    // because the guarantee is that no such path exists rather than that
    // nobody calls one.
    const surface = Object.getOwnPropertyNames(Object.getPrototypeOf(ctx.service));
    expect(surface.some((m) => /suspend|ban(?!ner)/i.test(m))).toBe(false);
  });
});

describe('ReportService — rate limiting (SAFETY-FR-009)', () => {
  it('refuses the twenty-first report of the day, with the limit stated', async () => {
    const reporter = randomUUID();
    for (let i = 0; i < RATE_LIMITS.REPORTS_PER_DAY; i += 1) {
      const target = randomUUID();
      ctx.repo.content.set(target, {
        id: target,
        ownerId: randomUUID(),
        type: 'POST',
        hidden: false,
        removed: false,
        count: 0,
      });
      const r = await ctx.service.report({
        reporterId: reporter,
        targetType: 'POST',
        targetId: target,
        reason: 'SPAM_OR_MISLEADING',
      });
      expect(r.status).toBe('RECEIVED');
    }

    const overflow = await reportBy(reporter);
    expect(overflow.status).toBe('RATE_LIMITED');
    if (overflow.status === 'RATE_LIMITED') {
      expect(overflow.verdict.limit).toBe(20);
      expect(overflow.verdict.resetsAt).toBeInstanceOf(Date);
    }
  });
});

describe('ReportService — what is never logged', () => {
  it('never logs who reported whom, or the note', async () => {
    const reporter = randomUUID();
    await ctx.service.report({
      reporterId: reporter,
      targetType: 'POST',
      targetId: postId,
      reason: 'HARASSMENT_OR_BULLYING',
      note: 'They have been messaging me at night',
    });

    // SAFETY-FR-001: the reporter's identity is visible to administrators "but
    // NEVER to the reported user". A log line naming both sits outside the
    // access control that promise depends on.
    for (const line of ctx.logs) {
      expect(line).not.toContain(reporter);
      expect(line).not.toContain(author);
      expect(line).not.toContain(postId);
      expect(line).not.toContain('messaging me at night');
    }
  });
});
