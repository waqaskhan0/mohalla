import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { EnforcementService } from './enforcement.service.js';
import { FixedClock } from '../../../platform/identity/ports/clock.port.js';
import type { EnforcementTarget } from '../domain/enforcement-policy.js';
import type {
  AdminUserView,
  DashboardCounts,
  EnforcementKind,
  EnforcementRecord,
  EnforcementRepository,
  SensitiveUserView,
} from '../repositories/enforcement.repository.port.js';
import type { AuditService } from '../../../platform/audit/audit.service.js';
import type { SessionService } from '../../../platform/identity/application/session.service.js';
import type { DatabaseService } from '../../../../database/database.service.js';
import type { StructuredLogger } from '../../../../common/logging/structured.logger.js';

interface FakeUser {
  id: string;
  state: EnforcementTarget['state'];
  accountType: 'INDIVIDUAL' | 'ORGANIZATION';
  suspendedUntil: Date | null;
  verifiedBadge: boolean;
  identifierBanned: boolean;
}

class InMemoryEnforcement implements EnforcementRepository {
  users = new Map<string, FakeUser>();
  administrators = new Set<string>();
  actions: EnforcementRecord[] = [];
  clock: () => Date = () => new Date();

  async isAdministrator(id: string): Promise<boolean> {
    return this.administrators.has(id);
  }

  async findTarget(userId: string): Promise<EnforcementTarget | null> {
    const u = this.users.get(userId);
    return u === undefined ? null : { userId: u.id, state: u.state };
  }

  async findUserView(userId: string): Promise<AdminUserView | null> {
    const u = this.users.get(userId);
    if (u === undefined) return null;
    return {
      userId: u.id,
      username: `user-${u.id.slice(0, 6)}`,
      displayName: 'A Person',
      accountType: u.accountType,
      state: u.state,
      suspendedUntil: u.suspendedUntil,
      verifiedBadge: u.verifiedBadge,
      createdAt: this.clock(),
      postCount: 0,
      reportsMade: 0,
      reportsReceived: 0,
    };
  }

  async searchUsers(): Promise<AdminUserView[]> {
    return [];
  }

  async findSensitive(userId: string): Promise<SensitiveUserView | null> {
    return this.users.has(userId)
      ? { phone: '+923001234567', dateOfBirth: new Date('1995-06-15') }
      : null;
  }

  async suspend(userId: string, until: Date): Promise<boolean> {
    const u = this.users.get(userId);
    if (u === undefined || u.state === 'DELETED') return false;
    u.state = 'SUSPENDED';
    u.suspendedUntil = until;
    return true;
  }

  async ban(userId: string): Promise<boolean> {
    const u = this.users.get(userId);
    if (u === undefined || u.state === 'DELETED') return false;
    u.state = 'BANNED';
    u.suspendedUntil = null;
    return true;
  }

  async reinstate(userId: string): Promise<boolean> {
    const u = this.users.get(userId);
    if (u === undefined) return false;
    u.state = 'ACTIVE';
    u.suspendedUntil = null;
    return true;
  }

  async banIdentifiersOf(userId: string): Promise<number> {
    const u = this.users.get(userId);
    if (u === undefined) return 0;
    u.identifierBanned = true;
    return 1;
  }

  async unbanIdentifiersOf(userId: string): Promise<number> {
    const u = this.users.get(userId);
    if (u === undefined) return 0;
    u.identifierBanned = false;
    return 1;
  }

  async recordAction(input: {
    id: string;
    targetUserId: string;
    adminId: string;
    kind: EnforcementKind;
    reason: string;
    expiresAt: Date | null;
    caseId: string | null;
  }): Promise<EnforcementRecord> {
    const record: EnforcementRecord = { ...input, createdAt: this.clock() };
    this.actions.push(record);
    return record;
  }

  async historyFor(userId: string, limit: number): Promise<EnforcementRecord[]> {
    return this.actions.filter((a) => a.targetUserId === userId).slice(0, limit);
  }

  async setVerifiedBadge(userId: string, granted: boolean): Promise<boolean> {
    const u = this.users.get(userId);
    if (u === undefined) return false;
    u.verifiedBadge = granted;
    return true;
  }

  async publishAnnouncement(input: { id: string }): Promise<{ id: string }> {
    return { id: input.id };
  }

  async countBroadcastsSince(): Promise<number> {
    return 0;
  }

  async dashboardCounts(): Promise<DashboardCounts> {
    return {
      totalUsers: this.users.size,
      newUsersToday: 0,
      newUsersThisWeek: 0,
      postsToday: 0,
      upcomingEvents: 0,
      openReports: 0,
      actionsThisWeek: this.actions.length,
    };
  }

  async searchAuditLog() {
    return { entries: [], total: 0 };
  }
}

const NOW = new Date('2026-09-05T12:00:00.000Z');

function build() {
  const repo = new InMemoryEnforcement();
  const clock = new FixedClock(NOW);
  repo.clock = () => clock.now();

  const logs: string[] = [];
  const audited: { action: string; entityType: string; metadata: Record<string, unknown> }[] = [];
  const revocations: { userId: string; reason: string }[] = [];

  const audit = {
    async append(entry: {
      action: string;
      entityType: string;
      metadata?: Record<string, unknown>;
    }) {
      audited.push({
        action: entry.action,
        entityType: entry.entityType,
        metadata: entry.metadata ?? {},
      });
    },
  } as unknown as AuditService;

  const sessions = {
    async revokeAllForUser(userId: string, reason: string) {
      revocations.push({ userId, reason });
      return 3;
    },
  } as unknown as SessionService;

  const db = {
    withTransaction: async <T>(fn: (c: never) => Promise<T>): Promise<T> => fn(undefined as never),
  } as unknown as DatabaseService;

  const logger = {
    log: (m: unknown) => logs.push(String(m)),
    debug: (m: unknown) => logs.push(String(m)),
    warn: (m: unknown) => logs.push(String(m)),
    error: (m: unknown) => logs.push(String(m)),
  } as unknown as StructuredLogger;

  return {
    service: new EnforcementService(db, repo, sessions, audit, clock, logger),
    repo,
    clock,
    logs,
    audited,
    revocations,
  };
}

let ctx: ReturnType<typeof build>;
let adminId: string;
let userId: string;

beforeEach(() => {
  ctx = build();
  adminId = randomUUID();
  userId = randomUUID();
  ctx.repo.users.set(userId, {
    id: userId,
    state: 'ACTIVE',
    accountType: 'INDIVIDUAL',
    suspendedUntil: null,
    verifiedBadge: false,
    identifierBanned: false,
  });
});

describe('BR-ADM-001 / SEC-021 — an administrator can never be actioned', () => {
  let otherAdmin: string;
  beforeEach(() => {
    otherAdmin = randomUUID();
    ctx.repo.administrators.add(otherAdmin);
  });

  it('REFUSES A SUSPENSION AGAINST AN ADMINISTRATOR (ADMIN-FR-006 AC)', async () => {
    // "GIVEN a suspension attempt against an admin account, THEN it is refused
    // SERVER-SIDE."
    const r = await ctx.service.suspend({
      adminId,
      targetUserId: otherAdmin,
      duration: 'DAYS_7',
      reason: 'attempting to suspend a colleague',
    });
    expect(r).toEqual({ status: 'REFUSED', reason: 'TARGET_IS_ADMINISTRATOR' });
  });

  it('refuses a ban and a reinstatement too', async () => {
    expect(
      (await ctx.service.ban({ adminId, targetUserId: otherAdmin, reason: 'attempting a ban' }))
        .status,
    ).toBe('REFUSED');
    expect(
      (
        await ctx.service.reinstate({
          adminId,
          targetUserId: otherAdmin,
          reason: 'attempting a reinstatement',
        })
      ).status,
    ).toBe('REFUSED');
  });

  it('CHANGES NOTHING AND REVOKES NOTHING', async () => {
    // The lockout risk the SRS names: with no hierarchy, one compromised
    // administrator suspending the others could hold the platform and there is
    // nobody above them to undo it. So the refusal has to happen before any
    // side effect, including the session revocation.
    await ctx.service.ban({ adminId, targetUserId: otherAdmin, reason: 'attempting a ban' });
    expect(ctx.repo.actions).toHaveLength(0);
    expect(ctx.revocations).toHaveLength(0);
  });

  it('AUDITS THE REFUSED ATTEMPT', async () => {
    // A refusal nobody can see is a refusal nobody can investigate. An
    // administrator trying to act on another is exactly the event BR-ADM-001
    // exists to prevent.
    await ctx.service.suspend({
      adminId,
      targetUserId: otherAdmin,
      duration: 'HOURS_24',
      reason: 'attempting to suspend a colleague',
    });
    expect(ctx.audited.map((a) => a.action)).toContain('ADMIN_ON_ADMIN_ACTION_REFUSED');
  });

  it('refuses BEFORE the reason is even checked', async () => {
    // SEC-021: "regardless of interface state". An empty reason must not
    // produce a validation error that reveals the admin check was never reached.
    const r = await ctx.service.ban({ adminId, targetUserId: otherAdmin, reason: '' });
    expect(r).toEqual({ status: 'REFUSED', reason: 'TARGET_IS_ADMINISTRATOR' });
  });
});

describe('ADMIN-FR-006 — suspend', () => {
  it('sets the state, the expiry and revokes every session (BR-035)', async () => {
    const r = await ctx.service.suspend({
      adminId,
      targetUserId: userId,
      duration: 'HOURS_24',
      reason: 'repeated spam after a warning',
    });

    expect(r.status).toBe('APPLIED');
    if (r.status === 'APPLIED') {
      expect(r.action.kind).toBe('SUSPEND');
      expect(r.action.expiresAt).toEqual(new Date('2026-09-06T12:00:00.000Z'));
      expect(r.sessionsRevoked).toBe(3);
    }

    expect(ctx.repo.users.get(userId)?.state).toBe('SUSPENDED');
    expect(ctx.revocations).toEqual([{ userId, reason: 'SUSPENDED' }]);
  });

  it('REPLACES an existing suspension rather than extending it (EDGE-027)', async () => {
    await ctx.service.suspend({
      adminId,
      targetUserId: userId,
      duration: 'DAYS_30',
      reason: 'a first suspension',
    });

    ctx.clock.advance(24 * 60 * 60 * 1000);
    const second = await ctx.service.suspend({
      adminId,
      targetUserId: userId,
      duration: 'HOURS_24',
      reason: 'a shorter second suspension',
    });

    // The NEW duration is in force, not the sum and not the longer of the two.
    // The most recent decision is the one that stands.
    expect(second.status).toBe('APPLIED');
    expect(ctx.repo.users.get(userId)?.suspendedUntil).toEqual(
      new Date('2026-09-07T12:00:00.000Z'),
    );
  });

  it('refuses without a reason (BR-038)', async () => {
    const r = await ctx.service.suspend({
      adminId,
      targetUserId: userId,
      duration: 'DAYS_7',
      reason: 'no',
    });
    expect(r).toEqual({ status: 'REFUSED', reason: 'REASON_TOO_SHORT' });
    expect(ctx.repo.users.get(userId)?.state).toBe('ACTIVE');
  });

  it('audits with the administrator and the reason (SEC-022)', async () => {
    await ctx.service.suspend({
      adminId,
      targetUserId: userId,
      duration: 'DAYS_7',
      reason: 'repeated harassment',
    });
    const entry = ctx.audited.find((a) => a.action === 'ADMIN_SUSPEND');
    expect(entry?.metadata.reason).toBe('repeated harassment');
    expect(entry?.metadata.expiresAt).toBe('2026-09-12T12:00:00.000Z');
  });
});

describe('ADMIN-FR-007 / ADMIN-FR-008 — ban and reinstate', () => {
  it('BANS AND BLOCKS THE NUMBER (BR-036)', async () => {
    const r = await ctx.service.ban({
      adminId,
      targetUserId: userId,
      reason: 'coordinated abuse across several accounts',
    });

    expect(r.status).toBe('APPLIED');
    expect(ctx.repo.users.get(userId)?.state).toBe('BANNED');
    expect(ctx.repo.users.get(userId)?.identifierBanned).toBe(true);
    expect(ctx.revocations).toEqual([{ userId, reason: 'BANNED' }]);
  });

  it('A BAN HAS NO EXPIRY', async () => {
    const r = await ctx.service.ban({
      adminId,
      targetUserId: userId,
      reason: 'coordinated abuse',
    });
    if (r.status === 'APPLIED') expect(r.action.expiresAt).toBeNull();
  });

  it('REINSTATEMENT UNBLOCKS THE NUMBER TOO (ADMIN-FR-008)', async () => {
    await ctx.service.ban({ adminId, targetUserId: userId, reason: 'a mistaken ban' });

    const r = await ctx.service.reinstate({
      adminId,
      targetUserId: userId,
      reason: 'reviewed and reversed on appeal',
    });

    expect(r.status).toBe('APPLIED');
    expect(ctx.repo.users.get(userId)?.state).toBe('ACTIVE');
    // "Administrators make mistakes and the product must let them be
    // corrected." A reinstatement leaving the number blocked would not be a
    // correction; it would be a ban with better paperwork.
    expect(ctx.repo.users.get(userId)?.identifierBanned).toBe(false);
  });

  it('a reinstatement revokes nothing — there is nothing to eject', async () => {
    await ctx.service.ban({ adminId, targetUserId: userId, reason: 'a mistaken ban' });
    ctx.revocations.length = 0;

    await ctx.service.reinstate({
      adminId,
      targetUserId: userId,
      reason: 'reviewed and reversed',
    });
    expect(ctx.revocations).toHaveLength(0);
  });

  it('NOTHING IS EVER DELETED — the content is hidden, the account retained', async () => {
    await ctx.service.ban({ adminId, targetUserId: userId, reason: 'coordinated abuse' });
    // The row is still there, in BANNED. ADMIN-FR-007: content is hidden
    // "so that it remains available to the audit trail if the ban is later
    // disputed".
    expect(ctx.repo.users.has(userId)).toBe(true);
  });
});

describe('ADMIN-FR-005 / PRIV-008 / SEC-022 — the sensitive view is audited', () => {
  it('THE AUDIT ENTRY IS WRITTEN FOR EVERY READ (AC)', async () => {
    // "GIVEN an administrator views a user's phone number, WHEN the audit log
    // is inspected, THEN an entry records that access."
    await ctx.service.sensitiveView({ adminId, targetUserId: userId });
    expect(ctx.audited.map((a) => a.action)).toContain('ADMIN_VIEWED_SENSITIVE_DATA');
  });

  it('audits EVERY time, not just the first', async () => {
    await ctx.service.sensitiveView({ adminId, targetUserId: userId });
    await ctx.service.sensitiveView({ adminId, targetUserId: userId });
    expect(ctx.audited.filter((a) => a.action === 'ADMIN_VIEWED_SENSITIVE_DATA')).toHaveLength(2);
  });

  it('THE ENTRY NAMES THE FIELDS, NEVER THEIR VALUES', async () => {
    // An audit log that recorded the phone number to prove somebody looked at
    // the phone number would be a second, worse copy of it - and the log
    // survives account erasure pseudonymously (OD-019), so it would outlive the
    // deletion meant to remove it.
    await ctx.service.sensitiveView({ adminId, targetUserId: userId });
    const entry = ctx.audited.find((a) => a.action === 'ADMIN_VIEWED_SENSITIVE_DATA');
    expect(entry?.metadata).toEqual({ fields: ['phone', 'dateOfBirth'] });
    expect(JSON.stringify(entry?.metadata)).not.toContain('92300');
  });

  it('THE ORDINARY ACCOUNT VIEW CARRIES NO IDENTIFIER AND AUDITS NOTHING', async () => {
    // A lookup must not itself be a sensitive-data view, or PRIV-008 would be
    // audited on every screen and mean nothing.
    const view = await ctx.service.userView(userId);
    expect(view).not.toBeNull();
    expect(JSON.stringify(view)).not.toContain('92300');
    expect(Object.keys(view ?? {})).not.toContain('phone');
    expect(ctx.audited).toHaveLength(0);
  });
});

describe('ADMIN-FR-010 — verification', () => {
  it('refuses an INDIVIDUAL account, stating the rule (AC)', async () => {
    const r = await ctx.service.setVerification({
      adminId,
      targetUserId: userId,
      granted: true,
      reason: 'they asked nicely',
    });
    expect(r).toEqual({ status: 'REFUSED', reason: 'NOT_AN_ORGANIZATION' });
  });

  it('grants to an ORGANIZATION', async () => {
    const org = randomUUID();
    ctx.repo.users.set(org, {
      id: org,
      state: 'ACTIVE',
      accountType: 'ORGANIZATION',
      suspendedUntil: null,
      verifiedBadge: false,
      identifierBanned: false,
    });

    const r = await ctx.service.setVerification({
      adminId,
      targetUserId: org,
      granted: true,
      reason: 'verified the registration documents',
    });
    expect(r).toEqual({ status: 'APPLIED' });
    expect(ctx.repo.users.get(org)?.verifiedBadge).toBe(true);
  });

  it('REVOKES FROM ANYONE, including an individual who somehow holds one', async () => {
    // The eligibility rule gates GRANTING. Revocation must never be blocked by
    // it, or a badge granted in error on an account that later changed type
    // could not be taken back.
    ctx.repo.users.get(userId)!.verifiedBadge = true;
    const r = await ctx.service.setVerification({
      adminId,
      targetUserId: userId,
      granted: false,
      reason: 'granted in error',
    });
    expect(r).toEqual({ status: 'APPLIED' });
    expect(ctx.repo.users.get(userId)?.verifiedBadge).toBe(false);
  });

  it('audits both directions with the reason', async () => {
    ctx.repo.users.get(userId)!.verifiedBadge = true;
    await ctx.service.setVerification({
      adminId,
      targetUserId: userId,
      granted: false,
      reason: 'granted in error',
    });
    const entry = ctx.audited.find((a) => a.action === 'ADMIN_REVOKED_VERIFICATION');
    expect(entry?.metadata.reason).toBe('granted in error');
  });

  it('refuses without a reason (BR-038)', async () => {
    const r = await ctx.service.setVerification({
      adminId,
      targetUserId: userId,
      granted: false,
      reason: 'x',
    });
    expect(r).toEqual({ status: 'REFUSED', reason: 'REASON_TOO_SHORT' });
  });
});

describe('EnforcementService — what is never logged', () => {
  it('never logs the target, the administrator or the reason text', async () => {
    await ctx.service.suspend({
      adminId,
      targetUserId: userId,
      duration: 'DAYS_7',
      reason: 'harassing a specific neighbour by name',
    });

    // The audit log holds all three under access control. An application log
    // line carrying them would be a second copy of the enforcement record in a
    // file with weaker controls - and a reason can name a person.
    for (const line of ctx.logs) {
      expect(line).not.toContain(userId);
      expect(line).not.toContain(adminId);
      expect(line).not.toContain('harassing a specific neighbour');
    }
  });
});
