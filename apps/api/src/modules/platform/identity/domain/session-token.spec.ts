import { describe, it, expect } from 'vitest';
import {
  MAX_ACTIVE_SESSIONS,
  hashSessionToken,
  isSessionLive,
  issueSessionToken,
  sessionTokenMatches,
  sessionsToEvict,
  type SessionRow,
} from './session-token.js';

const row = (id: string, ageMinutes: number, over: Partial<SessionRow> = {}): SessionRow => ({
  id,
  createdAt: new Date(Date.now() - ageMinutes * 60_000),
  expiresAt: new Date(Date.now() + 86_400_000),
  revokedAt: null,
  ...over,
});

describe('issueSessionToken', () => {
  it('returns a high-entropy token and stores only its hash', () => {
    const t = issueSessionToken();
    expect(t.token.length).toBeGreaterThanOrEqual(43); // 256 bits base64url
    expect(t.tokenHash.length).toBe(32);
    // The stored value must not contain the token.
    expect(t.tokenHash.toString('utf8')).not.toContain(t.token);
  });

  it('never repeats a token', () => {
    const tokens = new Set(Array.from({ length: 500 }, () => issueSessionToken().token));
    expect(tokens.size).toBe(500);
  });

  it('is verifiable only with the exact token', () => {
    const t = issueSessionToken();
    expect(sessionTokenMatches(t.token, t.tokenHash)).toBe(true);
    expect(sessionTokenMatches(`${t.token}x`, t.tokenHash)).toBe(false);
    expect(sessionTokenMatches('', t.tokenHash)).toBe(false);
  });

  it('hashes deterministically', () => {
    const t = issueSessionToken();
    expect(hashSessionToken(t.token).equals(t.tokenHash)).toBe(true);
  });
});

describe('isSessionLive', () => {
  it('is false once revoked - the basis of immediate revocation (SEC-005)', () => {
    expect(isSessionLive(row('a', 1, { revokedAt: new Date() }))).toBe(false);
  });

  it('is false once expired', () => {
    expect(isSessionLive(row('a', 1, { expiresAt: new Date(Date.now() - 1) }))).toBe(false);
  });

  it('is true for an unrevoked, unexpired session', () => {
    expect(isSessionLive(row('a', 1))).toBe(true);
  });
});

describe('sessionsToEvict (BR-007: five devices)', () => {
  it('evicts nothing below the cap', () => {
    const live = [row('a', 5), row('b', 4)];
    expect(sessionsToEvict(live)).toHaveLength(0);
  });

  it('evicts nothing when the new session exactly reaches the cap', () => {
    const live = Array.from({ length: MAX_ACTIVE_SESSIONS - 1 }, (_, i) => row(`s${i}`, i + 1));
    expect(sessionsToEvict(live)).toHaveLength(0);
  });

  it('evicts the OLDEST when a sixth device signs in', () => {
    const live = [row('newest', 1), row('oldest', 500), row('mid', 50), row('b', 20), row('c', 10)];
    const evicted = sessionsToEvict(live);
    expect(evicted).toHaveLength(1);
    expect(evicted[0]?.id).toBe('oldest');
  });

  it('evicts enough to stay within the cap when over by several', () => {
    const live = Array.from({ length: 9 }, (_, i) => row(`s${i}`, 100 - i));
    const evicted = sessionsToEvict(live);
    // 9 live + 1 new = 10; must drop to 5, so 5 evicted.
    expect(evicted).toHaveLength(5);
    expect(evicted[0]?.id).toBe('s0'); // the oldest first
  });

  it('does not mutate the caller array', () => {
    const live = [row('a', 3), row('b', 1), row('c', 2)];
    const before = live.map((s) => s.id);
    sessionsToEvict(live, 1);
    expect(live.map((s) => s.id)).toEqual(before);
  });
});
