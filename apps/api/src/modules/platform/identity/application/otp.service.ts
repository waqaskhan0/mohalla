import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DatabaseService } from '../../../../database/database.service.js';
import { StructuredLogger } from '../../../../common/logging/structured.logger.js';
import { IdentifierHasher } from '../domain/identifier-hash.js';
import {
  checkOtpResendAllowed,
  checkOtpUsable,
  generateOtpCode,
  hashOtpCode,
  otpExpiryFrom,
  otpMatches,
  type OtpPurpose,
} from '../domain/otp.js';
import { tryNormalizePakistaniMobile } from '../domain/phone-number.js';
import { CLOCK, type Clock } from '../ports/clock.port.js';
import { SMS_PROVIDER, type SmsProvider } from '../ports/sms-provider.port.js';
import {
  IDENTITY_REPOSITORY,
  type IdentityRepository,
} from '../repositories/identity.repository.port.js';

export interface VerifyOtpCommand {
  phone: string;
  code: string;
  purpose: OtpPurpose;
  correlationId?: string | undefined;
}

export interface ResendOtpCommand {
  phone: string;
  purpose: OtpPurpose;
  correlationId?: string | undefined;
}

/**
 * Verification outcomes.
 *
 * `REJECTED` is deliberately ONE value covering every failure: wrong code, no
 * challenge, expired, already used, attempts exhausted, unknown number. See the
 * class comment — telling the caller *which* of those it was would rebuild the
 * membership oracle that registration is careful not to be.
 */
export type VerifyOtpResult =
  | { status: 'VERIFIED'; userId: string }
  | { status: 'REJECTED' }
  | { status: 'INVALID_INPUT'; field: 'phone' | 'code' };

/** Resend is uniform for the same reason: it never confirms a number exists. */
export type ResendOtpResult = { status: 'ACCEPTED' } | { status: 'INVALID_INPUT'; field: 'phone' };

/**
 * OTP verification and resend (SEC-003 · AUTH-FR-002 · EDGE-005).
 *
 * A six-digit code is only 10^6 possibilities, which is nothing to a machine.
 * The security therefore comes from three limits, not from the code:
 *
 *   - it dies after 10 minutes,
 *   - it dies after 5 wrong attempts,
 *   - it dies the moment it is used, or a new one is issued.
 *
 * All three are enforced here AND by database constraints, because this is the
 * one gate between "someone typed a phone number" and "this account is real".
 *
 * Attempts are counted BEFORE the code is compared, and in the same transaction
 * as the comparison. Counting afterwards would let a client fire many parallel
 * guesses that all read `attempts = 0` and never trip the cap — which is how
 * a five-attempt limit quietly becomes unlimited.
 */
@Injectable()
export class OtpService {
  constructor(
    private readonly db: DatabaseService,
    @Inject(IDENTITY_REPOSITORY) private readonly repo: IdentityRepository,
    private readonly identifierHasher: IdentifierHasher,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly logger: StructuredLogger,
  ) {}

  async verify(cmd: VerifyOtpCommand): Promise<VerifyOtpResult> {
    const phone = tryNormalizePakistaniMobile(cmd.phone);
    if (phone === null) return { status: 'INVALID_INPUT', field: 'phone' };

    // Shape only. Whether the code is *correct* is never an input error — that
    // answer belongs behind the attempt counter.
    if (!/^\d{6}$/.test(cmd.code)) return { status: 'INVALID_INPUT', field: 'code' };

    const identifierHash = this.identifierHasher.hash(phone);

    try {
      return await this.db.withTransaction(async (client) => {
        // A lockout from a previous exhausted challenge still applies to a NEW
        // one. Checking only the current challenge's own counter would let an
        // attacker resend past the lockout the moment the cooldown lapses.
        const throttle = await this.repo.getOtpThrottleState(identifierHash, cmd.purpose, client);
        if (
          throttle.lockedUntil !== null &&
          throttle.lockedUntil.getTime() > this.clock.now().getTime()
        ) {
          this.logInternal('otp_verify_locked_out', cmd.purpose, cmd.correlationId);
          return { status: 'REJECTED' } as const;
        }

        const challenge = await this.repo.findLiveOtpChallenge(identifierHash, cmd.purpose, client);

        // No challenge at all: either the number never registered, or its code
        // was already used. Identical answer to a wrong code.
        if (challenge === null) {
          this.logInternal('otp_verify_no_challenge', cmd.purpose, cmd.correlationId);
          return { status: 'REJECTED' } as const;
        }

        const unusable = checkOtpUsable(challenge, this.clock.now());
        if (unusable !== null) {
          this.logInternal(`otp_verify_${unusable.toLowerCase()}`, cmd.purpose, cmd.correlationId);
          return { status: 'REJECTED' } as const;
        }

        // Spend the attempt FIRST. If the comparison below throws, or the
        // connection drops, the attempt is still spent — failing closed.
        const attempts = await this.repo.incrementOtpAttempts(challenge.id, client);

        if (!otpMatches(cmd.code, challenge.codeHash)) {
          this.logInternal('otp_verify_incorrect', cmd.purpose, cmd.correlationId, { attempts });
          return { status: 'REJECTED' } as const;
        }

        const userId = await this.repo.findUserIdByIdentifierHash(identifierHash, client);
        if (userId === null) {
          // A correct code with no owning account should be impossible: the
          // challenge and the user are written in one transaction. Log loudly
          // rather than silently succeeding into an inconsistent state.
          this.logger.error(
            JSON.stringify({
              event: 'otp_verified_without_user',
              purpose: cmd.purpose,
              correlationId: cmd.correlationId,
            }),
            undefined,
            'identity',
          );
          return { status: 'REJECTED' } as const;
        }

        // Single use (SEC-003). Consuming and activating in ONE transaction
        // means a replay of the same code cannot find it live again.
        await this.repo.consumeOtpChallenge(challenge.id, client);

        if (cmd.purpose === 'REGISTRATION') {
          await this.repo.markUserVerified(userId, client);
        }

        this.logInternal('otp_verified', cmd.purpose, cmd.correlationId);
        return { status: 'VERIFIED', userId } as const;
      });
    } catch (e) {
      this.logger.error(
        JSON.stringify({
          event: 'otp_verify_failed',
          purpose: cmd.purpose,
          correlationId: cmd.correlationId,
        }),
        e instanceof Error ? e.stack : String(e),
        'identity',
      );
      return { status: 'REJECTED' };
    }
  }

  /**
   * Issue a fresh code, invalidating the previous one (SEC-003, EDGE-005).
   *
   * Replacement is the point, not a side effect: leaving the old code alive
   * would mean each resend widens the attack surface, so a client could
   * accumulate valid codes and then guess against all of them at once.
   *
   * The response is uniform whether or not the number has a pending
   * registration, so resend cannot be used to test which numbers exist.
   */
  async resend(cmd: ResendOtpCommand): Promise<ResendOtpResult> {
    const phone = tryNormalizePakistaniMobile(cmd.phone);
    if (phone === null) return { status: 'INVALID_INPUT', field: 'phone' };

    const identifierHash = this.identifierHasher.hash(phone);
    let code: string | null = null;

    try {
      await this.db.withTransaction(async (client) => {
        const userId = await this.repo.findUserIdByIdentifierHash(identifierHash, client);
        if (userId === null) {
          this.logInternal('otp_resend_unknown_identifier', cmd.purpose, cmd.correlationId);
          return;
        }

        // Checked INSIDE the transaction, so two simultaneous resends cannot
        // both read the same state and both issue a code.
        const throttle = await this.repo.getOtpThrottleState(identifierHash, cmd.purpose, client);
        const refusal = checkOtpResendAllowed(throttle, this.clock.now());
        if (refusal !== null) {
          // Refused silently. Saying "wait 41 seconds" would confirm that this
          // number has a pending registration, which is precisely what the
          // uniform response exists to hide.
          this.logInternal(`otp_resend_${refusal.toLowerCase()}`, cmd.purpose, cmd.correlationId);
          return;
        }

        const fresh = generateOtpCode();
        await this.repo.replaceOtpChallenge(
          {
            id: randomUUID(),
            identifierHash,
            purpose: cmd.purpose,
            codeHash: hashOtpCode(fresh),
            expiresAt: otpExpiryFrom(this.clock.now()),
          },
          client,
        );

        // Held until commit, exactly as in registration: a code delivered for a
        // challenge that then rolls back would be a code that can never work.
        code = fresh;
      });
    } catch (e) {
      this.logger.error(
        JSON.stringify({
          event: 'otp_resend_failed',
          purpose: cmd.purpose,
          correlationId: cmd.correlationId,
        }),
        e instanceof Error ? e.stack : String(e),
        'identity',
      );
      return { status: 'ACCEPTED' };
    }

    if (code !== null) {
      const result = await this.sms.send({
        to: phone,
        body: `Mohalla: your verification code is ${code}. It expires in 10 minutes.`,
        correlationId: cmd.correlationId,
      });
      if (!result.ok) {
        this.logger.warn(
          JSON.stringify({
            event: 'otp_dispatch_failed',
            retryable: result.retryable,
            reason: result.reason,
            correlationId: cmd.correlationId,
            // No number, no code (SEC-002, PRIV-010).
          }),
          'identity',
        );
      }
    }

    return { status: 'ACCEPTED' };
  }

  private logInternal(
    event: string,
    purpose: OtpPurpose,
    correlationId: string | undefined,
    extra: Record<string, unknown> = {},
  ): void {
    this.logger.log(JSON.stringify({ event, purpose, correlationId, ...extra }), 'identity');
  }
}
