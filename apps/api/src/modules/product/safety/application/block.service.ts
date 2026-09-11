import { Inject, Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { DatabaseService } from '../../../../database/database.service.js';
import { StructuredLogger } from '../../../../common/logging/structured.logger.js';
import { BLOCK_REPOSITORY, type BlockRepository } from '../repositories/block.repository.port.js';
import { FOLLOW_REMOVAL, type FollowRemoval } from '../ports/follow-removal.port.js';
import { CONVERSATION_HIDING, type ConversationHiding } from '../ports/conversation-hiding.port.js';

export type BlockResult =
  { status: 'BLOCKED'; followsRemoved: number } | { status: 'CANNOT_BLOCK_SELF' };

export type UnblockResult = { status: 'UNBLOCKED' };

/**
 * Blocking (SAFETY-FR-005 · BR-024/025 · SEC-019 · PRIV-013).
 *
 * THREE RULES, AND EACH ONE IS A THING THAT COULD GO WRONG QUIETLY.
 *
 * 1. THE BLOCK AND THE FOLLOW REMOVAL ARE ONE TRANSACTION (BR-024). A block
 *    that commits while the follow rows survive leaves the blocked person's
 *    posts still arriving in the blocker's feed — the precise thing they acted
 *    to stop, and they would have no reason to check.
 *
 * 2. IT IS IDEMPOTENT. Blocking someone already blocked succeeds. A person
 *    tapping Block twice, or on a flaky connection, must not be shown a
 *    failure — a failure implies the block did not take, which is frightening
 *    in exactly the situation where someone is blocking for safety.
 *
 * 3. IT IS NEVER DISCLOSED. Nothing here tells the blocked user anything, and
 *    no notification is produced. The blocked user's experience is that the
 *    other person's content is simply "not available", identical to deleted or
 *    never-existed content. There is no method on this service that answers
 *    "who has blocked me".
 *
 * UNBLOCKING DOES NOT RESTORE FOLLOWS. Removing them was a deliberate act with
 * a safety purpose; silently re-creating a follow the user severed would put a
 * person back in their feed without being asked. If they want to follow again,
 * they can.
 */
@Injectable()
export class BlockService {
  constructor(
    private readonly db: DatabaseService,
    @Inject(BLOCK_REPOSITORY) private readonly blocks: BlockRepository,
    @Inject(FOLLOW_REMOVAL) private readonly follows: FollowRemoval,
    @Inject(CONVERSATION_HIDING) private readonly conversations: ConversationHiding,
    private readonly logger: StructuredLogger,
  ) {}

  /**
   * Block someone.
   *
   * Deliberately does NOT check whether the target exists or is visible. A
   * block on a banned or deleted account is harmless, and looking the target up
   * first would create a way to probe account existence through the block
   * endpoint — the one endpoint a frightened user most needs to just work.
   */
  async block(blockerId: string, blockedId: string): Promise<BlockResult> {
    if (blockerId === blockedId) return { status: 'CANNOT_BLOCK_SELF' };

    return this.db.withTransaction(async (client) => {
      const created = await this.blocks.create(blockerId, blockedId, client);

      // Run the removal even when the block already existed. It is cheap, and
      // it repairs the state if an earlier attempt was interrupted between the
      // two writes on an older version of this code.
      const followsRemoved = await this.follows.removeBothDirections(blockerId, blockedId, client);

      // Same transaction, same reason as the follow removal (MSG-FR-003,
      // EDGE-019). A block that commits while the conversation is still listed
      // leaves the blocked person's thread in the blocker's inbox with an
      // unread badge - the contact they just acted to end.
      //
      // The BLOCKER's side only. The blocked user's copy is untouched, because
      // a thread vanishing from their inbox would announce the block that
      // BR-025 says they are never told about.
      const conversationsHidden = await this.conversations.setHiddenForBlocker(
        blockerId,
        blockedId,
        this.now(),
        client,
      );

      this.log('user_blocked', { created, followsRemoved, conversationsHidden });
      return { status: 'BLOCKED', followsRemoved } as const;
    });
  }

  /**
   * Unblock.
   *
   * Always reports success, including when no block existed. The caller asked
   * for a state — "I am not blocking this person" — and that state is now true.
   * Reporting "you were not blocking them" would also disclose the absence of a
   * block, which is the same class of information as its presence.
   */
  async unblock(blockerId: string, blockedId: string): Promise<UnblockResult> {
    await this.db.withTransaction(async (client) => {
      await this.blocks.remove(blockerId, blockedId, client);

      // MSG-FR-003's second half: "WHEN A unblocks B, THEN it reappears with
      // its history intact." Clearing one timestamp is the whole restoration -
      // nothing was deleted, so there is nothing to rebuild. That is why the
      // hide is a column rather than a delete.
      await this.conversations.setHiddenForBlocker(blockerId, blockedId, null, client);
    });
    this.log('user_unblocked', {});
    return { status: 'UNBLOCKED' };
  }

  /**
   * The shared predicate, for other modules.
   *
   * This is what `profile`, `social-graph` and every later read path consult.
   * One implementation (§165), so a block cannot be respected on eight surfaces
   * and leak on the ninth.
   */
  async isBlockedEitherWay(userA: string, userB: string, client?: PoolClient): Promise<boolean> {
    if (userA === userB) return false;
    return this.blocks.isBlockedEitherWay(userA, userB, client);
  }

  /**
   * Everyone this user has a block with, either way.
   *
   * For read paths that filter a PAGE rather than a pair. See the repository
   * port for why that distinction earns its own method.
   */
  async blockCounterparts(userId: string, client?: PoolClient): Promise<string[]> {
    return this.blocks.blockCounterparts(userId, client);
  }

  /** The caller's own block list (SAFETY-FR-006). Never anyone else's. */
  async listOwnBlocks(
    blockerId: string,
    limit = 20,
    before?: Date,
  ): Promise<{ blockedUserId: string; createdAt: Date }[]> {
    const rows = await this.blocks.listBlockedBy(blockerId, limit, before);
    return rows.map((r) => ({ blockedUserId: r.blockedId, createdAt: r.createdAt }));
  }

  /**
   * The instant a hide takes effect.
   *
   * `hidden_at` is a marker, not a deadline: nothing computes an interval from
   * it, and nothing expires. So this reads the wall clock rather than taking a
   * dependency on `Clock`, which exists for rules that ARE statements about
   * time and would otherwise be untestable without waiting.
   */
  private now(): Date {
    return new Date();
  }

  private log(event: string, extra: Record<string, unknown>): void {
    // No user ids: a log line pairing a blocker with a blocked user is a record
    // of who is avoiding whom, which is exactly the sensitive fact here. The
    // audit log carries what moderation legitimately needs, under its own
    // access controls.
    this.logger.log(JSON.stringify({ event, ...extra }), 'safety');
  }
}
