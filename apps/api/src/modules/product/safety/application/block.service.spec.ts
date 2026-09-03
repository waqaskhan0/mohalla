import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { BlockService } from './block.service.js';
import type { BlockRepository, BlockRow } from '../repositories/block.repository.port.js';
import type { FollowRemoval } from '../ports/follow-removal.port.js';
import type { DatabaseService } from '../../../../database/database.service.js';
import type { StructuredLogger } from '../../../../common/logging/structured.logger.js';

/**
 * In-memory blocks, enforcing what the composite primary key enforces: one row
 * per (blocker, blocked) pair, and a repeat block is a no-op rather than a
 * second row.
 */
class InMemoryBlocks implements BlockRepository {
  readonly rows: BlockRow[] = [];
  now: () => Date = () => new Date();

  async isBlockedEitherWay(a: string, b: string): Promise<boolean> {
    return this.rows.some(
      (r) => (r.blockerId === a && r.blockedId === b) || (r.blockerId === b && r.blockedId === a),
    );
  }

  async create(blockerId: string, blockedId: string): Promise<boolean> {
    if (this.rows.some((r) => r.blockerId === blockerId && r.blockedId === blockedId)) {
      return false;
    }
    this.rows.push({ blockerId, blockedId, createdAt: this.now() });
    return true;
  }

  async remove(blockerId: string, blockedId: string): Promise<boolean> {
    const i = this.rows.findIndex((r) => r.blockerId === blockerId && r.blockedId === blockedId);
    if (i === -1) return false;
    this.rows.splice(i, 1);
    return true;
  }

  async listBlockedBy(blockerId: string, limit: number, before?: Date): Promise<BlockRow[]> {
    return this.rows
      .filter((r) => r.blockerId === blockerId)
      .filter((r) => before === undefined || r.createdAt < before)
      .sort((x, y) => y.createdAt.getTime() - x.createdAt.getTime())
      .slice(0, limit);
  }
}

function build() {
  const blocks = new InMemoryBlocks();
  const logs: string[] = [];

  // Records every removal, so the BR-024 assertions are about observable
  // behaviour rather than call order.
  const removals: [string, string][] = [];
  let followsToRemove = 0;
  const follows: FollowRemoval = {
    async removeBothDirections(a, b) {
      removals.push([a, b]);
      return followsToRemove;
    },
  };

  const db = {
    withTransaction: async <T>(fn: (c: never) => Promise<T>): Promise<T> => fn(undefined as never),
  } as unknown as DatabaseService;
  const logger = {
    log: (m: unknown) => logs.push(String(m)),
    warn: (m: unknown) => logs.push(String(m)),
    error: (m: unknown) => logs.push(String(m)),
  } as unknown as StructuredLogger;

  return {
    service: new BlockService(db, blocks, follows, logger),
    blocks,
    removals,
    logs,
    setFollowsToRemove: (n: number) => {
      followsToRemove = n;
    },
  };
}

describe('BlockService.block (SAFETY-FR-005, BR-024/025)', () => {
  let ctx: ReturnType<typeof build>;
  let a: string;
  let b: string;
  beforeEach(() => {
    ctx = build();
    a = randomUUID();
    b = randomUUID();
  });

  it('records the block', async () => {
    const r = await ctx.service.block(a, b);
    expect(r.status).toBe('BLOCKED');
    expect(await ctx.blocks.isBlockedEitherWay(a, b)).toBe(true);
  });

  it('REMOVES FOLLOWS IN BOTH DIRECTIONS (BR-024)', async () => {
    ctx.setFollowsToRemove(2);
    const r = await ctx.service.block(a, b);

    // A block that commits while the follow rows survive leaves the blocked
    // person's posts still arriving in the blocker's feed - the exact thing
    // they acted to stop, and they would have no reason to check.
    expect(r).toEqual({ status: 'BLOCKED', followsRemoved: 2 });
    expect(ctx.removals).toEqual([[a, b]]);
  });

  it('IS IDEMPOTENT — a second block still succeeds', async () => {
    await ctx.service.block(a, b);
    const again = await ctx.service.block(a, b);

    // A failure here would tell someone acting for their own safety that the
    // block had not taken effect.
    expect(again.status).toBe('BLOCKED');
    expect(ctx.blocks.rows).toHaveLength(1);
  });

  it('still runs the follow removal on a repeat block', async () => {
    await ctx.service.block(a, b);
    await ctx.service.block(a, b);
    // Cheap, and it repairs state if an earlier attempt was interrupted
    // between the two writes.
    expect(ctx.removals).toHaveLength(2);
  });

  it('refuses a self-block', async () => {
    expect(await ctx.service.block(a, a)).toEqual({ status: 'CANNOT_BLOCK_SELF' });
    expect(ctx.blocks.rows).toHaveLength(0);
  });

  it('DOES NOT CHECK WHETHER THE TARGET EXISTS', async () => {
    // Looking the target up would create a way to probe account existence
    // through the block endpoint - the one endpoint a frightened user most
    // needs to simply work.
    const nobody = randomUUID();
    expect((await ctx.service.block(a, nobody)).status).toBe('BLOCKED');
  });

  it('NEVER LOGS WHO BLOCKED WHOM', async () => {
    await ctx.service.block(a, b);
    for (const line of ctx.logs) {
      // A log line pairing a blocker with a blocked user is a record of who is
      // avoiding whom, which is the sensitive fact here.
      expect(line).not.toContain(a);
      expect(line).not.toContain(b);
    }
  });
});

describe('BlockService — the predicate is symmetric (BR-025)', () => {
  let ctx: ReturnType<typeof build>;
  let a: string;
  let b: string;
  beforeEach(() => {
    ctx = build();
    a = randomUUID();
    b = randomUUID();
  });

  it('ONE ROW HIDES BOTH DIRECTIONS', async () => {
    await ctx.service.block(a, b);

    // Unilateral in the row, mutual in effect. Asking the "wrong" way round
    // must give the same answer, or a caller can get it wrong.
    expect(await ctx.service.isBlockedEitherWay(a, b)).toBe(true);
    expect(await ctx.service.isBlockedEitherWay(b, a)).toBe(true);
  });

  it('reports no block between unrelated users', async () => {
    expect(await ctx.service.isBlockedEitherWay(a, b)).toBe(false);
  });

  it('never reports a person as blocking themselves', async () => {
    // Self-visibility must not be broken by an accidental self-block row.
    expect(await ctx.service.isBlockedEitherWay(a, a)).toBe(false);
  });

  it('leaves a third party unaffected', async () => {
    const c = randomUUID();
    await ctx.service.block(a, b);
    expect(await ctx.service.isBlockedEitherWay(a, c)).toBe(false);
    expect(await ctx.service.isBlockedEitherWay(b, c)).toBe(false);
  });
});

describe('BlockService.unblock (SAFETY-FR-006)', () => {
  let ctx: ReturnType<typeof build>;
  let a: string;
  let b: string;
  beforeEach(() => {
    ctx = build();
    a = randomUUID();
    b = randomUUID();
  });

  it('lifts the block', async () => {
    await ctx.service.block(a, b);
    await ctx.service.unblock(a, b);
    expect(await ctx.service.isBlockedEitherWay(a, b)).toBe(false);
  });

  it('succeeds when there was no block, disclosing nothing', async () => {
    // Reporting "you were not blocking them" would disclose the ABSENCE of a
    // block, which is the same class of information as its presence.
    expect(await ctx.service.unblock(a, b)).toEqual({ status: 'UNBLOCKED' });
  });

  it('DOES NOT LIFT THE OTHER PERSON’S BLOCK', async () => {
    // B blocked A. A "unblocking" B must not remove B's decision - and must
    // not reveal that it exists.
    await ctx.service.block(b, a);
    await ctx.service.unblock(a, b);

    expect(await ctx.service.isBlockedEitherWay(a, b)).toBe(true);
    expect(ctx.blocks.rows).toHaveLength(1);
  });

  it('DOES NOT RESTORE THE FOLLOWS THE BLOCK REMOVED', async () => {
    ctx.setFollowsToRemove(2);
    await ctx.service.block(a, b);
    const removalsAfterBlock = ctx.removals.length;

    await ctx.service.unblock(a, b);

    // Re-creating a relationship the user severed would put someone back in
    // their feed without being asked. If they want to follow again, they can.
    expect(ctx.removals).toHaveLength(removalsAfterBlock);
  });
});

describe('BlockService.listOwnBlocks', () => {
  it('lists only the caller’s own blocks, newest first', async () => {
    const ctx = build();
    const me = randomUUID();
    const someoneElse = randomUUID();

    let t = 0;
    ctx.blocks.now = () => new Date(1_700_000_000_000 + (t += 1000));

    const first = randomUUID();
    const second = randomUUID();
    await ctx.service.block(me, first);
    await ctx.service.block(me, second);
    await ctx.service.block(someoneElse, randomUUID());

    const mine = await ctx.service.listOwnBlocks(me);
    expect(mine.map((r) => r.blockedUserId)).toEqual([second, first]);
  });

  it('paginates by cursor', async () => {
    const ctx = build();
    const me = randomUUID();
    let t = 0;
    ctx.blocks.now = () => new Date(1_700_000_000_000 + (t += 1000));

    for (let i = 0; i < 5; i += 1) await ctx.service.block(me, randomUUID());

    const firstPage = await ctx.service.listOwnBlocks(me, 2);
    expect(firstPage).toHaveLength(2);

    const nextPage = await ctx.service.listOwnBlocks(me, 2, firstPage[1]?.createdAt);
    expect(nextPage).toHaveLength(2);
    expect(nextPage[0]?.blockedUserId).not.toBe(firstPage[0]?.blockedUserId);
  });
});
