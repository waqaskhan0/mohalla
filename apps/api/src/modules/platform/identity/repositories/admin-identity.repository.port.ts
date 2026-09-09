import type { PoolClient } from 'pg';

/**
 * Administrator persistence — a SEPARATE port from `IdentityRepository`.
 *
 * SEC-020 requires a separate credential store, and this is that separation
 * expressed in types rather than only in table names. One repository holding
 * both `findUserByIdentifierHash` and `findAdminByEmail` would make
 * "authenticate against the wrong store" a plausible typo; two ports make it a
 * compile error.
 *
 * There is deliberately NO create, update or delete for administrators here.
 * Provisioning is a CLI run by the technical owner with the migration
 * credential the runtime never holds (S2-CR-005), and
 * `09-authentication-authorization.md` is explicit: **there is no bootstrap
 * endpoint in any environment**. A create method on this port would be the
 * first step towards one existing by accident.
 */
export const ADMIN_IDENTITY_REPOSITORY = Symbol.for('mohalla.identity.adminRepository');

export type AdminState = 'ACTIVE' | 'DISABLED';

export interface AdminRecord {
  id: string;
  /** Stored `citext`, so lookup is case-insensitive without lowercasing here. */
  email: string;
  passwordHash: string;
  state: AdminState;
  displayName: string | null;
  createdAt: Date;
}

export interface AdminSessionRecord {
  id: string;
  adminId: string;
  createdAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
}

export interface AdminIdentityRepository {
  findAdminByEmail(email: string, client?: PoolClient): Promise<AdminRecord | null>;

  findAdminById(id: string, client?: PoolClient): Promise<AdminRecord | null>;

  createAdminSession(
    input: { id: string; adminId: string; tokenHash: Buffer; expiresAt: Date },
    client: PoolClient,
  ): Promise<void>;

  findLiveAdminSessionByTokenHash(
    tokenHash: Buffer,
    client?: PoolClient,
  ): Promise<AdminSessionRecord | null>;

  revokeAdminSessions(sessionIds: readonly string[], client: PoolClient): Promise<void>;

  listLiveAdminSessions(adminId: string, client?: PoolClient): Promise<AdminSessionRecord[]>;
}
