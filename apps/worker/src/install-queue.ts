import { PgBoss } from 'pg-boss';
import { loadEnv } from './config/env.js';
import {
  FOUNDATION_HEALTH_DEAD_LETTER,
  FOUNDATION_HEALTH_JOB,
} from './jobs/foundation-health.job.js';
import {
  NOTIFICATION_DRAIN_DEAD_LETTER,
  NOTIFICATION_DRAIN_JOB,
} from './jobs/notification-drain.job.js';

/**
 * ONE-TIME QUEUE INSTALL — run as migration_owner, not the runtime worker.
 *
 * pg-boss creates its own schema and tables on first start. That is DDL, and by
 * the four-role model only migration_owner may run DDL - the runtime worker has
 * DML only. So the queue schema is installed here, once, as a migration-time
 * step, exactly like `db:migrate`. The tables are then OWNED by migration_owner,
 * and roles.sql's ALTER DEFAULT PRIVILEGES hands runtime_worker/runtime_app the
 * DML they need.
 *
 * After this runs, the worker starts as runtime_worker and does no DDL: pg-boss
 * finds the schema current and skips construction.
 *
 * Point DATABASE_URL at migration_owner when running this.
 */
async function main(): Promise<void> {
  const env = loadEnv();
  const boss = new PgBoss({
    connectionString: env.DATABASE_URL,
    schema: env.PGBOSS_SCHEMA,
    application_name: 'mohalla-queue-install',
  });

  await boss.start(); // installs/migrates the pgboss schema as this role
  await boss.createQueue(FOUNDATION_HEALTH_DEAD_LETTER);
  await boss.createQueue(FOUNDATION_HEALTH_JOB, {
    retryLimit: env.JOB_RETRY_LIMIT,
    retryDelay: env.JOB_RETRY_DELAY_SECONDS,
    retryBackoff: true,
    expireInSeconds: env.JOB_EXPIRE_SECONDS,
    deadLetter: FOUNDATION_HEALTH_DEAD_LETTER,
  });

  await boss.createQueue(NOTIFICATION_DRAIN_DEAD_LETTER);
  await boss.createQueue(NOTIFICATION_DRAIN_JOB, {
    retryLimit: env.JOB_RETRY_LIMIT,
    retryDelay: env.JOB_RETRY_DELAY_SECONDS,
    retryBackoff: true,
    expireInSeconds: env.JOB_EXPIRE_SECONDS,
    deadLetter: NOTIFICATION_DRAIN_DEAD_LETTER,
    policy: 'singleton',
  });

  process.stdout.write(
    `${JSON.stringify({ event: 'queue_installed', schema: env.PGBOSS_SCHEMA, queues: [FOUNDATION_HEALTH_JOB, FOUNDATION_HEALTH_DEAD_LETTER, NOTIFICATION_DRAIN_JOB, NOTIFICATION_DRAIN_DEAD_LETTER] })}\n`,
  );
  await boss.stop({ graceful: true, close: true });
}

void main();
