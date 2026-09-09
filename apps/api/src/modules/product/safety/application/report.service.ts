import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DatabaseService } from '../../../../database/database.service.js';
import { StructuredLogger } from '../../../../common/logging/structured.logger.js';
import { AuditService } from '../../../platform/audit/audit.service.js';
import { CLOCK, type Clock } from '../../../platform/identity/ports/clock.port.js';
import {
  RATE_LIMIT_WINDOW_HOURS,
  checkRateLimit,
  type RateLimitVerdict,
} from '../domain/rate-limits.js';
import {
  REPEAT_OFFENDER_WINDOW_DAYS,
  checkReport,
  isRepeatOffender,
  reachesAutoHideThreshold,
  severityOf,
  type ReportReason,
  type ReportRejection,
  type ReportTarget,
} from '../domain/report-policy.js';
import {
  REPORT_REPOSITORY,
  type ModerationCase,
  type ReportRepository,
} from '../repositories/report.repository.port.js';

export type ReportResult =
  /**
   * ONE acknowledgement, whether or not this call created anything.
   *
   * SAFETY-FR-001's error case is explicit: a repeat report shows "the
   * acknowledgement again WITHOUT INCREMENTING the count, so the reporter
   * cannot infer the current tally". So this result carries no count, no
   * "already reported", and no hint that the content was hidden — three
   * different pieces of information a coordinated group would use to work out
   * exactly how many more accounts they need.
   */
  | { status: 'RECEIVED' }
  | { status: 'NOT_AVAILABLE' }
  | { status: 'INVALID'; reason: ReportRejection }
  | { status: 'RATE_LIMITED'; verdict: RateLimitVerdict };

export interface ThresholdOutcome {
  autoHidden: boolean;
  distinctReportCount: number;
  caseId: string;
}

/**
 * Reporting and the auto-hide threshold (SAFETY-FR-001…004 · BR-030/032/044).
 *
 * SAFETY-FR-004 states the purpose without decoration: "this is the mechanism
 * that lets a small moderation team run an open platform safely." One reviewer,
 * one pass a day, and content that enough distinct people flag is hidden in the
 * meantime.
 *
 * BR-032 STATES THE LIMIT WITH THE SAME DIRECTNESS: "nothing is ever deleted
 * automatically. A human always makes the permanent decision." RSK-010 is why —
 * coordinated reporting used to silence legitimate civic criticism, rated
 * MEDIUM likelihood and HIGH impact on a platform whose purpose IS civic
 * criticism. So the automatic step is the reversible one, restoring resets the
 * count, and every action is audited.
 *
 * THE TRANSACTION IS THE POINT OF THIS SERVICE. `13-moderation-audit.md` §2:
 * "report insert, distinct-count recompute and visibility change occur in ONE
 * transaction with `SELECT … FOR UPDATE` on the target. Two simultaneous
 * threshold-reaching reports cannot double-hide or miss." That is mandatory
 * test C, and it is the reason every step below happens inside one
 * `withTransaction` that takes the lock before it reads anything.
 *
 * WHAT THE REPORTER IS TOLD IS ALWAYS THE SAME. Reported already, just crossed
 * the threshold, nowhere near it — one acknowledgement. The tally is the thing
 * an organised group needs, and nothing here returns it.
 */
@Injectable()
export class ReportService {
  constructor(
    private readonly db: DatabaseService,
    @Inject(REPORT_REPOSITORY) private readonly repo: ReportRepository,
    private readonly audit: AuditService,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly logger: StructuredLogger,
  ) {}

  /**
   * SAFETY-FR-001/002 — file a report.
   *
   * Everything from the lock to the hide is one transaction. The rate-limit
   * check runs BEFORE it, because it needs no lock and a refused report should
   * not have taken one.
   */
  async report(input: {
    reporterId: string;
    targetType: ReportTarget;
    targetId: string;
    reason: ReportReason;
    note?: string | null;
  }): Promise<ReportResult> {
    const now = this.clock.now();

    // SAFETY-FR-009: 20 reports per user per day. Checked first so a
    // rate-limited caller never takes a row lock — otherwise a script could
    // hold locks on other people's content for free.
    const window = new Date(now.getTime() - RATE_LIMIT_WINDOW_HOURS * 60 * 60 * 1000);
    const used = await this.repo.countInWindow('reports', 'reporter_id', input.reporterId, window);
    const verdict = checkRateLimit('REPORTS_PER_DAY', used.used, used.oldest, now);
    if (!verdict.allowed) {
      this.log('report_rate_limited', {});
      return { status: 'RATE_LIMITED', verdict };
    }

    return this.db.withTransaction(async (client) => {
      // THE LOCK COMES FIRST. Read-then-lock would let two transactions both
      // read 2, both conclude the threshold of 3 is not reached, and both
      // insert - three reports and no hide.
      const target = await this.repo.lockTarget(
        input.targetType,
        input.targetId,
        input.reporterId,
        client,
      );
      if (!target.exists) return { status: 'NOT_AVAILABLE' } as const;

      const problem = checkReport({
        reporterId: input.reporterId,
        targetOwnerId: target.ownerId,
        reason: input.reason,
        note: input.note ?? null,
      });
      if (problem !== null) return { status: 'INVALID', reason: problem } as const;

      const severity = severityOf(input.reason);
      const created = await this.repo.insertReport(
        {
          id: randomUUID(),
          reporterId: input.reporterId,
          targetType: input.targetType,
          targetId: input.targetId,
          targetOwnerId: target.ownerId,
          reasonCode: input.reason,
          severity,
          note: input.note ?? null,
        },
        client,
      );

      // EDGE-023: a repeat report from the same account changes nothing. The
      // early return is what guarantees the count does not move — and the
      // caller returns the identical acknowledgement, so the reporter cannot
      // tell this branch from the other.
      if (!created) {
        this.log('report_duplicate', { targetType: input.targetType });
        return { status: 'RECEIVED' } as const;
      }

      const count = await this.repo.countDistinctReporters(
        input.targetType,
        input.targetId,
        client,
      );
      await this.repo.setDistinctReportCount(input.targetType, input.targetId, count, client);

      const shouldHide = reachesAutoHideThreshold({
        target: input.targetType,
        distinctReportCount: count,
        alreadyHidden: target.hidden,
      });

      let hidden = false;
      if (shouldHide) {
        hidden = await this.repo.autoHide(input.targetType, input.targetId, client);
      }

      const moderationCase = await this.repo.upsertOpenCase(
        {
          id: randomUUID(),
          targetType: input.targetType,
          targetId: input.targetId,
          targetOwnerId: target.ownerId,
          maxSeverity: severity,
          distinctReportCount: count,
          autoHidden: hidden || target.hidden,
        },
        client,
      );

      // AUDITED IN THE SAME TRANSACTION. An auto-hide with no audit row is an
      // invisible act of moderation, and an audit row for a hide that rolled
      // back is a false record. Both are worse than either being late.
      //
      // The metadata carries no reporter id: `13` §6 records enforcement, and
      // SAFETY-FR-001 says the reporter's identity is visible to administrators
      // "but never to the reported user" - the report row holds it under access
      // control, and the audit log is read more widely.
      if (hidden) {
        await this.audit.append(
          {
            actorType: 'SYSTEM',
            action: 'CONTENT_AUTO_HIDDEN',
            entityType: input.targetType,
            entityId: input.targetId,
            metadata: {
              distinctReportCount: count,
              severity,
              caseId: moderationCase.id,
            },
          },
          client,
        );
      }

      this.log('report_recorded', {
        targetType: input.targetType,
        severity,
        autoHidden: hidden,
      });

      // TODO(EPIC-13): notify the author that their content is under review
      // (SAFETY-FR-004 main flow step 4). The notification pipeline exists;
      // what is missing is the ADMIN-side template and the decision about
      // whether an auto-hide notice cites the guideline clause (SAFETY-FR-008,
      // blocked on OD-015 content).

      return { status: 'RECEIVED' } as const;
    });
  }

  /**
   * ADMIN-FR-003 — restore, and reset the count.
   *
   * "The report count resets to zero SO THE SAME REPORTERS CANNOT IMMEDIATELY
   * RE-HIDE IT." The rows are deleted rather than a counter zeroed: a counter
   * reset with the rows still present would be undone by the next recompute,
   * and EDGE-026 — "restored content is reported again by the same users" —
   * would then hide it instantly with no new information.
   *
   * EDGE-026 is still satisfiable afterwards: those users CAN report again, and
   * three fresh reports hide it again. What they cannot do is have their old
   * ones counted twice.
   */
  async restore(input: {
    caseId: string;
    adminId: string;
    reason: string;
    expectedVersion: number;
  }): Promise<
    | { status: 'RESOLVED'; case: ModerationCase }
    | { status: 'STALE'; case: ModerationCase }
    | { status: 'NOT_FOUND' }
  > {
    return this.resolve(input, 'RESOLVED_RESTORED', async (moderationCase, client) => {
      await this.repo.restore(moderationCase.targetType, moderationCase.targetId, client);
      await this.repo.clearReports(moderationCase.targetType, moderationCase.targetId, client);
    });
  }

  /**
   * ADMIN-FR-004 — the permanent decision, and only ever a human's.
   *
   * BR-032 permits exactly this one path to deletion. Nothing else in the
   * product deletes content on a count.
   */
  async removeContent(input: {
    caseId: string;
    adminId: string;
    reason: string;
    expectedVersion: number;
  }): Promise<
    | { status: 'RESOLVED'; case: ModerationCase }
    | { status: 'STALE'; case: ModerationCase }
    | { status: 'NOT_FOUND' }
  > {
    return this.resolve(input, 'RESOLVED_DELETED', async (moderationCase, client) => {
      await this.repo.adminRemove(moderationCase.targetType, moderationCase.targetId, client);
    });
  }

  /** No action: the case closes, the content is untouched. */
  async closeNoAction(input: {
    caseId: string;
    adminId: string;
    reason: string;
    expectedVersion: number;
  }): Promise<
    | { status: 'RESOLVED'; case: ModerationCase }
    | { status: 'STALE'; case: ModerationCase }
    | { status: 'NOT_FOUND' }
  > {
    return this.resolve(input, 'RESOLVED_NO_ACTION', async (moderationCase, client) => {
      // A no-action decision still clears the reports. Leaving them would mean
      // one more report re-hides content an administrator has just examined and
      // approved - which is EDGE-026 turned into a weapon.
      await this.repo.restore(moderationCase.targetType, moderationCase.targetId, client);
      await this.repo.clearReports(moderationCase.targetType, moderationCase.targetId, client);
    });
  }

  /** ADMIN-FR-002 — the queue: severity, then count, then age. */
  async queue(limit = 20, offset = 0): Promise<{ cases: ModerationCase[]; total: number }> {
    return this.repo.listOpenCases(clampLimit(limit), Math.max(0, offset));
  }

  async findCase(id: string): Promise<ModerationCase | null> {
    return this.repo.findCaseById(id);
  }

  /**
   * BR-037 — is this account flagged for a suspension DECISION?
   *
   * Three admin-confirmed deletions in 30 days. The word in the requirement is
   * "flags", and the sentence after it is "It is not auto-suspended" — so this
   * returns a boolean for a human to act on and there is no method here that
   * suspends anybody. Enforcement is EPIC-13's, behind an administrator.
   */
  async isFlaggedRepeatOffender(userId: string): Promise<boolean> {
    const since = new Date(
      this.clock.now().getTime() - REPEAT_OFFENDER_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    );
    return isRepeatOffender(await this.repo.countConfirmedDeletions(userId, since));
  }

  // ------------------------------------------------------------ internals
  /**
   * Resolve a case under an optimistic lock (EDGE-024).
   *
   * A stale version returns the CURRENT case rather than an error, because §4
   * requires the collision to be "rendered as information rather than an error"
   * — the second administrator needs to know who resolved it and how, which is
   * a fact about the case and not a fault of their request.
   */
  private async resolve(
    input: { caseId: string; adminId: string; reason: string; expectedVersion: number },
    state: 'RESOLVED_RESTORED' | 'RESOLVED_DELETED' | 'RESOLVED_NO_ACTION',
    apply: (moderationCase: ModerationCase, client: import('pg').PoolClient) => Promise<void>,
  ): Promise<
    | { status: 'RESOLVED'; case: ModerationCase }
    | { status: 'STALE'; case: ModerationCase }
    | { status: 'NOT_FOUND' }
  > {
    return this.db.withTransaction(async (client) => {
      const existing = await this.repo.findCaseById(input.caseId, client);
      if (existing === null) return { status: 'NOT_FOUND' } as const;

      const resolved = await this.repo.resolveCase(
        {
          id: input.caseId,
          expectedVersion: input.expectedVersion,
          state,
          resolutionReason: input.reason,
          adminId: input.adminId,
        },
        client,
      );

      if (resolved === null) {
        // Somebody got there first. Re-read so the caller can say who and how.
        const current = await this.repo.findCaseById(input.caseId, client);
        return { status: 'STALE', case: current ?? existing } as const;
      }

      await apply(resolved, client);

      // BR-039 / ADMIN-FR-012 — every moderation decision is audited, with the
      // administrator who made it and the mandatory reason. In the same
      // transaction as the decision itself.
      await this.audit.append(
        {
          actorType: 'ADMIN',
          actorId: input.adminId,
          action: `MODERATION_${state}`,
          entityType: resolved.targetType,
          entityId: resolved.targetId,
          metadata: {
            caseId: resolved.id,
            reason: input.reason,
            distinctReportCount: resolved.distinctReportCount,
          },
        },
        client,
      );

      this.log('moderation_resolved', { state, targetType: resolved.targetType });
      return { status: 'RESOLVED', case: resolved } as const;
    });
  }

  private log(event: string, extra: Record<string, unknown>): void {
    // No reporter id, no target id, no note. SAFETY-FR-001 says the reporter's
    // identity is visible to administrators "but never to the reported user",
    // and a log line naming both is a record of who reported whom sitting
    // outside the access control that promise depends on.
    this.logger.log(JSON.stringify({ event, ...extra }), 'safety');
  }
}

function clampLimit(limit: number, max = 50): number {
  if (!Number.isFinite(limit) || limit < 1) return 20;
  return Math.min(Math.floor(limit), max);
}
