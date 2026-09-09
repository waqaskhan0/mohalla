import { Inject, Injectable } from '@nestjs/common';
import { evaluateAlerts, type AlertEvaluation } from '@mohalla/observability';
import {
  METRICS_REPOSITORY,
  type MetricsRepository,
  type OperationalReadings,
  type ProductReadings,
} from '../repositories/metrics.repository.port.js';

export interface MetricsSnapshot {
  collectedAt: string;
  /** Flat metric-name → value, the shape a scraper wants. Nulls are preserved. */
  readings: Record<string, number | null>;
  operational: OperationalReadings;
  product: ProductReadings & { urduAdoptionRatio: number | null };
  alerts: AlertEvaluation[];
  /** Metrics no collector feeds yet, named rather than silently absent. */
  unmeasured: string[];
}

/**
 * The operational and product metrics surface (NFR-OBS-003/004 · §15.4).
 *
 * ONE ENDPOINT RATHER THAN A METRICS STACK, and that is a deliberate scale
 * decision. §15.5 describes "a two-person team without on-call"; standing up
 * Prometheus for that team would be a second system to operate, back up and
 * keep running in order to learn whether the first one is running. A JSON
 * snapshot that any uptime checker can poll gets the same answer for none of
 * the cost, and can be replaced later without changing what is measured.
 *
 * THE ALERTS ARE EVALUATED HERE, NOT ONLY DECLARED. §15.4 lists thresholds, and
 * a threshold that lives only in a provider's dashboard is a threshold nobody
 * can test. Evaluating them in-process means the shipped code knows when it is
 * unhealthy, `firing: true` is assertable by a test, and a monitor that can
 * only poll a URL still gets the judgement rather than a pile of numbers it
 * would have to interpret.
 *
 * WHAT THIS DOES NOT DO IS NOTIFY. Nothing here sends anything: it reports.
 * Routing an alert to a person is the provider's job and, per §15.5, the
 * technical owner is the named responder — which OD-020 means does not exist
 * yet. Building a notifier now would mean choosing where to send a page with
 * nobody to receive it.
 *
 * SEVERAL METRICS §15.4 NAMES ARE NOT COLLECTED HERE, and they are reported as
 * `unmeasured` rather than omitted. Error rate, latency percentiles and
 * crash-free sessions are measured where they happen — at the edge and on the
 * device — and inventing a value for them in this process would be worse than
 * an honest gap: a dashboard that is green because nothing is looking.
 */
@Injectable()
export class MetricsService {
  constructor(@Inject(METRICS_REPOSITORY) private readonly repo: MetricsRepository) {}

  async snapshot(): Promise<MetricsSnapshot> {
    const [operational, product] = await Promise.all([
      this.repo.operational(),
      this.repo.product(),
    ]);

    const readings: Record<string, number | null> = {
      'moderation.open_cases': operational.moderationOpenCases,
      'moderation.oldest_open_case_hours': operational.moderationOldestOpenCaseHours,
      'jobs.ready_count': operational.jobsReady,
      'jobs.dead_letter_count': operational.jobsDeadLetter,
      'db.connections_used': operational.dbConnectionsUsed,
      'db.connections_used_ratio': ratio(
        operational.dbConnectionsUsed,
        operational.dbConnectionsLimit,
      ),
      'db.size_bytes': operational.databaseBytes,
      'backup.hours_since_success': operational.backupHoursSinceSuccess,
      'product.registered_users': product.registeredUsers,
      'product.active_users_24h': product.activeUsers24h,
      'product.active_users_7d': product.activeUsers7d,
      'product.posts_total': product.postsTotal,
      'product.posts_7d': product.posts7d,
      'product.events_upcoming': product.eventsUpcoming,
      'product.urdu_adoption_ratio': ratio(product.languageUrduCount, product.languageChosenCount),
      'product.report_resolution_median_hours': product.reportResolutionMedianHours,
    };

    // `evaluateAlerts` treats an ABSENT key as unmeasured, so the nulls are
    // stripped rather than passed as zero. The distinction is the whole point:
    // a stopped collector must not read as a healthy system.
    const measured: Record<string, number> = {};
    for (const [name, value] of Object.entries(readings)) {
      if (value !== null) measured[name] = value;
    }

    const alerts = evaluateAlerts(measured);

    return {
      collectedAt: new Date().toISOString(),
      readings,
      operational,
      product: {
        ...product,
        urduAdoptionRatio: ratio(product.languageUrduCount, product.languageChosenCount),
      },
      alerts,
      unmeasured: alerts.filter((a) => a.value === null).map((a) => a.metric),
    };
  }
}

/**
 * `null` when the denominator is zero, never `0` and never `NaN`.
 *
 * A ratio with nothing underneath it is not a small ratio, it is an unanswered
 * question — and on a fresh platform every denominator here starts at zero. A
 * 0 would report "nobody chose Urdu" on day one when nobody has chosen
 * anything, and would satisfy the crash-free alert's `below` comparison into
 * firing forever.
 */
function ratio(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return numerator / denominator;
}
