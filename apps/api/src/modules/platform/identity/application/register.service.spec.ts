import { describe, it, expect, beforeEach } from 'vitest';
import { RegisterService, type RegisterCommand } from './register.service.js';
import { IdentifierHasher } from '../domain/identifier-hash.js';
import { FakeSmsProvider } from '../adapters/fake-sms-provider.js';
import type { IdentityRepository, UserRecord } from '../repositories/identity.repository.port.js';
import type { PasswordHasher } from '../ports/password-hasher.port.js';
import type { DatabaseService } from '../../../../database/database.service.js';
import type { StructuredLogger } from '../../../../common/logging/structured.logger.js';

/**
 * These tests exist mainly to prove ONE property: registration must not reveal
 * whether a number already holds an account, is banned, or is free (SEC-006,
 * EDGE-003/004). A leak here is a membership oracle for the whole platform.
 */

const PEPPER = 'p'.repeat(48);
const VALID: RegisterCommand = {
  phone: '+923001234567',
  password: 'goodPassword1',
  dateOfBirth: '1995-06-15',
  termsVersion: 'terms-2026-01',
};

/** Records what the service actually did, so behaviour is observable. */
class FakeRepo implements IdentityRepository {
  banned = new Set<string>();
  existing = new Map<string, string>();
  loseRace = false;

  createdUsers = 0;
  createdChallenges = 0;
  passwordHashCalls = 0;

  async isIdentifierBanned(hash: Buffer): Promise<boolean> {
    return this.banned.has(hash.toString('hex'));
  }
  async findUserIdByIdentifierHash(hash: Buffer): Promise<string | null> {
    return this.existing.get(hash.toString('hex')) ?? null;
  }
  async findUserById(): Promise<UserRecord | null> {
    return null;
  }
  async createUserWithPrimaryPhone(input: { id: string }): Promise<UserRecord | null> {
    if (this.loseRace) return null;
    this.createdUsers += 1;
    return {
      id: input.id,
      state: 'UNVERIFIED',
      accountType: 'INDIVIDUAL',
      username: null,
      passwordHash: 'x',
      dateOfBirth: VALID.dateOfBirth,
      suspendedUntil: null,
      termsVersion: VALID.termsVersion,
      termsAcceptedAt: new Date(),
      createdAt: new Date(),
    };
  }
  async markUserVerified(): Promise<void> {}
  async replaceOtpChallenge(): Promise<void> {
    this.createdChallenges += 1;
  }
  async findLiveOtpChallenge(): Promise<null> {
    return null;
  }
  async incrementOtpAttempts(): Promise<number> {
    return 1;
  }
  async consumeOtpChallenge(): Promise<void> {}
  async listLiveSessions(): Promise<[]> {
    return [];
  }
  async createSession(): Promise<void> {}
  async revokeSessions(): Promise<void> {}
  async findLiveSessionByTokenHash(): Promise<null> {
    return null;
  }
}

function build() {
  const repo = new FakeRepo();
  const sms = new FakeSmsProvider();
  const logs: string[] = [];

  const hasher: PasswordHasher = {
    async hash(pw) {
      repo.passwordHashCalls += 1;
      return `hashed:${pw}`;
    },
    async verify() {
      return true;
    },
    needsRehash() {
      return false;
    },
  };

  // Runs the callback immediately - the fake repo needs no real client.
  const db = {
    withTransaction: async <T>(fn: (c: never) => Promise<T>): Promise<T> => fn(undefined as never),
  } as unknown as DatabaseService;

  const logger = {
    log: (m: unknown) => logs.push(String(m)),
    warn: (m: unknown) => logs.push(String(m)),
    error: (m: unknown) => logs.push(String(m)),
    debug: () => undefined,
  } as unknown as StructuredLogger;

  const service = new RegisterService(db, repo, hasher, new IdentifierHasher(PEPPER), sms, logger);
  return { service, repo, sms, logs };
}

describe('RegisterService — enumeration resistance (SEC-006)', () => {
  let ctx: ReturnType<typeof build>;
  beforeEach(() => {
    ctx = build();
  });

  it('returns ACCEPTED for a free number', async () => {
    await expect(ctx.service.register(VALID)).resolves.toEqual({ status: 'ACCEPTED' });
    expect(ctx.repo.createdUsers).toBe(1);
  });

  it('returns the IDENTICAL result when the number is already registered', async () => {
    const hash = new IdentifierHasher(PEPPER).hash(VALID.phone).toString('hex');
    ctx.repo.existing.set(hash, 'existing-user-id');

    const result = await ctx.service.register(VALID);

    expect(result).toEqual({ status: 'ACCEPTED' }); // same shape, same value
    expect(ctx.repo.createdUsers).toBe(0); // but nothing was created
    expect(ctx.sms.all()).toHaveLength(0); // and no code was sent
  });

  it('returns the IDENTICAL result when the number is BANNED (BR-036)', async () => {
    const hash = new IdentifierHasher(PEPPER).hash(VALID.phone).toString('hex');
    ctx.repo.banned.add(hash);

    const result = await ctx.service.register(VALID);

    expect(result).toEqual({ status: 'ACCEPTED' });
    expect(ctx.repo.createdUsers).toBe(0);
    expect(ctx.sms.all()).toHaveLength(0);
  });

  it('returns the IDENTICAL result when a concurrent request wins the race (EDGE-001)', async () => {
    ctx.repo.loseRace = true;
    const result = await ctx.service.register(VALID);
    expect(result).toEqual({ status: 'ACCEPTED' });
    expect(ctx.sms.all()).toHaveLength(0);
  });

  it('makes free, taken, banned and raced outcomes indistinguishable to the caller', async () => {
    const results: unknown[] = [];

    for (const setup of [
      () => undefined,
      () =>
        ctx.repo.existing.set(new IdentifierHasher(PEPPER).hash(VALID.phone).toString('hex'), 'u'),
      () => ctx.repo.banned.add(new IdentifierHasher(PEPPER).hash(VALID.phone).toString('hex')),
      () => {
        ctx.repo.loseRace = true;
      },
    ]) {
      ctx = build();
      setup();
      results.push(await ctx.service.register(VALID));
    }

    // Every branch must serialise to exactly one value.
    expect(new Set(results.map((r) => JSON.stringify(r))).size).toBe(1);
  });

  it('still returns ACCEPTED when the database throws', async () => {
    const { service } = build();
    // Replace the transaction runner with one that fails.
    const failing = new RegisterService(
      {
        withTransaction: async () => {
          throw new Error('db down');
        },
      } as unknown as DatabaseService,
      new FakeRepo(),
      {
        async hash() {
          return 'h';
        },
        async verify() {
          return true;
        },
        needsRehash() {
          return false;
        },
      },
      new IdentifierHasher(PEPPER),
      new FakeSmsProvider(),
      {
        log: () => undefined,
        warn: () => undefined,
        error: () => undefined,
      } as unknown as StructuredLogger,
    );
    await expect(failing.register(VALID)).resolves.toEqual({ status: 'ACCEPTED' });
    expect(service).toBeDefined();
  });
});

describe('RegisterService — cost and delivery', () => {
  it('does NOT hash the password for a banned number (DoS resistance)', async () => {
    const ctx = build();
    ctx.repo.banned.add(new IdentifierHasher(PEPPER).hash(VALID.phone).toString('hex'));
    await ctx.service.register(VALID);
    // A ~236ms hash on every probe would be a free denial-of-service.
    expect(ctx.repo.passwordHashCalls).toBe(0);
  });

  it('does NOT hash the password for an already-registered number', async () => {
    const ctx = build();
    ctx.repo.existing.set(new IdentifierHasher(PEPPER).hash(VALID.phone).toString('hex'), 'u');
    await ctx.service.register(VALID);
    expect(ctx.repo.passwordHashCalls).toBe(0);
  });

  it('sends the OTP only on the genuinely-created path', async () => {
    const ctx = build();
    await ctx.service.register(VALID);
    const sent = ctx.sms.lastTo(VALID.phone);
    expect(sent).toBeDefined();
    expect(sent?.body).toMatch(/\b\d{6}\b/);
    expect(ctx.repo.createdChallenges).toBe(1);
  });

  it('never writes the OTP code or the phone number into a log line', async () => {
    const ctx = build();
    await ctx.service.register(VALID);
    const code = ctx.sms.lastTo(VALID.phone)?.body.match(/\b(\d{6})\b/)?.[1];
    expect(code).toBeDefined();
    for (const line of ctx.logs) {
      expect(line).not.toContain(code as string);
      expect(line).not.toContain(VALID.phone);
      expect(line).not.toContain('3001234567');
    }
  });

  it('normalizes before storing, so one number cannot register twice', async () => {
    const ctx = build();
    await ctx.service.register({ ...VALID, phone: '03001234567' });
    // The fake repo keys on the peppered hash of the NORMALIZED value.
    expect(ctx.sms.lastTo('+923001234567')).toBeDefined();
  });
});

describe('RegisterService — input the user can see for themselves', () => {
  it.each([
    ['+13001234567', 'phone'],
    ['not-a-number', 'phone'],
    ['+924212345678', 'phone'],
  ])('rejects the invalid phone %s', async (phone, field) => {
    const ctx = build();
    const r = await ctx.service.register({ ...VALID, phone });
    expect(r.status).toBe('INVALID_INPUT');
    if (r.status === 'INVALID_INPUT') expect(r.field).toBe(field);
  });

  it('rejects a weak password with the reason, since it is the user own input', async () => {
    const ctx = build();
    const r = await ctx.service.register({ ...VALID, password: 'short1' });
    expect(r).toEqual({ status: 'INVALID_INPUT', field: 'password', reason: 'TOO_SHORT' });
  });

  it('rejects a malformed date of birth', async () => {
    const ctx = build();
    const r = await ctx.service.register({ ...VALID, dateOfBirth: '15/06/1995' });
    expect(r.status).toBe('INVALID_INPUT');
  });

  it('requires an affirmative, versioned terms acceptance (BR-004)', async () => {
    const ctx = build();
    for (const bad of ['', '   ']) {
      const r = await ctx.service.register({ ...VALID, termsVersion: bad });
      expect(r).toEqual({
        status: 'INVALID_INPUT',
        field: 'termsVersion',
        reason: 'TERMS_NOT_ACCEPTED',
      });
    }
  });

  it('creates nothing when input validation fails', async () => {
    const ctx = build();
    await ctx.service.register({ ...VALID, password: 'weak' });
    expect(ctx.repo.createdUsers).toBe(0);
    expect(ctx.repo.passwordHashCalls).toBe(0);
  });
});
