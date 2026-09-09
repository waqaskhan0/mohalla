import { Module } from '@nestjs/common';
import { METRICS_REPOSITORY } from './repositories/metrics.repository.port.js';
import { PgMetricsRepository } from './repositories/pg-metrics.repository.js';
import { MetricsService } from './application/metrics.service.js';
import { MetricsController } from './transport/metrics.controller.js';

/**
 * `observability` — platform tier. EPIC-15.
 *
 * IT IMPORTS NOTHING AND OWNS NO TABLE, which is unusual enough to explain.
 *
 * A metrics surface is cross-cutting by nature: §15.4 asks for the moderation
 * queue's age, the job queue's depth, the database's size and the platform's
 * user counts, and those live in `safety`, pg-boss, PostgreSQL itself and
 * `identity` respectively. Assembling them through each owning module would
 * mean this module importing most of the application — including two admin-tier
 * modules, which the tier rules forbid outright — and every one of those
 * modules growing a `countFor` method that exists only for a status page.
 *
 * SO IT READS THE TABLES DIRECTLY, UNDER THREE CONSTRAINTS THAT MAKE THAT SAFE:
 *
 *   1. IT ONLY READS. There is no write path here, so it cannot violate an
 *      invariant another module owns. The worst a wrong query can do is report
 *      a wrong number.
 *   2. IT ONLY RETURNS AGGREGATES. NFR-OBS-004 requires the Stage 1 metrics to
 *      be "measurable without profiling individuals"; the repository cannot
 *      select a row, so that property holds by construction rather than by the
 *      caller's restraint.
 *   3. IT IS NOT IN THE IMPORT GRAPH. `check-module-dependencies` enforces
 *      direction on imports, and this module has none — so it cannot become the
 *      back door through which platform starts depending on product or admin.
 *
 * The alternative — a module that imports everything to ask each part how big
 * it is — would couple the whole application to its own status page, which is
 * a worse trade than a read-only module that knows some table names.
 */
@Module({
  controllers: [MetricsController],
  providers: [
    PgMetricsRepository,
    { provide: METRICS_REPOSITORY, useExisting: PgMetricsRepository },
    MetricsService,
  ],
  exports: [MetricsService],
})
export class ObservabilityModule {}
