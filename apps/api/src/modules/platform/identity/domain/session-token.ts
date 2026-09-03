import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Opaque server-backed session tokens (ADR-008).
 *
 * NOT a JWT, and the difference is the whole point: a JWT is valid until it
 * expires, so revoking one needs a deny-list that reintroduces the database
 * lookup a JWT was meant to avoid. An opaque token is a random string whose
 * authority lives entirely in a row, so a suspension, ban, password reset or
 * logout takes effect on the VERY NEXT REQUEST (SEC-005).
 *
 * Only the HASH is stored. A database dump therefore yields no usable session.
 */
export const SESSION_TOKEN_BYTES = 32; // 256 bits
export const MAX_ACTIVE_SESSIONS = 5; // BR-007 / SEC-005
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface IssuedSessionToken {
  /** Returned to the client ONCE. Never stored, never logged. */
  token: string;
  /** Stored in `sessions.token_hash`. */
  tokenHash: Buffer;
  expiresAt: Date;
}

export function issueSessionToken(now: Date = new Date()): IssuedSessionToken {
  const token = randomBytes(SESSION_TOKEN_BYTES).toString('base64url');
  return {
    token,
    tokenHash: hashSessionToken(token),
    expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
  };
}

/**
 * SHA-256 of the token.
 *
 * A fast hash is correct here: the token is 256 bits of CSPRNG output, so there
 * is no dictionary to attack and a slow hash would only add latency to every
 * authenticated request.
 */
export function hashSessionToken(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}

export function sessionTokenMatches(token: string, stored: Buffer): boolean {
  const computed = hashSessionToken(token);
  return computed.length === stored.length && timingSafeEqual(computed, stored);
}

export interface SessionRow {
  id: string;
  createdAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
}

export function isSessionLive(s: SessionRow, now: Date = new Date()): boolean {
  return s.revokedAt === null && s.expiresAt.getTime() > now.getTime();
}

/**
 * Which sessions must be evicted so that adding one more stays within the cap.
 *
 * Returns the OLDEST sessions beyond the limit (BR-007: the sixth device signs
 * the first out). Pure, so the eviction rule is testable without a database;
 * the caller performs the eviction and the insert in ONE transaction so a
 * concurrent login cannot produce a sixth live session.
 */
export function sessionsToEvict(live: SessionRow[], limit = MAX_ACTIVE_SESSIONS): SessionRow[] {
  const overBy = live.length + 1 - limit;
  if (overBy <= 0) return [];
  return [...live].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()).slice(0, overBy);
}
