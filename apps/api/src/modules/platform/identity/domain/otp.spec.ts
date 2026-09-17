import { createHash } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import {
  OTP_MAX_ATTEMPTS,
  checkOtpUsable,
  generateOtpCode,
  OtpDigest,
  otpExpiryFrom,
} from './otp.js';

describe('generateOtpCode', () => {
  it('is always exactly six digits, leading zeros preserved', () => {
    for (let i = 0; i < 500; i += 1) {
      expect(generateOtpCode()).toMatch(/^\d{6}$/);
    }
  });

  it('spans the full 10^6 space rather than clustering', () => {
    const seen = new Set(Array.from({ length: 800 }, generateOtpCode));
    // Random collisions are expected; near-total collision would mean a broken
    // generator. 400 distinct out of 800 is a very loose sanity floor.
    expect(seen.size).toBeGreaterThan(400);
  });
});

describe('OtpDigest (QA-005)', () => {
  // TEST-ONLY KEY, and obviously so. It is not a credential: it protects
  // nothing, it is not the development default, and production refuses both
  // this and the development default.
  const KEY = 'test-only-otp-key-0123456789abcdefghij';
  const OTHER_KEY = 'test-only-otp-key-zyxwvutsrqponmlkjih';
  const digest = new OtpDigest(KEY);
  const challengeId = '11111111-1111-4111-8111-111111111111';
  const other = '22222222-2222-4222-8222-222222222222';

  it('refuses a key too short to be a key', () => {
    expect(() => new OtpDigest('')).toThrow(/at least 32/);
    expect(() => new OtpDigest('short')).toThrow(/at least 32/);
  });

  it('stores a digest, never the code', () => {
    const h = digest.digest({ challengeId, purpose: 'REGISTRATION', code: '012345' });
    expect(h.length).toBe(32);
    expect(h.toString('utf8')).not.toContain('012345');
    expect(h.toString('hex')).not.toContain('012345');
  });

  it('preserves leading zeros as significant', () => {
    const a = digest.digest({ challengeId, purpose: 'REGISTRATION', code: '000123' });
    const b = digest.digest({ challengeId, purpose: 'REGISTRATION', code: '123' });
    expect(a.equals(b)).toBe(false);
  });

  it('matches only the exact code', () => {
    const stored = digest.digest({ challengeId, purpose: 'REGISTRATION', code: '428913' });
    expect(digest.matches({ challengeId, purpose: 'REGISTRATION', code: '428913' }, stored)).toBe(
      true,
    );
    expect(digest.matches({ challengeId, purpose: 'REGISTRATION', code: '428914' }, stored)).toBe(
      false,
    );
    expect(digest.matches({ challengeId, purpose: 'REGISTRATION', code: '' }, stored)).toBe(false);
  });

  it('J. two challenges with the SAME code do not share a stored digest', () => {
    // The table must not reveal, by collision, that two people hold the same
    // six digits — and a digest lifted from one row must not verify against
    // another.
    const a = digest.digest({ challengeId, purpose: 'REGISTRATION', code: '428913' });
    const b = digest.digest({ challengeId: other, purpose: 'REGISTRATION', code: '428913' });
    expect(a.equals(b)).toBe(false);
    expect(digest.matches({ challengeId: other, purpose: 'REGISTRATION', code: '428913' }, a)).toBe(
      false,
    );
  });

  it('binds the purpose, so a registration digest cannot be replayed as a reset', () => {
    const reg = digest.digest({ challengeId, purpose: 'REGISTRATION', code: '428913' });
    expect(digest.matches({ challengeId, purpose: 'PASSWORD_RESET', code: '428913' }, reg)).toBe(
      false,
    );
  });

  it('H/I. the stored digest is NOT sha256(code), and the space is not enumerable without the key', () => {
    // THE ACTUAL DEFECT, PINNED. Stage 10's QA harness recovered live codes by
    // precomputing sha256 over all 10^6 six-digit strings and looking the
    // stored value up. Both halves are asserted: the digest is not that, and
    // the same enumeration performed WITHOUT the key finds nothing.
    const code = '428913';
    const stored = digest.digest({ challengeId, purpose: 'REGISTRATION', code });
    expect(stored.equals(createHash('sha256').update(code, 'utf8').digest())).toBe(false);

    // Enumerate a window around the real code the way the harness did, using
    // only what the database holds. A full 10^6 sweep is the same computation
    // 100000 times over; this is the same proof at a size a unit test can run.
    const target = stored.toString('hex');
    let recovered: string | null = null;
    for (let i = 428_900; i < 428_930; i += 1) {
      const guess = String(i).padStart(6, '0');
      if (createHash('sha256').update(guess, 'utf8').digest().toString('hex') === target) {
        recovered = guess;
      }
      // And with the challenge context but still no key, which is the most an
      // attacker holding only the row could try.
      const contextual = createHash('sha256')
        .update(`mohalla:otp:v2${challengeId}REGISTRATION${guess}`, 'utf8')
        .digest()
        .toString('hex');
      if (contextual === target) recovered = guess;
    }
    expect(recovered).toBeNull();

    // With the key, the same sweep finds it — so the test is proving the key's
    // absence is what stops it, not that the sweep was broken.
    let withKey: string | null = null;
    for (let i = 428_900; i < 428_930; i += 1) {
      const guess = String(i).padStart(6, '0');
      if (digest.matches({ challengeId, purpose: 'REGISTRATION', code: guess }, stored)) {
        withKey = guess;
      }
    }
    expect(withKey).toBe(code);
  });

  it('a different key does not verify the same code', () => {
    const stored = digest.digest({ challengeId, purpose: 'REGISTRATION', code: '428913' });
    const impostor = new OtpDigest(OTHER_KEY);
    expect(impostor.matches({ challengeId, purpose: 'REGISTRATION', code: '428913' }, stored)).toBe(
      false,
    );
  });

  it('encodes its parts unambiguously, so fields cannot be slid past each other', () => {
    // Plain concatenation would make ("ab","c") and ("a","bc") identical.
    const a = digest.digest({ challengeId: 'ab', purpose: 'REGISTRATION', code: '111111' });
    const b = digest.digest({ challengeId: 'a', purpose: 'REGISTRATION', code: 'b111111' });
    expect(a.equals(b)).toBe(false);
  });
});

describe('checkOtpUsable', () => {
  const future = new Date(Date.now() + 60_000);
  const past = new Date(Date.now() - 1);

  it('permits a fresh, unconsumed, under-cap challenge', () => {
    expect(checkOtpUsable({ attempts: 0, expiresAt: future, consumedAt: null })).toBeNull();
  });

  it('rejects an expired challenge', () => {
    expect(checkOtpUsable({ attempts: 0, expiresAt: past, consumedAt: null })).toBe('EXPIRED');
  });

  it('rejects a challenge that was already consumed (single use)', () => {
    expect(checkOtpUsable({ attempts: 0, expiresAt: future, consumedAt: new Date() })).toBe(
      'ALREADY_CONSUMED',
    );
  });

  it('rejects once the attempt cap is reached (SEC-003)', () => {
    expect(
      checkOtpUsable({ attempts: OTP_MAX_ATTEMPTS, expiresAt: future, consumedAt: null }),
    ).toBe('TOO_MANY_ATTEMPTS');
  });

  it('checks consumption and expiry BEFORE the attempt cap', () => {
    // A stale challenge must not burn an attempt.
    expect(checkOtpUsable({ attempts: OTP_MAX_ATTEMPTS, expiresAt: past, consumedAt: null })).toBe(
      'EXPIRED',
    );
  });

  it('expires exactly at the boundary, not after', () => {
    const now = new Date();
    expect(checkOtpUsable({ attempts: 0, expiresAt: now, consumedAt: null }, now)).toBe('EXPIRED');
  });
});

describe('otpExpiryFrom', () => {
  it('is ten minutes ahead', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    expect(otpExpiryFrom(now).toISOString()).toBe('2026-01-01T00:10:00.000Z');
  });
});
