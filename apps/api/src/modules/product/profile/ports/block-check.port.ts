import type { PoolClient } from 'pg';

/**
 * "Is there a block between these two people, in either direction?"
 *
 * BR-025 · PROFILE-FR-005: a blocked relationship hides the profile in BOTH
 * directions. If A blocks B, then B cannot see A *and* A cannot see B — the
 * block is unilateral in action and mutual in effect, and it is never disclosed
 * as a block.
 *
 * WHY THIS IS A PORT HERE RATHER THAN AN IMPORT.
 *
 * Blocks are owned by `social-graph` (EPIC-05), which is not yet built. The
 * read path needs the predicate *now*, and there are only two honest options:
 * thread it through as a port and supply a real adapter later, or write the
 * read path without it and remember to come back.
 *
 * The second is how a privacy rule gets forgotten. It would also mean the block
 * check arrives as a change to every read path rather than as one provider
 * binding — and a change to every read path is exactly where one gets missed.
 *
 * Until EPIC-05 supplies the real adapter, `NoBlocksYet` answers "no block",
 * which is correct in the only sense available: no block can exist while no
 * block can be created. It is deliberately NOT a silent default — it is a named
 * class whose whole purpose is to be replaced, and a test asserts the read path
 * consults this port at all, so swapping in the real one cannot be a no-op.
 */
export const BLOCK_CHECK = Symbol.for('mohalla.profile.blockCheck');

export interface BlockCheck {
  /**
   * True when a block exists between the two users in EITHER direction.
   *
   * Symmetric by contract, so no caller has to remember which way round to ask
   * — asking one way and not the other is precisely the mistake BR-025's
   * both-directions rule exists to prevent.
   */
  isBlockedEitherWay(userA: string, userB: string, client?: PoolClient): Promise<boolean>;
}

/**
 * The stand-in until EPIC-05 owns blocks.
 *
 * Named for what it is, so nobody reads it as a considered decision that there
 * are no blocks in the product.
 */
export class NoBlocksYet implements BlockCheck {
  async isBlockedEitherWay(): Promise<boolean> {
    // No blocks can exist because no block can be created yet. This becomes
    // wrong the moment EPIC-05 lands, which is why the binding is one line in
    // the module rather than a condition scattered through the read paths.
    return false;
  }
}
