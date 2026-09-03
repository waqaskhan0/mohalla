import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { OtpService } from './otp.service.js';
import { IdentifierHasher } from '../domain/identifier-hash.js';
import { FakeSmsProvider } from '../adapters/fake-sms-provider.js';
import { InMemoryIdentityRepository } from '../testing/in-memory-identity.repository.js';
import {
  OTP_LOCKOUT_MS,
  OTP_MAX_ATTEMPTS,
  OTP_RESEND_COOLDOWN_MS,
  OTP_RESEND_MAX_PER_WINDOW,
  OTP_TTL_MS,
  hashOtpCode,
  otpExpiryFrom,
} from '../domain/otp.js';
import { FixedClock } from '../ports/clock.port.js';
import type { DatabaseService } from '../../../../database/database.service.js';
import type { StructuredLogger } from '../../../../common/logging/structured.logger.js';

/**
 * The §14 critical matrix for OTP: expiration, reuse, resend invalidation and
 * the attempt lockout. Each of these is a way the five-attempt cap can be made
 * meaningless, so each is proved rather than assumed.
 */

const PHONE = '+923001234567';
const PEPPER = 'p'.repeat(48);
const CORRECT = '123456';

function build() {
  const repo = new InMemoryIdentityRepository();
  const sms = new FakeSmsProvider();
  const logs: string[] = [];
  const hasher = new IdentifierHasher(PEPPER);

  // ONE controllable clock shared by the service, the fake repository and the
  // assertions, so "wait 15 minutes" is a variable rather than a sleep.
  const clock = new FixedClock(new Date('2026-03-01T09:00:00.000Z'));
  repo.now = () => clock.now();

  const db = {
    withTransaction: async <T>(fn: (c: never) => Promise<T>): Promise<T> => fn(undefined as never),
  } as unknown as DatabaseService;

  const logger = {
    log: (m: unknown) => logs.push(String(m)),
    warn: (m: unknown) => logs.push(String(m)),
    error: (m: unknown) => logs.push(String(m)),
  } as unknown as StructuredLogger;

  const service = new OtpService(db, repo, hasher, sms, clock, logger);
  const identifierHash = hasher.hash(PHONE);

  return {
    service,
    repo,
    sms,
    logs,
    identifierHash,
    advance: (ms: number) => clock.advance(ms),
    at: () => clock.now(),

    /** Put a registered, unverified account with a live code in place. */
    async seed(code = CORRECT, purpose: 'REGISTRATION' | 'PASSWORD_RESET' = 'REGISTRATION') {
      const userId = randomUUID();
      repo.users.set(userId, {
        id: userId,
        state: 'UNVERIFIED',
        accountType: 'INDIVIDUAL',
        username: null,
        passwordHash: 'irrelevant',
        dateOfBirth: '1995-06-15',
        suspendedUntil: null,
        termsVersion: 'terms-2026-01',
        termsAcceptedAt: clock.now(),
        createdAt: clock.now(),
      });
      repo.identifiers.set(identifierHash.toString('hex'), userId);
      await repo.replaceOtpChallenge({
        id: randomUUID(),
        identifierHash,
        purpose,
        codeHash: hashOtpCode(code),
        expiresAt: otpExpiryFrom(clock.now()),
      });
      return userId;
    },
  };
}

describe('OtpService.verify', () => {
  let ctx: ReturnType<typeof build>;
  beforeEach(() => {
    ctx = build();
  });

  it('verifies a correct code and activates the account', async () => {
    const userId = await ctx.seed();
    const r = await ctx.service.verify({ phone: PHONE, code: CORRECT, purpose: 'REGISTRATION' });

    expect(r).toEqual({ status: 'VERIFIED', userId });
    expect(ctx.repo.users.get(userId)?.state).toBe('ACTIVE');
  });

  it('accepts the number in any Pakistani format the user might type', async () => {
    await ctx.seed();
    const r = await ctx.service.verify({
      phone: '0300 123 4567',
      code: CORRECT,
      purpose: 'REGISTRATION',
    });
    expect(r.status).toBe('VERIFIED');
  });

  it('rejects a wrong code and spends an attempt', async () => {
    await ctx.seed();
    const r = await ctx.service.verify({ phone: PHONE, code: '000000', purpose: 'REGISTRATION' });

    expect(r).toEqual({ status: 'REJECTED' });
    expect(ctx.repo.challenges[0]?.attempts).toBe(1);
  });

  it('REFUSES A CODE THAT HAS EXPIRED, even though it is correct', async () => {
    await ctx.seed();
    ctx.advance(OTP_TTL_MS + 1);

    const r = await ctx.service.verify({ phone: PHONE, code: CORRECT, purpose: 'REGISTRATION' });
    expect(r).toEqual({ status: 'REJECTED' });
  });

  it('does not spend an attempt on an expired challenge', async () => {
    await ctx.seed();
    ctx.advance(OTP_TTL_MS + 1);
    await ctx.service.verify({ phone: PHONE, code: '000000', purpose: 'REGISTRATION' });

    // Expiry is checked before the counter, so a stale code cannot be used to
    // burn down someone else's remaining attempts.
    expect(ctx.repo.challenges[0]?.attempts).toBe(0);
  });

  it('REFUSES TO REUSE A CODE that already succeeded', async () => {
    await ctx.seed();
    const first = await ctx.service.verify({
      phone: PHONE,
      code: CORRECT,
      purpose: 'REGISTRATION',
    });
    expect(first.status).toBe('VERIFIED');

    const replay = await ctx.service.verify({
      phone: PHONE,
      code: CORRECT,
      purpose: 'REGISTRATION',
    });
    expect(replay).toEqual({ status: 'REJECTED' });
  });

  it('LOCKS OUT after the attempt cap, and the lockout outlives the challenge', async () => {
    await ctx.seed();

    for (let i = 0; i < OTP_MAX_ATTEMPTS; i += 1) {
      expect(
        (await ctx.service.verify({ phone: PHONE, code: '000000', purpose: 'REGISTRATION' }))
          .status,
      ).toBe('REJECTED');
    }

    // The sixth attempt is refused, and so is the CORRECT code - the account
    // holder waits, which is the cost of stopping the attacker.
    const withCorrect = await ctx.service.verify({
      phone: PHONE,
      code: CORRECT,
      purpose: 'REGISTRATION',
    });
    expect(withCorrect).toEqual({ status: 'REJECTED' });
    expect(ctx.repo.challenges[0]?.attempts).toBe(OTP_MAX_ATTEMPTS);
  });

  it('THE LOCKOUT CANNOT BE RESET BY ASKING FOR A NEW CODE', async () => {
    // This is the whole reason the lockout exists. Without it: burn 5 guesses,
    // resend, get a counter back at zero, repeat - unlimited guessing.
    await ctx.seed();
    for (let i = 0; i < OTP_MAX_ATTEMPTS; i += 1) {
      await ctx.service.verify({ phone: PHONE, code: '000000', purpose: 'REGISTRATION' });
    }

    ctx.advance(OTP_RESEND_COOLDOWN_MS + 1); // cooldown satisfied
    await ctx.service.resend({ phone: PHONE, purpose: 'REGISTRATION' });

    // No new code was sent...
    expect(ctx.sms.all()).toHaveLength(0);
    // ...and verification is still refused.
    expect(
      await ctx.service.verify({ phone: PHONE, code: CORRECT, purpose: 'REGISTRATION' }),
    ).toEqual({ status: 'REJECTED' });
  });

  it('lifts the lockout once it has elapsed', async () => {
    await ctx.seed();
    for (let i = 0; i < OTP_MAX_ATTEMPTS; i += 1) {
      await ctx.service.verify({ phone: PHONE, code: '000000', purpose: 'REGISTRATION' });
    }

    ctx.advance(OTP_LOCKOUT_MS + 1);
    const resent = await ctx.service.resend({ phone: PHONE, purpose: 'REGISTRATION' });

    expect(resent).toEqual({ status: 'ACCEPTED' });
    expect(ctx.sms.all()).toHaveLength(1); // a new code is issued again
  });

  it('gives one identical answer for wrong, expired, used, absent and unknown', async () => {
    const answers: unknown[] = [];

    // wrong code
    let c = build();
    await c.seed();
    answers.push(await c.service.verify({ phone: PHONE, code: '000000', purpose: 'REGISTRATION' }));

    // expired
    c = build();
    await c.seed();
    c.advance(OTP_TTL_MS + 1);
    answers.push(await c.service.verify({ phone: PHONE, code: CORRECT, purpose: 'REGISTRATION' }));

    // already used
    c = build();
    await c.seed();
    await c.service.verify({ phone: PHONE, code: CORRECT, purpose: 'REGISTRATION' });
    answers.push(await c.service.verify({ phone: PHONE, code: CORRECT, purpose: 'REGISTRATION' }));

    // number never registered
    c = build();
    answers.push(await c.service.verify({ phone: PHONE, code: CORRECT, purpose: 'REGISTRATION' }));

    expect(new Set(answers.map((a) => JSON.stringify(a))).size).toBe(1);
  });

  it('treats a malformed code as input, not as a guess', async () => {
    await ctx.seed();
    for (const bad of ['12345', '1234567', 'abcdef', '']) {
      expect(
        await ctx.service.verify({ phone: PHONE, code: bad, purpose: 'REGISTRATION' }),
      ).toEqual({ status: 'INVALID_INPUT', field: 'code' });
    }
    // None of those may consume an attempt - otherwise five junk requests lock
    // a legitimate user out of their own registration.
    expect(ctx.repo.challenges[0]?.attempts).toBe(0);
  });

  it('rejects a non-Pakistani number as input', async () => {
    expect(
      await ctx.service.verify({ phone: '+13001234567', code: CORRECT, purpose: 'REGISTRATION' }),
    ).toEqual({ status: 'INVALID_INPUT', field: 'phone' });
  });

  it('does not let a PASSWORD_RESET code verify a REGISTRATION', async () => {
    await ctx.seed(CORRECT, 'PASSWORD_RESET');
    const r = await ctx.service.verify({ phone: PHONE, code: CORRECT, purpose: 'REGISTRATION' });
    expect(r).toEqual({ status: 'REJECTED' });
  });

  it('does not activate the account on a password-reset verification', async () => {
    const userId = await ctx.seed(CORRECT, 'PASSWORD_RESET');
    const r = await ctx.service.verify({ phone: PHONE, code: CORRECT, purpose: 'PASSWORD_RESET' });

    expect(r.status).toBe('VERIFIED');
    // Proving identity for a reset must not also verify a registration.
    expect(ctx.repo.users.get(userId)?.state).toBe('UNVERIFIED');
  });

  it('never logs the submitted code', async () => {
    await ctx.seed();
    await ctx.service.verify({ phone: PHONE, code: '424242', purpose: 'REGISTRATION' });
    for (const line of ctx.logs) {
      expect(line).not.toContain('424242');
      expect(line).not.toContain(PHONE);
    }
  });
});

describe('OtpService.resend', () => {
  let ctx: ReturnType<typeof build>;
  beforeEach(() => {
    ctx = build();
  });

  it('RESENDING INVALIDATES THE PREVIOUS CODE', async () => {
    await ctx.seed();
    ctx.advance(OTP_RESEND_COOLDOWN_MS + 1);
    await ctx.service.resend({ phone: PHONE, purpose: 'REGISTRATION' });

    // The old code must be dead, or every resend would widen the guessable set.
    expect(
      await ctx.service.verify({ phone: PHONE, code: CORRECT, purpose: 'REGISTRATION' }),
    ).toEqual({ status: 'REJECTED' });
  });

  it('the newly sent code is the one that works', async () => {
    await ctx.seed();
    ctx.advance(OTP_RESEND_COOLDOWN_MS + 1);
    await ctx.service.resend({ phone: PHONE, purpose: 'REGISTRATION' });

    const fresh = ctx.sms.lastTo(PHONE)?.body.match(/\b(\d{6})\b/)?.[1];
    expect(fresh).toBeDefined();
    expect(
      (await ctx.service.verify({ phone: PHONE, code: fresh as string, purpose: 'REGISTRATION' }))
        .status,
    ).toBe('VERIFIED');
  });

  it('refuses a resend inside the 60-second cooldown', async () => {
    await ctx.seed();
    ctx.advance(OTP_RESEND_COOLDOWN_MS - 1_000);

    expect(await ctx.service.resend({ phone: PHONE, purpose: 'REGISTRATION' })).toEqual({
      status: 'ACCEPTED',
    });
    expect(ctx.sms.all()).toHaveLength(0); // accepted-looking, but nothing sent
  });

  it('caps resends per hour, so a resend loop cannot bill the victim', async () => {
    await ctx.seed(); // this counts as the first issued challenge

    let sent = 0;
    for (let i = 0; i < 6; i += 1) {
      ctx.advance(OTP_RESEND_COOLDOWN_MS + 1_000);
      await ctx.service.resend({ phone: PHONE, purpose: 'REGISTRATION' });
      sent = ctx.sms.all().length;
    }

    // An SMS costs the platform money and costs the recipient attention. Six
    // requests inside the hour must not produce six messages.
    expect(sent).toBeLessThanOrEqual(OTP_RESEND_MAX_PER_WINDOW);
  });

  it('allows resending again once the hour has passed', async () => {
    await ctx.seed();
    for (let i = 0; i < 5; i += 1) {
      ctx.advance(OTP_RESEND_COOLDOWN_MS + 1_000);
      await ctx.service.resend({ phone: PHONE, purpose: 'REGISTRATION' });
    }
    const during = ctx.sms.all().length;

    ctx.advance(60 * 60 * 1000 + 1);
    await ctx.service.resend({ phone: PHONE, purpose: 'REGISTRATION' });

    expect(ctx.sms.all().length).toBe(during + 1);
  });

  it('answers identically for an unknown number, sending nothing', async () => {
    const unknown = await ctx.service.resend({ phone: PHONE, purpose: 'REGISTRATION' });
    expect(unknown).toEqual({ status: 'ACCEPTED' });
    expect(ctx.sms.all()).toHaveLength(0);

    await ctx.seed();
    ctx.advance(OTP_RESEND_COOLDOWN_MS + 1);
    const known = await ctx.service.resend({ phone: PHONE, purpose: 'REGISTRATION' });

    // Same value for both - resend cannot be used to test which numbers exist.
    expect(JSON.stringify(known)).toBe(JSON.stringify(unknown));
  });

  it('rejects a malformed number as input', async () => {
    expect(await ctx.service.resend({ phone: 'nonsense', purpose: 'REGISTRATION' })).toEqual({
      status: 'INVALID_INPUT',
      field: 'phone',
    });
  });

  it('never logs the code it just sent', async () => {
    await ctx.seed();
    ctx.advance(OTP_RESEND_COOLDOWN_MS + 1);
    await ctx.service.resend({ phone: PHONE, purpose: 'REGISTRATION' });

    const code = ctx.sms.lastTo(PHONE)?.body.match(/\b(\d{6})\b/)?.[1] as string;
    for (const line of ctx.logs) {
      expect(line).not.toContain(code);
      expect(line).not.toContain(PHONE);
    }
  });
});
