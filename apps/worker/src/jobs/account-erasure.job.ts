/**
 * ACCOUNT_ERASURE_JOB — the day-30 sweep (PRIV-007 · ADR-019).
 *
 * THIS IS THE ONLY IRREVERSIBLE JOB IN THE SYSTEM. Everything else the worker
 * does can be run again: a drain that misses a row drains it next tick, a
 * health check that fails is retried. This one destroys, and a bug in it is
 * discovered by the person whose account it destroyed.
 *
 * SO IT IS BUILT TO BE HARD TO RUN BY ACCIDENT, AND EASY TO REHEARSE.
 *
 *   - it DEFAULTS TO A DRY RUN. `handleAccountErasure({})` counts and changes
 *     nothing; erasing requires `dryRun: false` to be stated. The schedule
 *     states it, once, in `main.ts`, where it can be read — rather than the
 *     dangerous mode being what you get for saying nothing.
 *   - `ACCOUNT_ERASURE_DRY_RUN=true` in the environment OVERRIDES the payload
 *     in the other direction only: it can force a rehearsal, never a real run.
 *     That is what makes staging safe to point at a copy of production data.
 *   - the dry run and the real run are the SAME CODE PATH through
 *     `DeletionService.runErasure`, differing in one flag. ADR-019 requires the
 *     job to "run dry-run in staging first", and a rehearsal of different code
 *     would be a rehearsal of a different play.
 *   - the batch is BOUNDED. A sweep that found ten thousand due accounts and
 *     tried them in one tick would hold a transaction per account for an hour
 *     and be impossible to stop halfway.
 *
 * LIKE THE DRAIN, IT BOOTSTRAPS THE API'S MODULE GRAPH rather than
 * reimplementing anything. ADR-019's anonymisation contract is per-module and
 * lives in the modules that own the data; a worker with its own copy of the
 * erasure logic would be a second implementation of the destructive path,
 * drifting from the first the moment either changes. The import is dynamic and
 * points at the API's build output for the same reason the drain's is: the
 * worker compiles with `rootDir: src` and cannot type-reference another app.
 */
export const ACCOUNT_ERASURE_JOB = 'account.erasure';
export const ACCOUNT_ERASURE_DEAD_LETTER = 'account.erasure.dead';

export interface AccountErasurePayload {
  /**
   * Defaults to TRUE. Erasing requires saying so.
   *
   * An omitted flag on a destructive job must mean "do nothing". The scheduled
   * production run passes `false` explicitly in `main.ts`, which is one line
   * somebody can read and question.
   */
  dryRun?: boolean;
  /** Accounts per tick. Bounded so a backlog cannot hold the worker for hours. */
  limit?: number;
  correlationId?: string;
}

export interface AccountErasureResult {
  dryRun: boolean;
  /** Accounts actually erased (or, in a dry run, that would have been). */
  accounts: number;
  /** Rows anonymised across every contributing module. Never row contents. */
  rowsAnonymised: number;
  rowsDeleted: number;
  /** Contributor names, so a module that stops reporting is visible. */
  modules: string[];
}

interface ErasureCapableContext {
  get(token: unknown, options?: { strict: boolean }): unknown;
  close(): Promise<void>;
}

interface Eraser {
  runErasure(options: { dryRun: boolean; limit?: number }): Promise<
    {
      userId: string;
      dryRun: boolean;
      outcomes: { module: string; rowsAnonymised: number; rowsDeleted: number }[];
    }[]
  >;
}

let context: ErasureCapableContext | null = null;
let eraser: Eraser | null = null;

/** Build (or reuse) the API's DI graph. Exported so a test can reset it. */
export async function getEraser(): Promise<Eraser> {
  if (eraser !== null) return eraser;

  const { NestFactory } = await import('@nestjs/core');
  const { AppModule } = (await import('../../../api/dist/app.module.js')) as {
    AppModule: unknown;
  };
  const { DeletionService } =
    (await import('../../../api/dist/modules/product/settings/application/deletion.service.js')) as {
      DeletionService: unknown;
    };

  const created = (await NestFactory.createApplicationContext(AppModule as never, {
    abortOnError: false,
    logger: false,
  })) as unknown as ErasureCapableContext;

  context = created;
  eraser = created.get(DeletionService) as Eraser;
  return eraser;
}

/** Test and shutdown hook. */
export async function closeEraser(): Promise<void> {
  await context?.close();
  context = null;
  eraser = null;
}

/**
 * Is this tick allowed to actually erase?
 *
 * Exported because the rule is the safety property, and a safety property that
 * is only exercised through a database is not tested. The environment can force
 * a dry run and can never force a real one — a staging box pointed at a copy of
 * production data stays harmless whatever a payload says.
 */
export function resolveDryRun(
  payload: Pick<AccountErasurePayload, 'dryRun'>,
  env: { ACCOUNT_ERASURE_DRY_RUN?: boolean },
): boolean {
  if (env.ACCOUNT_ERASURE_DRY_RUN === true) return true;
  return payload.dryRun !== false;
}

export async function handleAccountErasure(
  payload: AccountErasurePayload,
  env: { ACCOUNT_ERASURE_DRY_RUN?: boolean } = {},
): Promise<AccountErasureResult> {
  const dryRun = resolveDryRun(payload, env);

  const service = await getEraser();
  const options: { dryRun: boolean; limit?: number } =
    payload.limit === undefined ? { dryRun } : { dryRun, limit: payload.limit };
  const reports = await service.runErasure(options);

  const outcomes = reports.flatMap((r) => r.outcomes);

  // NO USER IDS. This result is logged, and a log line naming who was erased
  // would outlive the erasure it describes — which is exactly what PRIV-007
  // forbids, and log files are not covered by OD-019's pseudonymous retention.
  // The audit row holds the id, under access control.
  return {
    dryRun,
    accounts: reports.length,
    rowsAnonymised: outcomes.reduce((n, o) => n + o.rowsAnonymised, 0),
    rowsDeleted: outcomes.reduce((n, o) => n + o.rowsDeleted, 0),
    modules: [...new Set(outcomes.map((o) => o.module))],
  };
}
