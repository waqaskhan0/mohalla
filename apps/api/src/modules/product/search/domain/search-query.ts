/**
 * Query validation (SEARCH-FR-001/003 · BR-042).
 *
 * SEARCH-FR-003 E2 is explicit: "Query under 2 characters → search not
 * executed, minimum stated." Not "returns nothing" — refused, with the minimum
 * said out loud, so the user knows why rather than concluding the platform is
 * empty.
 *
 * That distinction matters more than it looks. E3 makes the same point about a
 * different failure: a search service outage "must not present as a zero-results
 * state, which would mislead the user into thinking the content does not
 * exist". On a civic platform, "nobody has posted about this" and "we could not
 * look" lead to very different actions.
 */

export const SEARCH_QUERY_MIN_LENGTH = 2;
export const SEARCH_QUERY_MAX_LENGTH = 200;

/**
 * The shortest normalised key worth matching on — EMPTY only.
 *
 * The first version required two characters, on the assumption that a
 * one-character key would match almost anything. MEASURED AGAINST REAL DATA,
 * that assumption was wrong twice over:
 *
 *   - "ali" reduces to "l" and matched 0 of 54 profiles. `word_similarity`
 *     compares against WORD-length extents, so a one-character key only hits a
 *     word that is itself essentially that character — it is precise, not
 *     loose.
 *   - "ayesha" reduces to "1" (the marker for "sh"), and the guard was
 *     therefore skipping the cross-script path for exactly the case it was
 *     added to support. Every one of its 12 matches was a profile genuinely
 *     named عائشہ.
 *
 * So the real guard is the QUERY length, which is already two characters
 * (SEARCH-FR-003 E2), and this only skips a key that normalised away to
 * nothing — a query of pure vowels or punctuation, where the raw-text path
 * still answers.
 */
export const SEARCH_KEY_MIN_LENGTH = 1;

export type SearchQueryRejection = 'NOT_A_STRING' | 'TOO_SHORT' | 'TOO_LONG';

/**
 * Remove characters no keyboard produces and PostgreSQL will not store.
 *
 * QA-007. A NUL byte in the query reached the driver and Postgres rejected the
 * whole statement — `invalid byte sequence for encoding "UTF8": 0x00` — which
 * the service turned into a 503 `SEARCH_UNAVAILABLE`. Two things were wrong
 * with that: a 503 tells the client the service is down and to retry, when the
 * request was simply malformed and will fail identically forever; and the
 * requirement E3 above reserves the "we could not look" answer for a genuine
 * outage, so spending it on bad input devalues it.
 *
 * Stripped rather than rejected outright, because that is what the surrounding
 * code already does with whitespace, and because the remaining text is usually
 * a perfectly good search. If nothing usable is left, the existing length rule
 * refuses it with the minimum stated — which is E2's answer, and the right one.
 *
 * C0 and C1 control characters plus the Unicode line and paragraph separators.
 * Ordinary spacing and every script's letters are untouched.
 */
export function stripControlCharacters(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u2028\u2029]/g, '');
}

export function checkSearchQuery(query: unknown): SearchQueryRejection | null {
  if (typeof query !== 'string') return 'NOT_A_STRING';

  // Counted AFTER stripping, so `a` is one character rather than two and
  // is refused as too short instead of being handed to the database.
  const trimmed = stripControlCharacters(query).trim();
  // Counted in code points rather than graphemes: two Urdu characters is two
  // characters to the person typing, and the bound is about refusing a
  // whole-corpus scan rather than about fairness between scripts.
  const length = [...trimmed].length;

  if (length < SEARCH_QUERY_MIN_LENGTH) return 'TOO_SHORT';
  if (length > SEARCH_QUERY_MAX_LENGTH) return 'TOO_LONG';
  return null;
}

export function normalizeSearchQuery(query: string): string {
  return stripControlCharacters(query).trim().replace(/\s+/g, ' ');
}

/**
 * How results are ordered.
 *
 * SEARCH-FR-002: "ranked by relevance then recency". Both, in that order —
 * relevance alone would surface a five-year-old post above today's, and
 * recency alone would make search a feed. SEARCH-FR-004 adds a third rule for
 * events, that upcoming ones outrank past ones, which belongs with EPIC-10.
 */
export type SearchOrdering = 'RELEVANCE_THEN_RECENCY';
