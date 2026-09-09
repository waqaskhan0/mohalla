import { PgBoss, type Job } from 'pg-boss';
import { loadEnv } from './config/env.js';
import { StructuredLogger } from './logging/structured.logger.js';
import {
  FOUNDATION_HEALTH_DEAD_LETTER,
  FOUNDATION_HEALTH_JOB,
  handleFoundationHealth,
  type FoundationHealthPayload,
} from './jobs/foundation-health.job.js';
import {
  ACCOUNT_ERASURE_DEAD_LETTER,
  ACCOUNT_ERASURE_JOB,
  closeEraser,
  handleAccountErasure,
  type AccountErasurePayload,
} from './jobs/account-erasure.job.js';
import {
  NOTIFICATION_DRAIN_DEAD_LETTER,
  NOTIFICATION_DRAIN_JOB,
  closeDrainer,
  handleNotificationDrain,
  type NotificationDrainPayload,
} from './jobs/notification-drain.job.js';

/**
 * Worker entry point.
 *
 * Registers the foundation health job and, since EPIC-11, the notification
 * drain (ADR-014's consumer).
 *
 * THE DRAIN IS SCHEDULED, NOT TRIGGERED. The API writes outbox rows inside its
 * business transactions and enqueues nothing - that is the whole point of an
 * outbox, since enqueuing after commit reintroduces the window it exists to
 * close. So the worker polls on a schedule instead, and a tick that finds
 * nothing is the normal case rather than a wasted one.
 */
async function main(): Promise<void> {
  const env = loadEnv();
  const logger = new StructuredLogger('worker', env.LOG_LEVEL);

  const boss = new PgBoss({
    connectionString: env.DATABASE_URL,
    schema: env.PGBOSS_SCHEMA,
    application_name: 'mohalla-worker',
  });

  // An unhandled 'error' from pg-boss terminates the process.
  boss.on('error', (err: Error) => {
    logger.error({ event: 'pgboss_error', message: err.message, stack: err.stack });
  });

  await boss.start();

  // A DEAD-LETTER QUEUE, not just an error log. A job that exhausts its retries
  // has its payload copied here instead of disappearing, so the work is
  // recoverable and inspectable after the fact. It must exist before the queue
  // that references it.
  await boss.createQueue(FOUNDATION_HEALTH_DEAD_LETTER);

  // Retry policy is declared on the QUEUE, not per send, so every producer gets
  // the same behaviour and a future caller cannot accidentally enqueue work
  // with no retries.
  await boss.createQueue(FOUNDATION_HEALTH_JOB, {
    retryLimit: env.JOB_RETRY_LIMIT,
    retryDelay: env.JOB_RETRY_DELAY_SECONDS,
    retryBackoff: true,
    expireInSeconds: env.JOB_EXPIRE_SECONDS,
    deadLetter: FOUNDATION_HEALTH_DEAD_LETTER,
  });

  // The notification drain. Its own dead-letter queue, because a payload that
  // cannot be turned into a notification is worth keeping: it names a like, a
  // follow or a message somebody never heard about.
  await boss.createQueue(NOTIFICATION_DRAIN_DEAD_LETTER);
  await boss.createQueue(NOTIFICATION_DRAIN_JOB, {
    retryLimit: env.JOB_RETRY_LIMIT,
    retryDelay: env.JOB_RETRY_DELAY_SECONDS,
    retryBackoff: true,
    expireInSeconds: env.JOB_EXPIRE_SECONDS,
    deadLetter: NOTIFICATION_DRAIN_DEAD_LETTER,
    // A drain already running must not be joined by a second one: they would
    // claim different rows (SKIP LOCKED) but both hold a DI graph and a pool.
    policy: 'singleton',
  });

  await boss.work<NotificationDrainPayload>(
    NOTIFICATION_DRAIN_JOB,
    async ([job]: Job<NotificationDrainPayload>[]) => {
      if (!job) return;
      const result = await handleNotificationDrain(job.data);
      // Logged even when empty. A drain that stops finding rows and a drain
      // that stops RUNNING look identical without a line per tick.
      logger.info({ event: 'notification_drain', jobId: job.id, ...result });
    },
  );

  // ADR-014 says the outbox is drained by the worker; nothing enqueues this
  // job, so the worker schedules it for itself. Every interval, forever.
  await boss.schedule(NOTIFICATION_DRAIN_JOB, `*/${env.NOTIFICATION_DRAIN_MINUTES} * * * *`, {});

  // THE DAY-30 ERASURE SWEEP (PRIV-007, ADR-019). The only irreversible job in
  // the system, and the one place in this file where a destructive flag is
  // written down. Its dead-letter queue matters more than the others': a sweep
  // that failed halfway is a question about whether an account was erased, and
  // that question needs the payload to answer.
  await boss.createQueue(ACCOUNT_ERASURE_DEAD_LETTER);
  await boss.createQueue(ACCOUNT_ERASURE_JOB, {
    retryLimit: env.JOB_RETRY_LIMIT,
    retryDelay: env.JOB_RETRY_DELAY_SECONDS,
    retryBackoff: true,
    // Longer than the others. Each account is one transaction across every
    // anonymising module, and a sweep expiring mid-account would be retried
    // against rows a committed transaction has already moved.
    expireInSeconds: Math.max(env.JOB_EXPIRE_SECONDS, 600),
    deadLetter: ACCOUNT_ERASURE_DEAD_LETTER,
    // Two sweeps would contend for the same rows. The row lock makes that safe
    // (mandatory test F proves exactly one of them erases), but both would hold
    // a DI graph and a pool for nothing.
    policy: 'singleton',
  });

  await boss.work<AccountErasurePayload>(
    ACCOUNT_ERASURE_JOB,
    async ([job]: Job<AccountErasurePayload>[]) => {
      if (!job) return;
      const result = await handleAccountErasure(job.data, {
        ACCOUNT_ERASURE_DRY_RUN: env.ACCOUNT_ERASURE_DRY_RUN,
      });

      // Logged every tick, including the empty ones. A sweep that stops finding
      // due accounts and a sweep that stops RUNNING look identical otherwise,
      // and the second means a thirty-day promise is quietly not being kept.
      logger.info({ event: 'account_erasure', jobId: job.id, ...result });
    },
  );

  // `dryRun: false` IS WRITTEN HERE AND NOWHERE ELSE. The handler defaults to a
  // dry run, so this single line is what makes the scheduled sweep real - one
  // line to read, question, or remove.
  await boss.schedule(
    ACCOUNT_ERASURE_JOB,
    env.ACCOUNT_ERASURE_CRON,
    { dryRun: false, limit: env.ACCOUNT_ERASURE_LIMIT },
    { tz: 'Asia/Karachi' },
  );

  await boss.work<FoundationHealthPayload>(
    FOUNDATION_HEALTH_JOB,
    async ([job]: Job<FoundationHealthPayload>[]) => {
      if (!job) return;

      // pg-boss reports retry count; attempt 1 is the first try.
      const attempt = (job as Job<FoundationHealthPayload> & { retryCount?: number }).retryCount
        ? ((job as Job<FoundationHealthPayload> & { retryCount: number }).retryCount ?? 0) + 1
        : 1;

      const base = {
        jobId: job.id,
        queue: FOUNDATION_HEALTH_JOB,
        attempt,
        correlationId: job.data.correlationId,
        marker: job.data.marker,
      };

      try {
        const result = handleFoundationHealth(job.data, attempt);
        logger.info({ event: 'job_completed', ...base, latencyMs: result.latencyMs });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        const willRetry = attempt <= env.JOB_RETRY_LIMIT;

        // DEAD-JOB LOGGING. A job that has exhausted its retries is logged at
        // `error` with an explicit `dead: true`, because that is the only
        // signal that work was accepted and then permanently lost. A retryable
        // failure is a warning - alerting on it would page for transient noise.
        if (willRetry) {
          logger.warn({ event: 'job_failed_will_retry', ...base, message });
        } else {
          logger.error({
            event: 'job_dead',
            dead: true,
            ...base,
            retryLimit: env.JOB_RETRY_LIMIT,
            message,
          });
        }
        throw e;
      }
    },
  );

  logger.info({
    event: 'startup',
    environment: env.NODE_ENV,
    version: env.APP_VERSION,
    commit: env.GIT_COMMIT,
    handlers: [FOUNDATION_HEALTH_JOB, NOTIFICATION_DRAIN_JOB, ACCOUNT_ERASURE_JOB],
    // Stated at startup because it is the difference between a worker that
    // erases accounts and one that rehearses. Somebody reading the first line
    // of the log should not have to infer it.
    accountErasure: {
      cron: env.ACCOUNT_ERASURE_CRON,
      forcedDryRun: env.ACCOUNT_ERASURE_DRY_RUN,
    },
    deadLetterQueue: FOUNDATION_HEALTH_DEAD_LETTER,
    retryLimit: env.JOB_RETRY_LIMIT,
    note: 'foundation only - no product job exists',
  });

  // HEARTBEAT. A worker that has stopped consuming looks identical to an idle
  // worker in the logs. A periodic line with queue depth makes the difference
  // visible without a metrics stack, which Stage 5 deliberately does not build.
  const heartbeat = setInterval(() => {
    void (async () => {
      try {
        const q = await boss.getQueue(FOUNDATION_HEALTH_JOB);
        logger.info({
          event: 'heartbeat',
          queue: FOUNDATION_HEALTH_JOB,
          // readyCount is the true backlog; queuedCount includes future-dated
          // jobs that are not yet runnable and would overstate it.
          ready: q?.readyCount ?? null,
          active: q?.activeCount ?? null,
          failed: q?.failedCount ?? null,
        });
      } catch (e) {
        logger.warn({
          event: 'heartbeat_failed',
          message: e instanceof Error ? e.message : String(e),
        });
      }
    })();
  }, env.WORKER_HEARTBEAT_SECONDS * 1000);
  heartbeat.unref();

  // GRACEFUL SHUTDOWN. Required by the rolling-restart strategy (Stage 4
  // section 14): without draining, every deploy abandons in-flight jobs.
  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    clearInterval(heartbeat);
    logger.info({ event: 'shutdown_started', signal });
    try {
      await boss.stop({ graceful: true, close: true });
      // The drain holds a NestJS context with its own connection pool. Leaving
      // it open keeps the process alive past the queue's shutdown, which turns
      // a graceful restart into a timeout and a SIGKILL.
      await closeDrainer();
      await closeEraser();
      logger.info({ event: 'shutdown_complete', signal });
      process.exit(0);
    } catch (e) {
      logger.error({
        event: 'shutdown_failed',
        signal,
        message: e instanceof Error ? e.message : String(e),
      });
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

void main();
