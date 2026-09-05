/**
 * "Is there a block between these two people?"
 *
 * ADR-014's eligibility rule 2 — never notify across a block, in either
 * direction — needs the answer `safety` already owns. `07-database-design.md`
 * §165 is prescriptive that the block predicate is implemented ONCE and applied
 * on every read path, "notifications" named among them.
 *
 * WHY A PORT RATHER THAN AN IMPORT. `notifications` is PLATFORM tier and
 * `safety` is PRODUCT (`06-backend-modules.md` §3: Admin → Product → Platform,
 * never upward). A platform module importing a product one would invert the
 * dependency the guard exists to protect, and the guard checks imports rather
 * than injection precisely because NestJS would not stop it.
 *
 * So the port is declared here, its adapter lives in `safety`, and the two are
 * bound at the composition root. The predicate keeps one implementation, and
 * the tier direction holds.
 */
export const BLOCK_CHECK = Symbol.for('mohalla.notifications.blockCheck');

export interface BlockCheck {
  isBlockedEitherWay(userA: string, userB: string): Promise<boolean>;
}
