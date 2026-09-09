import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { MetricsController } from './metrics.controller.js';
import type { Env } from '../../../../config/env.js';
import type { MetricsService } from '../application/metrics.service.js';

/**
 * The metrics token gate.
 *
 * WHY THIS FILE EXISTS. CodeQL reported `js/polynomial-redos` (high) against
 * the Authorization parser here, and it was right. The expression was
 * `/^Bearer\s+(.+)$/i`, in which `\s` and `.` both match a space — so the two
 * quantifiers overlap, and on a string the regex cannot match the engine has to
 * try every split between them before giving up. That is quadratic in the run
 * of spaces.
 *
 * IT MATTERS HERE MORE THAN IT WOULD ELSEWHERE. This runs on the Authorization
 * header of an UNAUTHENTICATED request, before anything else: the one string an
 * attacker fully controls, at whatever length the header limit allows.
 *
 * The parser is now a single left-to-right scan. These tests pin the BEHAVIOUR
 * either way, so the rewrite is a rewrite and not a quiet widening of what
 * counts as a credential — plus one bounded-time case for the pathological
 * input itself.
 */

const SECRET = 'a-synthetic-metrics-token-that-is-long-enough';

function controllerWith(token: string | undefined) {
  const metrics = {
    snapshot: async () => ({ ok: true }),
  } as unknown as MetricsService;

  return new MetricsController(metrics, { METRICS_TOKEN: token } as unknown as Env);
}

async function reject(header: string | undefined, why: string) {
  const controller = controllerWith(SECRET);
  await expect(controller.snapshot(header), why).rejects.toBeInstanceOf(UnauthorizedException);
}

describe('GET /health/metrics — the token gate', () => {
  it('accepts the configured token', async () => {
    const controller = controllerWith(SECRET);
    await expect(controller.snapshot(`Bearer ${SECRET}`)).resolves.toEqual({ ok: true });
  });

  it('accepts any casing of the scheme, and tabs or extra spaces after it', async () => {
    // What the old regex allowed, kept exactly.
    const controller = controllerWith(SECRET);

    for (const header of [
      `bearer ${SECRET}`,
      `BEARER ${SECRET}`,
      `BeArEr ${SECRET}`,
      `Bearer    ${SECRET}`,
      `Bearer\t${SECRET}`,
      `  Bearer ${SECRET}  `,
    ]) {
      await expect(controller.snapshot(header), header).resolves.toEqual({ ok: true });
    }
  });

  it('refuses everything that is not the token', async () => {
    await reject(undefined, 'no header at all');
    await reject('', 'an empty header');
    await reject('Bearer', 'the scheme with no credential');
    await reject('Bearer ', 'the scheme with only a separator');
    await reject(`Bearer${SECRET}`, 'no separator — `Bearerabc` is not the scheme');
    await reject(`Basic ${SECRET}`, 'the wrong scheme');
    await reject(SECRET, 'the bare token with no scheme');
    await reject('Bearer wrong-token-of-the-same-sort', 'a wrong token');
    await reject(`Bearer ${SECRET}x`, 'a token with one character too many');
    await reject(`Bearer ${SECRET.slice(0, -1)}`, 'a token with one character too few');
  });

  it('refuses a credential containing a newline, as the old expression did', async () => {
    // `(.+)` could not span a newline and `$` was not multiline, so these never
    // matched before either. Asserted so the rewrite is not a widening.
    await reject(`Bearer ${SECRET}\nx`, 'a newline inside the credential');
    await reject(`Bearer ${SECRET}\rx`, 'a carriage return inside the credential');
  });

  it('404s rather than 401s when no token is configured', async () => {
    // A 503 or a 401 would confirm the path exists; the route is simply not
    // there until somebody configures it.
    const controller = controllerWith(undefined);
    await expect(controller.snapshot('Bearer anything')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('REFUSES THE PATHOLOGICAL HEADER IN LINEAR TIME (js/polynomial-redos)', async () => {
    // THE SHAPE MATTERS, AND THE FIRST VERSION OF THIS TEST HAD IT WRONG.
    //
    // `Bearer` + spaces + `\nx` passes against the OLD regex in microseconds,
    // because `\s` matches a newline too: `\s+` swallows the spaces and the
    // newline, `.+` takes the `x`, and it matches on the first attempt with no
    // backtracking at all. A test built on that input proves nothing.
    //
    // The input that actually blows up has to make the match FAIL — and it has
    // to survive `.trim()`, which strips a trailing newline and defuses the
    // obvious candidate. Two newlines with content after each does both: `.`
    // cannot cross a newline, so no split of the space run between `\s+` and
    // `.+` can ever reach `$`, and the engine tries all of them.
    //
    // Measured against the old expression: 6ms at 2k spaces, 126ms at 8k,
    // 534ms at 16k — quadratic, and all three fit inside an ordinary 16KB
    // header limit. At the 32k used here it is a couple of seconds of CPU per
    // request, on a route that has not authenticated the caller yet.
    const hostile = `Bearer${' '.repeat(32_768)}\nA\nB`;

    const started = process.hrtime.bigint();
    await reject(hostile, 'a header built to make the parser backtrack');
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1_000_000;

    // A loose bound on purpose: this is a test for a quadratic blow-up, not a
    // benchmark. A single scan of 32k characters is well under a millisecond,
    // and the old regex needs seconds — so 500ms flags the regression by orders
    // of magnitude while leaving room for a busy CI runner.
    expect(elapsedMs, `parsing took ${elapsedMs.toFixed(1)}ms`).toBeLessThan(500);
  });
});
