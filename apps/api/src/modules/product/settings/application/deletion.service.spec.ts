import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { DeletionService } from './deletion.service.js';
import { FixedClock } from '../../../platform/identity/ports/clock.port.js';
import { DELETION_GRACE_DAYS } from '../domain/deletion-lifecycle.js';
import type { Anonymisable, AnonymisationOutcome } from '../ports/anonymisable.port.js';
import type {
  DeletionRepository,
  DeletionRequestRecord,
} from '../repositories/deletion.repository.port.js';
import type { AuditService } from '../../../platform/audit/audit.service.js';
import type { SessionService } from '../../../platform/identity/application/session.service.js';
import type { DatabaseService } from '../../../../database/database.service.js';
import type { StructuredLogger } from '../../../../common/logging/structured.logger.js';

const NOW = new Date('2026-09-05T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;

class InMemoryDeletion implements DeletionRepository {
  requests: DeletionRequestRecord[] = [];
  states = new Map<string, 'ACTIVE' | 'PENDING_DELETION' | 'DELETED'>();
  reserved = new Set<string>();
  identifiers = new Map<string, string>();

  /** Set by a test to commit a competing write in the gap the real lock closes. */
  onLock: ((userId: string) => void) | null = null;

  async createRequest(input: {
    id: string;
    userId: string;
    requestedAt: Date;
    scheduledErasureAt: Date;
  }): Promise<DeletionRequestRecord> {
    const record: DeletionRequestRecord = { ...input, restoredAt: null, completedAt: null };
    this.requests.push(record);
    return record;
  }

  private open(userId: string): DeletionRequestRecord | null {
    return (
      this.requests.find(
        (r) => r.userId === userId && r.restoredAt === null && r.completedAt === null,
      ) ?? null
    );
  }

  async findOpenRequest(userId: string): Promise<DeletionRequestRecord | null> {
    return this.open(userId);
  }

  async lockOpenRequest(userId: string): Promise<DeletionRequestRecord | null> {
    // The fake cannot interleave transactions — that is what mandatory test F
    // in `packages/db` is for, against real PostgreSQL. What it CAN do is let a
    // test commit a competing outcome at the moment of the lock, which proves
    // the SERVICE re-reads afterwards instead of trusting what it selected.
    this.onLock?.(userId);
    return this.open(userId);
  }

  /** EDGE-030. Keyed by conversation so the reinstate is exact. */
  withdrawn: string[] = [];
  pendingRequests = new Map<string, string>();

  async withdrawMessageRequests(userId: string): Promise<number> {
    let n = 0;
    for (const [conversationId, sender] of this.pendingRequests) {
      if (sender === userId && !this.withdrawn.includes(conversationId)) {
        this.withdrawn.push(conversationId);
        n += 1;
      }
    }
    return n;
  }

  async reinstateMessageRequests(userId: string): Promise<number> {
    const back = this.withdrawn.filter((c) => this.pendingRequests.get(c) === userId);
    this.withdrawn = this.withdrawn.filter((c) => !back.includes(c));
    return back.length;
  }

  async markRestored(id: string, at: Date): Promise<boolean> {
    const r = this.requests.find((x) => x.id === id);
    if (r === undefined || r.restoredAt !== null || r.completedAt !== null) return false;
    r.restoredAt = at;
    return true;
  }

  async markCompleted(id: string, at: Date): Promise<boolean> {
    const r = this.requests.find((x) => x.id === id);
    if (r === undefined || r.restoredAt !== null || r.completedAt !== null) return false;
    r.completedAt = at;
    return true;
  }

  async findDue(now: Date, limit: number): Promise<DeletionRequestRecord[]> {
    return this.requests
      .filter(
        (r) =>
          r.restoredAt === null &&
          r.completedAt === null &&
          r.scheduledErasureAt.getTime() <= now.getTime(),
      )
      .sort((a, b) => a.scheduledErasureAt.getTime() - b.scheduledErasureAt.getTime())
      .slice(0, limit);
  }

  async setState(
    userId: string,
    state: 'ACTIVE' | 'PENDING_DELETION' | 'DELETED',
  ): Promise<boolean> {
    if (this.states.get(userId) === 'DELETED') return false;
    this.states.set(userId, state);
    return true;
  }

  async identifierStatus(hash: Buffer): Promise<'FREE' | 'RESERVED' | 'PENDING_DELETION'> {
    const key = hash.toString('hex');
    if (this.reserved.has(key)) return 'RESERVED';
    const userId = this.identifiers.get(key);
    if (userId !== undefined && this.open(userId) !== null) return 'PENDING_DELETION';
    return 'FREE';
  }
}

class CountingAnonymiser implements Anonymisable {
  counted: string[] = [];
  erased: string[] = [];

  constructor(
    readonly moduleName: string,
    private readonly rows: number,
  ) {}

  async countFor(userId: string): Promise<AnonymisationOutcome> {
    this.counted.push(userId);
    return { module: this.moduleName, rowsAnonymised: this.rows, rowsDeleted: 0 };
  }

  async anonymise(userId: string): Promise<AnonymisationOutcome> {
    this.erased.push(userId);
    return { module: this.moduleName, rowsAnonymised: this.rows, rowsDeleted: 0 };
  }
}

function build() {
  const repo = new InMemoryDeletion();
  const clock = new FixedClock(NOW);
  const logs: string[] = [];
  const audited: { action: string; metadata: Record<string, unknown> }[] = [];
  const revocations: { userId: string; reason: string }[] = [];

  const content = new CountingAnonymiser('content', 4);
  const identity = new CountingAnonymiser('identity', 1);

  const audit = {
    async append(entry: { action: string; metadata?: Record<string, unknown> }) {
      audited.push({ action: entry.action, metadata: entry.metadata ?? {} });
    },
  } as unknown as AuditService;

  const sessions = {
    async revokeAllForUser(userId: string, reason: string) {
      revocations.push({ userId, reason });
      return 2;
    },
  } as unknown as SessionService;

  const db = {
    withTransaction: async <T>(fn: (c: PoolClient) => Promise<T>): Promise<T> =>
      fn(undefined as unknown as PoolClient),
  } as unknown as DatabaseService;

  const logger = {
    log: (m: unknown) => logs.push(String(m)),
    debug: (m: unknown) => logs.push(String(m)),
    warn: (m: unknown) => logs.push(String(m)),
    error: (m: unknown) => logs.push(String(m)),
  } as unknown as StructuredLogger;

  return {
    service: new DeletionService(db, repo, [content, identity], sessions, audit, clock, logger),
    repo,
    clock,
    logs,
    audited,
    revocations,
    content,
    identity,
  };
}

let ctx: ReturnType<typeof build>;
let userId: string;

beforeEach(() => {
  ctx = build();
  userId = randomUUID();
  ctx.repo.states.set(userId, 'ACTIVE');
});

const request = () =>
  ctx.service.requestDeletion({ userId, state: 'ACTIVE', passwordVerified: true });

describe('requesting deletion (SET-FR-004 · BR-008)', () => {
  it('REFUSES WITHOUT THE PASSWORD, AND CHANGES NOTHING', () => {
    // The flag is the whole check as far as this service is concerned: it
    // cannot verify a password and so cannot be asked to skip verifying one.
    return ctx.service
      .requestDeletion({ userId, state: 'ACTIVE', passwordVerified: false })
      .then((result) => {
        expect(result).toEqual({ status: 'REFUSED', reason: 'PASSWORD_REQUIRED' });
        expect(ctx.repo.requests).toHaveLength(0);
        expect(ctx.repo.states.get(userId)).toBe('ACTIVE');
        expect(ctx.revocations).toHaveLength(0);
      });
  });

  it('makes the account invisible immediately and schedules erasure for day 30', async () => {
    const result = await request();

    expect(result.status).toBe('PENDING');
    if (result.status !== 'PENDING') return;
    expect(result.scheduledErasureAt.getTime()).toBe(NOW.getTime() + DELETION_GRACE_DAYS * DAY);
    expect(ctx.repo.states.get(userId)).toBe('PENDING_DELETION');
    expect(ctx.repo.requests).toHaveLength(1);
  });

  it('ERASES NOTHING IN PHASE ONE — that is what makes restoring free', async () => {
    await request();
    expect(ctx.content.erased).toEqual([]);
    expect(ctx.identity.erased).toEqual([]);
  });

  it('revokes every session, with the reason recorded (BR-035)', async () => {
    await request();
    expect(ctx.revocations).toEqual([{ userId, reason: 'DELETED' }]);
  });

  it('returns the consequences with the response, so the client cannot omit them', async () => {
    const result = await request();
    if (result.status !== 'PENDING') throw new Error('expected PENDING');
    expect(result.consequences[1]).toBe('deletion.consequence.postsRemainAnonymised');
  });

  it('LOGS NO USER ID — the log would outlive the erasure it describes', async () => {
    await request();
    for (const line of ctx.logs) expect(line).not.toContain(userId);
    expect(ctx.logs.join('\n')).toContain('deletion_requested');
    // The audit row does carry it, under access control (ADR-018).
    expect(ctx.audited.map((a) => a.action)).toContain('ACCOUNT_DELETION_REQUESTED');
  });
});

describe('restoring (SET-FR-005)', () => {
  it('restores inside the window and puts the account back to ACTIVE', async () => {
    await request();
    ctx.clock.advance(29 * DAY);

    expect(await ctx.service.restore(userId)).toEqual({ status: 'RESTORED' });
    expect(ctx.repo.states.get(userId)).toBe('ACTIVE');
    expect(ctx.audited.map((a) => a.action)).toContain('ACCOUNT_RESTORED');
  });

  it('refuses past the window, so a client can answer with a neutral not-found', async () => {
    await request();
    ctx.clock.advance(DELETION_GRACE_DAYS * DAY);

    expect(await ctx.service.restore(userId)).toEqual({ status: 'GRACE_EXPIRED' });
    expect(ctx.repo.states.get(userId)).toBe('PENDING_DELETION');
  });

  it('says NOT_PENDING for an account that never asked', async () => {
    expect(await ctx.service.restore(userId)).toEqual({ status: 'NOT_PENDING' });
  });

  it('does not restore twice — the second call finds no open request', async () => {
    await request();
    await ctx.service.restore(userId);
    expect(await ctx.service.restore(userId)).toEqual({ status: 'NOT_PENDING' });
  });

  it('WILL NOT RESTORE AN ACCOUNT ERASED SINCE THE ROW WAS SELECTED', async () => {
    await request();
    ctx.clock.advance(29 * DAY);

    // The erasure job commits between this call starting and the lock being
    // granted. Real PostgreSQL makes that happen in mandatory test F; here it
    // is forced, to prove the service re-reads the outcome columns rather than
    // trusting the row it asked for.
    ctx.repo.onLock = () => {
      const open = ctx.repo.requests.find((r) => r.userId === userId);
      if (open !== undefined) open.completedAt = ctx.clock.now();
    };

    expect(await ctx.service.restore(userId)).toEqual({ status: 'NOT_PENDING' });
    expect(ctx.repo.states.get(userId)).toBe('PENDING_DELETION');
  });
});

describe('the day-30 sweep (PRIV-007 · ADR-019)', () => {
  it('does nothing before day 30', async () => {
    await request();
    ctx.clock.advance(29 * DAY);

    expect(await ctx.service.runErasure({ dryRun: false })).toEqual([]);
    expect(ctx.content.erased).toEqual([]);
    expect(ctx.repo.requests[0]?.completedAt).toBeNull();
  });

  it('runs every contributor in one pass and marks the request completed', async () => {
    await request();
    ctx.clock.advance(DELETION_GRACE_DAYS * DAY);

    const reports = await ctx.service.runErasure({ dryRun: false });

    expect(reports).toHaveLength(1);
    expect(reports[0]?.outcomes.map((o) => o.module)).toEqual(['content', 'identity']);
    expect(ctx.content.erased).toEqual([userId]);
    expect(ctx.identity.erased).toEqual([userId]);
    expect(ctx.repo.requests[0]?.completedAt).not.toBeNull();
  });

  it('THE DRY RUN TOUCHES NOTHING, AND REPORTS WHAT THE REAL ONE WOULD', async () => {
    await request();
    ctx.clock.advance(DELETION_GRACE_DAYS * DAY);

    const reports = await ctx.service.runErasure({ dryRun: true });

    expect(reports[0]?.dryRun).toBe(true);
    expect(reports[0]?.outcomes).toEqual([
      { module: 'content', rowsAnonymised: 4, rowsDeleted: 0 },
      { module: 'identity', rowsAnonymised: 1, rowsDeleted: 0 },
    ]);
    expect(ctx.content.counted).toEqual([userId]);
    expect(ctx.content.erased).toEqual([]);
    expect(ctx.repo.requests[0]?.completedAt).toBeNull();
    // No audit row either: nothing happened to record.
    expect(ctx.audited.map((a) => a.action)).not.toContain('ACCOUNT_ERASED');
  });

  it('a dry run leaves the account erasable, so staging can rehearse and then run', async () => {
    await request();
    ctx.clock.advance(DELETION_GRACE_DAYS * DAY);

    await ctx.service.runErasure({ dryRun: true });
    const real = await ctx.service.runErasure({ dryRun: false });

    expect(real).toHaveLength(1);
    expect(ctx.content.erased).toEqual([userId]);
  });

  it('SKIPS AN ACCOUNT RESTORED AFTER IT WAS SELECTED AS DUE', async () => {
    await request();
    ctx.clock.advance(DELETION_GRACE_DAYS * DAY);

    // ADR-019: "the second observes the new state and aborts". The row was
    // read outside the transaction; the restore commits before the lock.
    ctx.repo.onLock = () => {
      const open = ctx.repo.requests.find((r) => r.userId === userId);
      if (open !== undefined) open.restoredAt = ctx.clock.now();
      ctx.repo.states.set(userId, 'ACTIVE');
      ctx.repo.onLock = null;
    };

    expect(await ctx.service.runErasure({ dryRun: false })).toEqual([]);
    expect(ctx.content.erased).toEqual([]);
    expect(ctx.repo.states.get(userId)).toBe('ACTIVE');
  });

  it('records counts in the audit log and never content', async () => {
    await request();
    ctx.clock.advance(DELETION_GRACE_DAYS * DAY);
    await ctx.service.runErasure({ dryRun: false });

    const erased = ctx.audited.find((a) => a.action === 'ACCOUNT_ERASED');
    expect(erased?.metadata).toEqual({
      modules: [
        { module: 'content', anonymised: 4, deleted: 0 },
        { module: 'identity', anonymised: 1, deleted: 0 },
      ],
    });
  });

  it('erases in oldest-first order and honours the limit, so one sweep cannot run away', async () => {
    const second = randomUUID();
    await request();
    ctx.clock.advance(DAY);
    await ctx.service.requestDeletion({
      userId: second,
      state: 'ACTIVE',
      passwordVerified: true,
    });
    ctx.clock.advance(DELETION_GRACE_DAYS * DAY);

    const reports = await ctx.service.runErasure({ dryRun: false, limit: 1 });

    expect(reports.map((r) => r.userId)).toEqual([userId]);
    expect(ctx.content.erased).toEqual([userId]);
  });
});

describe('EDGE-030 — pending message requests the deleting user sent', () => {
  const CONVERSATION = 'conversation-1';

  beforeEach(() => {
    ctx.repo.pendingRequests.set(CONVERSATION, userId);
  });

  it('WITHDRAWS THEM WHEN THE ACCOUNT GOES', async () => {
    // "Requests are withdrawn from recipients' views." A request from an
    // account that has just ceased to exist invites a reply into a void.
    await request();
    expect(ctx.repo.withdrawn).toEqual([CONVERSATION]);
  });

  it('PUTS THEM BACK ON RESTORE — phase one changed only state', async () => {
    // The property that makes restoring free is that nothing was destroyed.
    // A withdrawn request is the one piece of phase one that touches somebody
    // ELSE's row, so it is also the one that has to be undone explicitly.
    await request();
    await ctx.service.restore(userId);
    expect(ctx.repo.withdrawn).toEqual([]);
  });

  it('leaves a request from a different sender alone', async () => {
    const other = randomUUID();
    ctx.repo.pendingRequests.set('conversation-2', other);

    await request();

    expect(ctx.repo.withdrawn).toEqual([CONVERSATION]);
  });
});

describe('EDGE-003 / EDGE-029 — an identifier attached to a pending deletion', () => {
  it('is PENDING_DELETION while the request is open, and FREE once restored', async () => {
    const hash = Buffer.from('a'.repeat(64), 'hex');
    ctx.repo.identifiers.set(hash.toString('hex'), userId);

    expect(await ctx.repo.identifierStatus(hash)).toBe('FREE');
    await request();
    expect(await ctx.repo.identifierStatus(hash)).toBe('PENDING_DELETION');

    await ctx.service.restore(userId);
    expect(await ctx.repo.identifierStatus(hash)).toBe('FREE');
  });

  it('reports a pending request for the account, which is what login tells the user about', async () => {
    expect(await ctx.service.pendingRequestFor(userId)).toBeNull();
    await request();
    expect((await ctx.service.pendingRequestFor(userId))?.userId).toBe(userId);
  });
});
