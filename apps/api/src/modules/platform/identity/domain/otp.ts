import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';

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

/** What a stored OTP digest is bound to. */
export interface OtpDigestInput {
  /** The challenge row's own id — different challenges, different digests. */
  challengeId: string;
  purpose: OtpPurpose;
  code: string;
}

/**
 * Length-prefixed encoding, so the parts cannot be slid past each other.
 *
 * Plain concatenation is ambiguous: `"a" + "bc"` and `"ab" + "c"` produce the
 * same bytes, and an attacker who controlled any field could therefore make two
 * different inputs hash identically. Every part is written as its byte length
 * followed by its bytes, which no other combination of parts can reproduce.
 */
function encode(parts: readonly string[]): Buffer {
  const chunks: Buffer[] = [];
  for (const part of parts) {
    const bytes = Buffer.from(part, 'utf8');
    const length = Buffer.alloc(4);
    length.writeUInt32BE(bytes.length, 0);
    chunks.push(length, bytes);
  }
  return Buffer.concat(chunks);
}

/** Domain separator. Bump the suffix if the construction ever changes again. */
const OTP_DIGEST_DOMAIN = 'mohalla:otp:v2';

/**
 * Keyed OTP digests (QA-005).
 *
 * WHAT WAS HERE BEFORE, AND WHY IT WAS REPLACED. This module used to store a
 * bare `sha256(code)` and argued — correctly — that a slow hash like Argon2id
 * buys nothing for a value that lives ten minutes, is single-use and is capped
 * at five attempts. That argument is sound and it answers a different question.
 * The question it does not answer is whether the digest should be KEYED, and
 * this codebase had already answered that, in the opposite direction, in
 * `identifier-hash.ts`:
 *
 *   > a phone number has only ~10^9 possibilities, so an unkeyed SHA-256 of the
 *   > whole space is enumerable in seconds. The pepper is what makes a stolen
 *   > database dump useless for recovering identifiers.
 *
 * A six-digit code has 10^6 possibilities — a THOUSAND TIMES SMALLER. Stage 10
 * demonstrated the consequence rather than asserting it: the QA harness read
 * live codes straight out of `otp_challenges` by enumerating the whole space,
 * every time, in well under a second. `PASSWORD_RESET` challenges live in that
 * same table, so recovering one is account takeover.
 *
 * The TTL, the attempt cap and the lockout are all real and none of them helps
 * against this: somebody who can read the row does not guess. They compute the
 * code offline and use it on the first attempt.
 *
 * SO THE DIGEST IS KEYED, and the key is NOT the identifier pepper. Separate
 * secrets for separate purposes: one leaking must not compromise the other, and
 * the identifier pepper is additionally the one value that can never be rotated
 * (rotating it silently unbans everyone), while this key can be.
 *
 * THE CHALLENGE ID AND PURPOSE ARE IN THE INPUT, not just the code. Two live
 * challenges that happen to draw the same six digits then store different
 * digests, so the table reveals nothing by collision — and a digest lifted from
 * a `REGISTRATION` row cannot be replayed against a `PASSWORD_RESET` one.
 */
export class OtpDigest {
  private readonly key: Buffer;

  constructor(key: string) {
    if (!key || key.length < 32) {
      // Refuse to start rather than quietly hash under a weak key. Same
      // posture as `IdentifierHasher`, for the same reason.
      throw new Error('OTP_HASH_KEY must be at least 32 characters');
    }
    this.key = Buffer.from(key, 'utf8');
  }

  digest(input: OtpDigestInput): Buffer {
    return createHmac('sha256', this.key)
      .update(encode([OTP_DIGEST_DOMAIN, input.challengeId, input.purpose, input.code]))
      .digest();
  }

  /** Constant-time comparison — never `===` on a secret. */
  matches(input: OtpDigestInput, stored: Buffer): boolean {
    const computed = this.digest(input);
    return computed.length === stored.length && timingSafeEqual(computed, stored);
  }
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
