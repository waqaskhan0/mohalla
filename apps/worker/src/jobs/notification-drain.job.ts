/**
 * NOTIFICATION_DRAIN_JOB — the consumer half of ADR-014.
 *
 * Reads outbox rows the API wrote inside its business transactions, turns each
 * into notification records, and pushes where the eligibility rules allow.
 *
 * WHY THIS BOOTSTRAPS THE API'S OWN MODULE GRAPH INSTEAD OF REIMPLEMENTING
 * ANYTHING.
 *
 * ADR-014's six eligibility rules — own action, block, message request,
 * preference, batching, language — decide who gets told what. Two of them
 * suppress the record entirely and two suppress only the push, and getting that
 * split wrong is invisible until somebody who blocked a neighbour starts
 * getting notified about them.
 *
 * A worker with its own copy of that logic would be a second implementation of
 * the most privacy-sensitive decision in the product, drifting from the first
 * the moment either changes. So the worker starts a NestJS APPLICATION CONTEXT
 * over the API's `AppModule` — no HTTP server, no listener, just the DI graph —
 * and calls `OutboxDrainService`. Same code, same tests, one behaviour.
 *
 * The import is DYNAMIC and points at the API's build output, which is why it
 * is not a TypeScript `import` at the top of this file: the worker compiles
 * with `rootDir: src` and cannot type-reference another app's sources. The
 * smoke test reaches the API the same way, for the same reason.
 *
 * The context is created ONCE and reused across ticks. Building the graph per
 * tick would open a fresh connection pool every time.
 */
export const NOTIFICATION_DRAIN_JOB = 'notification.drain';
export const NOTIFICATION_DRAIN_DEAD_LETTER = 'notification.drain.dead';

export interface NotificationDrainPayload {
  /** Bounded per tick so a backlog cannot stall the queue. */
  batchSize?: number;
  correlationId?: string;
}

export interface NotificationDrainResult {
  claimed: number;
  processed: number;
  failed: number;
  pushesSent: number;
  suppressed: number;
}

interface DrainCapableContext {
  get(token: unknown, options?: { strict: boolean }): unknown;
  close(): Promise<void>;
}

interface Drainer {
  drain(batchSize?: number): Promise<{
    claimed: number;
    processed: number;
    failed: number;
    deliveries: { suppression: { push: boolean; record: boolean }; pushesSent: number }[];
  }>;
}

let context: DrainCapableContext | null = null;
let drainer: Drainer | null = null;

/**
 * Build (or reuse) the API's DI graph.
 *
 * Exported so a test can reset it — and so the failure mode when the API has
 * not been built is a clear message rather than a module-resolution stack.
 */
export async function getDrainer(): Promise<Drainer> {
  if (drainer !== null) return drainer;

  const { NestFactory } = await import('@nestjs/core');
  const { AppModule } = (await import('../../../api/dist/app.module.js')) as {
    AppModule: unknown;
  };
  const { OutboxDrainService } =
    (await import('../../../api/dist/modules/platform/notifications/application/outbox-drain.service.js')) as {
      OutboxDrainService: unknown;
    };

  // No HTTP server: this is the module graph only. `abortOnError: false` so a
  // configuration problem surfaces as a thrown error the job can report,
  // rather than killing the worker process.
  const created = (await NestFactory.createApplicationContext(AppModule as never, {
    abortOnError: false,
    logger: false,
  })) as unknown as DrainCapableContext;

  context = created;
  drainer = created.get(OutboxDrainService) as Drainer;
  return drainer;
}

/** Test and shutdown hook. */
export async function closeDrainer(): Promise<void> {
  await context?.close();
  context = null;
  drainer = null;
}

export async function handleNotificationDrain(
  payload: NotificationDrainPayload,
): Promise<NotificationDrainResult> {
  const service = await getDrainer();
  const result = await service.drain(payload.batchSize);

  return {
    claimed: result.claimed,
    processed: result.processed,
    failed: result.failed,
    pushesSent: result.deliveries.reduce((n, d) => n + d.pushesSent, 0),
    // Counted for the heartbeat, because a drain that processes everything and
    // pushes nothing is either a very quiet hour or a broken eligibility rule,
    // and the two look identical without this number.
    suppressed: result.deliveries.filter((d) => !d.suppression.push).length,
  };
}
