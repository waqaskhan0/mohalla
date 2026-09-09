import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { PasswordService } from './password.service.js';
import { IdentifierHasher } from '../domain/identifier-hash.js';
import { FakeSmsProvider } from '../adapters/fake-sms-provider.js';
import { InMemoryIdentityRepository } from '../testing/in-memory-identity.repository.js';
import { FixedClock } from '../ports/clock.port.js';
import { issueSessionToken } from '../domain/session-token.js';
import {
  OTP_MAX_ATTEMPTS,
  OTP_RESEND_COOLDOWN_MS,
  OTP_RESEND_MAX_PER_WINDOW,
  OTP_TTL_MS,
  hashOtpCode,
} from '../domain/otp.js';
import type { PasswordHasher } from '../ports/password-hasher.port.js';
import type { DatabaseService } from '../../../../database/database.service.js';
import type { StructuredLogger } from '../../../../common/logging/structured.logger.js';

const PHONE = '+923001234567';
const PEPPER = 'p'.repeat(48);
const OLD_PASSWORD = 'synthetic-OldPassw0rd';
const NEW_PASSWORD = 'synthetic-NewPassw0rd';

function build() {
  const repo = new InMemoryIdentityRepository();
  const identifierHasher = new IdentifierHasher(PEPPER);
  const sms = new FakeSmsProvider();
  const clock = new FixedClock(new Date('2026-03-01T09:00:00.000Z'));
  repo.now = () => clock.now();
  const logs: string[] = [];

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
    log: (m: unknown) => logs.push(String(m)),
    warn: (m: unknown) => logs.push(String(m)),
    error: (m: unknown) => logs.push(String(m)),
  } as unknown as StructuredLogger;

  const service = new PasswordService(db, repo, hasher, identifierHasher, sms, clock, logger);

  return {
    service,
    repo,
    sms,
    logs,
    clock,
    advance: (ms: number) => clock.advance(ms),
    identifierHash: identifierHasher.hash(PHONE),

    /** A registered account with `deviceCount` live sessions. */
    async seedUser(deviceCount = 3) {
      const userId = randomUUID();
      repo.users.set(userId, {
        id: userId,
        state: 'ACTIVE',
        accountType: 'INDIVIDUAL',
        username: 'neighbour',
        passwordHash: `h:${OLD_PASSWORD}`,
        dateOfBirth: '1995-06-15',
        suspendedUntil: null,
        language: null,
        termsVersion: 'terms-2026-01',
        termsAcceptedAt: clock.now(),
        createdAt: clock.now(),
      });
      repo.identifiers.set(identifierHasher.hash(PHONE).toString('hex'), userId);

      const sessionIds: string[] = [];
      for (let i = 0; i < deviceCount; i += 1) {
        const issued = issueSessionToken(clock.now());
        const id = randomUUID();
        await repo.createSession({
          id,
          userId,
          tokenHash: issued.tokenHash,
          expiresAt: issued.expiresAt,
          deviceLabel: `device-${i}`,
        });
        sessionIds.push(id);
      }
      return { userId, sessionIds };
    },

    /** The code that was actually texted. */
    sentCode(): string | undefined {
      return sms.lastTo(PHONE)?.body.match(/\b(\d{6})\b/)?.[1];
    },
  };
}

describe('PasswordService.forgot (AUTH-API-006)', () => {
  let ctx: ReturnType<typeof build>;
  beforeEach(() => {
    ctx = build();
  });

  it('sends a reset code to a registered number', async () => {
    await ctx.seedUser();
    const r = await ctx.service.forgot({ phone: PHONE });

    expect(r).toEqual({ status: 'ACCEPTED' });
    expect(ctx.sentCode()).toMatch(/^\d{6}$/);
  });

  it('GIVES THE SAME ANSWER FOR AN UNKNOWN NUMBER, and sends nothing', async () => {
    const unknown = await ctx.service.forgot({ phone: PHONE });
    expect(unknown).toEqual({ status: 'ACCEPTED' });
    expect(ctx.sms.all()).toHaveLength(0);

    const known = build();
    await known.seedUser();
    const r = await known.service.forgot({ phone: PHONE });

    // "Same response whether or not the number exists" is the frozen wording.
    expect(JSON.stringify(r)).toBe(JSON.stringify(unknown));
  });

  it('shares the OTP hourly cap, so it cannot be used to flood a number', async () => {
    await ctx.seedUser();
    for (let i = 0; i < 6; i += 1) {
      ctx.advance(OTP_RESEND_COOLDOWN_MS + 1_000);
      await ctx.service.forgot({ phone: PHONE });
    }
    // Otherwise this endpoint is a free SMS-flood aimed at whoever holds the
    // number - who may not even be a user.
    expect(ctx.sms.all().length).toBeLessThanOrEqual(OTP_RESEND_MAX_PER_WINDOW);
  });

  it('respects the 60-second cooldown', async () => {
    await ctx.seedUser();
    await ctx.service.forgot({ phone: PHONE });
    const after = ctx.sms.all().length;

    ctx.advance(OTP_RESEND_COOLDOWN_MS - 1_000);
    await ctx.service.forgot({ phone: PHONE });
    expect(ctx.sms.all().length).toBe(after);
  });

  it('rejects a malformed number as input', async () => {
    expect(await ctx.service.forgot({ phone: 'nonsense' })).toEqual({
      status: 'INVALID_INPUT',
      field: 'phone',
    });
  });

  it('never logs the number or the code', async () => {
    await ctx.seedUser();
    await ctx.service.forgot({ phone: PHONE });
    const code = ctx.sentCode() as string;
    for (const line of ctx.logs) {
      expect(line).not.toContain(code);
      expect(line).not.toContain(PHONE);
    }
  });
});

describe('PasswordService.reset (AUTH-API-007)', () => {
  let ctx: ReturnType<typeof build>;
  beforeEach(() => {
    ctx = build();
  });

  it('resets the password with a valid code', async () => {
    const { userId } = await ctx.seedUser(0);
    await ctx.service.forgot({ phone: PHONE });

    const r = await ctx.service.reset({
      phone: PHONE,
      code: ctx.sentCode() as string,
      newPassword: NEW_PASSWORD,
    });

    expect(r.status).toBe('RESET');
    expect(ctx.repo.users.get(userId)?.passwordHash).toBe(`h:${NEW_PASSWORD}`);
  });

  it('INVALIDATES EVERY SESSION (BR-035)', async () => {
    const { userId } = await ctx.seedUser(4);
    await ctx.service.forgot({ phone: PHONE });

    const r = await ctx.service.reset({
      phone: PHONE,
      code: ctx.sentCode() as string,
      newPassword: NEW_PASSWORD,
    });

    // Someone resetting because they fear another person has their password
    // must actually eject that person - from every device, with no exception
    // for the one doing the reset (which is unauthenticated anyway).
    expect(r).toEqual({ status: 'RESET', sessionsRevoked: 4 });
    expect(await ctx.repo.listLiveSessions(userId)).toHaveLength(0);
    expect(ctx.repo.revocations.at(-1)?.reason).toBe('PASSWORD_RESET');
  });

  it('consumes the code, so it cannot be replayed', async () => {
    await ctx.seedUser(0);
    await ctx.service.forgot({ phone: PHONE });
    const code = ctx.sentCode() as string;

    expect(
      (await ctx.service.reset({ phone: PHONE, code, newPassword: NEW_PASSWORD })).status,
    ).toBe('RESET');
    expect(
      await ctx.service.reset({ phone: PHONE, code, newPassword: 'synthetic-Another1' }),
    ).toEqual({ status: 'REJECTED' });
  });

  it('DOES NOT SPEND THE CODE WHEN THE NEW PASSWORD IS REJECTED', async () => {
    await ctx.seedUser(0);
    await ctx.service.forgot({ phone: PHONE });
    const code = ctx.sentCode() as string;

    const weak = await ctx.service.reset({ phone: PHONE, code, newPassword: 'short' });
    expect(weak.status).toBe('INVALID_INPUT');

    // Burning the one-time code on a policy failure would force another SMS -
    // and at three per hour, that can lock someone out of their own recovery.
    expect(
      (await ctx.service.reset({ phone: PHONE, code, newPassword: NEW_PASSWORD })).status,
    ).toBe('RESET');
  });

  it('refuses an expired code even though it is correct', async () => {
    await ctx.seedUser(0);
    await ctx.service.forgot({ phone: PHONE });
    const code = ctx.sentCode() as string;

    ctx.advance(OTP_TTL_MS + 1);
    expect(await ctx.service.reset({ phone: PHONE, code, newPassword: NEW_PASSWORD })).toEqual({
      status: 'REJECTED',
    });
  });

  it('locks out after the attempt cap and refuses the right code', async () => {
    await ctx.seedUser(0);
    await ctx.service.forgot({ phone: PHONE });
    const code = ctx.sentCode() as string;

    for (let i = 0; i < OTP_MAX_ATTEMPTS; i += 1) {
      await ctx.service.reset({ phone: PHONE, code: '000000', newPassword: NEW_PASSWORD });
    }

    expect(await ctx.service.reset({ phone: PHONE, code, newPassword: NEW_PASSWORD })).toEqual({
      status: 'REJECTED',
    });
  });

  it('leaves the old password working when the reset is rejected', async () => {
    const { userId } = await ctx.seedUser(0);
    await ctx.service.forgot({ phone: PHONE });

    await ctx.service.reset({ phone: PHONE, code: '000000', newPassword: NEW_PASSWORD });
    expect(ctx.repo.users.get(userId)?.passwordHash).toBe(`h:${OLD_PASSWORD}`);
  });

  it('gives ONE answer for wrong code, no challenge and unknown number', async () => {
    const answers: unknown[] = [];

    let c = build();
    await c.seedUser(0);
    await c.service.forgot({ phone: PHONE });
    answers.push(
      await c.service.reset({ phone: PHONE, code: '000000', newPassword: NEW_PASSWORD }),
    );

    c = build();
    await c.seedUser(0); // no forgot() call, so no challenge
    answers.push(
      await c.service.reset({ phone: PHONE, code: '123456', newPassword: NEW_PASSWORD }),
    );

    c = build(); // no account at all
    answers.push(
      await c.service.reset({ phone: PHONE, code: '123456', newPassword: NEW_PASSWORD }),
    );

    expect(new Set(answers.map((a) => JSON.stringify(a))).size).toBe(1);
    expect(answers[0]).toEqual({ status: 'REJECTED' });
  });

  it('does not accept a REGISTRATION code for a reset', async () => {
    const { userId } = await ctx.seedUser(0);
    await ctx.repo.replaceOtpChallenge({
      id: randomUUID(),
      identifierHash: ctx.identifierHash,
      purpose: 'REGISTRATION',
      codeHash: hashOtpCode('123456'),
      expiresAt: new Date(ctx.clock.now().getTime() + OTP_TTL_MS),
    });

    expect(
      await ctx.service.reset({ phone: PHONE, code: '123456', newPassword: NEW_PASSWORD }),
    ).toEqual({ status: 'REJECTED' });
    expect(ctx.repo.users.get(userId)?.passwordHash).toBe(`h:${OLD_PASSWORD}`);
  });

  it('validates input shape before anything else', async () => {
    expect(
      await ctx.service.reset({ phone: 'nope', code: '123456', newPassword: NEW_PASSWORD }),
    ).toEqual({ status: 'INVALID_INPUT', field: 'phone' });
    expect(
      await ctx.service.reset({ phone: PHONE, code: '12', newPassword: NEW_PASSWORD }),
    ).toEqual({ status: 'INVALID_INPUT', field: 'code' });
  });
});

describe('PasswordService.change (SET-FR-002)', () => {
  let ctx: ReturnType<typeof build>;
  beforeEach(() => {
    ctx = build();
  });

  it('changes the password when the current one is right', async () => {
    const { userId, sessionIds } = await ctx.seedUser(1);
    const r = await ctx.service.change({
      userId,
      currentPassword: OLD_PASSWORD,
      newPassword: NEW_PASSWORD,
      currentSessionId: sessionIds[0] as string,
    });

    expect(r.status).toBe('CHANGED');
    expect(ctx.repo.users.get(userId)?.passwordHash).toBe(`h:${NEW_PASSWORD}`);
  });

  it('REQUIRES THE CURRENT PASSWORD even though the caller is signed in', async () => {
    const { userId, sessionIds } = await ctx.seedUser(1);
    const r = await ctx.service.change({
      userId,
      currentPassword: 'synthetic-WrongOne1',
      newPassword: NEW_PASSWORD,
      currentSessionId: sessionIds[0] as string,
    });

    // A borrowed or stolen phone must not be enough to lock the owner out of
    // their own account.
    expect(r).toEqual({ status: 'WRONG_PASSWORD' });
    expect(ctx.repo.users.get(userId)?.passwordHash).toBe(`h:${OLD_PASSWORD}`);
  });

  it('signs out the OTHER devices but keeps this one', async () => {
    const { userId, sessionIds } = await ctx.seedUser(4);
    const keep = sessionIds[0] as string;

    const r = await ctx.service.change({
      userId,
      currentPassword: OLD_PASSWORD,
      newPassword: NEW_PASSWORD,
      currentSessionId: keep,
    });

    expect(r).toEqual({ status: 'CHANGED', sessionsRevoked: 3 });
    const live = await ctx.repo.listLiveSessions(userId);
    expect(live.map((s) => s.id)).toEqual([keep]);
    expect(ctx.repo.revocations.at(-1)?.reason).toBe('PASSWORD_CHANGE');
  });

  it('rejects a new password that fails policy, without changing anything', async () => {
    const { userId, sessionIds } = await ctx.seedUser(2);
    const r = await ctx.service.change({
      userId,
      currentPassword: OLD_PASSWORD,
      newPassword: 'weak',
      currentSessionId: sessionIds[0] as string,
    });

    expect(r).toEqual({ status: 'INVALID_INPUT', field: 'newPassword', reason: 'TOO_SHORT' });
    expect(ctx.repo.users.get(userId)?.passwordHash).toBe(`h:${OLD_PASSWORD}`);
    expect(await ctx.repo.listLiveSessions(userId)).toHaveLength(2);
  });

  it('treats a missing account as a wrong password, never as success', async () => {
    const r = await ctx.service.change({
      userId: randomUUID(),
      currentPassword: OLD_PASSWORD,
      newPassword: NEW_PASSWORD,
      currentSessionId: randomUUID(),
    });
    expect(r).toEqual({ status: 'WRONG_PASSWORD' });
  });

  it('never logs either password', async () => {
    const { userId, sessionIds } = await ctx.seedUser(1);
    await ctx.service.change({
      userId,
      currentPassword: OLD_PASSWORD,
      newPassword: NEW_PASSWORD,
      currentSessionId: sessionIds[0] as string,
    });
    for (const line of ctx.logs) {
      expect(line).not.toContain(OLD_PASSWORD);
      expect(line).not.toContain(NEW_PASSWORD);
    }
  });
});
