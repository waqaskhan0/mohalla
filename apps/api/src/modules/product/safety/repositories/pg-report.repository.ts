import { Injectable } from '@nestjs/common';
import type { PoolClient, QueryResult, QueryResultRow } from 'pg';
import { DatabaseService } from '../../../../database/database.service.js';
import type { ReportReason, ReportSeverity, ReportTarget } from '../domain/report-policy.js';
import type {
  ModerationCase,
  ModerationState,
  ReportRepository,
  ReportableTarget,
} from './report.repository.port.js';

interface CaseRow {
  id: string;
  target_type: ReportTarget;
  target_id: string;
  target_owner_id: string | null;
  state: ModerationState;
  max_severity: ReportSeverity;
  distinct_report_count: number;
  auto_hidden: boolean;
  resolution_reason: string | null;
  resolved_by_admin_id: string | null;
  resolved_at: Date | null;
  version: number;
  created_at: Date;
}

const toCase = (r: CaseRow): ModerationCase => ({
  id: r.id,
  targetType: r.target_type,
  targetId: r.target_id,
  targetOwnerId: r.target_owner_id,
  state: r.state,
  maxSeverity: r.max_severity,
  distinctReportCount: r.distinct_report_count,
  autoHidden: r.auto_hidden,
  resolutionReason: r.resolution_reason,
  resolvedByAdminId: r.resolved_by_admin_id,
  resolvedAt: r.resolved_at,
  version: r.version,
  createdAt: r.created_at,
});

const CASE_COLUMNS = `id, target_type, target_id, target_owner_id, state, max_severity,
  distinct_report_count, auto_hidden, resolution_reason, resolved_by_admin_id,
  resolved_at, version, created_at`;

/**
 * Where each reportable thing lives.
 *
 * A lookup rather than a `switch` in five methods, so adding a target type is
 * one entry and the compiler names every place that needs it. `hiddenState` is
 * null for the two types that never auto-hide — PROFILE and CONVERSATION — and
 * that null is load-bearing: `autoHide` refuses rather than guessing a column.
 */
const TARGET_TABLES: Record<
  ReportTarget,
  {
    table: string | null;
    /** Null when the thing has no single owner — see CONVERSATION below. */
    ownerColumn: string | null;
    stateColumn: string | null;
    hiddenState: string | null;
    visibleState: string | null;
    removedState: string | null;
  }
> = {
  POST: {
    table: 'posts',
    ownerColumn: 'author_id',
    stateColumn: 'visibility_state',
    hiddenState: 'AUTO_HIDDEN',
    visibleState: 'VISIBLE',
    removedState: 'ADMIN_REMOVED',
  },
  COMMENT: {
    table: 'comments',
    ownerColumn: 'author_id',
    stateColumn: 'visibility_state',
    hiddenState: 'AUTO_HIDDEN',
    visibleState: 'VISIBLE',
    // A comment's enum has no ADMIN_REMOVED - EPIC-07 modelled three states.
    // An admin deletion therefore lands on DELETED, and the CASE records that
    // it was an administrator rather than the author.
    removedState: 'DELETED',
  },
  EVENT: {
    table: 'events',
    ownerColumn: 'creator_id',
    stateColumn: 'visibility_state',
    hiddenState: 'AUTO_HIDDEN',
    visibleState: 'VISIBLE',
    removedState: 'ADMIN_REMOVED',
  },
  // SAFETY-FR-002: a profile is never auto-hidden, so there is no state column
  // to move. The owner is the user themselves.
  PROFILE: {
    table: 'users',
    ownerColumn: 'id',
    stateColumn: null,
    hiddenState: null,
    visibleState: null,
    removedState: null,
  },
  /**
   * MSG-FR-007: a conversation is never auto-hidden either — AND IT HAS NO
   * OWNER.
   *
   * The first version named `user_low_id` as the owner, which is wrong in a way
   * that is invisible until it bites: `checkReport` refuses a self-report, so
   * whichever participant happened to sort lower by uuid could never report
   * their own conversation. Half of all reporters, chosen at random, silently
   * refused — and the smoke test caught it because its two synthetic accounts
   * happened to land the wrong way round.
   *
   * A conversation is equally both participants' (BR-046 says as much about
   * deletion), so `ownerColumn` is null and the report carries no owner. That
   * also keeps BR-037 honest: a conversation is not one person's content, so
   * it cannot count toward one person's repeat-offender tally.
   */
  CONVERSATION: {
    table: 'conversations',
    ownerColumn: null,
    stateColumn: null,
    hiddenState: null,
    visibleState: null,
    removedState: null,
  },
};

@Injectable()
export class PgReportRepository implements ReportRepository {
  constructor(private readonly db: DatabaseService) {}

  private q<R extends QueryResultRow>(
    client: PoolClient | undefined,
    sql: string,
    params: unknown[],
  ): Promise<QueryResult<R>> {
    return client === undefined ? this.db.query<R>(sql, params) : client.query<R>(sql, params);
  }

  // ---- the atomic threshold ----------------------------------------------
  async lockTarget(
    targetType: ReportTarget,
    targetId: string,
    reporterId: string,
    client: PoolClient,
  ): Promise<ReportableTarget> {
    const spec = TARGET_TABLES[targetType];
    if (spec.table === null) {
      return { targetId, ownerId: null, hidden: false, distinctReportCount: 0, exists: false };
    }

    // MSG-FR-007: only a participant may report a conversation. A stranger who
    // guessed an id gets `exists: false`, which the service turns into the same
    // neutral 404 every other messaging path returns - so the report endpoint
    // cannot be used to probe which conversation ids are real.
    if (targetType === 'CONVERSATION') {
      const participant = await client.query<{ id: string }>(
        `SELECT c.id
           FROM conversations c
           JOIN conversation_participants p
             ON p.conversation_id = c.id AND p.user_id = $2
          WHERE c.id = $1
          FOR UPDATE OF c`,
        [targetId, reporterId],
      );
      return {
        targetId,
        // No owner: a conversation is equally both participants'.
        ownerId: null,
        hidden: false,
        distinctReportCount: 0,
        exists: participant.rows.length > 0,
      };
    }

    // FOR UPDATE, and it is taken BEFORE the count is read. Read-then-lock
    // would let two transactions both read 2, both conclude 3 is not reached,
    // and both insert - three reports, no hide, and nothing in the logs to say
    // so. This is what mandatory test C exercises.
    //
    // A conversation and a profile have no report counter of their own, so they
    // report zero and the threshold rule refuses them anyway.
    const counted = spec.stateColumn !== null;
    const r = await client.query<{
      owner_id: string | null;
      state: string | null;
      distinct_report_count: number | null;
    }>(
      `SELECT ${spec.ownerColumn === null ? 'NULL::uuid' : spec.ownerColumn} AS owner_id,
              ${spec.stateColumn === null ? 'NULL::text' : spec.stateColumn + '::text'} AS state,
              ${counted ? 'distinct_report_count' : 'NULL::integer'} AS distinct_report_count
         FROM ${spec.table}
        WHERE id = $1
        FOR UPDATE`,
      [targetId],
    );

    const row = r.rows[0];
    if (row === undefined) {
      return { targetId, ownerId: null, hidden: false, distinctReportCount: 0, exists: false };
    }

    return {
      targetId,
      ownerId: row.owner_id,
      hidden: row.state !== null && row.state !== spec.visibleState,
      distinctReportCount: row.distinct_report_count ?? 0,
      exists: true,
    };
  }

  async insertReport(
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
  ): Promise<boolean> {
    // ON CONFLICT DO NOTHING on the UNIQUE (reporter, type, target). The caller
    // returns the SAME acknowledgement either way (SAFETY-FR-001).
    const r = await client.query(
      `INSERT INTO reports (
         id, reporter_id, target_type, target_id, target_owner_id, reason_code, severity, note
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (reporter_id, target_type, target_id) DO NOTHING`,
      [
        input.id,
        input.reporterId,
        input.targetType,
        input.targetId,
        input.targetOwnerId,
        input.reasonCode,
        input.severity,
        input.note,
      ],
    );
    return (r.rowCount ?? 0) > 0;
  }

  async countDistinctReporters(
    targetType: ReportTarget,
    targetId: string,
    client: PoolClient,
  ): Promise<number> {
    // A plain row count IS a distinct-reporter count, because the UNIQUE
    // constraint permits one row per reporter. `COUNT(DISTINCT reporter_id)`
    // would be the same answer, more slowly, and would suggest the constraint
    // might not hold.
    const r = await client.query<{ n: string }>(
      'SELECT COUNT(*) AS n FROM reports WHERE target_type = $1 AND target_id = $2',
      [targetType, targetId],
    );
    return Number(r.rows[0]?.n ?? 0);
  }

  async setDistinctReportCount(
    targetType: ReportTarget,
    targetId: string,
    count: number,
    client: PoolClient,
  ): Promise<void> {
    const spec = TARGET_TABLES[targetType];
    if (spec.table === null || spec.stateColumn === null) return;
    await client.query(`UPDATE ${spec.table} SET distinct_report_count = $2 WHERE id = $1`, [
      targetId,
      count,
    ]);
  }

  async autoHide(targetType: ReportTarget, targetId: string, client: PoolClient): Promise<boolean> {
    const spec = TARGET_TABLES[targetType];
    // Refuses rather than guessing. SAFETY-FR-002 and MSG-FR-007 both say these
    // two types are never auto-hidden, and a caller that reached here for one
    // of them has a bug worth failing on rather than a no-op worth hiding.
    if (spec.stateColumn === null || spec.hiddenState === null) return false;

    const r = await client.query(
      `UPDATE ${spec.table} SET ${spec.stateColumn} = $2
        WHERE id = $1 AND ${spec.stateColumn} = $3`,
      [targetId, spec.hiddenState, spec.visibleState],
    );
    return (r.rowCount ?? 0) > 0;
  }

  async restore(targetType: ReportTarget, targetId: string, client: PoolClient): Promise<boolean> {
    const spec = TARGET_TABLES[targetType];
    if (spec.stateColumn === null || spec.visibleState === null) return false;

    // Only from AUTO_HIDDEN. Restoring something the AUTHOR deleted would put
    // back content its owner removed, which is a different and much worse act
    // than reversing an automatic hide.
    const r = await client.query(
      `UPDATE ${spec.table} SET ${spec.stateColumn} = $2, distinct_report_count = 0
        WHERE id = $1 AND ${spec.stateColumn} = $3`,
      [targetId, spec.visibleState, spec.hiddenState],
    );
    return (r.rowCount ?? 0) > 0;
  }

  async adminRemove(
    targetType: ReportTarget,
    targetId: string,
    client: PoolClient,
  ): Promise<boolean> {
    const spec = TARGET_TABLES[targetType];
    if (spec.stateColumn === null || spec.removedState === null) return false;

    const r = await client.query(
      `UPDATE ${spec.table} SET ${spec.stateColumn} = $2 WHERE id = $1`,
      [targetId, spec.removedState],
    );
    return (r.rowCount ?? 0) > 0;
  }

  async clearReports(
    targetType: ReportTarget,
    targetId: string,
    client: PoolClient,
  ): Promise<number> {
    // ADMIN-FR-003: restoring "resets the report count so the same reporters
    // cannot immediately re-hide it". Deleting the rows rather than zeroing a
    // counter is what makes that true - a counter reset with the rows still
    // there would let the next recompute restore the old number.
    const r = await client.query('DELETE FROM reports WHERE target_type = $1 AND target_id = $2', [
      targetType,
      targetId,
    ]);
    return r.rowCount ?? 0;
  }

  // ---- cases -------------------------------------------------------------
  async upsertOpenCase(
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
  ): Promise<ModerationCase> {
    const existing = await client.query<CaseRow>(
      `SELECT ${CASE_COLUMNS} FROM moderation_cases
        WHERE target_type = $1 AND target_id = $2 AND state = 'OPEN'
        FOR UPDATE`,
      [input.targetType, input.targetId],
    );

    const open = existing.rows[0];
    if (open !== undefined) {
      // Severity only ever RISES on an open case. A later Spam report must not
      // demote a case opened by a Violence report down the queue.
      const updated = await client.query<CaseRow>(
        `UPDATE moderation_cases
            SET max_severity = CASE
                  WHEN $2::report_severity > max_severity THEN $2::report_severity
                  ELSE max_severity END,
                distinct_report_count = $3,
                auto_hidden = auto_hidden OR $4,
                updated_at = now()
          WHERE id = $1
          RETURNING ${CASE_COLUMNS}`,
        [open.id, input.maxSeverity, input.distinctReportCount, input.autoHidden],
      );
      return toCase(updated.rows[0] as CaseRow);
    }

    const inserted = await client.query<CaseRow>(
      `INSERT INTO moderation_cases (
         id, target_type, target_id, target_owner_id, max_severity,
         distinct_report_count, auto_hidden
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING ${CASE_COLUMNS}`,
      [
        input.id,
        input.targetType,
        input.targetId,
        input.targetOwnerId,
        input.maxSeverity,
        input.distinctReportCount,
        input.autoHidden,
      ],
    );
    return toCase(inserted.rows[0] as CaseRow);
  }

  async findCaseById(id: string, client?: PoolClient): Promise<ModerationCase | null> {
    const r = await this.q<CaseRow>(
      client,
      `SELECT ${CASE_COLUMNS} FROM moderation_cases WHERE id = $1`,
      [id],
    );
    const row = r.rows[0];
    return row === undefined ? null : toCase(row);
  }

  async findOpenCaseFor(
    targetType: ReportTarget,
    targetId: string,
    client?: PoolClient,
  ): Promise<ModerationCase | null> {
    const r = await this.q<CaseRow>(
      client,
      `SELECT ${CASE_COLUMNS} FROM moderation_cases
        WHERE target_type = $1 AND target_id = $2 AND state = 'OPEN'`,
      [targetType, targetId],
    );
    const row = r.rows[0];
    return row === undefined ? null : toCase(row);
  }

  async listOpenCases(
    limit: number,
    offset: number,
    client?: PoolClient,
  ): Promise<{ cases: ModerationCase[]; total: number }> {
    // ADMIN-FR-002: severity, then count, then AGE ASCENDING - the oldest of
    // equal cases first, because a queue that surfaced the newest would let an
    // item at the bottom wait forever.
    const r = await this.q<CaseRow & { total: string }>(
      client,
      `SELECT ${CASE_COLUMNS}, COUNT(*) OVER () AS total
         FROM moderation_cases
        WHERE state = 'OPEN'
        ORDER BY max_severity DESC, distinct_report_count DESC, created_at ASC
        LIMIT $1 OFFSET $2`,
      [limit, offset],
    );
    return {
      cases: r.rows.map(toCase),
      total: Number(r.rows[0]?.total ?? 0),
    };
  }

  async resolveCase(
    input: {
      id: string;
      expectedVersion: number;
      state: Exclude<ModerationState, 'OPEN'>;
      resolutionReason: string;
      adminId: string;
    },
    client: PoolClient,
  ): Promise<ModerationCase | null> {
    // The version AND the OPEN state are both in the WHERE clause. Version
    // alone would let a second admin resolve an already-resolved case if the
    // first had not bumped it - and `state = 'OPEN'` says the intent directly.
    const r = await client.query<CaseRow>(
      `UPDATE moderation_cases
          SET state = $3,
              resolution_reason = $4,
              resolved_by_admin_id = $5,
              resolved_at = now(),
              updated_at = now(),
              version = version + 1
        WHERE id = $1 AND version = $2 AND state = 'OPEN'
        RETURNING ${CASE_COLUMNS}`,
      [input.id, input.expectedVersion, input.state, input.resolutionReason, input.adminId],
    );
    const row = r.rows[0];
    return row === undefined ? null : toCase(row);
  }

  async countConfirmedDeletions(
    ownerId: string,
    since: Date,
    client?: PoolClient,
  ): Promise<number> {
    const r = await this.q<{ n: string }>(
      client,
      `SELECT COUNT(*) AS n FROM moderation_cases
        WHERE target_owner_id = $1
          AND state = 'RESOLVED_DELETED'
          AND resolved_at >= $2`,
      [ownerId, since],
    );
    return Number(r.rows[0]?.n ?? 0);
  }

  // ---- rate limiting -----------------------------------------------------
  async countInWindow(
    table: 'posts' | 'comments' | 'messages' | 'follows' | 'events' | 'reports',
    userColumn: string,
    userId: string,
    since: Date,
    client?: PoolClient,
  ): Promise<{ used: number; oldest: Date | null }> {
    // The table and column are NOT interpolated from caller input: both
    // parameters are typed to a closed set and every call site passes a
    // literal. A string that reached here from a request would be an injection,
    // and the union type is what makes that unrepresentable rather than
    // merely unlikely.
    const r = await this.q<{ n: string; oldest: Date | null }>(
      client,
      `SELECT COUNT(*) AS n, MIN(created_at) AS oldest
         FROM ${table}
        WHERE ${userColumn} = $1 AND created_at >= $2`,
      [userId, since],
    );
    return {
      used: Number(r.rows[0]?.n ?? 0),
      oldest: r.rows[0]?.oldest ?? null,
    };
  }
}
