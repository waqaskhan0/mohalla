import type { PoolClient } from 'pg';

/**
 * "Remove any follow between these two people, in both directions."
 *
 * BR-024: blocking removes existing follows both ways. That has to happen in
 * the SAME TRANSACTION as the block — a block that commits while the follow
 * rows survive leaves the blocked person's posts still arriving in the
 * blocker's feed, which is the precise thing they acted to stop.
 *
 * WHY A PORT, WHEN `06-backend-modules.md` §188 SAYS SAFETY DEPENDS ON
 * SOCIAL-GRAPH.
 *
 * The design lists `safety → social-graph` (for this) and
 * `social-graph → safety` (for the block predicate, §174). Both are real
 * needs, and together they are a cycle: NestJS would require `forwardRef` and
 * the import graph would stop being a statement about layering.
 *
 * So one edge is inverted. This one, because it is the lighter of the two: the
 * block predicate is consulted on EVERY read path in the product, while follow
 * removal happens only when somebody blocks. The heavier dependency stays a
 * plain import that is easy to read; the rarer one becomes a port.
 *
 * `follows` therefore stays owned by `social-graph` — safety never writes
 * another module's table, it asks the owner to.
 */
export const FOLLOW_REMOVAL = Symbol.for('mohalla.safety.followRemoval');

export interface FollowRemoval {
  /**
   * Delete follows in both directions, inside the caller's transaction.
   *
   * @returns how many rows were removed, for the audit trail. Zero is an
   * ordinary outcome — most blocks are between people who never followed
   * each other.
   */
  removeBothDirections(userA: string, userB: string, client: PoolClient): Promise<number>;
}
