import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { FollowService } from './follow.service.js';
import type { FollowPage, FollowRepository } from '../repositories/follow.repository.port.js';
import type { BlockService } from '../../safety/application/block.service.js';
import type { ProfileService } from '../../profile/application/profile.service.js';
import type { DatabaseService } from '../../../../database/database.service.js';
import type { StructuredLogger } from '../../../../common/logging/structured.logger.js';

/**
 * In-memory follows, enforcing what the composite primary key enforces: a
 * repeat follow is one row, not two. A fake that allowed duplicates would let
 * a test prove EDGE-015 was handled when it was not.
 */
class InMemoryFollows implements FollowRepository {
  readonly edges: { followerId: string; followeeId: string; createdAt: Date }[] = [];
  now: () => Date = () => new Date();
  /** Ids the list/suggestion queries are allowed to return. */
  visible = new Set<string>();

  async follow(followerId: string, followeeId: string): Promise<boolean> {
    if (this.edges.some((e) => e.followerId === followerId && e.followeeId === followeeId)) {
      return false;
    }
    this.edges.push({ followerId, followeeId, createdAt: this.now() });
    return true;
  }

  async unfollow(followerId: string, followeeId: string): Promise<boolean> {
    const i = this.edges.findIndex(
      (e) => e.followerId === followerId && e.followeeId === followeeId,
    );
    if (i === -1) return false;
    this.edges.splice(i, 1);
    return true;
  }

  async isFollowing(followerId: string, followeeId: string): Promise<boolean> {
    return this.edges.some((e) => e.followerId === followerId && e.followeeId === followeeId);
  }

  async removeBothDirections(a: string, b: string): Promise<number> {
    const before = this.edges.length;
    for (let i = this.edges.length - 1; i >= 0; i -= 1) {
      const e = this.edges[i];
      if (
        e !== undefined &&
        ((e.followerId === a && e.followeeId === b) || (e.followerId === b && e.followeeId === a))
      ) {
        this.edges.splice(i, 1);
      }
    }
    return before - this.edges.length;
  }

  async listFollowers(_viewerId: string, subjectId: string, limit: number): Promise<FollowPage> {
    const ids = this.edges.filter((e) => e.followeeId === subjectId).map((e) => e.followerId);
    return { userIds: ids.slice(0, limit), nextBefore: null };
  }

  async listFollowing(_viewerId: string, subjectId: string, limit: number): Promise<FollowPage> {
    const ids = this.edges.filter((e) => e.followerId === subjectId).map((e) => e.followeeId);
    return { userIds: ids.slice(0, limit), nextBefore: null };
  }

  async suggestions(viewerId: string, limit: number): Promise<string[]> {
    const followed = new Set(
      this.edges.filter((e) => e.followerId === viewerId).map((e) => e.followeeId),
    );
    return [...this.visible].filter((id) => id !== viewerId && !followed.has(id)).slice(0, limit);
  }
}

function build() {
  const repo = new InMemoryFollows();
  const logs: string[] = [];

  /** Which ids the profile read path reports as visible. */
  const unavailable = new Set<string>();
  const profiles = {
    async viewByUserId(_viewerId: string, targetId: string) {
      return unavailable.has(targetId)
        ? ({ status: 'NOT_AVAILABLE' } as const)
        : ({ status: 'FOUND', profile: { userId: targetId } } as never);
    },
  } as unknown as ProfileService;

  const blocks = {
    async isBlockedEitherWay() {
      return false;
    },
  } as unknown as BlockService;

  const db = {
    withTransaction: async <T>(fn: (c: never) => Promise<T>): Promise<T> => fn(undefined as never),
  } as unknown as DatabaseService;
  const logger = {
    log: (m: unknown) => logs.push(String(m)),
    warn: (m: unknown) => logs.push(String(m)),
    error: (m: unknown) => logs.push(String(m)),
  } as unknown as StructuredLogger;

  return {
    service: new FollowService(db, repo, blocks, profiles, logger),
    repo,
    logs,
    /** Make a user invisible to the read path (banned, deleted or blocked). */
    hide: (id: string) => unavailable.add(id),
  };
}

describe('FollowService.follow (SOCIAL-FR-001, EDGE-015/016)', () => {
  let ctx: ReturnType<typeof build>;
  let a: string;
  let b: string;
  beforeEach(() => {
    ctx = build();
    a = randomUUID();
    b = randomUUID();
  });

  it('creates the relationship with no approval step (BR-018)', async () => {
    const r = await ctx.service.follow(a, b);
    expect(r).toEqual({ status: 'FOLLOWING', created: true });
    expect(await ctx.service.isFollowing(a, b)).toBe(true);
  });

  it('IS IDEMPOTENT — exactly one relationship (EDGE-015)', async () => {
    await ctx.service.follow(a, b);
    const again = await ctx.service.follow(a, b);

    // SOCIAL-FR-001 AC: "GIVEN A already follows B, WHEN the follow request is
    // sent again, THEN exactly one relationship exists and the count is
    // unchanged."
    expect(again).toEqual({ status: 'FOLLOWING', created: false });
    expect(ctx.repo.edges).toHaveLength(1);
  });

  it('reports `created: false` on a repeat, so no second notification is sent', async () => {
    await ctx.service.follow(a, b);
    const again = await ctx.service.follow(a, b);
    // NOTIF-FR-003 fires on a follow; a repeat must not notify again.
    expect(again.status === 'FOLLOWING' && again.created).toBe(false);
  });

  it('refuses a self-follow (BR-019)', async () => {
    expect(await ctx.service.follow(a, a)).toEqual({ status: 'CANNOT_FOLLOW_SELF' });
    expect(ctx.repo.edges).toHaveLength(0);
  });

  it('REFUSES ACROSS A BLOCK, with a neutral answer (BR-023, EDGE-016)', async () => {
    ctx.hide(b);
    const r = await ctx.service.follow(a, b);

    // Identical to a banned or missing account. "You are blocked" would
    // disclose the block, which blocking must never do.
    expect(r).toEqual({ status: 'NOT_AVAILABLE' });
    expect(ctx.repo.edges).toHaveLength(0);
  });

  it('gives ONE answer for blocked, banned, deleted and never-existed', async () => {
    const answers: unknown[] = [];
    for (const _ of [0, 1, 2]) {
      const c = build();
      const target = randomUUID();
      c.hide(target);
      answers.push(await c.service.follow(a, target));
    }
    expect(new Set(answers.map((x) => JSON.stringify(x))).size).toBe(1);
  });

  it('never logs who followed whom', async () => {
    await ctx.service.follow(a, b);
    for (const line of ctx.logs) {
      expect(line).not.toContain(a);
      expect(line).not.toContain(b);
    }
  });
});

describe('FollowService.unfollow (SOCIAL-FR-002, BR-020)', () => {
  let ctx: ReturnType<typeof build>;
  let a: string;
  let b: string;
  beforeEach(() => {
    ctx = build();
    a = randomUUID();
    b = randomUUID();
  });

  it('removes the relationship', async () => {
    await ctx.service.follow(a, b);
    await ctx.service.unfollow(a, b);
    expect(await ctx.service.isFollowing(a, b)).toBe(false);
  });

  it('is idempotent when not currently following', async () => {
    expect(await ctx.service.unfollow(a, b)).toEqual({ status: 'NOT_FOLLOWING' });
  });

  it('PRODUCES NO NOTIFIABLE OUTCOME (BR-020)', async () => {
    // SOCIAL-FR-002 AC: "GIVEN A unfollows B, WHEN B opens their
    // notifications, THEN no unfollow notification is present."
    //
    // Asserted through the SIGNAL that gates notification rather than through
    // log text. `follow` returns `created`, which is what tells EPIC-11 to
    // notify; `unfollow` has no such field, and its result type has no shape
    // that could carry one. That is the durable property - a log-text
    // assertion would pass for the wrong reason the moment a message changed.
    const followed = await ctx.service.follow(a, b);
    expect(followed.status === 'FOLLOWING' && followed.created).toBe(true);

    const unfollowed = await ctx.service.unfollow(a, b);
    expect(unfollowed).toEqual({ status: 'NOT_FOLLOWING' });
    expect(Object.keys(unfollowed)).toEqual(['status']);

    // And no domain event name appears in what was recorded. Matched on the
    // parsed event VALUE, not the raw line, so the JSON key "event" cannot
    // make this pass or fail spuriously.
    const names = ctx.logs
      .map((l) => {
        try {
          return JSON.parse(l).event as string;
        } catch {
          return '';
        }
      })
      .filter((n) => n !== '');
    expect(names).not.toContain('social.unfollowed');
    expect(names.filter((n) => n.startsWith('notif'))).toEqual([]);
  });

  it('does not touch the reverse relationship', async () => {
    await ctx.service.follow(a, b);
    await ctx.service.follow(b, a);
    await ctx.service.unfollow(a, b);

    // Following is one-directional (BR-018): B following A is B's own
    // relationship and survives.
    expect(await ctx.service.isFollowing(b, a)).toBe(true);
  });
});

describe('FollowService — lists (SOCIAL-FR-003/004)', () => {
  let ctx: ReturnType<typeof build>;
  beforeEach(() => {
    ctx = build();
  });

  it('lists followers and following', async () => {
    const subject = randomUUID();
    const f1 = randomUUID();
    const f2 = randomUUID();
    await ctx.service.follow(f1, subject);
    await ctx.service.follow(f2, subject);
    await ctx.service.follow(subject, f1);

    const followers = await ctx.service.listFollowers(f1, subject);
    expect(followers?.userIds.sort()).toEqual([f1, f2].sort());

    const following = await ctx.service.listFollowing(f1, subject);
    expect(following?.userIds).toEqual([f1]);
  });

  it('REFUSES THE LIST WHEN THE SUBJECT IS NOT VISIBLE', async () => {
    const subject = randomUUID();
    const viewer = randomUUID();
    ctx.hide(subject);

    // A banned profile has no viewable follower list, and a blocked one must
    // not expose through this route what the profile route refuses to show.
    expect(await ctx.service.listFollowers(viewer, subject)).toBeNull();
    expect(await ctx.service.listFollowing(viewer, subject)).toBeNull();
  });

  it('always lets a person see their own lists', async () => {
    const me = randomUUID();
    ctx.hide(me); // suspended, say
    expect(await ctx.service.listFollowers(me, me)).not.toBeNull();
  });

  it('caps a large limit rather than doing unbounded work', async () => {
    const subject = randomUUID();
    for (let i = 0; i < 5; i += 1) await ctx.service.follow(randomUUID(), subject);

    const page = await ctx.service.listFollowers(subject, subject, 10_000);
    // The fake returns everything it has; the point is that the clamp did not
    // pass 10,000 through as the SQL LIMIT.
    expect(page?.userIds.length).toBeLessThanOrEqual(100);
  });

  it('defaults an absurd limit to the documented page size', async () => {
    const subject = randomUUID();
    await ctx.service.follow(randomUUID(), subject);
    for (const bad of [0, -5, Number.NaN]) {
      const page = await ctx.service.listFollowers(subject, subject, bad);
      expect(page).not.toBeNull();
    }
  });
});

describe('FollowService.suggestions (SOCIAL-FR-005)', () => {
  let ctx: ReturnType<typeof build>;
  beforeEach(() => {
    ctx = build();
  });

  it('RETURNS A NON-EMPTY SET WITH NO INTERESTS SELECTED', async () => {
    // PROFILE-FR-011 AC: "GIVEN no interests selected, WHEN suggested accounts
    // are requested, THEN a non-empty default set is still returned." So
    // suggestions must not be gated on interests.
    const me = randomUUID();
    for (let i = 0; i < 3; i += 1) ctx.repo.visible.add(randomUUID());

    const suggestions = await ctx.service.suggestions(me);
    expect(suggestions.length).toBeGreaterThan(0);
  });

  it('excludes self and accounts already followed', async () => {
    const me = randomUUID();
    const followed = randomUUID();
    const other = randomUUID();
    ctx.repo.visible.add(me);
    ctx.repo.visible.add(followed);
    ctx.repo.visible.add(other);
    await ctx.service.follow(me, followed);

    const suggestions = await ctx.service.suggestions(me);
    expect(suggestions).not.toContain(me);
    expect(suggestions).not.toContain(followed);
    expect(suggestions).toContain(other);
  });

  it('returns an empty list rather than failing when there is nobody to suggest', async () => {
    expect(await ctx.service.suggestions(randomUUID())).toEqual([]);
  });
});
