import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { DatabaseService } from '../../../../database/database.service.js';
import type {
  CreateUserInput,
  IdentityRepository,
  LoginSubjectKind,
  OtpChallengeRecord,
  OtpThrottleState,
  SessionRecord,
  UserRecord,
} from './identity.repository.port.js';
import {
  OTP_LOCKOUT_MS,
  OTP_MAX_ATTEMPTS,
  OTP_RESEND_WINDOW_MS,
  type OtpPurpose,
} from '../domain/otp.js';
import type { UserState } from '../domain/user-state.js';
import type { LoginFailureCounts } from '../domain/login-lockout.js';

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
  language: 'en' | 'ur' | null;
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
    language: r.language,
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

  async isIdentifierReserved(hash: Buffer, client?: PoolClient): Promise<boolean> {
    const r = await this.q<{ exists: boolean }>(
      client,
      'SELECT EXISTS(SELECT 1 FROM reserved_identifiers WHERE identifier_hash = $1) AS exists',
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

  async findUserByIdentifierHash(hash: Buffer, client?: PoolClient): Promise<UserRecord | null> {
    const r = await this.q<UserRow>(
      client,
      `SELECT u.* FROM users u
         JOIN user_identifiers i ON i.user_id = u.id
        WHERE i.value_hash = $1`,
      [hash],
    );
    const row = r.rows[0];
    return row ? toUser(row) : null;
  }

  async updatePasswordHash(
    userId: string,
    passwordHash: string,
    client: PoolClient,
  ): Promise<void> {
    await client.query('UPDATE users SET password_hash = $2 WHERE id = $1', [userId, passwordHash]);
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
    challenge: Omit<
      OtpChallengeRecord,
      'attempts' | 'consumedAt' | 'createdAt' | 'attemptsExhaustedAt'
    >,
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
      created_at: Date;
      expires_at: Date;
      consumed_at: Date | null;
      attempts_exhausted_at: Date | null;
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
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      consumedAt: row.consumed_at,
      attemptsExhaustedAt: row.attempts_exhausted_at,
    };
  }

  async incrementOtpAttempts(challengeId: string, client: PoolClient): Promise<number> {
    // The lockout stamp is set in the SAME statement that reaches the cap, so
    // the counter and its timestamp can never disagree - and a crash between
    // two statements cannot leave an exhausted challenge with no lockout.
    //
    // COALESCE keeps the FIRST exhaustion time: a later attempt must not push
    // the lockout further out, or the window would never end. (It cannot be
    // reached anyway - the cap CHECK rejects a sixth increment - but the
    // constraint should not be the only thing holding this correct.)
    const r = await client.query<{ attempts: number }>(
      `UPDATE otp_challenges
          SET attempts = attempts + 1,
              attempts_exhausted_at = CASE
                WHEN attempts + 1 >= $2 THEN COALESCE(attempts_exhausted_at, now())
                ELSE attempts_exhausted_at
              END
        WHERE id = $1
        RETURNING attempts`,
      [challengeId, OTP_MAX_ATTEMPTS],
    );
    return r.rows[0]?.attempts ?? 0;
  }

  async getOtpThrottleState(
    identifierHash: Buffer,
    purpose: OtpPurpose,
    client?: PoolClient,
  ): Promise<OtpThrottleState> {
    // One query rather than three: the throttle runs on every resend, and each
    // extra round trip is latency a user feels while waiting for a code.
    const r = await this.q<{
      last_issued_at: Date | null;
      issued_last_hour: string;
      locked_until: Date | null;
    }>(
      client,
      `SELECT MAX(created_at)                                       AS last_issued_at,
              COUNT(*) FILTER (WHERE created_at > now() - $3::interval)
                                                                    AS issued_last_hour,
              MAX(attempts_exhausted_at) + $4::interval             AS locked_until
         FROM otp_challenges
        WHERE identifier_hash = $1
          AND purpose = $2
          AND created_at > now() - $5::interval`,
      [
        identifierHash,
        purpose,
        `${OTP_RESEND_WINDOW_MS} milliseconds`,
        `${OTP_LOCKOUT_MS} milliseconds`,
        // Bound the scan. Nothing older than the longest window can affect any
        // of the three answers, and this lets the index do the work.
        `${Math.max(OTP_RESEND_WINDOW_MS, OTP_LOCKOUT_MS) * 2} milliseconds`,
      ],
    );

    const row = r.rows[0];
    const lockedUntil = row?.locked_until ?? null;
    return {
      lastIssuedAt: row?.last_issued_at ?? null,
      issuedLastHour: Number(row?.issued_last_hour ?? 0),
      // Report a lockout only while it is still running. An elapsed one is not
      // a lockout, and the caller should not have to reason about that.
      lockedUntil: lockedUntil !== null && lockedUntil.getTime() > Date.now() ? lockedUntil : null,
    };
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

  async touchSession(sessionId: string, expiresAt: Date, client?: PoolClient): Promise<void> {
    // Guarded, not blind: a revoked or expired session must never have its
    // expiry pushed forward, which would resurrect it and defeat revocation
    // entirely (BR-035, EDGE-010).
    await this.q(
      client,
      `UPDATE sessions
          SET expires_at = $2, last_seen_at = now()
        WHERE id = $1 AND revoked_at IS NULL AND expires_at > now()`,
      [sessionId, expiresAt],
    );
  }

  // ---- login attempts -----------------------------------------------------
  async recordLoginAttempt(
    attempt: {
      id: string;
      subjectKind: LoginSubjectKind;
      subjectHash: Buffer;
      sourceHash: Buffer | null;
      succeeded: boolean;
    },
    client?: PoolClient,
  ): Promise<void> {
    await this.q(
      client,
      `INSERT INTO login_attempts (id, subject_kind, subject_hash, source_hash, succeeded)
       VALUES ($1, $2, $3, $4, $5)`,
      [attempt.id, attempt.subjectKind, attempt.subjectHash, attempt.sourceHash, attempt.succeeded],
    );
  }

  async getLoginFailureCounts(
    subjectKind: LoginSubjectKind,
    subjectHash: Buffer,
    sourceHash: Buffer | null,
    windowMs: number,
    client?: PoolClient,
  ): Promise<LoginFailureCounts> {
    const r = await this.q<{
      account: string;
      source: string;
      last_failure_at: Date | null;
    }>(
      client,
      // The account count starts AFTER the last success, so failures a person
      // already recovered from cannot accumulate into a later lockout.
      `WITH window_start AS (
         SELECT GREATEST(
                  now() - $4::interval,
                  COALESCE(
                    (SELECT MAX(created_at) FROM login_attempts
                      WHERE subject_kind = $1 AND subject_hash = $2 AND succeeded),
                    '-infinity'::timestamptz
                  )
                ) AS at
       )
       SELECT
         (SELECT COUNT(*) FROM login_attempts, window_start
           WHERE subject_kind = $1 AND subject_hash = $2
             AND NOT succeeded AND created_at > window_start.at)          AS account,
         (SELECT COUNT(*) FROM login_attempts
           WHERE subject_kind = $1 AND $3::bytea IS NOT NULL AND source_hash = $3
             AND NOT succeeded AND created_at > now() - $4::interval)     AS source,
         (SELECT MAX(created_at) FROM login_attempts
           WHERE subject_kind = $1 AND NOT succeeded
             AND (subject_hash = $2 OR ($3::bytea IS NOT NULL AND source_hash = $3))
             AND created_at > now() - $4::interval)                       AS last_failure_at`,
      [subjectKind, subjectHash, sourceHash, `${windowMs} milliseconds`],
    );

    const row = r.rows[0];
    return {
      account: Number(row?.account ?? 0),
      source: Number(row?.source ?? 0),
      lastFailureAt: row?.last_failure_at ?? null,
    };
  }
}
