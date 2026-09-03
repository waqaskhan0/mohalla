/**
 * THE BLOCK PREDICATE (BR-025 · SEC-019 · PRIV-013).
 *
 * `07-database-design.md` §165 is prescriptive about this:
 *
 *   > This predicate is implemented **once**, in a shared query fragment owned
 *   > by the `safety` module, and applied on every read path — feeds, search,
 *   > profile, post detail, comments, messaging, notifications and events.
 *
 * ONE implementation, and this is it. Not because duplication is untidy, but
 * because there are nine read paths and a block that leaks on any one of them
 * leaks entirely. Someone who blocked a neighbour to stop being contacted does
 * not care that eight surfaces respect it.
 *
 * TWO PROPERTIES THIS FILE EXISTS TO GUARANTEE.
 *
 * 1. SYMMETRY. The row is unilateral — one row says who blocked whom — but the
 *    effect is mutual. Every check tests both directions, so a caller cannot
 *    get it wrong by asking the wrong way round. Getting this wrong in one
 *    direction is the subtle failure: A blocks B, and A keeps seeing B's posts,
 *    which is exactly the contact A was trying to end.
 *
 * 2. SILENCE. A block is never disclosed. The predicate returns a boolean and
 *    the read paths turn it into the same neutral "not available" they use for
 *    deleted and never-existed content. There is deliberately no function here
 *    that answers "who blocked whom" for a non-admin caller.
 */

/**
 * SQL that is true when NO block exists between two users, in either direction.
 *
 * Written as a fragment rather than a function call so it can be composed into
 * a larger query and use the indexes — a per-row function call in a feed query
 * would be a correctness-preserving performance disaster.
 *
 * Takes the two parameter placeholders as arguments rather than hardcoding
 * `$1`/`$2`, because a caller composing this into a bigger query will have
 * other parameters and cannot control the numbering. Passing them explicitly
 * is what keeps this fragment usable everywhere instead of only first.
 *
 * @example
 *   `SELECT ... FROM posts p WHERE ${notBlockedSql('$1', 'p.author_id')}`
 */
export function notBlockedSql(viewerParam: string, otherColumn: string): string {
  return `NOT EXISTS (
    SELECT 1 FROM blocks
     WHERE (blocker_id = ${viewerParam} AND blocked_id = ${otherColumn})
        OR (blocker_id = ${otherColumn} AND blocked_id = ${viewerParam})
  )`;
}

/** The same predicate, positive: true when a block exists either way. */
export function blockedSql(viewerParam: string, otherColumn: string): string {
  return `EXISTS (
    SELECT 1 FROM blocks
     WHERE (blocker_id = ${viewerParam} AND blocked_id = ${otherColumn})
        OR (blocker_id = ${otherColumn} AND blocked_id = ${viewerParam})
  )`;
}

/**
 * Decide visibility from the facts, without a database.
 *
 * Pure, so the RULE can be tested exhaustively while the SQL is tested against
 * real PostgreSQL. The two must agree, and keeping the rule here means there is
 * something to compare the SQL against.
 */
export interface VisibilityFacts {
  /** Is the subject's account publicly visible at all (not banned/deleted)? */
  subjectIsPubliclyVisible: boolean;
  /** Is there a block between viewer and subject, in either direction? */
  blockedEitherWay: boolean;
  /** True when the viewer IS the subject — self is always visible to self. */
  isSelf: boolean;
}

export type Visibility = 'VISIBLE' | 'NOT_AVAILABLE';

/**
 * `NOT_AVAILABLE` collapses every reason.
 *
 * Banned, deleted, blocked and never-existed are one answer (UX-STATE-001,
 * BR-025). The order below matters only for cost, never for the result — the
 * result is deliberately the same either way, which is the point.
 */
export function decideVisibility(facts: VisibilityFacts): Visibility {
  // A person can always see themselves, including while suspended or pending
  // deletion. Otherwise a suspended user could not read their own profile to
  // find out why, and someone mid-deletion could not reach the restore option.
  if (facts.isSelf) return 'VISIBLE';
  if (!facts.subjectIsPubliclyVisible) return 'NOT_AVAILABLE';
  if (facts.blockedEitherWay) return 'NOT_AVAILABLE';
  return 'VISIBLE';
}
