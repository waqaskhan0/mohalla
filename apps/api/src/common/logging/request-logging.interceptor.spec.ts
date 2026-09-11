import { EventEmitter } from 'node:events';
import { of, throwError } from 'rxjs';
import { describe, expect, it } from 'vitest';
import { RequestLoggingInterceptor } from './request-logging.interceptor.js';
import type { StructuredLogger } from './structured.logger.js';

/**
 * QA-008 — every failed request was logged as `status: 200`.
 *
 * The interceptor read `res.statusCode` from an rxjs `tap`, in both the next
 * and the error path. On the error path that is too early: the exception
 * filter has not run, so the status is still Express's default 200.
 *
 * Measured against the running API — a 401 from the session guard, a 400 from
 * a validation pipe and a 503 from a thrown exception were ALL recorded as
 * `status: 200`:
 *
 *     logged: POST /login              -> status 200   (really 401)
 *     logged: GET  /posts/not-a-uuid   -> status 200   (really 400)
 *     logged: GET  /search/people      -> status 200   (really 503)
 *
 * These tests drive the interceptor directly rather than through Nest, because
 * what they pin is a question of TIMING — when the status is read — and the
 * response object is where that timing lives.
 */

/** A response that behaves like Express's: status set later, `finish` emitted. */
class FakeResponse extends EventEmitter {
  statusCode = 200;
}

function harness() {
  const lines: Array<Record<string, unknown>> = [];
  const logger = {
    log: (message: string) => lines.push(JSON.parse(message)),
  } as unknown as StructuredLogger;

  const res = new FakeResponse();
  const context = {
    getType: () => 'http',
    switchToHttp: () => ({
      getRequest: () => ({ method: 'GET', originalUrl: '/search/people?q=secret' }),
      getResponse: () => res,
    }),
  } as never;

  return { lines, res, context, interceptor: new RequestLoggingInterceptor(logger) };
}

describe('QA-008 · the access log records the status the client received', () => {
  it('logs the real status when the handler THROWS', async () => {
    const { lines, res, context, interceptor } = harness();

    const result = interceptor.intercept(context, {
      handle: () => throwError(() => new Error('boom')),
    });
    result.subscribe({ error: () => undefined });

    // The exception filter runs after the handler settles, then Express writes
    // the response. That ordering is the whole defect.
    res.statusCode = 503;
    res.emit('finish');

    expect(lines).toHaveLength(1);
    expect(lines[0]?.status).toBe(503);
  });

  it('logs the real status for a guard rejection', async () => {
    const { lines, res, context, interceptor } = harness();
    interceptor
      .intercept(context, { handle: () => throwError(() => new Error('unauthorised')) })
      .subscribe({ error: () => undefined });

    res.statusCode = 401;
    res.emit('finish');

    expect(lines[0]?.status).toBe(401);
  });

  it('still logs a successful response correctly', async () => {
    const { lines, res, context, interceptor } = harness();
    interceptor.intercept(context, { handle: () => of({ ok: true }) }).subscribe();

    res.statusCode = 200;
    res.emit('finish');

    expect(lines[0]?.status).toBe(200);
  });

  it('logs exactly one line even when finish and close both fire', () => {
    const { lines, res, context, interceptor } = harness();
    interceptor.intercept(context, { handle: () => of({ ok: true }) }).subscribe();

    res.statusCode = 204;
    res.emit('finish');
    res.emit('close');

    expect(lines).toHaveLength(1);
    expect(lines[0]?.status).toBe(204);
  });

  it('logs a client disconnect rather than dropping the request entirely', () => {
    const { lines, res, context, interceptor } = harness();
    interceptor.intercept(context, { handle: () => of({ ok: true }) }).subscribe();

    res.statusCode = 499;
    res.emit('close');

    expect(lines).toHaveLength(1);
    expect(lines[0]?.status).toBe(499);
  });

  it('never logs the query string, which is where identifiers end up', () => {
    const { lines, res, context, interceptor } = harness();
    interceptor.intercept(context, { handle: () => of({}) }).subscribe();
    res.emit('finish');

    expect(lines[0]?.path).toBe('/search/people');
    expect(JSON.stringify(lines[0])).not.toContain('secret');
  });
});
