import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { LoginService } from './login.service.js';
import { IdentifierHasher } from '../domain/identifier-hash.js';
import { InMemoryIdentityRepository } from '../testing/in-memory-identity.repository.js';
import { FixedClock } from '../ports/clock.port.js';
import { MAX_ACTIVE_SESSIONS, SESSION_IDLE_MS, hashSessionToken } from '../domain/session-token.js';
import {
  LOGIN_LOCKOUT_MS,
  LOGIN_MAX_FAILURES_PER_ACCOUNT,
  LOGIN_MAX_FAILURES_PER_SOURCE,
} from '../domain/login-lockout.js';
import type { UserState } from '../domain/user-state.js';
import type { PasswordHasher } from '../ports/password-hasher.port.js';
import type { DatabaseService } from '../../../../database/database.service.js';
import type { StructuredLogger } from '../../../../common/logging/structured.logger.js';

const PHONE = '+923001234567';
const PEPPER = 'p'.repeat(48);
const PASSWORD = 'synthetic-Passw0rd';
// Also carries the marker: the secret guard allows a heuristic credential match
// only when the VALUE itself says it is test data.
const WRONG_PASSWORD = 'synthetic-WrongPassw0rd';
const SOURCE = '203.0.113.7'; // TEST-NET-3, reserved for documentation

function build() {
  const repo = new InMemoryIdentityRepository();
  const identifierHasher = new IdentifierHasher(PEPPER);
  const clock = new FixedClock(new Date('2026-03-01T09:00:00.000Z'));
  repo.now = () => clock.now();
  const logs: string[] = [];

  let hashCalls = 0;
  let verifyCalls = 0;
  let rehashNeeded = false;
  // Bumped by a test so a rehash produces a DIFFERENT stored value. Without
  // that, "it rehashed" would assert the hash still equals what it already was
  // - a test that passes whether or not the write happens.
  let hashVersion = 1;

  // A trivial reversible "hash". The Argon2 adapter has its own tests; here the
  // question is which CODE PATHS run, and counting them is the point.
  const hasher: PasswordHasher = {
    async hash(pw) {
      hashCalls += 1;
      return `h${hashVersion}:${pw}`;
    },
    async verify(stored, pw) {
      verifyCalls += 1;
      return /^h\d+:/.test(stored) && stored.replace(/^h\d+:/, '') === pw;
    },
    needsRehash: () => rehashNeeded,
  };

  const db = {
    withTransaction: async <T>(fn: (c: never) => Promise<T>): Promise<T> => fn(undefined as never),
  } as unknown as DatabaseService;

  const logger = {
    log: (m: unknown) => logs.push(String(m)),
    warn: (m: unknown) => logs.push(String(m)),
    error: (m: unknown) => logs.push(String(m)),
  } as unknown as StructuredLogger;

  const service = new LoginService(db, repo, hasher, identifierHasher, clock, logger);

  return {
    service,
    repo,
    logs,
    clock,
    advance: (ms: number) => clock.advance(ms),
    counts: () => ({ hashCalls, verifyCalls }),
    setRehashNeeded: (v: boolean) => {
      rehashNeeded = v;
    },
    bumpHashVersion: () => {
      hashVersion += 1;
    },

    seedUser(state: UserState = 'ACTIVE', suspendedUntil: Date | null = null): string {
      const id = randomUUID();
      repo.users.set(id, {
        id,
        state,
        accountType: 'INDIVIDUAL',
        username: 'neighbour',
        passwordHash: `h${hashVersion}:${PASSWORD}`,
        dateOfBirth: '1995-06-15',
        suspendedUntil,
        termsVersion: 'terms-2026-01',
        termsAcceptedAt: clock.now(),
        createdAt: clock.now(),
      });
      repo.identifiers.set(identifierHasher.hash(PHONE).toString('hex'), id);
      return id;
    },
  };
}

describe('LoginService — the uniform failure (SEC-006)', () => {
  let ctx: ReturnType<typeof build>;
  beforeEach(() => {
    ctx = build();
  });

  it('authenticates a correct password on an active account', async () => {
    const userId = ctx.seedUser('ACTIVE');
    const r = await ctx.service.login({ phone: PHONE, password: PASSWORD });

    expect(r.status).toBe('AUTHENTICATED');
    if (r.status === 'AUTHENTICATED') {
      expect(r.userId).toBe(userId);
      expect(r.capability).toBe('FULL');
      expect(r.token).toHaveLength(43); // 32 bytes, base64url
    }
  });

  it('gives ONE answer for wrong password, unknown number, banned and deleted', async () => {
    const answers: unknown[] = [];

    let c = build();
    c.seedUser('ACTIVE');
    answers.push(await c.service.login({ phone: PHONE, password: WRONG_PASSWORD }));

    c = build(); // no account at all
    answers.push(await c.service.login({ phone: PHONE, password: PASSWORD }));

    c = build();
    c.seedUser('BANNED');
    answers.push(await c.service.login({ phone: PHONE, password: PASSWORD }));

    c = build();
    c.seedUser('DELETED');
    answers.push(await c.service.login({ phone: PHONE, password: PASSWORD }));

    expect(new Set(answers.map((a) => JSON.stringify(a))).size).toBe(1);
    expect(answers[0]).toEqual({ status: 'FAILED' });
  });

  it('VERIFIES A PASSWORD HASH EVEN WHEN NO ACCOUNT EXISTS', async () => {
    // Returning early for an unknown number skips ~236ms of Argon2 and turns
    // latency into a membership oracle: fast means "nobody here". The work has
    // to be done on both paths.
    const withoutAccount = build();
    await withoutAccount.service.login({ phone: PHONE, password: PASSWORD });

    const withAccount = build();
    withAccount.seedUser('ACTIVE');
    await withAccount.service.login({ phone: PHONE, password: WRONG_PASSWORD });

    expect(withoutAccount.counts().verifyCalls).toBe(withAccount.counts().verifyCalls);
    expect(withoutAccount.counts().verifyCalls).toBe(1);
  });

  it('also pays the hash cost for a banned account', async () => {
    const ctxBanned = build();
    ctxBanned.seedUser('BANNED');
    await ctxBanned.service.login({ phone: PHONE, password: PASSWORD });
    expect(ctxBanned.counts().verifyCalls).toBe(1);
  });

  it('records a failure for a banned account, so it is not a free guessing oracle', async () => {
    ctx.seedUser('BANNED');
    await ctx.service.login({ phone: PHONE, password: PASSWORD });
    expect(ctx.repo.loginAttempts.filter((a) => !a.succeeded)).toHaveLength(1);
  });

  it('never writes the number, the password or the token to a log', async () => {
    ctx.seedUser('ACTIVE');
    const r = await ctx.service.login({ phone: PHONE, password: PASSWORD, sourceAddress: SOURCE });
    const token = r.status === 'AUTHENTICATED' ? r.token : '';

    for (const line of ctx.logs) {
      expect(line).not.toContain(PHONE);
      expect(line).not.toContain('3001234567');
      expect(line).not.toContain(PASSWORD);
      expect(line).not.toContain(token);
      expect(line).not.toContain(SOURCE);
    }
  });

  it('stores only the hash of the session token', async () => {
    ctx.seedUser('ACTIVE');
    const r = await ctx.service.login({ phone: PHONE, password: PASSWORD });
    if (r.status !== 'AUTHENTICATED') throw new Error('expected a session');

    // A database dump must not yield a usable session.
    const found = await ctx.repo.findLiveSessionByTokenHash(hashSessionToken(r.token));
    expect(found).not.toBeNull();
    expect(JSON.stringify(ctx.repo.sessions)).not.toContain(r.token);
  });

  it('rejects malformed input without touching the account store', async () => {
    expect(await ctx.service.login({ phone: 'nope', password: PASSWORD })).toEqual({
      status: 'INVALID_INPUT',
      field: 'phone',
    });
    expect(await ctx.service.login({ phone: PHONE, password: '' })).toEqual({
      status: 'INVALID_INPUT',
      field: 'password',
    });
    expect(ctx.repo.loginAttempts).toHaveLength(0);
  });
});

describe('LoginService — account state', () => {
  let ctx: ReturnType<typeof build>;
  beforeEach(() => {
    ctx = build();
  });

  it('routes an unverified account back to OTP instead of issuing a session', async () => {
    ctx.seedUser('UNVERIFIED');
    const r = await ctx.service.login({ phone: PHONE, password: PASSWORD });

    expect(r).toEqual({ status: 'VERIFICATION_REQUIRED' });
    expect(ctx.repo.sessions).toHaveLength(0);
  });

  it('gives a suspended account a READ_ONLY session with its expiry (BR-034)', async () => {
    const until = new Date('2026-03-08T09:00:00.000Z');
    ctx.seedUser('SUSPENDED', until);

    const r = await ctx.service.login({ phone: PHONE, password: PASSWORD });
    expect(r.status).toBe('AUTHENTICATED');
    if (r.status === 'AUTHENTICATED') {
      // A suspension restricts contribution, not access - the person can still
      // read, report and block, and must be told when it ends.
      expect(r.capability).toBe('READ_ONLY');
      expect(r.suspendedUntil).toEqual(until);
    }
  });

  it('gives a pending-deletion account a RESTORE_ONLY session (SET-FR-005)', async () => {
    ctx.seedUser('PENDING_DELETION');
    const r = await ctx.service.login({ phone: PHONE, password: PASSWORD });

    expect(r.status).toBe('AUTHENTICATED');
    if (r.status === 'AUTHENTICATED') expect(r.capability).toBe('RESTORE_ONLY');
  });

  it('issues no session for a banned account even with the right password', async () => {
    ctx.seedUser('BANNED');
    await ctx.service.login({ phone: PHONE, password: PASSWORD });
    expect(ctx.repo.sessions).toHaveLength(0);
  });
});

describe('LoginService — the device cap (BR-007, EDGE-009)', () => {
  let ctx: ReturnType<typeof build>;
  beforeEach(() => {
    ctx = build();
  });

  it('keeps five devices without evicting anything', async () => {
    ctx.seedUser('ACTIVE');
    for (let i = 0; i < MAX_ACTIVE_SESSIONS; i += 1) {
      ctx.advance(1_000);
      await ctx.service.login({ phone: PHONE, password: PASSWORD });
    }
    const live = await ctx.repo.listLiveSessions([...ctx.repo.users.keys()][0] as string);
    expect(live).toHaveLength(MAX_ACTIVE_SESSIONS);
    expect(ctx.repo.revocations).toHaveLength(0);
  });

  it('THE SIXTH DEVICE SIGNS THE FIRST ONE OUT', async () => {
    const userId = ctx.seedUser('ACTIVE');

    const tokens: string[] = [];
    for (let i = 0; i < MAX_ACTIVE_SESSIONS + 1; i += 1) {
      ctx.advance(1_000); // distinct createdAt, so "oldest" is unambiguous
      const r = await ctx.service.login({ phone: PHONE, password: PASSWORD });
      if (r.status === 'AUTHENTICATED') tokens.push(r.token);
    }

    const live = await ctx.repo.listLiveSessions(userId);
    expect(live).toHaveLength(MAX_ACTIVE_SESSIONS);

    // The FIRST device is the one that lost its session...
    expect(
      await ctx.repo.findLiveSessionByTokenHash(hashSessionToken(tokens[0] as string)),
    ).toBeNull();
    // ...and the second-oldest is still signed in.
    expect(
      await ctx.repo.findLiveSessionByTokenHash(hashSessionToken(tokens[1] as string)),
    ).not.toBeNull();
    expect(ctx.repo.revocations[0]?.reason).toBe('EVICTED');
  });

  it('sets a 60-day idle expiry on the new session (AUTH-FR-010)', async () => {
    ctx.seedUser('ACTIVE');
    const r = await ctx.service.login({ phone: PHONE, password: PASSWORD });
    if (r.status !== 'AUTHENTICATED') throw new Error('expected a session');

    expect(r.expiresAt.getTime()).toBe(ctx.clock.now().getTime() + SESSION_IDLE_MS);
  });
});

describe('LoginService — failure lockout (SEC-007)', () => {
  let ctx: ReturnType<typeof build>;
  beforeEach(() => {
    ctx = build();
  });

  const failOnce = () => ctx.service.login({ phone: PHONE, password: WRONG_PASSWORD });

  it('locks the account after ten failures in the window', async () => {
    ctx.seedUser('ACTIVE');
    for (let i = 0; i < LOGIN_MAX_FAILURES_PER_ACCOUNT; i += 1) await failOnce();

    // Even the CORRECT password is refused now.
    expect(await ctx.service.login({ phone: PHONE, password: PASSWORD })).toEqual({
      status: 'FAILED',
    });
  });

  it('lifts the lockout once thirty minutes have passed', async () => {
    ctx.seedUser('ACTIVE');
    for (let i = 0; i < LOGIN_MAX_FAILURES_PER_ACCOUNT; i += 1) await failOnce();

    ctx.advance(LOGIN_LOCKOUT_MS + 1);
    expect((await ctx.service.login({ phone: PHONE, password: PASSWORD })).status).toBe(
      'AUTHENTICATED',
    );
  });

  it('A SUCCESSFUL LOGIN CLEARS EARLIER FAILURES', async () => {
    // Otherwise someone who mistypes nine times, gets in, then mistypes twice
    // is locked out by failures they already recovered from.
    ctx.seedUser('ACTIVE');
    for (let i = 0; i < LOGIN_MAX_FAILURES_PER_ACCOUNT - 1; i += 1) await failOnce();

    expect((await ctx.service.login({ phone: PHONE, password: PASSWORD })).status).toBe(
      'AUTHENTICATED',
    );

    await failOnce();
    await failOnce();
    expect((await ctx.service.login({ phone: PHONE, password: PASSWORD })).status).toBe(
      'AUTHENTICATED',
    );
  });

  it('does not lock one account because a DIFFERENT account failed', async () => {
    ctx.seedUser('ACTIVE');
    // Failures against another number, from the same source.
    for (let i = 0; i < LOGIN_MAX_FAILURES_PER_ACCOUNT; i += 1) {
      await ctx.service.login({
        phone: '+923019999999',
        password: WRONG_PASSWORD,
        sourceAddress: SOURCE,
      });
    }

    expect(
      (await ctx.service.login({ phone: PHONE, password: PASSWORD, sourceAddress: SOURCE })).status,
    ).toBe('AUTHENTICATED');
  });

  it('locks a source address that sprays many accounts', async () => {
    ctx.seedUser('ACTIVE');
    for (let i = 0; i < LOGIN_MAX_FAILURES_PER_SOURCE; i += 1) {
      await ctx.service.login({
        phone: `+9230${String(10_000_000 + i).slice(0, 8)}`,
        password: WRONG_PASSWORD,
        sourceAddress: SOURCE,
      });
    }

    // One guess each against fifty accounts never trips a per-account counter,
    // which is why the source key exists.
    expect(
      (await ctx.service.login({ phone: PHONE, password: PASSWORD, sourceAddress: SOURCE })).status,
    ).toBe('FAILED');
  });

  it('does not punish a different source for that spraying', async () => {
    ctx.seedUser('ACTIVE');
    for (let i = 0; i < LOGIN_MAX_FAILURES_PER_SOURCE; i += 1) {
      await ctx.service.login({
        phone: `+9230${String(10_000_000 + i).slice(0, 8)}`,
        password: WRONG_PASSWORD,
        sourceAddress: SOURCE,
      });
    }

    expect(
      (await ctx.service.login({ phone: PHONE, password: PASSWORD, sourceAddress: '198.51.100.4' }))
        .status,
    ).toBe('AUTHENTICATED');
  });

  it('stores the source address only as a hash', async () => {
    ctx.seedUser('ACTIVE');
    await ctx.service.login({ phone: PHONE, password: PASSWORD, sourceAddress: SOURCE });
    expect(JSON.stringify(ctx.repo.loginAttempts)).not.toContain(SOURCE);
  });
});

describe('LoginService — opportunistic rehash', () => {
  it('upgrades a stale hash while the plaintext is in hand', async () => {
    const ctx = build();
    const userId = ctx.seedUser('ACTIVE');
    expect(ctx.repo.users.get(userId)?.passwordHash).toBe(`h1:${PASSWORD}`);

    ctx.setRehashNeeded(true);
    ctx.bumpHashVersion(); // parameters have moved on since that hash was made

    const r = await ctx.service.login({ phone: PHONE, password: PASSWORD });
    expect(r.status).toBe('AUTHENTICATED');

    // Login is the only moment an old hash can be upgraded without asking the
    // user to do anything - and the STORED value must actually change.
    expect(ctx.repo.users.get(userId)?.passwordHash).toBe(`h2:${PASSWORD}`);
  });

  it('does not rehash when the parameters are current', async () => {
    const ctx = build();
    const userId = ctx.seedUser('ACTIVE');
    const before = ctx.counts().hashCalls;

    await ctx.service.login({ phone: PHONE, password: PASSWORD });

    expect(ctx.counts().hashCalls).toBe(before);
    expect(ctx.repo.users.get(userId)?.passwordHash).toBe(`h1:${PASSWORD}`);
  });
});
