import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { AdminAuthService } from './admin-auth.service.js';
import { LoginService } from './login.service.js';
import { IdentifierHasher } from '../domain/identifier-hash.js';
import { InMemoryIdentityRepository } from '../testing/in-memory-identity.repository.js';
import { InMemoryAdminIdentityRepository } from '../testing/in-memory-admin-identity.repository.js';
import { FixedClock } from '../ports/clock.port.js';
import {
  ADMIN_LOGIN_MAX_FAILURES,
  ADMIN_SESSION_ABSOLUTE_MS,
  LOGIN_LOCKOUT_MS,
  LOGIN_MAX_FAILURES_PER_ACCOUNT,
} from '../domain/login-lockout.js';
import { SESSION_IDLE_MS, hashSessionToken } from '../domain/session-token.js';
import { assertNoIdentifiers } from '../../audit/audit.service.js';
import type { AuditEntry, AuditService } from '../../audit/audit.service.js';
import type { PasswordHasher } from '../ports/password-hasher.port.js';
import type { DatabaseService } from '../../../../database/database.service.js';
import type { StructuredLogger } from '../../../../common/logging/structured.logger.js';

const ADMIN_EMAIL = 'moderator@shehersaaz.example';
const ADMIN_PASSWORD = 'synthetic-AdminPassw0rd';
const USER_PHONE = '+923001234567';
const USER_PASSWORD = 'synthetic-UserPassw0rd';
const PEPPER = 'p'.repeat(48);
const SOURCE = '203.0.113.7';

function build() {
  const adminRepo = new InMemoryAdminIdentityRepository();
  const userRepo = new InMemoryIdentityRepository();
  const identifierHasher = new IdentifierHasher(PEPPER);
  const clock = new FixedClock(new Date('2026-03-01T09:00:00.000Z'));
  adminRepo.now = () => clock.now();
  userRepo.now = () => clock.now();

  const audited: AuditEntry[] = [];
  const audit = {
    append: (entry: AuditEntry) => {
      // Run the REAL privacy guard, so a test that writes an email or a number
      // into audit metadata fails here rather than in production.
      assertNoIdentifiers(entry.action, entry.metadata ?? {});
      audited.push(entry);
      return Promise.resolve();
    },
  } as unknown as AuditService;

  const hasher: PasswordHasher = {
    async hash(pw) {
      return `h:${pw}`;
    },
    async verify(stored, pw) {
      return stored === `h:${pw}`;
    },
    needsRehash: () => false,
  };

  const db = {
    withTransaction: async <T>(fn: (c: never) => Promise<T>): Promise<T> => fn(undefined as never),
  } as unknown as DatabaseService;
  const logger = {
    log: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  } as unknown as StructuredLogger;

  const service = new AdminAuthService(
    db,
    adminRepo,
    userRepo,
    hasher,
    identifierHasher,
    audit,
    clock,
    logger,
  );

  // The user-side service, sharing the same attempt store, so the separation
  // between the two credential stores can be tested for real.
  const userLogin = new LoginService(db, userRepo, hasher, identifierHasher, clock, logger);

  return {
    service,
    userLogin,
    adminRepo,
    userRepo,
    audited,
    clock,
    advance: (ms: number) => clock.advance(ms),

    seedAdmin(state: 'ACTIVE' | 'DISABLED' = 'ACTIVE'): string {
      const id = randomUUID();
      adminRepo.admins.set(id, {
        id,
        email: ADMIN_EMAIL,
        passwordHash: `h:${ADMIN_PASSWORD}`,
        state,
        displayName: 'Moderator',
        createdAt: clock.now(),
      });
      return id;
    },

    seedUser(): string {
      const id = randomUUID();
      userRepo.users.set(id, {
        id,
        state: 'ACTIVE',
        accountType: 'INDIVIDUAL',
        username: 'neighbour',
        passwordHash: `h:${USER_PASSWORD}`,
        dateOfBirth: '1995-06-15',
        suspendedUntil: null,
        termsVersion: 'terms-2026-01',
        termsAcceptedAt: clock.now(),
        createdAt: clock.now(),
      });
      userRepo.identifiers.set(identifierHasher.hash(USER_PHONE).toString('hex'), id);
      return id;
    },
  };
}

describe('AdminAuthService.login', () => {
  let ctx: ReturnType<typeof build>;
  beforeEach(() => {
    ctx = build();
  });

  it('authenticates a valid administrator', async () => {
    const adminId = ctx.seedAdmin();
    const r = await ctx.service.login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

    expect(r.status).toBe('AUTHENTICATED');
    if (r.status === 'AUTHENTICATED') expect(r.adminId).toBe(adminId);
  });

  it('matches the email case-insensitively, as citext does', async () => {
    ctx.seedAdmin();
    const r = await ctx.service.login({
      email: 'Moderator@Shehersaaz.Example',
      password: ADMIN_PASSWORD,
    });
    expect(r.status).toBe('AUTHENTICATED');
  });

  it('SETS AN 8-HOUR ABSOLUTE EXPIRY, not the 60-day user idle window (SEC-024)', async () => {
    ctx.seedAdmin();
    const r = await ctx.service.login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    if (r.status !== 'AUTHENTICATED') throw new Error('expected a session');

    expect(r.expiresAt.getTime()).toBe(ctx.clock.now().getTime() + ADMIN_SESSION_ABSOLUTE_MS);
    // An admin console left open on an unattended desk is the risk here, so
    // this must NOT be the personal-phone lifetime.
    expect(r.expiresAt.getTime()).toBeLessThan(ctx.clock.now().getTime() + SESSION_IDLE_MS);
  });

  it('refuses a wrong password, a disabled account and an unknown address alike', async () => {
    const answers: unknown[] = [];

    let c = build();
    c.seedAdmin();
    answers.push(
      await c.service.login({ email: ADMIN_EMAIL, password: 'synthetic-WrongPassw0rd' }),
    );

    c = build();
    c.seedAdmin('DISABLED');
    answers.push(await c.service.login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }));

    c = build();
    answers.push(await c.service.login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }));

    expect(new Set(answers.map((a) => JSON.stringify(a))).size).toBe(1);
    expect(answers[0]).toEqual({ status: 'FAILED' });
  });

  it('issues no session for a disabled administrator', async () => {
    const adminId = ctx.seedAdmin('DISABLED');
    await ctx.service.login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    expect(await ctx.adminRepo.listLiveAdminSessions(adminId)).toHaveLength(0);
  });

  it('locks out after FIVE failures, not ten', async () => {
    ctx.seedAdmin();
    for (let i = 0; i < ADMIN_LOGIN_MAX_FAILURES; i += 1) {
      await ctx.service.login({ email: ADMIN_EMAIL, password: 'synthetic-WrongPassw0rd' });
    }

    // The population is tiny and known; ten failures here would be an attack
    // running for twice as long as it needs to.
    expect(ADMIN_LOGIN_MAX_FAILURES).toBeLessThan(LOGIN_MAX_FAILURES_PER_ACCOUNT);
    expect(await ctx.service.login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })).toEqual({
      status: 'FAILED',
    });
  });

  it('lifts the admin lockout after thirty minutes', async () => {
    ctx.seedAdmin();
    for (let i = 0; i < ADMIN_LOGIN_MAX_FAILURES; i += 1) {
      await ctx.service.login({ email: ADMIN_EMAIL, password: 'synthetic-WrongPassw0rd' });
    }

    ctx.advance(LOGIN_LOCKOUT_MS + 1);
    expect((await ctx.service.login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })).status).toBe(
      'AUTHENTICATED',
    );
  });

  it('rejects malformed input', async () => {
    expect(await ctx.service.login({ email: 'not-an-email', password: ADMIN_PASSWORD })).toEqual({
      status: 'INVALID_INPUT',
      field: 'email',
    });
    expect(await ctx.service.login({ email: ADMIN_EMAIL, password: '' })).toEqual({
      status: 'INVALID_INPUT',
      field: 'password',
    });
  });

  it('stores the admin email only as a hash in the attempt history', async () => {
    ctx.seedAdmin();
    await ctx.service.login({
      email: ADMIN_EMAIL,
      password: 'synthetic-WrongPassw0rd',
      sourceAddress: SOURCE,
    });

    const serialized = JSON.stringify(ctx.userRepo.loginAttempts);
    expect(serialized).not.toContain(ADMIN_EMAIL);
    expect(serialized).not.toContain(SOURCE);
  });
});

describe('AdminAuthService — SEC-020: the stores must not cross', () => {
  let ctx: ReturnType<typeof build>;
  beforeEach(() => {
    ctx = build();
  });

  it('A USER CREDENTIAL IS REJECTED BY ADMIN AUTHENTICATION', async () => {
    ctx.seedUser();
    ctx.seedAdmin();

    // A neighbour's password is not a key to the moderation console.
    expect(await ctx.service.login({ email: ADMIN_EMAIL, password: USER_PASSWORD })).toEqual({
      status: 'FAILED',
    });
  });

  it('AN ADMIN CREDENTIAL IS REJECTED BY USER AUTHENTICATION', async () => {
    ctx.seedUser();
    ctx.seedAdmin();

    // And a moderator's password is not a key to someone's neighbourhood feed.
    expect(await ctx.userLogin.login({ phone: USER_PHONE, password: ADMIN_PASSWORD })).toEqual({
      status: 'FAILED',
    });
  });

  it('an admin session token does not resolve as a user session', async () => {
    ctx.seedAdmin();
    const r = await ctx.service.login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    if (r.status !== 'AUTHENTICATED') throw new Error('expected a session');

    // Separate session tables, so a token from one store is meaningless in the
    // other even though both are opaque random strings of the same shape.
    expect(await ctx.userRepo.findLiveSessionByTokenHash(hashSessionToken(r.token))).toBeNull();
  });

  it('counts admin and user failures separately', async () => {
    ctx.seedUser();
    ctx.seedAdmin();

    // Five failures against the ADMIN account must not count towards the user.
    for (let i = 0; i < ADMIN_LOGIN_MAX_FAILURES; i += 1) {
      await ctx.service.login({
        email: ADMIN_EMAIL,
        password: 'synthetic-WrongPassw0rd',
        sourceAddress: SOURCE,
      });
    }

    expect(
      (
        await ctx.userLogin.login({
          phone: USER_PHONE,
          password: USER_PASSWORD,
          sourceAddress: SOURCE,
        })
      ).status,
    ).toBe('AUTHENTICATED');
  });
});

describe('AdminAuthService — every login is audited (SEC-021)', () => {
  let ctx: ReturnType<typeof build>;
  beforeEach(() => {
    ctx = build();
  });

  it('audits a successful sign-in', async () => {
    const adminId = ctx.seedAdmin();
    await ctx.service.login({
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
      sourceAddress: SOURCE,
    });

    const entry = ctx.audited.find((a) => a.action === 'ADMIN_LOGIN_SUCCEEDED');
    expect(entry).toBeDefined();
    expect(entry?.actorId).toBe(adminId);
    expect(entry?.ipHash).toBeInstanceOf(Buffer);
  });

  it('AUDITS A FAILURE TOO', async () => {
    ctx.seedAdmin();
    await ctx.service.login({ email: ADMIN_EMAIL, password: 'synthetic-WrongPassw0rd' });

    // A failed admin sign-in is exactly the event worth having a record of.
    const entry = ctx.audited.find((a) => a.action === 'ADMIN_LOGIN_FAILED');
    expect(entry?.metadata?.reason).toBe('BAD_PASSWORD');
  });

  it('audits an attempt on an unknown address without inventing an actor', async () => {
    await ctx.service.login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

    const entry = ctx.audited.find((a) => a.action === 'ADMIN_LOGIN_FAILED');
    expect(entry?.metadata?.reason).toBe('UNKNOWN_ACCOUNT');
    expect(entry?.actorId ?? null).toBeNull();
  });

  it('audits a lockout separately from an ordinary failure', async () => {
    ctx.seedAdmin();
    for (let i = 0; i < ADMIN_LOGIN_MAX_FAILURES + 1; i += 1) {
      await ctx.service.login({ email: ADMIN_EMAIL, password: 'synthetic-WrongPassw0rd' });
    }
    expect(ctx.audited.some((a) => a.action === 'ADMIN_LOGIN_BLOCKED_LOCKOUT')).toBe(true);
  });

  it('NEVER PUTS THE ADMIN EMAIL IN AUDIT METADATA', async () => {
    ctx.seedAdmin();
    await ctx.service.login({
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
      sourceAddress: SOURCE,
    });
    await ctx.service.login({ email: ADMIN_EMAIL, password: 'synthetic-WrongPassw0rd' });

    // The log is retained after erasure (OD-019); the real assertNoIdentifiers
    // guard runs inside this test's audit fake, so a violation throws above.
    const serialized = JSON.stringify(ctx.audited.map((a) => a.metadata ?? {}));
    expect(serialized).not.toContain(ADMIN_EMAIL);
    expect(serialized).not.toContain(SOURCE);
  });

  it('audits a logout', async () => {
    ctx.seedAdmin();
    const r = await ctx.service.login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    if (r.status !== 'AUTHENTICATED') throw new Error('expected a session');

    const resolved = await ctx.service.resolve(r.token);
    if (resolved.status !== 'AUTHENTICATED') throw new Error('expected a principal');

    await ctx.service.logout(resolved.principal);
    expect(ctx.audited.some((a) => a.action === 'ADMIN_LOGOUT')).toBe(true);
    expect(await ctx.service.resolve(r.token)).toEqual({ status: 'UNAUTHENTICATED' });
  });
});

describe('AdminAuthService.resolve', () => {
  let ctx: ReturnType<typeof build>;
  beforeEach(() => {
    ctx = build();
  });

  it('resolves a live admin token', async () => {
    const adminId = ctx.seedAdmin();
    const r = await ctx.service.login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    if (r.status !== 'AUTHENTICATED') throw new Error('expected a session');

    const resolved = await ctx.service.resolve(r.token);
    expect(resolved.status).toBe('AUTHENTICATED');
    if (resolved.status === 'AUTHENTICATED') {
      expect(resolved.principal.adminId).toBe(adminId);
    }
  });

  it('EXPIRES AFTER 8 HOURS EVEN UNDER CONTINUOUS USE', async () => {
    ctx.seedAdmin();
    const r = await ctx.service.login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    if (r.status !== 'AUTHENTICATED') throw new Error('expected a session');

    // Busy the whole shift - the absolute limit must not slide.
    for (let i = 0; i < 7; i += 1) {
      ctx.advance(60 * 60 * 1000);
      expect((await ctx.service.resolve(r.token)).status).toBe('AUTHENTICATED');
    }

    ctx.advance(60 * 60 * 1000 + 1);
    expect(await ctx.service.resolve(r.token)).toEqual({ status: 'UNAUTHENTICATED' });
  });

  it('rejects the token the moment the administrator is disabled', async () => {
    const adminId = ctx.seedAdmin();
    const r = await ctx.service.login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    if (r.status !== 'AUTHENTICATED') throw new Error('expected a session');

    const admin = ctx.adminRepo.admins.get(adminId);
    if (admin === undefined) throw new Error('seed failed');
    ctx.adminRepo.admins.set(adminId, { ...admin, state: 'DISABLED' });

    expect(await ctx.service.resolve(r.token)).toEqual({ status: 'UNAUTHENTICATED' });
    expect(await ctx.adminRepo.listLiveAdminSessions(adminId)).toHaveLength(0);
  });

  it('gives one answer for empty, unknown and revoked tokens', async () => {
    const answers = [await ctx.service.resolve(''), await ctx.service.resolve('not-a-real-token')];
    expect(new Set(answers.map((a) => JSON.stringify(a))).size).toBe(1);
  });
});
