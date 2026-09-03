/**
 * Password policy - SRS §12 via 09-authentication-authorization.md §44:
 * 8-64 characters, at least one letter and one digit.
 *
 * The upper bound is deliberate, not decorative: Argon2id hashing cost grows
 * with input, so an unbounded password field is a cheap denial-of-service
 * vector against a ~236 ms hash.
 */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 64;

export type PasswordRejection =
  'TOO_SHORT' | 'TOO_LONG' | 'NEEDS_LETTER' | 'NEEDS_DIGIT' | 'NOT_A_STRING';

/**
 * @returns null when acceptable, otherwise the first failed rule.
 *
 * The reason is returned so the REGISTRATION form can help the user. It is
 * never surfaced on login, where every failure must look identical (SEC-006).
 */
export function checkPassword(password: unknown): PasswordRejection | null {
  if (typeof password !== 'string') return 'NOT_A_STRING';
  // Count by code point: an emoji or Urdu grapheme should count as one
  // character, not as its UTF-16 surrogate pair.
  const length = [...password].length;
  if (length < PASSWORD_MIN_LENGTH) return 'TOO_SHORT';
  if (length > PASSWORD_MAX_LENGTH) return 'TOO_LONG';
  if (!/\p{L}/u.test(password)) return 'NEEDS_LETTER';
  if (!/\d/u.test(password)) return 'NEEDS_DIGIT';
  return null;
}

export function isPasswordAcceptable(password: unknown): boolean {
  return checkPassword(password) === null;
}
