import { z } from 'zod';

/**
 * Environment contract for the worker process.
 *
 * The worker shares `DATABASE_URL` with the API because pg-boss stores its
 * queue in the same PostgreSQL instance (ADR-010). That is the point of the
 * choice: one datastore, one backup, one connection string, no separate broker.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),

  DATABASE_URL: z.string({ error: 'DATABASE_URL is required' }).min(1, 'DATABASE_URL is required'),

  PGBOSS_SCHEMA: z.string().min(1).default('pgboss'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  /** Retries before a job is treated as dead. */
  JOB_RETRY_LIMIT: z.coerce.number().int().min(0).max(20).default(3),
  /** Base seconds between retries; pg-boss applies exponential backoff. */
  JOB_RETRY_DELAY_SECONDS: z.coerce.number().int().min(1).max(3600).default(15),
  /** Seconds a handler may run before the job is considered expired. */
  JOB_EXPIRE_SECONDS: z.coerce.number().int().min(5).max(3600).default(120),

  /** Heartbeat interval, so a wedged worker is visible rather than silent. */
  /**
   * How often the outbox is drained (ADR-014).
   *
   * A minute is well inside what a notification needs - NOTIF-FR-001 calls push
   * "the primary retention mechanism", not a realtime one, and MSG-FR-004's
   * 3-second guarantee is the SOCKET's job, not this one. A notification that
   * arrives a minute after the message is normal; one that arrives never is the
   * failure this schedule exists to prevent.
   */
  NOTIFICATION_DRAIN_MINUTES: z.coerce.number().int().min(1).max(60).default(1),

  WORKER_HEARTBEAT_SECONDS: z.coerce.number().int().min(5).max(3600).default(60),

  APP_VERSION: z.string().default('0.0.0'),
  GIT_COMMIT: z.string().default('unknown'),
});

export type Env = z.infer<typeof schema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    // Field names and messages only - values may be secrets.
    const fields = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n  ');
    throw new Error(`Invalid environment configuration:\n  ${fields}`);
  }
  return parsed.data;
}
