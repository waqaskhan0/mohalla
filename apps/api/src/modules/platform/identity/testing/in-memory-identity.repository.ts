import type { PoolClient } from 'pg';
import {
  OTP_LOCKOUT_MS,
  OTP_MAX_ATTEMPTS,
  OTP_RESEND_WINDOW_MS,
  type OtpPurpose,
} from '../domain/otp.js';
import type {
  CreateUserInput,
  IdentityRepository,
  LoginSubjectKind,
  OtpChallengeRecord,
  OtpThrottleState,
  SessionRecord,
  UserRecord,
} from '../repositories/identity.repository.port.js';
import type { UserState } from '../domain/user-state.js';
import type { LoginFailureCounts } from '../domain/login-lockout.js';

/**
 * In-memory `IdentityRepository` for service tests.
 *
 * Deliberately a FAKE, not a mock: it enforces the same invariants PostgreSQL
 * does — one live challenge per identifier and purpose, unique identifiers,
 * the attempt cap stamping its own lockout — so a service test that passes
 * here is testing behaviour rather than a recording of call order.
 *
 * It is NOT a substitute for the integration tests. Anything that depends on
 * actual SQL (constraint names, isolation, the UNIQUE race) is proved against
 * real PostgreSQL; this exists so the *policy* tests run in milliseconds.
 *
 * `client` arguments are ignored: there is one store and no isolation, so a
 * test that needs true transactional behaviour belongs in the integration
 * suite. Everything here is synchronous under the hood, which also means the
 * `now` hook below is enough to control time exactly.
 */
export class InMemoryIdentityRepository implements IdentityRepository {
  /** Overridable clock, so lockouts and cooldowns are tested without waiting. */
  now: () => Date = () => new Date();

  readonly users = new Map<string, UserRecord>();
  /** hex(identifier hash) -> userId */
  readonly identifiers = new Map<string, string>();
  readonly bannedIdentifiers = new Set<string>();
  readonly challenges: OtpChallengeRecord[] = [];
  readonly sessions: SessionRecord[] = [];

  /** Set to make the next create lose the uniqueness race (EDGE-001). */
  loseUniquenessRace = false;

  /** Observability for tests that assert what did NOT happen. */
  passwordHashCalls = 0;
  readonly revocations: { ids: readonly string[]; reason: string }[] = [];

  private key(hash: Buffer): string {
    return hash.toString('hex');
  }

  // ---- identifiers -----------------------------------------------------
  async isIdentifierBanned(hash: Buffer): Promise<boolean> {
    return this.bannedIdentifiers.has(this.key(hash));
  }

  async findUserIdByIdentifierHash(hash: Buffer): Promise<string | null> {
    return this.identifiers.get(this.key(hash)) ?? null;
  }

  // ---- users -----------------------------------------------------------
  async findUserById(id: string): Promise<UserRecord | null> {
    return this.users.get(id) ?? null;
  }

  async createUserWithPrimaryPhone(
    input: CreateUserInput,
    identifier: { id: string; normalized: string; hash: Buffer },
  ): Promise<UserRecord | null> {
    // Mirrors `UNIQUE (value_hash)`: the check and the insert are one step, so
    // the fake cannot pass a test that real PostgreSQL would fail.
    if (this.loseUniquenessRace || this.identifiers.has(this.key(identifier.hash))) return null;

    const user: UserRecord = {
      id: input.id,
      state: 'UNVERIFIED',
      accountType: input.accountType,
      username: null,
      passwordHash: input.passwordHash,
      dateOfBirth: input.dateOfBirth,
      suspendedUntil: null,
      termsVersion: input.termsVersion,
      termsAcceptedAt: this.now(),
      createdAt: this.now(),
    };
    this.users.set(user.id, user);
    this.identifiers.set(this.key(identifier.hash), user.id);
    return user;
  }

  async findUserByIdentifierHash(hash: Buffer): Promise<UserRecord | null> {
    const id = this.identifiers.get(this.key(hash));
    return id === undefined ? null : (this.users.get(id) ?? null);
  }

  async updatePasswordHash(userId: string, passwordHash: string): Promise<void> {
    const u = this.users.get(userId);
    if (u) this.users.set(userId, { ...u, passwordHash });
  }

  async markUserVerified(userId: string): Promise<void> {
    this.setState(userId, 'ACTIVE');
  }

  /** Test helper — put an account into any state without going through a flow. */
  setState(userId: string, state: UserState): void {
    const u = this.users.get(userId);
    if (u) this.users.set(userId, { ...u, state });
  }

  // ---- OTP -------------------------------------------------------------
  async replaceOtpChallenge(
    challenge: Omit<
      OtpChallengeRecord,
      'attempts' | 'consumedAt' | 'createdAt' | 'attemptsExhaustedAt'
    >,
  ): Promise<void> {
    // The partial unique index allows only one live challenge per
    // identifier+purpose, so issuing a new one consumes the old.
    for (let i = 0; i < this.challenges.length; i += 1) {
      const c = this.challenges[i];
      if (
        c !== undefined &&
        c.consumedAt === null &&
        c.identifierHash.equals(challenge.identifierHash) &&
        c.purpose === challenge.purpose
      ) {
        this.challenges[i] = { ...c, consumedAt: this.now() };
      }
    }
    this.challenges.push({
      ...challenge,
      attempts: 0,
      consumedAt: null,
      createdAt: this.now(),
      attemptsExhaustedAt: null,
    });
  }

  async findLiveOtpChallenge(
    identifierHash: Buffer,
    purpose: OtpPurpose,
  ): Promise<OtpChallengeRecord | null> {
    for (let i = this.challenges.length - 1; i >= 0; i -= 1) {
      const c = this.challenges[i];
      if (
        c !== undefined &&
        c.consumedAt === null &&
        c.identifierHash.equals(identifierHash) &&
        c.purpose === purpose
      ) {
        return c;
      }
    }
    return null;
  }

  async incrementOtpAttempts(challengeId: string): Promise<number> {
    const i = this.challenges.findIndex((c) => c.id === challengeId);
    const c = this.challenges[i];
    if (c === undefined) return 0;

    const attempts = c.attempts + 1;
    this.challenges[i] = {
      ...c,
      attempts,
      // Same rule as the SQL: stamp on reaching the cap, and keep the FIRST
      // stamp so a later attempt cannot push the lockout further out.
      attemptsExhaustedAt:
        attempts >= OTP_MAX_ATTEMPTS
          ? (c.attemptsExhaustedAt ?? this.now())
          : c.attemptsExhaustedAt,
    };
    return attempts;
  }

  async consumeOtpChallenge(challengeId: string): Promise<void> {
    const i = this.challenges.findIndex((c) => c.id === challengeId);
    const c = this.challenges[i];
    if (c !== undefined) this.challenges[i] = { ...c, consumedAt: this.now() };
  }

  async getOtpThrottleState(
    identifierHash: Buffer,
    purpose: OtpPurpose,
  ): Promise<OtpThrottleState> {
    const now = this.now().getTime();
    const mine = this.challenges.filter(
      (c) => c.identifierHash.equals(identifierHash) && c.purpose === purpose,
    );

    let lastIssuedAt: Date | null = null;
    let issuedLastHour = 0;
    let lockedUntil: Date | null = null;

    for (const c of mine) {
      if (lastIssuedAt === null || c.createdAt > lastIssuedAt) lastIssuedAt = c.createdAt;
      if (now - c.createdAt.getTime() < OTP_RESEND_WINDOW_MS) issuedLastHour += 1;

      const exhausted = c.attemptsExhaustedAt;
      if (exhausted !== null) {
        const until = new Date(exhausted.getTime() + OTP_LOCKOUT_MS);
        if (lockedUntil === null || until > lockedUntil) lockedUntil = until;
      }
    }

    return {
      lastIssuedAt,
      issuedLastHour,
      // An elapsed lockout is not a lockout.
      lockedUntil: lockedUntil !== null && lockedUntil.getTime() > now ? lockedUntil : null,
    };
  }

  // ---- sessions ---------------------------------------------------------
  async listLiveSessions(userId: string): Promise<SessionRecord[]> {
    const now = this.now().getTime();
    return this.sessions.filter(
      (s) => s.userId === userId && s.revokedAt === null && s.expiresAt.getTime() > now,
    );
  }

  async createSession(input: {
    id: string;
    userId: string;
    tokenHash: Buffer;
    expiresAt: Date;
    deviceLabel: string | null;
  }): Promise<void> {
    this.sessions.push({
      id: input.id,
      userId: input.userId,
      createdAt: this.now(),
      expiresAt: input.expiresAt,
      revokedAt: null,
    });
    this.tokenHashes.set(input.tokenHash.toString('hex'), input.id);
  }

  private readonly tokenHashes = new Map<string, string>();

  async revokeSessions(sessionIds: readonly string[], reason: string): Promise<void> {
    this.revocations.push({ ids: [...sessionIds], reason });
    for (let i = 0; i < this.sessions.length; i += 1) {
      const s = this.sessions[i];
      if (s !== undefined && sessionIds.includes(s.id) && s.revokedAt === null) {
        this.sessions[i] = { ...s, revokedAt: this.now() };
      }
    }
  }

  async findLiveSessionByTokenHash(tokenHash: Buffer): Promise<SessionRecord | null> {
    const id = this.tokenHashes.get(tokenHash.toString('hex'));
    if (id === undefined) return null;
    const s = this.sessions.find((x) => x.id === id);
    if (s === undefined || s.revokedAt !== null) return null;
    return s.expiresAt.getTime() > this.now().getTime() ? s : null;
  }

  async touchSession(sessionId: string, expiresAt: Date): Promise<void> {
    const i = this.sessions.findIndex((x) => x.id === sessionId);
    const s = this.sessions[i];
    // Same guard as the SQL: never slide a revoked or expired session.
    if (s === undefined || s.revokedAt !== null) return;
    if (s.expiresAt.getTime() <= this.now().getTime()) return;
    this.sessions[i] = { ...s, expiresAt };
  }

  // ---- login attempts -----------------------------------------------------
  readonly loginAttempts: {
    subjectKind: LoginSubjectKind;
    subjectHash: Buffer;
    sourceHash: Buffer | null;
    succeeded: boolean;
    createdAt: Date;
  }[] = [];

  async recordLoginAttempt(attempt: {
    id: string;
    subjectKind: LoginSubjectKind;
    subjectHash: Buffer;
    sourceHash: Buffer | null;
    succeeded: boolean;
  }): Promise<void> {
    this.loginAttempts.push({
      subjectKind: attempt.subjectKind,
      subjectHash: attempt.subjectHash,
      sourceHash: attempt.sourceHash,
      succeeded: attempt.succeeded,
      createdAt: this.now(),
    });
  }

  async getLoginFailureCounts(
    subjectKind: LoginSubjectKind,
    subjectHash: Buffer,
    sourceHash: Buffer | null,
    windowMs: number,
  ): Promise<LoginFailureCounts> {
    const now = this.now().getTime();
    const inWindow = (at: Date) => now - at.getTime() < windowMs;
    const mine = this.loginAttempts.filter((a) => a.subjectKind === subjectKind);

    // Account failures count only from the last success onward.
    let lastSuccessAt = -Infinity;
    for (const a of mine) {
      if (a.succeeded && a.subjectHash.equals(subjectHash)) {
        lastSuccessAt = Math.max(lastSuccessAt, a.createdAt.getTime());
      }
    }

    let account = 0;
    let source = 0;
    let lastFailureAt: Date | null = null;

    for (const a of mine) {
      if (a.succeeded) continue;
      const sameAccount = a.subjectHash.equals(subjectHash);
      const sameSource =
        sourceHash !== null && a.sourceHash !== null && a.sourceHash.equals(sourceHash);

      if (sameAccount && inWindow(a.createdAt) && a.createdAt.getTime() > lastSuccessAt) {
        account += 1;
      }
      if (sameSource && inWindow(a.createdAt)) source += 1;

      if (
        (sameAccount || sameSource) &&
        inWindow(a.createdAt) &&
        (lastFailureAt === null || a.createdAt > lastFailureAt)
      ) {
        lastFailureAt = a.createdAt;
      }
    }

    return { account, source, lastFailureAt };
  }
}

/** Satisfies the unused-parameter lint for the ignored `client` arguments. */
export type IgnoredClient = PoolClient | undefined;
