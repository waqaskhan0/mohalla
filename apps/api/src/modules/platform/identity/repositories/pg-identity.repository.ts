import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { DatabaseService } from '../../../../database/database.service.js';
import type {
  CreateUserInput,
  IdentityRepository,
  OtpChallengeRecord,
  SessionRecord,
  UserRecord,
} from './identity.repository.port.js';
import type { OtpPurpose } from '../domain/otp.js';
import type { UserState } from '../domain/user-state.js';

/** Postgres unique-violation. */
const UNIQUE_VIOLATION = '23505';

interface UserRow {
  id: string;
  state: UserState;
  account_type: 'INDIVIDUAL' | 'ORGANIZATION';
  username: string | null;
  password_hash: string;
  date_of_birth: string;
  suspended_until: Date | null;
  terms_version: string;
  terms_accepted_at: Date;
  created_at: Date;
}

function toUser(r: UserRow): UserRecord {
  return {
    id: r.id,
    state: r.state,
    accountType: r.account_type,
    username: r.username,
    passwordHash: r.password_hash,
    // `date` comes back as a string; keep it that way so no timezone is ever
    // applied to a date of birth.
    dateOfBirth: String(r.date_of_birth),
    suspendedUntil: r.suspended_until,
    termsVersion: r.terms_version,
    termsAcceptedAt: r.terms_accepted_at,
    createdAt: r.created_at,
  };
}

/**
 * PostgreSQL adapter for the identity port.
 *
 * Contains SQL and nothing else - no business rule, no policy decision. Every
 * method either takes the caller's transaction client or, for pure reads, falls
 * back to the pool.
 */
@Injectable()
export class PgIdentityRepository implements IdentityRepository {
  constructor(private readonly db: DatabaseService) {}

  private q<T extends import('pg').QueryResultRow>(
    client: PoolClient | undefined,
    sql: string,
    params: readonly unknown[],
  ): Promise<import('pg').QueryResult<T>> {
    return client ? client.query<T>(sql, params as unknown[]) : this.db.query<T>(sql, params);
  }

  // ------------------------------------------------------------ identifiers
  async isIdentifierBanned(hash: Buffer, client?: PoolClient): Promise<boolean> {
    const r = await this.q<{ exists: boolean }>(
      client,
      'SELECT EXISTS(SELECT 1 FROM banned_identifiers WHERE identifier_hash = $1) AS exists',
      [hash],
    );
    return r.rows[0]?.exists === true;
  }

  async findUserIdByIdentifierHash(hash: Buffer, client?: PoolClient): Promise<string | null> {
    const r = await this.q<{ user_id: string }>(
      client,
      'SELECT user_id FROM user_identifiers WHERE value_hash = $1',
      [hash],
    );
    return r.rows[0]?.user_id ?? null;
  }

  // ------------------------------------------------------------------ users
  async findUserById(id: string, client?: PoolClient): Promise<UserRecord | null> {
    const r = await this.q<UserRow>(client, 'SELECT * FROM users WHERE id = $1', [id]);
    const row = r.rows[0];
    return row ? toUser(row) : null;
  }

  async createUserWithPrimaryPhone(
    input: CreateUserInput,
    identifier: { id: string; normalized: string; hash: Buffer },
    client: PoolClient,
  ): Promise<UserRecord | null> {
    const user = await client.query<UserRow>(
      `INSERT INTO users (id, state, account_type, password_hash, date_of_birth,
                          terms_version, terms_accepted_at)
       VALUES ($1, 'UNVERIFIED', $2, $3, $4, $5, now())
       RETURNING *`,
      [input.id, input.accountType, input.passwordHash, input.dateOfBirth, input.termsVersion],
    );

    try {
      await client.query(
        `INSERT INTO user_identifiers (id, user_id, kind, value_normalized, value_hash, is_primary)
         VALUES ($1, $2, 'PHONE', $3, $4, true)`,
        [identifier.id, input.id, identifier.normalized, identifier.hash],
      );
    } catch (e) {
      // EDGE-001: a concurrent request registered this number first. The UNIQUE
      // index is the authority - not a prior SELECT, which would be a race.
      if ((e as { code?: string }).code === UNIQUE_VIOLATION) return null;
      throw e;
    }

    return toUser(user.rows[0] as UserRow);
  }

  async markUserVerified(userId: string, client: PoolClient): Promise<void> {
    await client.query(
      `UPDATE users SET state = 'ACTIVE', state_changed_at = now()
        WHERE id = $1 AND state = 'UNVERIFIED'`,
      [userId],
    );
    await client.query(
      'UPDATE user_identifiers SET verified_at = now() WHERE user_id = $1 AND is_primary',
      [userId],
    );
  }

  // -------------------------------------------------------------------- OTP
  async replaceOtpChallenge(
    challenge: Omit<OtpChallengeRecord, 'attempts' | 'consumedAt'>,
    client: PoolClient,
  ): Promise<void> {
    // Consume any live challenge first: resend invalidates the previous code
    // (SEC-003), and the partial unique index would otherwise reject the insert.
    await client.query(
      `UPDATE otp_challenges SET consumed_at = now()
        WHERE identifier_hash = $1 AND purpose = $2 AND consumed_at IS NULL`,
      [challenge.identifierHash, challenge.purpose],
    );
    await client.query(
      `INSERT INTO otp_challenges (id, identifier_hash, purpose, code_hash, attempts, expires_at)
       VALUES ($1, $2, $3, $4, 0, $5)`,
      [
        challenge.id,
        challenge.identifierHash,
        challenge.purpose,
        challenge.codeHash,
        challenge.expiresAt,
      ],
    );
  }

  async findLiveOtpChallenge(
    identifierHash: Buffer,
    purpose: OtpPurpose,
    client?: PoolClient,
  ): Promise<OtpChallengeRecord | null> {
    const r = await this.q<{
      id: string;
      identifier_hash: Buffer;
      purpose: OtpPurpose;
      code_hash: Buffer;
      attempts: number;
      expires_at: Date;
      consumed_at: Date | null;
    }>(
      client,
      `SELECT * FROM otp_challenges
        WHERE identifier_hash = $1 AND purpose = $2 AND consumed_at IS NULL`,
      [identifierHash, purpose],
    );
    const row = r.rows[0];
    if (!row) return null;
    return {
      id: row.id,
      identifierHash: row.identifier_hash,
      purpose: row.purpose,
      codeHash: row.code_hash,
      attempts: row.attempts,
      expiresAt: row.expires_at,
      consumedAt: row.consumed_at,
    };
  }

  async incrementOtpAttempts(challengeId: string, client: PoolClient): Promise<number> {
    const r = await client.query<{ attempts: number }>(
      'UPDATE otp_challenges SET attempts = attempts + 1 WHERE id = $1 RETURNING attempts',
      [challengeId],
    );
    return r.rows[0]?.attempts ?? 0;
  }

  async consumeOtpChallenge(challengeId: string, client: PoolClient): Promise<void> {
    await client.query('UPDATE otp_challenges SET consumed_at = now() WHERE id = $1', [
      challengeId,
    ]);
  }

  // --------------------------------------------------------------- sessions
  async listLiveSessions(userId: string, client?: PoolClient): Promise<SessionRecord[]> {
    const r = await this.q<{
      id: string;
      user_id: string;
      created_at: Date;
      expires_at: Date;
      revoked_at: Date | null;
    }>(
      client,
      `SELECT id, user_id, created_at, expires_at, revoked_at
         FROM sessions
        WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now()
        ORDER BY created_at ASC`,
      [userId],
    );
    return r.rows.map((s) => ({
      id: s.id,
      userId: s.user_id,
      createdAt: s.created_at,
      expiresAt: s.expires_at,
      revokedAt: s.revoked_at,
    }));
  }

  async createSession(
    input: {
      id: string;
      userId: string;
      tokenHash: Buffer;
      expiresAt: Date;
      deviceLabel: string | null;
    },
    client: PoolClient,
  ): Promise<void> {
    await client.query(
      `INSERT INTO sessions (id, user_id, token_hash, device_label, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [input.id, input.userId, input.tokenHash, input.deviceLabel, input.expiresAt],
    );
  }

  async revokeSessions(
    sessionIds: readonly string[],
    reason: Parameters<IdentityRepository['revokeSessions']>[1],
    client: PoolClient,
  ): Promise<void> {
    if (sessionIds.length === 0) return;
    await client.query(
      `UPDATE sessions SET revoked_at = now(), revoked_reason = $2
        WHERE id = ANY($1::uuid[]) AND revoked_at IS NULL`,
      [sessionIds as string[], reason],
    );
  }

  async findLiveSessionByTokenHash(
    tokenHash: Buffer,
    client?: PoolClient,
  ): Promise<SessionRecord | null> {
    const r = await this.q<{
      id: string;
      user_id: string;
      created_at: Date;
      expires_at: Date;
      revoked_at: Date | null;
    }>(
      client,
      `SELECT id, user_id, created_at, expires_at, revoked_at
         FROM sessions
        WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()`,
      [tokenHash],
    );
    const s = r.rows[0];
    return s
      ? {
          id: s.id,
          userId: s.user_id,
          createdAt: s.created_at,
          expiresAt: s.expires_at,
          revokedAt: s.revoked_at,
        }
      : null;
  }
}
