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
  createdAt: Date;
  expiresAt: Date;
  consumedAt: Date | null;
  /** Set when the attempt cap is reached; starts the 15-minute lockout. */
  attemptsExhaustedAt: Date | null;
}

export interface SessionRecord {
  id: string;
  userId: string;
  createdAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
}

/**
 * What the resend throttle needs to decide, in one round trip (SEC-003 §52).
 *
 * Three separate limits, because they stop three different things: the
 * cooldown stops accidental double-taps, the hourly cap stops an SMS-cost
 * attack on the victim, and the lockout stops the attempt cap being reset by
 * simply asking for a new code.
 */
export interface OtpThrottleState {
  /** When the newest challenge was issued, for the 60-second cooldown. */
  lastIssuedAt: Date | null;
  /** Challenges issued in the last hour, capped at 3. */
  issuedLastHour: number;
  /** Set while a 15-minute attempt lockout is in force. */
  lockedUntil: Date | null;
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
    challenge: Omit<
      OtpChallengeRecord,
      'attempts' | 'consumedAt' | 'createdAt' | 'attemptsExhaustedAt'
    >,
    client: PoolClient,
  ): Promise<void>;

  findLiveOtpChallenge(
    identifierHash: Buffer,
    purpose: OtpPurpose,
    client?: PoolClient,
  ): Promise<OtpChallengeRecord | null>;

  /**
   * Spend one attempt and return the new total.
   *
   * Also stamps the moment the cap is reached, which starts the lockout. Doing
   * it here rather than in the service keeps the counter and its timestamp in
   * one atomic statement - they must never disagree.
   */
  incrementOtpAttempts(challengeId: string, client: PoolClient): Promise<number>;

  /** Everything the resend throttle needs, in one query. */
  getOtpThrottleState(
    identifierHash: Buffer,
    purpose: OtpPurpose,
    client?: PoolClient,
  ): Promise<OtpThrottleState>;

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
