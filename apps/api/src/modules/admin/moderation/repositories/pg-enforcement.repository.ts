import { Injectable } from '@nestjs/common';
import type { PoolClient, QueryResult, QueryResultRow } from 'pg';
import { DatabaseService } from '../../../../database/database.service.js';
import type { EnforcementTarget } from '../domain/enforcement-policy.js';
import type {
  AdminUserView,
  DashboardCounts,
  EnforcementKind,
  EnforcementRecord,
  EnforcementRepository,
  SensitiveUserView,
} from './enforcement.repository.port.js';

interface ActionRow {
  id: string;
  target_user_id: string;
  admin_id: string;
  kind: EnforcementKind;
  reason: string;
  expires_at: Date | null;
  case_id: string | null;
  created_at: Date;
}

const toAction = (r: ActionRow): EnforcementRecord => ({
  id: r.id,
  targetUserId: r.target_user_id,
  adminId: r.admin_id,
  kind: r.kind,
  reason: r.reason,
  expiresAt: r.expires_at,
  caseId: r.case_id,
  createdAt: r.created_at,
});

@Injectable()
export class PgEnforcementRepository implements EnforcementRepository {
  constructor(private readonly db: DatabaseService) {}

  private q<R extends QueryResultRow>(
    client: PoolClient | undefined,
    sql: string,
    params: unknown[],
  ): Promise<QueryResult<R>> {
    return client === undefined ? this.db.query<R>(sql, params) : client.query<R>(sql, params);
  }

  // ---- BR-ADM-001 / SEC-021 ----------------------------------------------
  async isAdministrator(id: string, client?: PoolClient): Promise<boolean> {
    // Queries `admins`, a different store from `users` (SEC-020). Any match is
    // either an impossible UUIDv7 collision or exactly what BR-ADM-001 forbids.
    const r = await this.q<{ ok: boolean }>(
      client,
      'SELECT EXISTS (SELECT 1 FROM admins WHERE id = $1) AS ok',
      [id],
    );
    return r.rows[0]?.ok === true;
  }

  async findTarget(userId: string, client?: PoolClient): Promise<EnforcementTarget | null> {
    const r = await this.q<{ id: string; state: EnforcementTarget['state'] }>(
      client,
      'SELECT id, state FROM users WHERE id = $1',
      [userId],
    );
    const row = r.rows[0];
    return row === undefined ? null : { userId: row.id, state: row.state };
  }

  // ---- ADMIN-FR-005 -------------------------------------------------------
  async findUserView(userId: string, client?: PoolClient): Promise<AdminUserView | null> {
    // NO phone, NO email, NO date of birth. Those need `findSensitive`, which
    // the caller reaches deliberately and audits (PRIV-008, SEC-022) - a view
    // that carried them would make every account lookup a sensitive-data view.
    const r = await this.q<{
      user_id: string;
      username: string | null;
      display_name: string | null;
      account_type: 'INDIVIDUAL' | 'ORGANIZATION';
      state: EnforcementTarget['state'];
      suspended_until: Date | null;
      verified_badge: boolean | null;
      created_at: Date;
      post_count: number | null;
      reports_made: string;
      reports_received: string;
    }>(
      client,
      `SELECT u.id AS user_id,
              p.username::text AS username,
              p.display_name,
              u.account_type,
              u.state,
              u.suspended_until,
              p.verified_badge,
              u.created_at,
              p.post_count,
              (SELECT COUNT(*) FROM reports r WHERE r.reporter_id = u.id) AS reports_made,
              (SELECT COUNT(*) FROM reports r WHERE r.target_owner_id = u.id) AS reports_received
         FROM users u
         LEFT JOIN profiles p ON p.user_id = u.id
        WHERE u.id = $1`,
      [userId],
    );

    const row = r.rows[0];
    if (row === undefined) return null;
    return {
      userId: row.user_id,
      username: row.username,
      displayName: row.display_name,
      accountType: row.account_type,
      state: row.state,
      suspendedUntil: row.suspended_until,
      verifiedBadge: row.verified_badge === true,
      createdAt: row.created_at,
      postCount: row.post_count ?? 0,
      reportsMade: Number(row.reports_made),
      reportsReceived: Number(row.reports_received),
    };
  }

  async searchUsers(query: string, limit: number, client?: PoolClient): Promise<AdminUserView[]> {
    // Username and display name only. ADMIN-FR-005 also lists phone as a search
    // key, and that is an EXACT lookup by peppered hash in the identity module
    // rather than a substring match here - a hash has no substrings, so there
    // is no partial-number search to build. An administrator who has a number
    // gets one account or none, which is what a support call needs anyway.
    const r = await this.q<{ user_id: string }>(
      client,
      `SELECT u.id AS user_id
         FROM users u
         LEFT JOIN profiles p ON p.user_id = u.id
        WHERE p.username::text ILIKE '%' || $1 || '%'
           OR p.display_name ILIKE '%' || $1 || '%'
        ORDER BY u.created_at DESC
        LIMIT $2`,
      [query, limit],
    );

    const out: AdminUserView[] = [];
    for (const row of r.rows) {
      const view = await this.findUserView(row.user_id, client);
      if (view !== null) out.push(view);
    }
    return out;
  }

  async findSensitive(userId: string, client?: PoolClient): Promise<SensitiveUserView | null> {
    // THE REAL NUMBER, and that is the requirement rather than an oversight.
    // PRIV-003 keeps `value_normalized` out of every public DTO - no user ever
    // sees another user's number - but SEC-022 and PRIV-008 permit an
    // ADMINISTRATOR to view it and make the viewing itself auditable. The
    // control is not concealment from the admin; it is that the access leaves a
    // record. The caller has already written that record before calling here.
    const r = await this.q<{ date_of_birth: Date | null; phone: string | null }>(
      client,
      `SELECT u.date_of_birth,
              (SELECT ui.value_normalized FROM user_identifiers ui
                WHERE ui.user_id = u.id AND ui.is_primary
                LIMIT 1) AS phone
         FROM users u
        WHERE u.id = $1`,
      [userId],
    );
    const row = r.rows[0];
    if (row === undefined) return null;
    return {
      phone: row.phone,
      dateOfBirth: row.date_of_birth,
    };
  }

  // ---- state changes ------------------------------------------------------
  async suspend(userId: string, until: Date, client: PoolClient): Promise<boolean> {
    // ONE statement. A row saying SUSPENDED with no expiry is a permanent
    // suspension nobody decided; one saying ACTIVE with an expiry is a
    // suspension nobody can see. EDGE-027: this REPLACES any existing expiry
    // rather than extending it.
    const r = await client.query(
      `UPDATE users
          SET state = 'SUSPENDED', suspended_until = $2, state_changed_at = now()
        WHERE id = $1 AND state <> 'DELETED'`,
      [userId, until],
    );
    return (r.rowCount ?? 0) > 0;
  }

  async ban(userId: string, client: PoolClient): Promise<boolean> {
    const r = await client.query(
      `UPDATE users
          SET state = 'BANNED', suspended_until = NULL, state_changed_at = now()
        WHERE id = $1 AND state <> 'DELETED'`,
      [userId],
    );
    return (r.rowCount ?? 0) > 0;
  }

  async reinstate(userId: string, client: PoolClient): Promise<boolean> {
    const r = await client.query(
      `UPDATE users
          SET state = 'ACTIVE', suspended_until = NULL, state_changed_at = now()
        WHERE id = $1 AND state IN ('SUSPENDED', 'BANNED')`,
      [userId],
    );
    return (r.rowCount ?? 0) > 0;
  }

  async banIdentifiersOf(userId: string, reason: string, client: PoolClient): Promise<number> {
    // BR-036. The hash, never the number - the registration path compares
    // hashes, so the ban list never needs to hold an identifier in the clear.
    const r = await client.query(
      `INSERT INTO banned_identifiers (identifier_hash, reason, banned_user_id)
       SELECT ui.value_hash, $2, $1
         FROM user_identifiers ui
        WHERE ui.user_id = $1
       ON CONFLICT (identifier_hash) DO NOTHING`,
      [userId, reason],
    );
    return r.rowCount ?? 0;
  }

  async unbanIdentifiersOf(userId: string, client: PoolClient): Promise<number> {
    // ADMIN-FR-008 exists because "administrators make mistakes and the product
    // must let them be corrected". A reinstatement that left the number blocked
    // would not be a correction.
    const r = await client.query('DELETE FROM banned_identifiers WHERE banned_user_id = $1', [
      userId,
    ]);
    return r.rowCount ?? 0;
  }

  // ---- the record ---------------------------------------------------------
  async recordAction(
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
  ): Promise<EnforcementRecord> {
    const r = await client.query<ActionRow>(
      `INSERT INTO enforcement_actions (
         id, target_user_id, admin_id, kind, reason, expires_at, case_id
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, target_user_id, admin_id, kind, reason, expires_at, case_id, created_at`,
      [
        input.id,
        input.targetUserId,
        input.adminId,
        input.kind,
        input.reason,
        input.expiresAt,
        input.caseId,
      ],
    );
    const row = r.rows[0];
    if (row === undefined) throw new Error('enforcement insert returned no row');
    return toAction(row);
  }

  async historyFor(
    userId: string,
    limit: number,
    client?: PoolClient,
  ): Promise<EnforcementRecord[]> {
    const r = await this.q<ActionRow>(
      client,
      `SELECT id, target_user_id, admin_id, kind, reason, expires_at, case_id, created_at
         FROM enforcement_actions
        WHERE target_user_id = $1
        ORDER BY created_at DESC
        LIMIT $2`,
      [userId, limit],
    );
    return r.rows.map(toAction);
  }

  // ---- verification -------------------------------------------------------
  async setVerifiedBadge(
    userId: string,
    granted: boolean,
    adminId: string,
    client: PoolClient,
  ): Promise<boolean> {
    // PROFILE-FR-007: "revocation removes it everywhere immediately". It does,
    // because every surface reads the badge from this one column rather than
    // caching it - there is nothing else to invalidate.
    const r = await client.query(
      `UPDATE profiles
          SET verified_badge = $2,
              verified_by_admin_id = CASE WHEN $2 THEN $3::uuid ELSE NULL END,
              verified_at = CASE WHEN $2 THEN now() ELSE NULL END,
              updated_at = now()
        WHERE user_id = $1`,
      [userId, granted, adminId],
    );
    return (r.rowCount ?? 0) > 0;
  }

  // ---- announcements ------------------------------------------------------
  async publishAnnouncement(
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
  ): Promise<{ id: string }> {
    const r = await client.query<{ id: string }>(
      `INSERT INTO announcements (
         id, created_by_admin_id, title_en, title_ur, body_en, body_ur, expires_at, broadcast_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, CASE WHEN $8 THEN now() ELSE NULL END)
       RETURNING id`,
      [
        input.id,
        input.adminId,
        input.titleEn,
        input.titleUr,
        input.bodyEn,
        input.bodyUr,
        input.expiresAt,
        input.broadcast,
      ],
    );
    const row = r.rows[0];
    if (row === undefined) throw new Error('announcement insert returned no row');
    return row;
  }

  async countBroadcastsSince(since: Date, client?: PoolClient): Promise<number> {
    const r = await this.q<{ n: string }>(
      client,
      'SELECT COUNT(*) AS n FROM announcements WHERE broadcast_at >= $1',
      [since],
    );
    return Number(r.rows[0]?.n ?? 0);
  }

  // ---- dashboard ----------------------------------------------------------
  async dashboardCounts(now: Date, client?: PoolClient): Promise<DashboardCounts> {
    // ONE query, and every figure an aggregate. ADMIN-FR-011: "no individual
    // user's activity is profiled" - there is no id anywhere in this result,
    // which is what makes that criterion structural rather than a promise.
    const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const r = await this.q<{
      total_users: string;
      new_users_today: string;
      new_users_this_week: string;
      posts_today: string;
      upcoming_events: string;
      open_reports: string;
      actions_this_week: string;
    }>(
      client,
      `SELECT
         (SELECT COUNT(*) FROM users WHERE state <> 'DELETED') AS total_users,
         (SELECT COUNT(*) FROM users WHERE created_at >= $1) AS new_users_today,
         (SELECT COUNT(*) FROM users WHERE created_at >= $2) AS new_users_this_week,
         (SELECT COUNT(*) FROM posts
           WHERE created_at >= $1 AND visibility_state = 'VISIBLE') AS posts_today,
         (SELECT COUNT(*) FROM events
           WHERE starts_at > $3 AND visibility_state = 'VISIBLE') AS upcoming_events,
         (SELECT COUNT(*) FROM moderation_cases WHERE state = 'OPEN') AS open_reports,
         (SELECT COUNT(*) FROM enforcement_actions WHERE created_at >= $2) AS actions_this_week`,
      [dayAgo, weekAgo, now],
    );

    const row = r.rows[0];
    return {
      totalUsers: Number(row?.total_users ?? 0),
      newUsersToday: Number(row?.new_users_today ?? 0),
      newUsersThisWeek: Number(row?.new_users_this_week ?? 0),
      postsToday: Number(row?.posts_today ?? 0),
      upcomingEvents: Number(row?.upcoming_events ?? 0),
      openReports: Number(row?.open_reports ?? 0),
      actionsThisWeek: Number(row?.actions_this_week ?? 0),
    };
  }

  // ---- audit log ----------------------------------------------------------
  async searchAuditLog(
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
  }> {
    // ADMIN-FR-012: "searchable by administrator, action and date range". Built
    // as parameterised fragments rather than string concatenation - this table
    // is the evidence, and an injection here would be an injection into the one
    // record that proves what happened.
    const params: unknown[] = [limit, offset];
    const where: string[] = [];

    if (filter.adminId !== undefined) {
      params.push(filter.adminId);
      where.push(`actor_id = $${params.length}`);
    }
    if (filter.action !== undefined) {
      params.push(filter.action);
      where.push(`action = $${params.length}`);
    }
    if (filter.from !== undefined) {
      params.push(filter.from);
      where.push(`occurred_at >= $${params.length}`);
    }
    if (filter.to !== undefined) {
      params.push(filter.to);
      where.push(`occurred_at <= $${params.length}`);
    }

    const clause = where.length === 0 ? '' : ` WHERE ${where.join(' AND ')}`;

    const r = await this.q<{
      id: string;
      occurred_at: Date;
      actor_type: string;
      actor_id: string | null;
      action: string;
      entity_type: string;
      entity_id: string | null;
      metadata: Record<string, unknown>;
      total: string;
    }>(
      client,
      `SELECT id, occurred_at, actor_type, actor_id, action, entity_type, entity_id, metadata,
              COUNT(*) OVER () AS total
         FROM audit_log${clause}
        ORDER BY occurred_at DESC
        LIMIT $1 OFFSET $2`,
      params,
    );

    return {
      entries: r.rows.map((row) => ({
        id: row.id,
        occurredAt: row.occurred_at,
        actorType: row.actor_type,
        actorId: row.actor_id,
        action: row.action,
        entityType: row.entity_type,
        entityId: row.entity_id,
        metadata: row.metadata,
      })),
      total: Number(r.rows[0]?.total ?? 0),
    };
  }
}
