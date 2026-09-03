import { createHash, randomInt, timingSafeEqual } from 'node:crypto';

/**
 * One-time passcode rules (SEC-003).
 *
 * The code is six digits because it is typed by a person on a phone, which caps
 * entropy at 10^6 - so the security comes from the SHORT LIFETIME and the HARD
 * ATTEMPT CAP, not from the code itself. Both are enforced here and again by
 * database constraints.
 */
export const OTP_LENGTH = 6;
export const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
export const OTP_MAX_ATTEMPTS = 5;

/**
 * What happens once those five attempts are gone (SEC-003 §52).
 *
 * Without a lockout the attempt cap is decorative: exhaust five guesses, ask
 * for a new code, and the counter is back at zero. That is unlimited guessing
 * with extra steps, and every round costs the victim an SMS. The lockout is
 * what makes the cap mean something.
 */
export const OTP_LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes

/** Resend limits: no faster than this, and no more than 3 in the window. */
export const OTP_RESEND_COOLDOWN_MS = 60 * 1000; // 60 seconds
export const OTP_RESEND_WINDOW_MS = 60 * 60 * 1000; // 1 hour
export const OTP_RESEND_MAX_PER_WINDOW = 3;

export type OtpPurpose = 'REGISTRATION' | 'PASSWORD_RESET';

/**
 * Cryptographically random six-digit code.
 *
 * `randomInt` (CSPRNG), never `Math.random`. Leading zeros are preserved by
 * padding, so `000123` is a valid code and the space really is 10^6.
 */
export function generateOtpCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(OTP_LENGTH, '0');
}

/**
 * Hash an OTP for storage.
 *
 * A plain SHA-256 is correct here, unlike for passwords: the code lives for ten
 * minutes, is single-use, and is capped at five attempts, so the slow-hash
 * property Argon2id provides buys nothing while costing latency on every
 * verification. What matters is that the stored value is not the code itself.
 */
export function hashOtpCode(code: string): Buffer {
  return createHash('sha256').update(code, 'utf8').digest();
}

/** Constant-time comparison - never `===` on a secret. */
export function otpMatches(code: string, stored: Buffer): boolean {
  const computed = hashOtpCode(code);
  return computed.length === stored.length && timingSafeEqual(computed, stored);
}

export interface OtpChallengeState {
  attempts: number;
  expiresAt: Date;
  consumedAt: Date | null;
}

export type OtpRejection = 'EXPIRED' | 'ALREADY_CONSUMED' | 'TOO_MANY_ATTEMPTS' | 'INCORRECT';

/**
 * Decide whether a challenge may be attempted at all, before comparing codes.
 *
 * Ordering matters: expiry and consumption are checked BEFORE the attempt cap
 * so that a stale challenge reports honestly to the service layer rather than
 * burning an attempt. The service still returns one neutral response outward.
 */
export function checkOtpUsable(
  state: OtpChallengeState,
  now: Date = new Date(),
): OtpRejection | null {
  if (state.consumedAt !== null) return 'ALREADY_CONSUMED';
  if (state.expiresAt.getTime() <= now.getTime()) return 'EXPIRED';
  if (state.attempts >= OTP_MAX_ATTEMPTS) return 'TOO_MANY_ATTEMPTS';
  return null;
}

export function otpExpiryFrom(now: Date = new Date()): Date {
  return new Date(now.getTime() + OTP_TTL_MS);
}

export interface OtpThrottleInputs {
  lastIssuedAt: Date | null;
  issuedLastHour: number;
  lockedUntil: Date | null;
}

export type OtpResendRefusal = 'LOCKED_OUT' | 'COOLDOWN' | 'HOURLY_CAP';

/**
 * May a new code be issued right now?
 *
 * Order is deliberate. The lockout is checked first because it is the security
 * limit - the other two are courtesy limits protecting the user's inbox and
 * the SMS bill, and neither should be able to mask an active lockout.
 */
export function checkOtpResendAllowed(
  state: OtpThrottleInputs,
  now: Date = new Date(),
): OtpResendRefusal | null {
  if (state.lockedUntil !== null && state.lockedUntil.getTime() > now.getTime()) {
    return 'LOCKED_OUT';
  }
  if (
    state.lastIssuedAt !== null &&
    now.getTime() - state.lastIssuedAt.getTime() < OTP_RESEND_COOLDOWN_MS
  ) {
    return 'COOLDOWN';
  }
  if (state.issuedLastHour >= OTP_RESEND_MAX_PER_WINDOW) return 'HOURLY_CAP';
  return null;
}
