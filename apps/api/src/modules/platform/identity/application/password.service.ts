import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DatabaseService } from '../../../../database/database.service.js';
import { StructuredLogger } from '../../../../common/logging/structured.logger.js';
import { IdentifierHasher } from '../domain/identifier-hash.js';
import { checkPassword } from '../domain/password-policy.js';
import type { UserState } from '../domain/user-state.js';
import {
  checkOtpResendAllowed,
  checkOtpUsable,
  generateOtpCode,
  hashOtpCode,
  otpExpiryFrom,
  otpMatches,
} from '../domain/otp.js';
import { tryNormalizePakistaniMobile } from '../domain/phone-number.js';
import { CLOCK, type Clock } from '../ports/clock.port.js';
import { PASSWORD_HASHER, type PasswordHasher } from '../ports/password-hasher.port.js';
import { SMS_PROVIDER, type SmsProvider } from '../ports/sms-provider.port.js';
import {
  IDENTITY_REPOSITORY,
  type IdentityRepository,
} from '../repositories/identity.repository.port.js';

export interface ForgotPasswordCommand {
  phone: string;
  correlationId?: string | undefined;
}

export interface ResetPasswordCommand {
  phone: string;
  code: string;
  newPassword: string;
  correlationId?: string | undefined;
}

export interface ChangePasswordCommand {
  userId: string;
  currentPassword: string;
  newPassword: string;
  /** The device asking. It stays signed in; every other device does not. */
  currentSessionId: string;
  correlationId?: string | undefined;
}

/** Uniform whether or not the number has an account (AUTH-API-006). */
export type ForgotPasswordResult =
  { status: 'ACCEPTED' } | { status: 'INVALID_INPUT'; field: 'phone' };

export type ResetPasswordResult =
  | { status: 'RESET'; sessionsRevoked: number }
  | { status: 'REJECTED' }
  | { status: 'INVALID_INPUT'; field: 'phone' | 'code' | 'newPassword'; reason?: string };

export type ChangePasswordResult =
  | { status: 'CHANGED'; sessionsRevoked: number }
  | { status: 'WRONG_PASSWORD' }
  | { status: 'INVALID_INPUT'; field: 'newPassword'; reason: string };

/**
 * Password reset and change (AUTH-FR-007 · SET-FR-002 · BR-007/035 · SEC-005/006).
 *
 * THE RULE THAT SHAPES ALL OF THIS: a password reset revokes every session in
 * the SAME TRANSACTION as the password change (BR-035).
 *
 * Not afterwards, and not in a follow-up job. Someone resetting their password
 * is very often doing it *because* they believe another person has access. If
 * the new hash commits and the revocation is a separate step that then fails,
 * the attacker keeps a live session while the victim believes they have just
 * locked them out — the worst possible outcome, and a silent one. So the two
 * are one atomic write, and the sessions are read inside that transaction.
 *
 * Reset takes the phone, the code and the new password in a SINGLE call. The
 * endpoint is public (AUTH-API-007), so it must carry its own proof; issuing an
 * intermediate "reset token" after OTP verification would create one more
 * bearer credential to leak, log or replay for no gain.
 */
@Injectable()
export class PasswordService {
  constructor(
    private readonly db: DatabaseService,
    @Inject(IDENTITY_REPOSITORY) private readonly repo: IdentityRepository,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasher,
    private readonly identifierHasher: IdentifierHasher,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly logger: StructuredLogger,
  ) {}

  /**
   * Start a reset (AUTH-API-006).
   *
   * "**Same response whether or not the number exists**" is the frozen wording,
   * so an unknown number, a banned account and a real user are one answer. The
   * code only reaches the number's actual holder.
   */
  async forgot(cmd: ForgotPasswordCommand): Promise<ForgotPasswordResult> {
    const phone = tryNormalizePakistaniMobile(cmd.phone);
    if (phone === null) return { status: 'INVALID_INPUT', field: 'phone' };

    const identifierHash = this.identifierHasher.hash(phone);
    let code: string | null = null;

    try {
      await this.db.withTransaction(async (client) => {
        const userId = await this.repo.findUserIdByIdentifierHash(identifierHash, client);
        if (userId === null) {
          this.log('password_forgot_unknown_identifier', cmd.correlationId);
          return;
        }

        // Reset shares the OTP throttle (SEC-005: 3/hour/number). Without it,
        // this endpoint is a free SMS-flood aimed at whoever holds the number.
        const throttle = await this.repo.getOtpThrottleState(
          identifierHash,
          'PASSWORD_RESET',
          client,
        );
        const refusal = checkOtpResendAllowed(throttle, this.clock.now());
        if (refusal !== null) {
          this.log(`password_forgot_${refusal.toLowerCase()}`, cmd.correlationId);
          return;
        }

        const fresh = generateOtpCode();
        await this.repo.replaceOtpChallenge(
          {
            id: randomUUID(),
            identifierHash,
            purpose: 'PASSWORD_RESET',
            codeHash: hashOtpCode(fresh),
            expiresAt: otpExpiryFrom(this.clock.now()),
          },
          client,
        );
        code = fresh;
      });
    } catch (e) {
      this.logger.error(
        JSON.stringify({ event: 'password_forgot_failed', correlationId: cmd.correlationId }),
        e instanceof Error ? e.stack : String(e),
        'identity',
      );
      return { status: 'ACCEPTED' };
    }

    if (code !== null) {
      const sent = await this.sms.send({
        to: phone,
        body: `Mohalla: your password reset code is ${code}. It expires in 10 minutes.`,
        correlationId: cmd.correlationId,
      });
      if (!sent.ok) {
        this.log('password_forgot_dispatch_failed', cmd.correlationId, {
          retryable: sent.retryable,
        });
      }
    }

    return { status: 'ACCEPTED' };
  }

  /**
   * Complete the reset (AUTH-API-007) — "Invalidates **all** sessions".
   *
   * Password policy is checked BEFORE the code is spent. A rejected new
   * password must not burn the user's one-time code and force them to request
   * another; that is a needless SMS and, at three per hour, a way to lock a
   * legitimate person out of their own recovery.
   */
  async reset(cmd: ResetPasswordCommand): Promise<ResetPasswordResult> {
    const phone = tryNormalizePakistaniMobile(cmd.phone);
    if (phone === null) return { status: 'INVALID_INPUT', field: 'phone' };
    if (!/^\d{6}$/.test(cmd.code)) return { status: 'INVALID_INPUT', field: 'code' };

    const policy = checkPassword(cmd.newPassword);
    if (policy !== null) {
      return { status: 'INVALID_INPUT', field: 'newPassword', reason: policy };
    }

    const identifierHash = this.identifierHasher.hash(phone);

    try {
      return await this.db.withTransaction(async (client) => {
        const throttle = await this.repo.getOtpThrottleState(
          identifierHash,
          'PASSWORD_RESET',
          client,
        );
        if (
          throttle.lockedUntil !== null &&
          throttle.lockedUntil.getTime() > this.clock.now().getTime()
        ) {
          this.log('password_reset_locked_out', cmd.correlationId);
          return { status: 'REJECTED' } as const;
        }

        const challenge = await this.repo.findLiveOtpChallenge(
          identifierHash,
          'PASSWORD_RESET',
          client,
        );
        if (challenge === null) {
          this.log('password_reset_no_challenge', cmd.correlationId);
          return { status: 'REJECTED' } as const;
        }

        const unusable = checkOtpUsable(challenge, this.clock.now());
        if (unusable !== null) {
          this.log(`password_reset_${unusable.toLowerCase()}`, cmd.correlationId);
          return { status: 'REJECTED' } as const;
        }

        // Spend the attempt before comparing, as in verification.
        await this.repo.incrementOtpAttempts(challenge.id, client);

        if (!otpMatches(cmd.code, challenge.codeHash)) {
          this.log('password_reset_incorrect_code', cmd.correlationId);
          return { status: 'REJECTED' } as const;
        }

        const userId = await this.repo.findUserIdByIdentifierHash(identifierHash, client);
        if (userId === null) {
          this.logger.error(
            JSON.stringify({
              event: 'password_reset_without_user',
              correlationId: cmd.correlationId,
            }),
            undefined,
            'identity',
          );
          return { status: 'REJECTED' } as const;
        }

        // ---- the atomic part (BR-035) ---------------------------------
        await this.repo.consumeOtpChallenge(challenge.id, client);
        await this.repo.updatePasswordHash(userId, await this.hasher.hash(cmd.newPassword), client);

        // Read inside the transaction: a session created between a prior read
        // and this write would otherwise survive the reset.
        const live = await this.repo.listLiveSessions(userId, client);
        if (live.length > 0) {
          await this.repo.revokeSessions(
            live.map((s) => s.id),
            'PASSWORD_RESET',
            client,
          );
        }

        this.log('password_reset', cmd.correlationId, { sessionsRevoked: live.length });
        return { status: 'RESET', sessionsRevoked: live.length } as const;
      });
    } catch (e) {
      this.logger.error(
        JSON.stringify({ event: 'password_reset_failed', correlationId: cmd.correlationId }),
        e instanceof Error ? e.stack : String(e),
        'identity',
      );
      return { status: 'REJECTED' };
    }
  }

  /**
   * Change a password while signed in (SET-FR-002).
   *
   * Requires the CURRENT password even though the caller already holds a valid
   * session: a borrowed or stolen phone should not be enough to lock the owner
   * out of their own account.
   *
   * Other devices are signed out; this one is not. The person doing the change
   * is present and has just proved it, so ejecting them would be pointless
   * friction — while everyone else, who may be the reason for the change, goes.
   */
  /**
   * "Is this really the account holder?" — asked by irreversible actions.
   *
   * WHY THIS EXISTS RATHER THAN THE CALLER READING THE HASH. Account deletion
   * (SET-FR-004) needs the password re-entered, and the obvious implementation
   * is for `settings` to fetch the user and call the hasher itself. That would
   * mean a second module knowing how a password is stored, and a second place
   * to update when the hash algorithm changes — the exact duplication that ends
   * with one of them still using the old verifier.
   *
   * So identity answers the QUESTION and keeps the mechanism. The caller learns
   * two facts and no credential.
   *
   * `null` when there is no such account. The state comes back with it because
   * the callers that need this also need to know whether the account may act,
   * and two round trips would be two chances for it to change in between.
   */
  async confirmIdentity(
    userId: string,
    password: string,
  ): Promise<{ state: UserState; verified: boolean } | null> {
    const user = await this.repo.findUserById(userId);
    if (user === null) return null;

    // The hasher never throws on a malformed stored hash (its port says so), so
    // a corrupt row reads as a wrong password rather than a 500. For deletion
    // that is the right failure: the account survives and the user is asked to
    // try again.
    return { state: user.state, verified: await this.hasher.verify(user.passwordHash, password) };
  }

  async change(cmd: ChangePasswordCommand): Promise<ChangePasswordResult> {
    const policy = checkPassword(cmd.newPassword);
    if (policy !== null) {
      return { status: 'INVALID_INPUT', field: 'newPassword', reason: policy };
    }

    return this.db.withTransaction(async (client) => {
      const user = await this.repo.findUserById(cmd.userId, client);

      // No account behind a valid session should be impossible; treat it as a
      // wrong password rather than a 500, and never as success.
      if (user === null || !(await this.hasher.verify(user.passwordHash, cmd.currentPassword))) {
        this.log('password_change_wrong_current', cmd.correlationId);
        return { status: 'WRONG_PASSWORD' } as const;
      }

      await this.repo.updatePasswordHash(
        cmd.userId,
        await this.hasher.hash(cmd.newPassword),
        client,
      );

      const live = await this.repo.listLiveSessions(cmd.userId, client);
      const others = live.map((s) => s.id).filter((id) => id !== cmd.currentSessionId);
      if (others.length > 0) {
        await this.repo.revokeSessions(others, 'PASSWORD_CHANGE', client);
      }

      this.log('password_changed', cmd.correlationId, { sessionsRevoked: others.length });
      return { status: 'CHANGED', sessionsRevoked: others.length } as const;
    });
  }

  private log(
    event: string,
    correlationId: string | undefined,
    extra: Record<string, unknown> = {},
  ): void {
    // No number, no code, no password.
    this.logger.log(JSON.stringify({ event, correlationId, ...extra }), 'identity');
  }
}
