import { describe, it, expect } from 'vitest';
import { MetricsService } from './metrics.service.js';
import type {
  MetricsRepository,
  OperationalReadings,
  ProductReadings,
} from '../repositories/metrics.repository.port.js';

const OPERATIONAL: OperationalReadings = {
  moderationOpenCases: 0,
  moderationOldestOpenCaseHours: null,
  jobsReady: 0,
  jobsDeadLetter: 0,
  dbConnectionsUsed: 4,
  dbConnectionsLimit: 100,
  databaseBytes: 12_000_000,
  backupHoursSinceSuccess: 2,
};

const PRODUCT: ProductReadings = {
  registeredUsers: 100,
  activeUsers24h: 30,
  activeUsers7d: 60,
  postsTotal: 400,
  posts7d: 40,
  eventsUpcoming: 5,
  languageChosenCount: 50,
  languageUrduCount: 30,
  reportResolutionMedianHours: 4,
};

function build(
  operational: Partial<OperationalReadings> = {},
  product: Partial<ProductReadings> = {},
) {
  const repo: MetricsRepository = {
    async operational() {
      return { ...OPERATIONAL, ...operational };
    },
    async product() {
      return { ...PRODUCT, ...product };
    },
  };
  return new MetricsService(repo);
}

const alert = (snapshot: Awaited<ReturnType<MetricsService['snapshot']>>, id: string) => {
  const found = snapshot.alerts.find((a) => a.id === id);
  if (found === undefined) throw new Error(`no alert ${id}`);
  return found;
};

describe('the moderation queue — the reason this endpoint exists', () => {
  it('FIRES WHEN THE OLDEST CASE PASSES A DAY (§15.4, A3)', async () => {
    // §15.4: A3 - that somebody reviews the queue daily - is a SEVERE
    // assumption, and monitoring is "the only early warning" if they stop.
    const snapshot = await build({
      moderationOpenCases: 7,
      moderationOldestOpenCaseHours: 30,
    }).snapshot();

    expect(alert(snapshot, 'moderation_queue_age').firing).toBe(true);
    expect(alert(snapshot, 'moderation_queue_age').severity).toBe('page');
  });

  it('does not fire while the queue is being worked', async () => {
    const snapshot = await build({
      moderationOpenCases: 3,
      moderationOldestOpenCaseHours: 5,
    }).snapshot();
    expect(alert(snapshot, 'moderation_queue_age').firing).toBe(false);
  });

  it('AN EMPTY QUEUE IS UNMEASURED, NOT ZERO HOURS OLD', async () => {
    // An empty queue has no oldest item. Reporting 0 would read as "reviewed
    // seconds ago" when nothing has been reviewed at all - and would make a
    // queue nobody has ever touched indistinguishable from one kept clear.
    const snapshot = await build().snapshot();

    expect(snapshot.readings['moderation.oldest_open_case_hours']).toBeNull();
    expect(alert(snapshot, 'moderation_queue_age').value).toBeNull();
    expect(snapshot.unmeasured).toContain('moderation.oldest_open_case_hours');
  });
});

describe('an unmeasured metric is never a green one', () => {
  it('NAMES WHAT NOTHING IS FEEDING, rather than omitting it', async () => {
    // Error rate, latency and crash-free sessions are measured at the edge and
    // on the device. Inventing values here would be worse than a gap: a
    // dashboard that is green because nothing is looking.
    const snapshot = await build().snapshot();

    expect(snapshot.unmeasured).toContain('api.error_rate');
    expect(snapshot.unmeasured).toContain('api.latency_p95_ms');
    expect(snapshot.unmeasured).toContain('mobile.crash_free_ratio');

    for (const metric of snapshot.unmeasured) {
      expect(snapshot.alerts.find((a) => a.metric === metric)?.firing).toBe(false);
    }
  });

  it('reports a MISSING backup as unmeasured rather than fresh', async () => {
    // The failure mode of a backup is silence. `null` must reach the operator
    // as "unknown, therefore unproven" - never as a comfortable zero.
    const snapshot = await build({ backupHoursSinceSuccess: null }).snapshot();

    expect(snapshot.readings['backup.hours_since_success']).toBeNull();
    expect(snapshot.unmeasured).toContain('backup.hours_since_success');
  });

  it('fires the backup alert once a day has actually been missed (SEC-026)', async () => {
    expect(
      alert(await build({ backupHoursSinceSuccess: 30 }).snapshot(), 'backup_failure').firing,
    ).toBe(true);
    // A late run is not a missed one.
    expect(
      alert(await build({ backupHoursSinceSuccess: 25 }).snapshot(), 'backup_failure').firing,
    ).toBe(false);
  });
});

describe('ratios', () => {
  it('computes Urdu adoption against accounts that CHOSE (BR-040)', async () => {
    // BR-040 pre-selects nothing, so an unset row is an account that has not
    // chosen rather than one that chose English. Counting the 50 who have not
    // as English would report 30% where the real answer is 60%.
    const snapshot = await build().snapshot();
    expect(snapshot.product.urduAdoptionRatio).toBeCloseTo(0.6);
  });

  it('IS NULL WITH NOTHING UNDERNEATH IT, not zero', async () => {
    // Day one: nobody has chosen anything. A 0 would report "nobody chose
    // Urdu", which is a different and false claim.
    const snapshot = await build({}, { languageChosenCount: 0, languageUrduCount: 0 }).snapshot();
    expect(snapshot.product.urduAdoptionRatio).toBeNull();
  });

  it('reports connection pressure as a ratio of the server limit', async () => {
    const snapshot = await build({ dbConnectionsUsed: 85, dbConnectionsLimit: 100 }).snapshot();
    expect(alert(snapshot, 'database_connections').firing).toBe(true);
  });
});

describe('dead-lettered work', () => {
  it('FIRES ON THE FIRST ONE', async () => {
    // A job that exhausted its retries is work accepted and then permanently
    // lost - a notification nobody got, an erasure that did not run.
    const snapshot = await build({ jobsDeadLetter: 1 }).snapshot();
    expect(alert(snapshot, 'dead_letter_growth').firing).toBe(true);
  });

  it('distinguishes an empty queue from an unreadable one', async () => {
    // pg-boss owns that schema. If it is absent the honest answer is "not
    // collected", because zero would claim the queue was checked and empty.
    const empty = await build({ jobsDeadLetter: 0 }).snapshot();
    expect(empty.readings['jobs.dead_letter_count']).toBe(0);
    expect(empty.unmeasured).not.toContain('jobs.dead_letter_count');

    const unreadable = await build({ jobsDeadLetter: null, jobsReady: null }).snapshot();
    expect(unreadable.unmeasured).toContain('jobs.dead_letter_count');
  });
});

describe('the snapshot itself', () => {
  it('carries no field that could identify a person (NFR-OBS-004)', async () => {
    // "Measurable WITHOUT PROFILING INDIVIDUALS." Every value is a count, a
    // ratio or a duration; there is no id, name, handle or free text anywhere
    // in the response, and no shape here could hold one.
    const snapshot = await build().snapshot();

    for (const value of Object.values(snapshot.readings)) {
      expect(value === null || typeof value === 'number').toBe(true);
    }
    for (const value of Object.values(snapshot.product)) {
      expect(value === null || typeof value === 'number').toBe(true);
    }
  });

  it('reports every declared alert, so nothing is silently unmonitored', async () => {
    const snapshot = await build().snapshot();
    expect(snapshot.alerts.length).toBeGreaterThanOrEqual(10);
    expect(new Set(snapshot.alerts.map((a) => a.id)).size).toBe(snapshot.alerts.length);
  });

  it('stamps when it was collected, so a stale scrape is visible', async () => {
    const snapshot = await build().snapshot();
    expect(snapshot.collectedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
