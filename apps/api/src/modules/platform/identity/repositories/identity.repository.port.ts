import type { PoolClient } from 'pg';
import type { UserState } from '../domain/user-state.js';
import type { OtpPurpose } from '../domain/otp.js';

/**
 * Identity persistence port.
 *
 * An interface so the application layer never sees SQL, and so the service
 * tests can run against a fake while the SAME contract is verified against real
 * PostgreSQL by the integration tests.
 *
 * Every method that participates in a multi-step invariant accepts a
 * `PoolClient`, because the transaction boundary belongs to the application
 * service (06-backend-modules.md §2) - the repository must never open one.
 */
export const IDENTITY_REPOSITORY = Symbol.for('mohalla.identity.repository');

export interface UserRecord {
  id: string;
  state: UserState;
  accountType: 'INDIVIDUAL' | 'ORGANIZATION';
  username: string | null;
  passwordHash: string;
  dateOfBirth: string;
  suspendedUntil: Date | null;
  termsVersion: string;
  termsAcceptedAt: Date;
  createdAt: Date;
}

export interface OtpChallengeRecord {
  id: string;
  identifierHash: Buffer;
  purpose: OtpPurpose;
  codeHash: Buffer;
  attempts: number;
  expiresAt: Date;
  consumedAt: Date | null;
}

export interface SessionRecord {
  id: string;
  userId: string;
  createdAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
}

export interface CreateUserInput {
  id: string;
  passwordHash: string;
  dateOfBirth: string;
  termsVersion: string;
  accountType: 'INDIVIDUAL' | 'ORGANIZATION';
}

export interface IdentityRepository {
  // ---- identifiers ---------------------------------------------------
  /** BR-036: is this identifier permanently barred from registering? */
  isIdentifierBanned(hash: Buffer, client?: PoolClient): Promise<boolean>;

  /** Does an account already hold this identifier? */
  findUserIdByIdentifierHash(hash: Buffer, client?: PoolClient): Promise<string | null>;

  // ---- users ----------------------------------------------------------
  findUserById(id: string, client?: PoolClient): Promise<UserRecord | null>;

  /**
   * Create the account and bind its primary identifier in ONE call so the
   * caller cannot accidentally create a user with no identity. Runs inside the
   * caller's transaction.
   *
   * @returns null when `UNIQUE (value_hash)` rejects the insert - i.e. the
   * number was registered by a concurrent request (EDGE-001). Returning null
   * rather than throwing keeps the uniform-202 path simple for the caller.
   */
  createUserWithPrimaryPhone(
    input: CreateUserInput,
    identifier: { id: string; normalized: string; hash: Buffer },
    client: PoolClient,
  ): Promise<UserRecord | null>;

  markUserVerified(userId: string, client: PoolClient): Promise<void>;

  // ---- OTP ------------------------------------------------------------
  /**
   * Replace any live challenge for this identifier+purpose with a new one.
   *
   * Resend MUST invalidate the previous code (SEC-003), and the partial unique
   * index makes a concurrent resend unable to leave two valid codes standing.
   */
  replaceOtpChallenge(
    challenge: Omit<OtpChallengeRecord, 'attempts' | 'consumedAt'>,
    client: PoolClient,
  ): Promise<void>;

  findLiveOtpChallenge(
    identifierHash: Buffer,
    purpose: OtpPurpose,
    client?: PoolClient,
  ): Promise<OtpChallengeRecord | null>;

  incrementOtpAttempts(challengeId: string, client: PoolClient): Promise<number>;

  consumeOtpChallenge(challengeId: string, client: PoolClient): Promise<void>;

  // ---- sessions --------------------------------------------------------
  listLiveSessions(userId: string, client?: PoolClient): Promise<SessionRecord[]>;

  createSession(
    input: {
      id: string;
      userId: string;
      tokenHash: Buffer;
      expiresAt: Date;
      deviceLabel: string | null;
    },
    client: PoolClient,
  ): Promise<void>;

  revokeSessions(
    sessionIds: readonly string[],
    reason:
      | 'LOGOUT'
      | 'PASSWORD_CHANGE'
      | 'PASSWORD_RESET'
      | 'SUSPENDED'
      | 'BANNED'
      | 'DELETED'
      | 'EVICTED'
      | 'ADMIN',
    client: PoolClient,
  ): Promise<void>;

  /** Resolve a presented token to its live session, or null. */
  findLiveSessionByTokenHash(tokenHash: Buffer, client?: PoolClient): Promise<SessionRecord | null>;
}
