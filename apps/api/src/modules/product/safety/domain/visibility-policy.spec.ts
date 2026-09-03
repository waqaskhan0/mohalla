import { describe, it, expect } from 'vitest';
import { blockedSql, decideVisibility, notBlockedSql } from './visibility-policy.js';

/**
 * The rule is tested exhaustively here; the SQL is tested against real
 * PostgreSQL by the integration checks. Both must agree, and having the rule
 * as a pure function is what gives the SQL something to be compared against.
 */

describe('decideVisibility', () => {
  const facts = (over: Partial<Parameters<typeof decideVisibility>[0]> = {}) => ({
    subjectIsPubliclyVisible: true,
    blockedEitherWay: false,
    isSelf: false,
    ...over,
  });

  it('shows a visible, unblocked profile', () => {
    expect(decideVisibility(facts())).toBe('VISIBLE');
  });

  it('hides a subject that is not publicly visible', () => {
    expect(decideVisibility(facts({ subjectIsPubliclyVisible: false }))).toBe('NOT_AVAILABLE');
  });

  it('hides across a block', () => {
    expect(decideVisibility(facts({ blockedEitherWay: true }))).toBe('NOT_AVAILABLE');
  });

  it('ALWAYS SHOWS A PERSON THEMSELVES, whatever their state', () => {
    // Otherwise a suspended user cannot read their own profile to find out
    // why, and someone mid-deletion cannot reach the restore option.
    expect(decideVisibility(facts({ isSelf: true, subjectIsPubliclyVisible: false }))).toBe(
      'VISIBLE',
    );
    expect(decideVisibility(facts({ isSelf: true, blockedEitherWay: true }))).toBe('VISIBLE');
  });

  it('gives the SAME answer for every hiding reason', () => {
    // UX-STATE-001 / BR-025: banned, deleted, blocked and never-existed are
    // one neutral state, so no combination may be distinguishable.
    const answers = [
      decideVisibility(facts({ subjectIsPubliclyVisible: false })),
      decideVisibility(facts({ blockedEitherWay: true })),
      decideVisibility(facts({ subjectIsPubliclyVisible: false, blockedEitherWay: true })),
    ];
    expect(new Set(answers).size).toBe(1);
    expect(answers[0]).toBe('NOT_AVAILABLE');
  });

  it('covers every combination without a gap', () => {
    for (const isSelf of [true, false]) {
      for (const subjectIsPubliclyVisible of [true, false]) {
        for (const blockedEitherWay of [true, false]) {
          const result = decideVisibility({ isSelf, subjectIsPubliclyVisible, blockedEitherWay });
          const expected =
            isSelf || (subjectIsPubliclyVisible && !blockedEitherWay) ? 'VISIBLE' : 'NOT_AVAILABLE';
          expect(
            result,
            JSON.stringify({ isSelf, subjectIsPubliclyVisible, blockedEitherWay }),
          ).toBe(expected);
        }
      }
    }
  });
});

describe('the shared SQL fragment (§165)', () => {
  it('TESTS BOTH DIRECTIONS', () => {
    // The row is unilateral, the effect is mutual. A fragment that checked one
    // direction would let A block B and keep seeing B's posts - the exact
    // contact A acted to end.
    const sql = notBlockedSql('$1', 'p.author_id');
    expect(sql).toContain('blocker_id = $1 AND blocked_id = p.author_id');
    expect(sql).toContain('blocker_id = p.author_id AND blocked_id = $1');
  });

  it('is composable with caller-chosen parameter numbers', () => {
    // A caller composing this into a larger query has its own parameters and
    // cannot control the numbering, so hardcoding $1/$2 would make the
    // fragment usable only first.
    const sql = notBlockedSql('$4', 'c.author_id');
    expect(sql).toContain('$4');
    expect(sql).not.toContain('$1');
  });

  it('offers the positive form with identical semantics', () => {
    const positive = blockedSql('$1', '$2');
    const negative = notBlockedSql('$1', '$2');
    expect(positive.startsWith('EXISTS')).toBe(true);
    expect(negative.startsWith('NOT EXISTS')).toBe(true);
    // Same body, so the two cannot drift apart.
    expect(positive.replace('EXISTS', '')).toBe(negative.replace('NOT EXISTS', ''));
  });

  it('queries only the blocks table, so it can be indexed', () => {
    // A per-row function call would be correct and unusably slow in a feed.
    const sql = notBlockedSql('$1', '$2');
    expect(sql).toContain('FROM blocks');
    expect(sql).not.toMatch(/JOIN/i);
  });
});
