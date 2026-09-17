import { describe, expect, it } from 'vitest';
import { checkSearchQuery, normalizeSearchQuery, stripControlCharacters } from './search-query.js';

const NUL = '\u0000';

/**
 * QA-007 — a NUL byte in the query produced a 503.
 *
 * Measured against the running API: `GET /search/people?q=%00a` returned
 * `503 SEARCH_UNAVAILABLE`, because the byte reached the driver and PostgreSQL
 * refused the statement with `invalid byte sequence for encoding "UTF8": 0x00`.
 *
 * Two things were wrong. A 503 tells the client the service is down and to try
 * again, when the request was malformed and will fail identically forever. And
 * SEARCH-FR-003 E3 reserves "we could not look" for a real outage precisely so
 * it means something — spending it on bad input devalues the one answer that
 * distinguishes an outage from an empty result.
 */
describe('QA-007 · control characters never reach the database', () => {
  it('strips a NUL byte', () => {
    expect(stripControlCharacters(`a${NUL}b`)).toBe('ab');
  });

  it('strips the C0 and C1 ranges and the Unicode separators', () => {
    const dirty = `a\u0001\u0002b\u007f\u2028`;
    expect(stripControlCharacters(dirty)).toBe('ab');
  });

  it('leaves ordinary whitespace alone, which normalisation still collapses', () => {
    expect(stripControlCharacters('a \t\n b')).toBe('a \t\n b');
    expect(normalizeSearchQuery('a \t\n b')).toBe('a b');
  });

  it('leaves Urdu and emoji untouched', () => {
    expect(stripControlCharacters('پانی کی مرمت')).toBe('پانی کی مرمت');
    expect(stripControlCharacters('🙂🎉')).toBe('🙂🎉');
  });

  it('THE DEFECT: a NUL plus one letter is now too short, not a database error', () => {
    // It used to count as two characters, pass the length rule, and be handed
    // to PostgreSQL. It is one usable character, and E2's answer is the right
    // one: refused, with the minimum stated.
    expect(checkSearchQuery(`${NUL}a`)).toBe('TOO_SHORT');
  });

  it('a query of nothing but control characters is too short', () => {
    expect(checkSearchQuery(`${NUL}`)).toBe('TOO_SHORT');
  });

  it('and a real query containing one still works, with the byte removed', () => {
    expect(checkSearchQuery(`ali${NUL}ya`)).toBeNull();
    expect(normalizeSearchQuery(`ali${NUL}ya`)).toBe('aliya');
  });

  it('the ordinary rules are unchanged', () => {
    expect(checkSearchQuery('a')).toBe('TOO_SHORT');
    expect(checkSearchQuery('ab')).toBeNull();
    expect(checkSearchQuery(123)).toBe('NOT_A_STRING');
    expect(checkSearchQuery('x'.repeat(201))).toBe('TOO_LONG');
  });
});
