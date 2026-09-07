import { Injectable } from '@nestjs/common';
import type { PoolClient, QueryResult, QueryResultRow } from 'pg';
import { DatabaseService } from '../../../../database/database.service.js';
import type {
  MetricsRepository,
  OperationalReadings,
  ProductReadings,
} from './metrics.repository.port.js';

/**
 * The metrics queries.
 *
 * EVERY QUERY HERE RETURNS AN AGGREGATE, and that is a design constraint rather
 * than a coincidence. NFR-OBS-004 requires the Stage 1 metrics to be
 * "measurable WITHOUT PROFILING INDIVIDUALS" — so this adapter cannot select a
 * row, cannot group by a user, and cannot return anything a caller could narrow
 * to one person. The privacy property is in the SHAPE of what is possible here,
 * not in the manners of whoever calls it.
 *
 * THEY ARE ALSO ALL CHEAP OR BOUNDED. A metrics endpoint that takes a second
 * becomes a metrics endpoint somebody scrapes less often, and then the
 * moderation queue alert has a coarser resolution than the thing it is
 * watching. Counts over indexed predicates, `pg_database_size`, and one
 * percentile over resolved cases.
 */
@Injectable()
export class PgMetricsRepository implements MetricsRepository {
  constructor(private readonly db: DatabaseService) {}

  private q<R extends QueryResultRow>(
    client: PoolClient | undefined,
    sql: string,
    params: unknown[] = [],
  ): Promise<QueryResult<R>> {
    return client === undefined ? this.db.query<R>(sql, params) : client.query<R>(sql, params);
  }

  async operational(client?: PoolClient): Promise<OperationalReadings> {
    const moderation = await this.q<{ open_cases: string; oldest_hours: string | null }>(
      client,
      `SELECT count(*)::text AS open_cases,
              (EXTRACT(EPOCH FROM (now() - min(created_at))) / 3600)::text AS oldest_hours
         FROM moderation_cases
        WHERE state = 'OPEN'`,
    );

    // The reason this endpoint exists (§15.4). `min(created_at)` is NULL on an
    // empty queue, and that NULL is carried through rather than flattened to
    // zero: an empty queue has no oldest item, while zero would read as
    // "reviewed seconds ago".
    const openCases = Number(moderation.rows[0]?.open_cases ?? 0);
    const oldestRaw = moderation.rows[0]?.oldest_hours;
    const moderationOldestOpenCaseHours =
      oldestRaw === null || oldestRaw === undefined ? null : Number(oldestRaw);

    const connections = await this.q<{ used: string; limit: string }>(
      client,
      `SELECT (SELECT count(*) FROM pg_stat_activity WHERE datname = current_database())::text AS used,
              current_setting('max_connections') AS limit`,
    );

    const size = await this.q<{ bytes: string }>(
      client,
      'SELECT pg_database_size(current_database())::text AS bytes',
    );

    const jobs = await this.jobCounts(client);
    const backupHoursSinceSuccess = await this.backupAge(client);

    return {
      moderationOpenCases: openCases,
      moderationOldestOpenCaseHours,
      jobsReady: jobs.ready,
      jobsDeadLetter: jobs.dead,
      dbConnectionsUsed: Number(connections.rows[0]?.used ?? 0),
      dbConnectionsLimit: Number(connections.rows[0]?.limit ?? 0),
      databaseBytes: Number(size.rows[0]?.bytes ?? 0),
      backupHoursSinceSuccess,
    };
  }

  /**
   * pg-boss's own tables, read defensively.
   *
   * The queue schema is another system's, in a schema this application does not
   * own and does not migrate. If it is absent — a fresh database, a worker that
   * has never started — the honest answer is `null` (not collected) rather than
   * zero (collected, and empty), and certainly not a 500 that takes the whole
   * metrics endpoint down with it. A monitoring surface that fails when one
   * source is missing is a monitoring surface that goes dark exactly when
   * something is wrong.
   */
  private async jobCounts(
    client?: PoolClient,
  ): Promise<{ ready: number | null; dead: number | null }> {
    try {
      const r = await this.q<{ ready: string; dead: string }>(
        client,
        `SELECT count(*) FILTER (WHERE state < 'active' AND name NOT LIKE '%.dead')::text AS ready,
                count(*) FILTER (WHERE name LIKE '%.dead')::text AS dead
           FROM pgboss.job`,
      );
      return { ready: Number(r.rows[0]?.ready ?? 0), dead: Number(r.rows[0]?.dead ?? 0) };
    } catch {
      return { ready: null, dead: null };
    }
  }

  /**
   * Hours since the last SUCCEEDED backup (SEC-026).
   *
   * `null` when none has ever been recorded, and an operator must read that as
   * "unknown, therefore unproven" rather than "fine". The alert treats a
   * missing reading as not-firing, which is why the metrics response reports
   * the null explicitly instead of leaving the field out.
   */
  private async backupAge(client?: PoolClient): Promise<number | null> {
    const r = await this.q<{ hours: string | null }>(
      client,
      `SELECT (EXTRACT(EPOCH FROM (now() - max(finished_at))) / 3600)::text AS hours
         FROM backup_runs
        WHERE kind = 'BACKUP' AND status = 'SUCCEEDED'`,
    );
    const hours = r.rows[0]?.hours;
    return hours === null || hours === undefined ? null : Number(hours);
  }

  async product(client?: PoolClient): Promise<ProductReadings> {
    // ONE ROUND TRIP, and every subquery an aggregate. Splitting these would
    // read the same tables several times for a page nobody looks at often.
    const r = await this.q<{
      registered_users: string;
      active_24h: string;
      active_7d: string;
      posts_total: string;
      posts_7d: string;
      events_upcoming: string;
      language_chosen: string;
      language_urdu: string;
    }>(
      client,
      `SELECT
         (SELECT count(*) FROM users
           WHERE state IN ('ACTIVE', 'SUSPENDED', 'PENDING_DELETION'))::text AS registered_users,

         -- ACTIVITY IS MEASURED FROM SESSIONS, not from posts. A community
         -- platform where people read and do not write is working; counting
         -- only authors would report it as dead.
         (SELECT count(DISTINCT user_id) FROM sessions
           WHERE last_seen_at > now() - interval '24 hours')::text AS active_24h,
         (SELECT count(DISTINCT user_id) FROM sessions
           WHERE last_seen_at > now() - interval '7 days')::text AS active_7d,

         (SELECT count(*) FROM posts WHERE visibility_state = 'VISIBLE')::text AS posts_total,
         (SELECT count(*) FROM posts
           WHERE visibility_state = 'VISIBLE'
             AND created_at > now() - interval '7 days')::text AS posts_7d,

         (SELECT count(*) FROM events
           WHERE status <> 'CANCELLED'
             AND visibility_state = 'VISIBLE'
             AND starts_at > now())::text AS events_upcoming,

         -- BR-040: no language is pre-selected, so an unset row is an account
         -- that has not chosen rather than one that chose English. Both counts
         -- are returned so the ratio is computed from a stated denominator
         -- rather than assumed.
         (SELECT count(*) FROM users WHERE language IS NOT NULL)::text AS language_chosen,
         (SELECT count(*) FROM users WHERE language = 'ur')::text AS language_urdu`,
    );

    const row = r.rows[0];

    return {
      registeredUsers: Number(row?.registered_users ?? 0),
      activeUsers24h: Number(row?.active_24h ?? 0),
      activeUsers7d: Number(row?.active_7d ?? 0),
      postsTotal: Number(row?.posts_total ?? 0),
      posts7d: Number(row?.posts_7d ?? 0),
      eventsUpcoming: Number(row?.events_upcoming ?? 0),
      languageChosenCount: Number(row?.language_chosen ?? 0),
      languageUrduCount: Number(row?.language_urdu ?? 0),
      reportResolutionMedianHours: await this.reportResolutionMedian(client),
    };
  }

  /**
   * MEDIAN, not mean (NFR-OBS-004 "report resolution time").
   *
   * One case left open over a holiday weekend drags a mean past any threshold
   * anybody would set, and the resulting number describes the outlier rather
   * than the practice. The median answers the question actually being asked —
   * "how long does a report usually take?" — and the outlier is already covered
   * by the queue-age alert, which is where it belongs.
   */
  private async reportResolutionMedian(client?: PoolClient): Promise<number | null> {
    const r = await this.q<{ median: string | null }>(
      client,
      `SELECT (percentile_cont(0.5) WITHIN GROUP (
                ORDER BY EXTRACT(EPOCH FROM (resolved_at - created_at)) / 3600
              ))::text AS median
         FROM moderation_cases
        WHERE resolved_at IS NOT NULL`,
    );
    const median = r.rows[0]?.median;
    return median === null || median === undefined ? null : Number(median);
  }
}
