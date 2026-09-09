import type { PoolClient } from 'pg';

/**
 * "Take this person's conversations out of the blocker's inbox — and put them
 * back on unblock."
 *
 * MSG-FR-003's acceptance criterion is both halves at once: "GIVEN A blocks B,
 * WHEN A opens the inbox, THEN B's conversation is not listed. AND WHEN A
 * unblocks B, THEN it reappears with its history intact."
 *
 * IT MUST BE IN THE SAME TRANSACTION AS THE BLOCK, for the reason BR-024's
 * follow removal is: a block that commits while the conversation is still
 * listed leaves the blocked person's thread sitting in the blocker's inbox with
 * an unread badge, which is the contact they just acted to end.
 *
 * ONLY THE BLOCKER'S SIDE MOVES. The blocked user's copy stays exactly where it
 * was, and that asymmetry is the requirement, not an oversight: MSG-FR-006 says
 * "the blocked user is never told a block exists; from their side the
 * conversation simply receives no replies". A thread that vanished from their
 * inbox would announce what happened.
 *
 * WHY A PORT. `safety` already owns the block predicate that `messaging` reads
 * on every path, so messaging → safety is the heavier and more legible edge and
 * stays a plain import. This is the lighter direction — it fires only when
 * somebody blocks — so it is the one that inverts. Exactly the reasoning in
 * `follow-removal.port.ts`, and for the same reason: `conversation_participants`
 * keeps a single writer, its owner.
 */
export const CONVERSATION_HIDING = Symbol.for('mohalla.safety.conversationHiding');

export interface ConversationHiding {
  /**
   * Hide (`hiddenAt` set) or restore (`null`) the blocker's side of every
   * conversation they share with this person, inside the caller's transaction.
   *
   * @returns how many participant rows changed. Zero is ordinary — most blocks
   * are between people who never had a conversation.
   */
  setHiddenForBlocker(
    blockerId: string,
    blockedId: string,
    hiddenAt: Date | null,
    client: PoolClient,
  ): Promise<number>;
}
