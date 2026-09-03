import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { SessionService } from './session.service.js';
import { InMemoryIdentityRepository } from '../testing/in-memory-identity.repository.js';
import { FixedClock } from '../ports/clock.port.js';
import { SESSION_IDLE_MS, issueSessionToken } from '../domain/session-token.js';
import type { UserState } from '../domain/user-state.js';
import type { DatabaseService } from '../../../../database/database.service.js';
import type { StructuredLogger } from '../../../../common/logging/structured.logger.js';

/**
 * The property that matters here is EDGE-010: a revoked or suspended account
 * must be rejected within one request cycle. That is the entire reason these
 * sessions are server-backed rather than JWTs, so it is tested directly.
 */

function build() {
  const repo = new InMemoryIdentityRepository();
  const clock = new FixedClock(new Date('2026-03-01T09:00:00.000Z'));
  repo.now = () => clock.now();
  const logs: string[] = [];

  const db = {
    withTransaction: async <T>(fn: (c: never) => Promise<T>): Promise<T> => fn(undefined as never),
  } as unknown as DatabaseService;

  const logger = {
    log: (m: unknown) => logs.push(String(m)),
    warn: (m: unknown) => logs.push(String(m)),
    error: (m: unknown) => logs.push(String(m)),
  } as unknown as StructuredLogger;

  const service = new SessionService(db, repo, clock, logger);

  return {
    service,
    repo,
    logs,
    clock,
    advance: (ms: number) => clock.advance(ms),

    async seedSession(state: UserState = 'ACTIVE', suspendedUntil: Date | null = null) {
      const userId = randomUUID();
      repo.users.set(userId, {
        id: userId,
        state,
        accountType: 'INDIVIDUAL',
        username: 'neighbour',
        passwordHash: 'irrelevant',
        dateOfBirth: '1995-06-15',
        suspendedUntil,
        termsVersion: 'terms-2026-01',
        termsAcceptedAt: clock.now(),
        createdAt: clock.now(),
      });

      const issued = issueSessionToken(clock.now());
      const sessionId = randomUUID();
      await repo.createSession({
        id: sessionId,
        userId,
        tokenHash: issued.tokenHash,
        expiresAt: issued.expiresAt,
        deviceLabel: null,
      });
      return { userId, sessionId, token: issued.token };
    },
  };
}

describe('SessionService.resolve', () => {
  let ctx: ReturnType<typeof build>;
  beforeEach(() => {
    ctx = build();
  });

  it('resolves a live token to a principal', async () => {
    const { userId, sessionId, token } = await ctx.seedSession('ACTIVE');
    const r = await ctx.service.resolve(token);

    expect(r.status).toBe('AUTHENTICATED');
    if (r.status === 'AUTHENTICATED') {
      expect(r.principal).toEqual({
        userId,
        sessionId,
        state: 'ACTIVE',
        capability: 'FULL',
        suspendedUntil: null,
      });
    }
  });

  it('NEVER puts an identifier or date of birth in the principal (PRIV-002/003)', async () => {
    const { token } = await ctx.seedSession('ACTIVE');
    const r = await ctx.service.resolve(token);
    if (r.status !== 'AUTHENTICATED') throw new Error('expected a principal');

    // This object reaches every product module. A number sitting in it would
    // leak out of identity by default rather than on request.
    const serialized = JSON.stringify(r.principal);
    expect(serialized).not.toContain('1995-06-15');
    expect(Object.keys(r.principal).sort()).toEqual([
      'capability',
      'sessionId',
      'state',
      'suspendedUntil',
      'userId',
    ]);
  });

  it('gives ONE answer for absent, malformed, unknown, expired and revoked', async () => {
    const answers: unknown[] = [];

    answers.push(await ctx.service.resolve(''));
    answers.push(await ctx.service.resolve('not-a-real-token'));

    let c = build();
    answers.push(await c.service.resolve(issueSessionToken(c.clock.now()).token));

    c = build();
    let s = await c.seedSession('ACTIVE');
    c.advance(SESSION_IDLE_MS + 1);
    answers.push(await c.service.resolve(s.token));

    c = build();
    s = await c.seedSession('ACTIVE');
    await c.service.logout(s.sessionId);
    answers.push(await c.service.resolve(s.token));

    expect(new Set(answers.map((a) => JSON.stringify(a))).size).toBe(1);
    expect(answers[0]).toEqual({ status: 'UNAUTHENTICATED' });
  });

  it('REJECTS A BAN ON THE VERY NEXT REQUEST (EDGE-010)', async () => {
    const { userId, token } = await ctx.seedSession('ACTIVE');
    expect((await ctx.service.resolve(token)).status).toBe('AUTHENTICATED');

    // The ban changes only the user row - no session bookkeeping.
    ctx.repo.setState(userId, 'BANNED');

    // This is the whole argument for server-backed sessions: a signed token
    // would keep working until it expired.
    expect(await ctx.service.resolve(token)).toEqual({ status: 'UNAUTHENTICATED' });
  });

  it('retires the session when the account is banned, so later requests are cheap', async () => {
    const { userId, token } = await ctx.seedSession('ACTIVE');
    await ctx.service.resolve(token);
    ctx.repo.setState(userId, 'BANNED');
    await ctx.service.resolve(token);

    expect(await ctx.repo.listLiveSessions(userId)).toHaveLength(0);
    expect(ctx.repo.revocations.at(-1)?.reason).toBe('BANNED');
  });

  it('DOWNGRADES A SUSPENDED ACCOUNT TO READ_ONLY without a new login (BR-034)', async () => {
    const { userId, token } = await ctx.seedSession('ACTIVE');
    const until = new Date('2026-03-08T09:00:00.000Z');

    const existing = ctx.repo.users.get(userId);
    if (existing === undefined) throw new Error('seed failed');
    ctx.repo.users.set(userId, { ...existing, state: 'SUSPENDED', suspendedUntil: until });

    const r = await ctx.service.resolve(token);
    expect(r.status).toBe('AUTHENTICATED');
    if (r.status === 'AUTHENTICATED') {
      // A moderator's suspension has to bite now, not at next sign-in - which
      // is precisely when a suspended user would avoid signing in.
      expect(r.principal.capability).toBe('READ_ONLY');
      expect(r.principal.suspendedUntil).toEqual(until);
    }
  });

  it('gives a pending-deletion account RESTORE_ONLY', async () => {
    const { userId, token } = await ctx.seedSession('ACTIVE');
    ctx.repo.setState(userId, 'PENDING_DELETION');

    const r = await ctx.service.resolve(token);
    if (r.status !== 'AUTHENTICATED') throw new Error('expected a principal');
    expect(r.principal.capability).toBe('RESTORE_ONLY');
  });

  it('rejects a session whose account fell back to UNVERIFIED', async () => {
    const { userId, token } = await ctx.seedSession('ACTIVE');
    ctx.repo.setState(userId, 'UNVERIFIED');
    expect(await ctx.service.resolve(token)).toEqual({ status: 'UNAUTHENTICATED' });
  });

  it('slides the idle window forward on use (AUTH-API-008)', async () => {
    const { userId, token } = await ctx.seedSession('ACTIVE');
    const original = (await ctx.repo.listLiveSessions(userId))[0]?.expiresAt as Date;

    ctx.advance(10 * 24 * 60 * 60 * 1000); // ten days of active use
    await ctx.service.resolve(token);

    const after = (await ctx.repo.listLiveSessions(userId))[0]?.expiresAt as Date;
    expect(after.getTime()).toBeGreaterThan(original.getTime());
    expect(after.getTime()).toBe(ctx.clock.now().getTime() + SESSION_IDLE_MS);
  });

  it('does not write on every request when the gain is trivial', async () => {
    const { userId, token } = await ctx.seedSession('ACTIVE');
    const before = (await ctx.repo.listLiveSessions(userId))[0]?.expiresAt as Date;

    ctx.advance(2_000); // two seconds later, as on a scrolling feed
    await ctx.service.resolve(token);

    const after = (await ctx.repo.listLiveSessions(userId))[0]?.expiresAt as Date;
    expect(after.getTime()).toBe(before.getTime());
  });

  it('CANNOT RESURRECT AN EXPIRED SESSION BY SLIDING IT', async () => {
    const { userId, token } = await ctx.seedSession('ACTIVE');
    ctx.advance(SESSION_IDLE_MS + 1);

    expect(await ctx.service.resolve(token)).toEqual({ status: 'UNAUTHENTICATED' });
    // If sliding could revive a dead session, revocation would mean nothing.
    expect(await ctx.repo.listLiveSessions(userId)).toHaveLength(0);
  });

  it('fails CLOSED when the database throws', async () => {
    const failing = new SessionService(
      {
        withTransaction: async () => {
          throw new Error('db down');
        },
      } as unknown as DatabaseService,
      {
        findLiveSessionByTokenHash: async () => {
          throw new Error('db down');
        },
      } as never,
      new FixedClock(new Date()),
      { log: () => undefined, error: () => undefined } as unknown as StructuredLogger,
    );

    // An infrastructure fault must deny, never admit.
    expect(await failing.resolve('anything')).toEqual({ status: 'UNAUTHENTICATED' });
  });

  it('never logs the token', async () => {
    const { token } = await ctx.seedSession('ACTIVE');
    await ctx.service.resolve(token);
    await ctx.service.logout(randomUUID());
    for (const line of ctx.logs) expect(line).not.toContain(token);
  });
});

describe('SessionService revocation', () => {
  let ctx: ReturnType<typeof build>;
  beforeEach(() => {
    ctx = build();
  });

  it('logout signs out only that device', async () => {
    const a = await ctx.seedSession('ACTIVE');
    const userId = a.userId;

    // A second device for the same person.
    const second = issueSessionToken(ctx.clock.now());
    await ctx.repo.createSession({
      id: randomUUID(),
      userId,
      tokenHash: second.tokenHash,
      expiresAt: second.expiresAt,
      deviceLabel: 'tablet',
    });

    await ctx.service.logout(a.sessionId);

    expect(await ctx.service.resolve(a.token)).toEqual({ status: 'UNAUTHENTICATED' });
    expect((await ctx.service.resolve(second.token)).status).toBe('AUTHENTICATED');
  });

  it('A PASSWORD RESET REVOKES EVERY SESSION (BR-007, AUTH-FR-007)', async () => {
    const a = await ctx.seedSession('ACTIVE');
    const tokens = [a.token];

    for (let i = 0; i < 3; i += 1) {
      const t = issueSessionToken(ctx.clock.now());
      await ctx.repo.createSession({
        id: randomUUID(),
        userId: a.userId,
        tokenHash: t.tokenHash,
        expiresAt: t.expiresAt,
        deviceLabel: `device-${i}`,
      });
      tokens.push(t.token);
    }

    const revoked = await ctx.service.revokeAllForUser(a.userId, 'PASSWORD_RESET');
    expect(revoked).toBe(4);

    // Someone who resets their password because they fear another person has
    // it must actually eject that person from every device.
    for (const t of tokens) {
      expect(await ctx.service.resolve(t)).toEqual({ status: 'UNAUTHENTICATED' });
    }
    expect(ctx.repo.revocations.at(-1)?.reason).toBe('PASSWORD_RESET');
  });

  it('can spare the device that asked, for a password CHANGE', async () => {
    const a = await ctx.seedSession('ACTIVE');
    const other = issueSessionToken(ctx.clock.now());
    await ctx.repo.createSession({
      id: randomUUID(),
      userId: a.userId,
      tokenHash: other.tokenHash,
      expiresAt: other.expiresAt,
      deviceLabel: 'old-phone',
    });

    const revoked = await ctx.service.revokeAllForUser(a.userId, 'PASSWORD_CHANGE', {
      exceptSessionId: a.sessionId,
    });

    expect(revoked).toBe(1);
    // The person who just changed their password stays signed in here.
    expect((await ctx.service.resolve(a.token)).status).toBe('AUTHENTICATED');
    expect(await ctx.service.resolve(other.token)).toEqual({ status: 'UNAUTHENTICATED' });
  });

  it('does not touch the sessions of a different user', async () => {
    const a = await ctx.seedSession('ACTIVE');
    const b = await ctx.seedSession('ACTIVE');

    await ctx.service.revokeAllForUser(a.userId, 'PASSWORD_RESET');

    expect((await ctx.service.resolve(b.token)).status).toBe('AUTHENTICATED');
  });

  it('revoking when nothing is live is a no-op, not an error', async () => {
    const a = await ctx.seedSession('ACTIVE');
    await ctx.service.revokeAllForUser(a.userId, 'PASSWORD_RESET');
    await expect(ctx.service.revokeAllForUser(a.userId, 'PASSWORD_RESET')).resolves.toBe(0);
  });
});
