import type { PoolClient } from 'pg';
import type { EnforcementTarget } from '../domain/enforcement-policy.js';

export const ENFORCEMENT_REPOSITORY = Symbol.for('mohalla.admin.enforcementRepository');

export type EnforcementKind = 'SUSPEND' | 'BAN' | 'REINSTATE' | 'CONTENT_DELETED';

export interface EnforcementRecord {
  id: string;
  targetUserId: string;
  adminId: string;
  kind: EnforcementKind;
  reason: string;
  expiresAt: Date | null;
  caseId: string | null;
  createdAt: Date;
}

/** ADMIN-FR-005 — the account view an administrator opens. */
export interface AdminUserView {
  userId: string;
  username: string | null;
  displayName: string | null;
  accountType: 'INDIVIDUAL' | 'ORGANIZATION';
  state: EnforcementTarget['state'];
  suspendedUntil: Date | null;
  verifiedBadge: boolean;
  createdAt: Date;
  postCount: number;
  reportsMade: number;
  reportsReceived: number;
}

/**
 * The identifiers an administrator may see — and only after an audited read.
 *
 * PRIV-008 / SEC-022: "viewing a user's phone number, email or date of birth is
 * audit-logged EVERY TIME". A separate type from `AdminUserView` so the two
 * cannot be fetched by accident together: the ordinary account view carries no
 * identifier at all, and reaching this one is a deliberate second call that
 * writes an audit row.
 */
export interface SensitiveUserView {
  phone: string | null;
  dateOfBirth: Date | null;
}

export interface DashboardCounts {
  totalUsers: number;
  newUsersToday: number;
  newUsersThisWeek: number;
  postsToday: number;
  upcomingEvents: number;
  openReports: number;
  actionsThisWeek: number;
}

export interface EnforcementRepository {
  /**
   * Is this id an ADMINISTRATOR?
   *
   * The first question every enforcement path asks (BR-ADM-001, SEC-021). It
   * queries `admins`, which is a different store from `users` (SEC-020) — so a
   * "user id" that matches an admin row is either a coincidence impossible with
   * UUIDv7 or somebody trying exactly what the rule forbids.
   */
  isAdministrator(id: string, client?: PoolClient): Promise<boolean>;

  findTarget(userId: string, client?: PoolClient): Promise<EnforcementTarget | null>;

  /** ADMIN-FR-005 — the account view. Carries NO phone, email or date of birth. */
  findUserView(userId: string, client?: PoolClient): Promise<AdminUserView | null>;

  /** ADMIN-FR-005 — search by username, display name or identifier hash. */
  searchUsers(query: string, limit: number, client?: PoolClient): Promise<AdminUserView[]>;

  /**
   * The identifiers, for an administrator who has a reason to see them.
   *
   * The CALLER writes the audit row. It is not done here because the repository
   * has no correlation id, no administrator identity and no notion of why — and
   * an audit entry that cannot say who or why is not evidence.
   */
  findSensitive(userId: string, client?: PoolClient): Promise<SensitiveUserView | null>;

  // ---- state changes -----------------------------------------------------
  /**
   * ADMIN-FR-006 — suspend, or replace an existing suspension (EDGE-027).
   *
   * Sets `state` and `suspended_until` in ONE statement. The two must never
   * disagree: a row that says SUSPENDED with no expiry is a permanent
   * suspension nobody decided, and one that says ACTIVE with an expiry is a
   * suspension nobody can see.
   */
  suspend(userId: string, until: Date, client: PoolClient): Promise<boolean>;

  /** ADMIN-FR-007 — permanent, and the content is hidden rather than deleted. */
  ban(userId: string, client: PoolClient): Promise<boolean>;

  /** ADMIN-FR-008 — back to ACTIVE, clearing any expiry. */
  reinstate(userId: string, client: PoolClient): Promise<boolean>;

  /**
   * BR-036 — add the account's identifier hash to the ban list.
   *
   * "A banned account's registered mobile number cannot be used to create a new
   * account." The registration path already consults this list; banning is what
   * puts a row in it.
   */
  banIdentifiersOf(userId: string, reason: string, client: PoolClient): Promise<number>;

  /** ADMIN-FR-008 — and reinstatement takes them off it again. */
  unbanIdentifiersOf(userId: string, client: PoolClient): Promise<number>;

  // ---- the record ---------------------------------------------------------
  recordAction(
    input: {
      id: string;
      targetUserId: string;
      adminId: string;
      kind: EnforcementKind;
      reason: string;
      expiresAt: Date | null;
      caseId: string | null;
    },
    client: PoolClient,
  ): Promise<EnforcementRecord>;

  /**
   * ADMIN-FR-002 — "the author's enforcement history", on the case view.
   *
   * §4: "so proportionality can be judged without navigating away". An
   * administrator deciding whether a first offence warrants 30 days should not
   * have to open another screen to find out that it is the fourth.
   */
  historyFor(userId: string, limit: number, client?: PoolClient): Promise<EnforcementRecord[]>;

  // ---- verification (ADMIN-FR-010) ---------------------------------------
  setVerifiedBadge(
    userId: string,
    granted: boolean,
    adminId: string,
    client: PoolClient,
  ): Promise<boolean>;

  // ---- announcements (ADMIN-FR-009) --------------------------------------
  publishAnnouncement(
    input: {
      id: string;
      adminId: string;
      titleEn: string;
      titleUr: string;
      bodyEn: string;
      bodyUr: string;
      expiresAt: Date;
      broadcast: boolean;
    },
    client: PoolClient,
  ): Promise<{ id: string }>;

  /** NOTIF-FR-005 — two per rolling week, counted from the table. */
  countBroadcastsSince(since: Date, client?: PoolClient): Promise<number>;

  // ---- dashboard (ADMIN-FR-001/011) --------------------------------------
  /**
   * AGGREGATES ONLY. ADMIN-FR-011's acceptance criterion is that "every figure
   * shown is an aggregate and NO INDIVIDUAL USER'S ACTIVITY IS PROFILED" — so
   * this returns counts and there is no method here that returns a list of
   * people who did something.
   */
  dashboardCounts(now: Date, client?: PoolClient): Promise<DashboardCounts>;

  // ---- audit log (ADMIN-FR-012) ------------------------------------------
  /**
   * Read the log. There is no write method, and no update or delete anywhere.
   *
   * BR-039: "no interface, permission or administrator can edit or delete an
   * entry." The runtime role holds SELECT and INSERT only, and the INSERT lives
   * in `AuditService` — this interface exposes reading and nothing else, so
   * there is no admin-facing path that could mutate it even if the grants
   * changed.
   */
  searchAuditLog(
    filter: {
      adminId?: string | undefined;
      action?: string | undefined;
      from?: Date | undefined;
      to?: Date | undefined;
    },
    limit: number,
    offset: number,
    client?: PoolClient,
  ): Promise<{
    entries: {
      id: string;
      occurredAt: Date;
      actorType: string;
      actorId: string | null;
      action: string;
      entityType: string;
      entityId: string | null;
      metadata: Record<string, unknown>;
    }[];
    total: number;
  }>;
}
