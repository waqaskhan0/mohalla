import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DatabaseService } from '../../../../database/database.service.js';
import { StructuredLogger } from '../../../../common/logging/structured.logger.js';
import { IdentifierHasher } from '../domain/identifier-hash.js';
import { tryNormalizePakistaniMobile } from '../domain/phone-number.js';
import { authOutcomeFor } from '../domain/user-state.js';
import { LOGIN_FAILURE_WINDOW_MS, checkLoginLockout } from '../domain/login-lockout.js';
import { issueSessionToken, sessionsToEvict } from '../domain/session-token.js';
import type { Clock } from '../ports/clock.port.js';
import type { PasswordHasher } from '../ports/password-hasher.port.js';
import type { IdentityRepository } from '../repositories/identity.repository.port.js';

export interface LoginCommand {
  phone: string;
  password: string;
  /** Opaque label the user sees in their device list. Never a fingerprint. */
  deviceLabel?: string;
  /** Source address, hashed before storage. Absent when unavailable. */
  sourceAddress?: string;
  correlationId?: string;
}

/** What the client may act on. Anything else is the one uniform failure. */
export type LoginResult =
  | {
      status: 'AUTHENTICATED';
      token: string;
      expiresAt: Date;
      userId: string;
      /**
       * FULL for an active account; READ_ONLY for a suspension (BR-034);
       * RESTORE_ONLY while deletion is pending (SET-FR-005).
       */
      capability: 'FULL' | 'READ_ONLY' | 'RESTORE_ONLY';
      suspendedUntil?: Date | null;
    }
  | { status: 'VERIFICATION_REQUIRED' }
  | { status: 'FAILED' }
  | { status: 'INVALID_INPUT'; field: 'phone' | 'password' };

/**
 * Login (AUTH-FR-005/010 · SEC-006/007 · BR-007/034/035 · EDGE-009/010).
 *
 * TWO THINGS MAKE THIS DIFFERENT FROM AN ORDINARY PASSWORD CHECK.
 *
 * 1. UNIFORMITY IN BOTH BODY AND TIME (SEC-006). A wrong password, an unknown
 *    number and a banned account return the identical `FAILED` — and take
 *    comparable time. The obvious implementation returns early when the number
 *    is unknown, which skips the ~236 ms Argon2 verification and turns response
 *    latency into a membership oracle: fast means "no account here". So the
 *    hash is verified even when there is no account, against a decoy. The
 *    timing signal is REMOVED, not merely reduced (09-auth §69).
 *
 * 2. THE DEVICE CAP IS A SECURITY CONTROL, NOT TIDINESS (BR-007, EDGE-009).
 *    Eviction of the oldest session and insertion of the new one happen in ONE
 *    transaction, so two simultaneous logins cannot both see five sessions,
 *    both evict one, and leave six alive.
 *
 * A successful login with a correct password may still not be a full session:
 * an unverified account is routed back to OTP, a suspended one gets a
 * read-only session, and one pending deletion gets a session that can only
 * restore. Those distinctions are safe to disclose because reaching them
 * already required the right password.
 */
@Injectable()
export class LoginService {
  /**
   * Decoy hash, verified when no account exists so the work is identical.
   *
   * Generated once at construction from a random secret nobody holds, so it
   * cannot match any password and cannot be recognised as a constant across
   * deployments.
   */
  private decoyHash: Promise<string> | null = null;

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: IdentityRepository,
    private readonly hasher: PasswordHasher,
    private readonly identifierHasher: IdentifierHasher,
    private readonly clock: Clock,
    private readonly logger: StructuredLogger,
  ) {}

  async login(cmd: LoginCommand): Promise<LoginResult> {
    const phone = tryNormalizePakistaniMobile(cmd.phone);
    if (phone === null) return { status: 'INVALID_INPUT', field: 'phone' };
    if (typeof cmd.password !== 'string' || cmd.password.length === 0) {
      return { status: 'INVALID_INPUT', field: 'password' };
    }

    const subjectHash = this.identifierHasher.hash(phone);
    const sourceHash =
      cmd.sourceAddress === undefined ? null : this.identifierHasher.hash(cmd.sourceAddress);

    try {
      return await this.db.withTransaction(async (client) => {
        // ---- lockout (SEC-007) -----------------------------------------
        const counts = await this.repo.getLoginFailureCounts(
          'USER',
          subjectHash,
          sourceHash,
          LOGIN_FAILURE_WINDOW_MS,
          client,
        );
        const lockout = checkLoginLockout(counts, this.clock.now());
        if (lockout !== null) {
          // Not disclosed. "Locked out" would confirm the account exists, and
          // would tell an attacker their spraying is working.
          this.log('login_locked_out', cmd.correlationId, { reason: lockout.reason });
          return { status: 'FAILED' } as const;
        }

        const user = await this.repo.findUserByIdentifierHash(subjectHash, client);

        // ---- the password check, always paid for ------------------------
        const passwordOk =
          user === null
            ? // No account. Verify anyway, against a hash that cannot match, so
              // this path costs what the real one costs.
              await this.verifyDecoy(cmd.password)
            : await this.hasher.verify(user.passwordHash, cmd.password);

        if (user === null || !passwordOk) {
          await this.recordFailure(subjectHash, sourceHash, client);
          this.log(
            user === null ? 'login_unknown_identifier' : 'login_bad_password',
            cmd.correlationId,
          );
          return { status: 'FAILED' } as const;
        }

        // ---- what this account's state permits --------------------------
        const outcome = authOutcomeFor(user.state, user.suspendedUntil);

        if (outcome.kind === 'DENY_NEUTRAL') {
          // Banned or deleted. Recorded as a failure so a banned account cannot
          // be used as an unlimited password-guessing oracle either.
          await this.recordFailure(subjectHash, sourceHash, client);
          this.log('login_denied_state', cmd.correlationId, { state: user.state });
          return { status: 'FAILED' } as const;
        }

        // The password was right, so the attempt is a success for lockout
        // purposes even when no session follows.
        await this.repo.recordLoginAttempt(
          { id: randomUUID(), subjectKind: 'USER', subjectHash, sourceHash, succeeded: true },
          client,
        );

        if (outcome.kind === 'VERIFY_REQUIRED') {
          this.log('login_verification_required', cmd.correlationId);
          return { status: 'VERIFICATION_REQUIRED' } as const;
        }

        // ---- rehash if the parameters have moved on ---------------------
        // The user just handed over the plaintext; this is the only moment an
        // old hash can be upgraded without asking them to do anything.
        if (this.hasher.needsRehash(user.passwordHash)) {
          await this.repo.updatePasswordHash(user.id, await this.hasher.hash(cmd.password), client);
          this.log('password_rehashed', cmd.correlationId);
        }

        const session = await this.issueSession(user.id, cmd.deviceLabel ?? null, client);

        this.log('login_succeeded', cmd.correlationId, { capability: outcome.kind });
        return {
          status: 'AUTHENTICATED',
          token: session.token,
          expiresAt: session.expiresAt,
          userId: user.id,
          capability:
            outcome.kind === 'ALLOW'
              ? ('FULL' as const)
              : outcome.kind === 'READ_ONLY'
                ? ('READ_ONLY' as const)
                : ('RESTORE_ONLY' as const),
          suspendedUntil: outcome.kind === 'READ_ONLY' ? outcome.until : null,
        } as const;
      });
    } catch (e) {
      this.logger.error(
        JSON.stringify({ event: 'login_failed', correlationId: cmd.correlationId }),
        e instanceof Error ? e.stack : String(e),
        'identity',
      );
      // An infrastructure failure must not be a distinguishable answer either.
      return { status: 'FAILED' };
    }
  }

  /**
   * Issue a session, evicting the oldest if this is the sixth device.
   *
   * Both steps inside the caller's transaction (BR-007, EDGE-009): read, evict
   * and insert must be atomic or two simultaneous logins each see five live
   * sessions, each evict one, and six survive.
   */
  private async issueSession(
    userId: string,
    deviceLabel: string | null,
    client: Parameters<Parameters<DatabaseService['withTransaction']>[0]>[0],
  ): Promise<{ token: string; expiresAt: Date }> {
    const live = await this.repo.listLiveSessions(userId, client);
    const evict = sessionsToEvict(live);

    if (evict.length > 0) {
      await this.repo.revokeSessions(
        evict.map((s) => s.id),
        'EVICTED',
        client,
      );
    }

    const issued = issueSessionToken(this.clock.now());
    await this.repo.createSession(
      {
        id: randomUUID(),
        userId,
        tokenHash: issued.tokenHash,
        expiresAt: issued.expiresAt,
        deviceLabel,
      },
      client,
    );

    return { token: issued.token, expiresAt: issued.expiresAt };
  }

  private async recordFailure(
    subjectHash: Buffer,
    sourceHash: Buffer | null,
    client: Parameters<Parameters<DatabaseService['withTransaction']>[0]>[0],
  ): Promise<void> {
    await this.repo.recordLoginAttempt(
      { id: randomUUID(), subjectKind: 'USER', subjectHash, sourceHash, succeeded: false },
      client,
    );
  }

  /**
   * Verify against a hash that cannot match, purely to spend the same time.
   *
   * Built lazily and cached: hashing at construction would add ~236 ms to
   * application start, and the value is identical for every call.
   */
  private async verifyDecoy(password: string): Promise<false> {
    this.decoyHash ??= this.hasher.hash(`decoy:${randomUUID()}:${randomUUID()}`);
    await this.hasher.verify(await this.decoyHash, password);
    return false;
  }

  private log(
    event: string,
    correlationId: string | undefined,
    extra: Record<string, unknown> = {},
  ): void {
    // Never the number, never the password, never the token.
    this.logger.log(JSON.stringify({ event, correlationId, ...extra }), 'identity');
  }
}
