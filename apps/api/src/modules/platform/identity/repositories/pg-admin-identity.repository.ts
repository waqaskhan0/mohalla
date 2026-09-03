import { Injectable } from '@nestjs/common';
import type { PoolClient, QueryResult, QueryResultRow } from 'pg';
import { DatabaseService } from '../../../../database/database.service.js';
import type {
  AdminIdentityRepository,
  AdminRecord,
  AdminSessionRecord,
  AdminState,
} from './admin-identity.repository.port.js';

interface AdminRow {
  id: string;
  email: string;
  password_hash: string;
  state: AdminState;
  display_name: string | null;
  created_at: Date;
}

interface AdminSessionRow {
  id: string;
  admin_id: string;
  created_at: Date;
  expires_at: Date;
  revoked_at: Date | null;
}

function toAdmin(row: AdminRow): AdminRecord {
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    state: row.state,
    displayName: row.display_name,
    createdAt: row.created_at,
  };
}

function toAdminSession(row: AdminSessionRow): AdminSessionRecord {
  return {
    id: row.id,
    adminId: row.admin_id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
  };
}

/** PostgreSQL adapter for the administrator store (SEC-020). */
@Injectable()
export class PgAdminIdentityRepository implements AdminIdentityRepository {
  constructor(private readonly db: DatabaseService) {}

  /** Read through the caller's transaction when there is one, else the pool. */
  private q<Row extends QueryResultRow>(
    client: PoolClient | undefined,
    sql: string,
    params: unknown[],
  ): Promise<QueryResult<Row>> {
    return client === undefined ? this.db.query<Row>(sql, params) : client.query<Row>(sql, params);
  }

  async findAdminByEmail(email: string, client?: PoolClient): Promise<AdminRecord | null> {
    // `email` is citext, so the comparison is case-insensitive in the database.
    // Lowercasing here instead would silently break for any address where
    // Unicode case folding differs from ASCII.
    const r = await this.q<AdminRow>(client, 'SELECT * FROM admins WHERE email = $1', [email]);
    const row = r.rows[0];
    return row ? toAdmin(row) : null;
  }

  async findAdminById(id: string, client?: PoolClient): Promise<AdminRecord | null> {
    const r = await this.q<AdminRow>(client, 'SELECT * FROM admins WHERE id = $1', [id]);
    const row = r.rows[0];
    return row ? toAdmin(row) : null;
  }

  async createAdminSession(
    input: { id: string; adminId: string; tokenHash: Buffer; expiresAt: Date },
    client: PoolClient,
  ): Promise<void> {
    await client.query(
      `INSERT INTO admin_sessions (id, admin_id, token_hash, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [input.id, input.adminId, input.tokenHash, input.expiresAt],
    );
  }

  async findLiveAdminSessionByTokenHash(
    tokenHash: Buffer,
    client?: PoolClient,
  ): Promise<AdminSessionRecord | null> {
    const r = await this.q<AdminSessionRow>(
      client,
      `SELECT * FROM admin_sessions
        WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()`,
      [tokenHash],
    );
    const row = r.rows[0];
    return row ? toAdminSession(row) : null;
  }

  async revokeAdminSessions(sessionIds: readonly string[], client: PoolClient): Promise<void> {
    if (sessionIds.length === 0) return;
    await client.query(
      `UPDATE admin_sessions SET revoked_at = now()
        WHERE id = ANY($1::uuid[]) AND revoked_at IS NULL`,
      [[...sessionIds]],
    );
  }

  async listLiveAdminSessions(adminId: string, client?: PoolClient): Promise<AdminSessionRecord[]> {
    const r = await this.q<AdminSessionRow>(
      client,
      `SELECT * FROM admin_sessions
        WHERE admin_id = $1 AND revoked_at IS NULL AND expires_at > now()
        ORDER BY created_at`,
      [adminId],
    );
    return r.rows.map(toAdminSession);
  }
}
