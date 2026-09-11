import type { PoolClient } from 'pg';

export const BLOCK_REPOSITORY = Symbol.for('mohalla.safety.blockRepository');

export interface BlockRow {
  blockerId: string;
  blockedId: string;
  createdAt: Date;
}

export interface BlockRepository {
  /**
   * Is there a block between these two, in EITHER direction?
   *
   * The one question every read path asks. Symmetric by contract, so no caller
   * can get the direction wrong.
   */
  isBlockedEitherWay(userA: string, userB: string, client?: PoolClient): Promise<boolean>;

  /**
   * Every user id with a block between them and `userId`, in either direction.
   *
   * THE SET RATHER THAN A PREDICATE PER PAIR, because the callers that need
   * this are filtering a PAGE. `isBlockedEitherWay` asked twenty times for a
   * page of twenty notifications is the per-row call `visibility-policy.ts`
   * warns about; one bounded query and a SQL exclusion is the same answer
   * without it.
   */
  blockCounterparts(userId: string, client?: PoolClient): Promise<string[]>;

  /**
   * Create the block.
   *
   * @returns false when the block already existed. Idempotent, because a
   * double-tap on a Block button must not be an error — the user's intent is
   * satisfied either way, and showing them a failure would suggest the block
   * did not take effect.
   */
  create(blockerId: string, blockedId: string, client: PoolClient): Promise<boolean>;

  /** @returns false when no block existed. Idempotent, for the same reason. */
  remove(blockerId: string, blockedId: string, client: PoolClient): Promise<boolean>;

  /**
   * Everyone this user has blocked, newest first.
   *
   * Only ever the caller's OWN list (SAFETY-FR-006 manage blocks). There is
   * deliberately no method for "who has blocked this user" — that question has
   * no legitimate non-admin caller, and providing it would make disclosure a
   * matter of remembering not to call it.
   */
  listBlockedBy(
    blockerId: string,
    limit: number,
    before?: Date,
    client?: PoolClient,
  ): Promise<BlockRow[]>;
}
