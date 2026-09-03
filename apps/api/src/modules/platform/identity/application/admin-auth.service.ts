import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DatabaseService } from '../../../../database/database.service.js';
import { StructuredLogger } from '../../../../common/logging/structured.logger.js';
import { AuditService } from '../../audit/audit.service.js';
import { IdentifierHasher } from '../domain/identifier-hash.js';
import { hashSessionToken, issueSessionToken } from '../domain/session-token.js';
import {
  ADMIN_LOGIN_MAX_FAILURES,
  ADMIN_SESSION_ABSOLUTE_MS,
  LOGIN_FAILURE_WINDOW_MS,
  LOGIN_LOCKOUT_MS,
} from '../domain/login-lockout.js';
import type { Clock } from '../ports/clock.port.js';
import type { PasswordHasher } from '../ports/password-hasher.port.js';
import type { AdminIdentityRepository } from '../repositories/admin-identity.repository.port.js';
import type { IdentityRepository } from '../repositories/identity.repository.port.js';

export interface AdminLoginCommand {
  email: string;
  password: string;
  sourceAddress?: string;
  correlationId?: string;
}

export type AdminLoginResult =
  | { status: 'AUTHENTICATED'; token: string; expiresAt: Date; adminId: string }
  | { status: 'FAILED' }
  | { status: 'INVALID_INPUT'; field: 'email' | 'password' };

export interface AdminPrincipal {
  adminId: string;
  sessionId: string;
  /** Absolute, never slid. The console signs you out after 8 hours. */
  expiresAt: Date;
}

export type ResolveAdminResult =
  { status: 'AUTHENTICATED'; principal: AdminPrincipal } | { status: 'UNAUTHENTICATED' };

/**
 * Administrator authentication (SEC-020 · SEC-021 · SEC-024 · AUTH-FR-011).
 *
 * THREE THINGS ARE DELIBERATELY DIFFERENT FROM USER LOGIN.
 *
 * 1. A SEPARATE STORE, reached through a separate port. An administrator
 *    credential must not authenticate a user session and a user credential
 *    must not authenticate an admin session — a moderator's password is not a
 *    key to the neighbourhood feed, and a user's password is certainly not a
 *    key to the moderation console. Two ports make crossing them a compile
 *    error rather than a code-review question.
 *
 * 2. AN ABSOLUTE 8-HOUR LIFETIME, not a sliding idle window (SEC-024). A user
 *    session slides because signing out an active person is hostile. The
 *    opposite is true here: an admin console left open on an unattended
 *    machine is exactly the risk, so the session dies on schedule no matter
 *    how busy the moderator is.
 *
 * 3. A LOWER FAILURE THRESHOLD — five, against ten for users — because the
 *    population is tiny and known. Ten failures against an administrator
 *    account is not someone fumbling their password; it is an attack.
 *
 * EVERY LOGIN IS AUDITED, successes and failures alike, in the SAME
 * TRANSACTION as the session write. A successful admin sign-in with no audit
 * row is precisely the event an intruder would want unrecorded.
 */
@Injectable()
export class AdminAuthService {
  private decoyHash: Promise<string> | null = null;

  constructor(
    private readonly db: DatabaseService,
    private readonly admins: AdminIdentityRepository,
    /** Shared only for the login-attempt history, which is kind-scoped. */
    private readonly attempts: IdentityRepository,
    private readonly hasher: PasswordHasher,
    private readonly identifierHasher: IdentifierHasher,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly logger: StructuredLogger,
  ) {}

  async login(cmd: AdminLoginCommand): Promise<AdminLoginResult> {
    const email = typeof cmd.email === 'string' ? cmd.email.trim() : '';
    if (email.length === 0 || !email.includes('@')) {
      return { status: 'INVALID_INPUT', field: 'email' };
    }
    if (typeof cmd.password !== 'string' || cmd.password.length === 0) {
      return { status: 'INVALID_INPUT', field: 'password' };
    }

    // Hashed, so the attempt history never holds an administrator's address.
    const subjectHash = this.identifierHasher.hash(email.toLowerCase());
    const sourceHash =
      cmd.sourceAddress === undefined ? null : this.identifierHasher.hash(cmd.sourceAddress);

    try {
      return await this.db.withTransaction(async (client) => {
        const counts = await this.attempts.getLoginFailureCounts(
          'ADMIN',
          subjectHash,
          sourceHash,
          LOGIN_FAILURE_WINDOW_MS,
          client,
        );

        const lockedUntil =
          counts.lastFailureAt === null
            ? null
            : new Date(counts.lastFailureAt.getTime() + LOGIN_LOCKOUT_MS);

        if (
          counts.account >= ADMIN_LOGIN_MAX_FAILURES &&
          lockedUntil !== null &&
          lockedUntil.getTime() > this.clock.now().getTime()
        ) {
          await this.recordAttempt(subjectHash, sourceHash, false, client);
          await this.audit.append(
            {
              actorType: 'ADMIN',
              actorId: null,
              action: 'ADMIN_LOGIN_BLOCKED_LOCKOUT',
              entityType: 'ADMIN_SESSION',
              metadata: { failures: counts.account },
              ipHash: sourceHash,
            },
            client,
          );
          return { status: 'FAILED' } as const;
        }

        const admin = await this.admins.findAdminByEmail(email, client);

        // Same timing discipline as user login: the hash is verified even when
        // there is no such administrator, so latency does not reveal which
        // addresses are administrators — a far smaller and more valuable set to
        // enumerate than the user base.
        const passwordOk =
          admin === null
            ? await this.verifyDecoy(cmd.password)
            : await this.hasher.verify(admin.passwordHash, cmd.password);

        if (admin === null || !passwordOk || admin.state !== 'ACTIVE') {
          await this.recordAttempt(subjectHash, sourceHash, false, client);
          await this.audit.append(
            {
              actorType: 'ADMIN',
              // Named only when the account exists; otherwise there is no
              // administrator to attribute this to.
              actorId: admin?.id ?? null,
              action: 'ADMIN_LOGIN_FAILED',
              entityType: 'ADMIN_SESSION',
              entityId: admin?.id ?? null,
              metadata: {
                reason:
                  admin === null
                    ? 'UNKNOWN_ACCOUNT'
                    : admin.state !== 'ACTIVE'
                      ? 'ACCOUNT_DISABLED'
                      : 'BAD_PASSWORD',
              },
              ipHash: sourceHash,
            },
            client,
          );
          return { status: 'FAILED' } as const;
        }

        await this.recordAttempt(subjectHash, sourceHash, true, client);

        const issued = issueSessionToken(this.clock.now());
        // SEC-024: absolute, and shorter than the user default. Computed here
        // rather than taken from `issued`, whose expiry is the 60-day idle
        // window meant for a personal phone.
        const expiresAt = new Date(this.clock.now().getTime() + ADMIN_SESSION_ABSOLUTE_MS);
        const sessionId = randomUUID();

        await this.admins.createAdminSession(
          { id: sessionId, adminId: admin.id, tokenHash: issued.tokenHash, expiresAt },
          client,
        );

        await this.audit.append(
          {
            actorType: 'ADMIN',
            actorId: admin.id,
            action: 'ADMIN_LOGIN_SUCCEEDED',
            entityType: 'ADMIN_SESSION',
            entityId: sessionId,
            metadata: { expiresAt: expiresAt.toISOString() },
            ipHash: sourceHash,
          },
          client,
        );

        return {
          status: 'AUTHENTICATED',
          token: issued.token,
          expiresAt,
          adminId: admin.id,
        } as const;
      });
    } catch (e) {
      this.logger.error(
        JSON.stringify({ event: 'admin_login_failed', correlationId: cmd.correlationId }),
        e instanceof Error ? e.stack : String(e),
        'identity',
      );
      return { status: 'FAILED' };
    }
  }

  /**
   * Resolve an admin bearer token.
   *
   * No sliding. The expiry set at login is the expiry, full stop (SEC-024).
   */
  async resolve(token: string): Promise<ResolveAdminResult> {
    if (typeof token !== 'string' || token.length === 0) {
      return { status: 'UNAUTHENTICATED' };
    }

    try {
      const session = await this.admins.findLiveAdminSessionByTokenHash(hashSessionToken(token));
      if (session === null) return { status: 'UNAUTHENTICATED' };
      if (session.expiresAt.getTime() <= this.clock.now().getTime()) {
        return { status: 'UNAUTHENTICATED' };
      }

      // Re-read on every request, exactly as for users: disabling an
      // administrator must take effect immediately, not at their next sign-in.
      const admin = await this.admins.findAdminById(session.adminId);
      if (admin === null || admin.state !== 'ACTIVE') {
        await this.db.withTransaction((client) =>
          this.admins.revokeAdminSessions([session.id], client),
        );
        return { status: 'UNAUTHENTICATED' };
      }

      return {
        status: 'AUTHENTICATED',
        principal: {
          adminId: admin.id,
          sessionId: session.id,
          expiresAt: session.expiresAt,
        },
      };
    } catch (e) {
      // Fail closed.
      this.logger.error(
        JSON.stringify({ event: 'admin_session_resolve_failed' }),
        e instanceof Error ? e.stack : String(e),
        'identity',
      );
      return { status: 'UNAUTHENTICATED' };
    }
  }

  async logout(principal: AdminPrincipal): Promise<void> {
    await this.db.withTransaction(async (client) => {
      await this.admins.revokeAdminSessions([principal.sessionId], client);
      await this.audit.append(
        {
          actorType: 'ADMIN',
          actorId: principal.adminId,
          action: 'ADMIN_LOGOUT',
          entityType: 'ADMIN_SESSION',
          entityId: principal.sessionId,
        },
        client,
      );
    });
  }

  private async recordAttempt(
    subjectHash: Buffer,
    sourceHash: Buffer | null,
    succeeded: boolean,
    client: Parameters<Parameters<DatabaseService['withTransaction']>[0]>[0],
  ): Promise<void> {
    await this.attempts.recordLoginAttempt(
      { id: randomUUID(), subjectKind: 'ADMIN', subjectHash, sourceHash, succeeded },
      client,
    );
  }

  private async verifyDecoy(password: string): Promise<false> {
    this.decoyHash ??= this.hasher.hash(`decoy:${randomUUID()}:${randomUUID()}`);
    await this.hasher.verify(await this.decoyHash, password);
    return false;
  }
}
