import type { PoolClient } from 'pg';

/**
 * "This person just followed that person — promote any pending message request
 * between them."
 *
 * MSG-FR-005 A3: "Recipient later follows the sender → any pending request is
 * promoted to the inbox automatically."
 *
 * The reason is that following someone is an unambiguous statement that you
 * want to hear from them. Leaving their message in a request area afterwards
 * would be the system ignoring what the user just told it — and worse, quietly:
 * the request area is designed to be unobtrusive, so a message stranded there
 * is a message that never arrives.
 *
 * SAME TRANSACTION AS THE FOLLOW. A follow that commits while the promotion
 * fails leaves a user who has just followed someone still not seeing their
 * message, with nothing to indicate why.
 *
 * A DECLINED REQUEST IS NOT PROMOTED. A decline was a decision too, and a
 * follow does not silently reverse one — accepting is a separate act, and the
 * requirement asks only for PENDING.
 *
 * WHY A PORT. `messaging` asks `social-graph` on every send whether the
 * recipient follows the sender (BR-027), so messaging → social-graph is the
 * heavier edge and stays a plain import. This direction fires only when
 * somebody follows, so it is the one that inverts — the same trade recorded in
 * `safety/ports/follow-removal.port.ts`.
 */
export const REQUEST_PROMOTION = Symbol.for('mohalla.socialGraph.requestPromotion');

export interface RequestPromotion {
  /**
   * Promote a PENDING request held by `followerId` against `followeeId`.
   *
   * @returns true when a row was promoted. False is the ordinary case: most
   * follows have no message request behind them.
   */
  promotePendingRequest(
    followerId: string,
    followeeId: string,
    client: PoolClient,
  ): Promise<boolean>;
}
