import { describe, it, expect } from 'vitest';
import {
  OTP_MAX_ATTEMPTS,
  checkOtpUsable,
  generateOtpCode,
  hashOtpCode,
  otpExpiryFrom,
  otpMatches,
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

describe('hashOtpCode / otpMatches', () => {
  it('stores a hash, never the code', () => {
    const h = hashOtpCode('012345');
    expect(h.length).toBe(32);
    expect(h.toString('utf8')).not.toContain('012345');
  });

  it('preserves leading zeros as significant', () => {
    expect(hashOtpCode('000123').equals(hashOtpCode('123'))).toBe(false);
  });

  it('matches only the exact code', () => {
    const stored = hashOtpCode('428913');
    expect(otpMatches('428913', stored)).toBe(true);
    expect(otpMatches('428914', stored)).toBe(false);
    expect(otpMatches('', stored)).toBe(false);
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
