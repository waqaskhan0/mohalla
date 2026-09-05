import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DatabaseService } from '../../../../database/database.service.js';
import { StructuredLogger } from '../../../../common/logging/structured.logger.js';
import { IdentifierHasher } from '../domain/identifier-hash.js';
import { checkPassword } from '../domain/password-policy.js';
import { generateOtpCode, hashOtpCode, otpExpiryFrom } from '../domain/otp.js';
import { tryNormalizePakistaniMobile } from '../domain/phone-number.js';
import { CLOCK, type Clock } from '../ports/clock.port.js';
import { PASSWORD_HASHER, type PasswordHasher } from '../ports/password-hasher.port.js';
import { SMS_PROVIDER, type SmsProvider } from '../ports/sms-provider.port.js';
import {
  IDENTITY_REPOSITORY,
  type IdentityRepository,
} from '../repositories/identity.repository.port.js';

export interface RegisterCommand {
  phone: string;
  password: string;
  dateOfBirth: string;
  termsVersion: string;
  accountType?: 'INDIVIDUAL' | 'ORGANIZATION' | undefined;
  correlationId?: string | undefined;
}

/**
 * Every outcome the caller is allowed to see.
 *
 * There is deliberately no `ALREADY_REGISTERED` and no `BANNED` — see the class
 * comment. `INVALID_INPUT` covers only what the user can see for themselves on
 * their own form (a malformed number, a weak password, an under-age date), none
 * of which reveals anything about an OTHER account.
 */
export type RegisterResult =
  | { status: 'ACCEPTED' }
  | {
      status: 'INVALID_INPUT';
      field: 'phone' | 'password' | 'dateOfBirth' | 'termsVersion';
      reason: string;
    };

/**
 * Registration (AUTH-FR-001 · BR-002 · BR-004 · BR-036 · SEC-006).
 *
 * THE CENTRAL RULE: the response is a uniform `ACCEPTED` whether the number was
 * free, already active, pending deletion, or permanently banned
 * (09-authentication-authorization.md §50, EDGE-003, EDGE-004).
 *
 * That is not politeness — a registration endpoint that says "already
 * registered" is a free membership oracle for the whole platform. Anyone could
 * test a list of numbers and learn who holds an account, which for a civic
 * platform in Pakistan is exactly the information that puts people at risk.
 *
 * The distinction is delivered by the OTP instead, which only ever reaches the
 * number's actual holder. A stranger probing numbers learns nothing; the
 * legitimate owner gets a code.
 *
 * The write is ONE transaction: user + primary identifier + OTP challenge. A
 * half-created account with no identity, or an account with no way to verify,
 * is not a state this module can produce.
 */
@Injectable()
export class RegisterService {
  constructor(
    private readonly db: DatabaseService,
    @Inject(IDENTITY_REPOSITORY) private readonly repo: IdentityRepository,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasher,
    private readonly identifierHasher: IdentifierHasher,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly logger: StructuredLogger,
  ) {}

  async register(cmd: RegisterCommand): Promise<RegisterResult> {
    // ---- input the user can validate on their own form -------------------
    const phone = tryNormalizePakistaniMobile(cmd.phone);
    if (phone === null) {
      return { status: 'INVALID_INPUT', field: 'phone', reason: 'INVALID_PAKISTANI_MOBILE' };
    }

    const passwordProblem = checkPassword(cmd.password);
    if (passwordProblem !== null) {
      return { status: 'INVALID_INPUT', field: 'password', reason: passwordProblem };
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(cmd.dateOfBirth)) {
      return { status: 'INVALID_INPUT', field: 'dateOfBirth', reason: 'INVALID_DATE' };
    }

    // BR-004 / AUTH-FR-009: acceptance must be affirmative and versioned.
    if (typeof cmd.termsVersion !== 'string' || cmd.termsVersion.trim() === '') {
      return { status: 'INVALID_INPUT', field: 'termsVersion', reason: 'TERMS_NOT_ACCEPTED' };
    }

    const identifierHash = this.identifierHasher.hash(phone);

    // ---- everything below returns ACCEPTED, whatever happens -------------
    // From here on, no branch may change the caller's outcome. Each one logs
    // internally so operators can see reality, while the caller sees one shape.
    let otpCode: string | null = null;

    try {
      await this.db.withTransaction(async (client) => {
        // BR-036: a banned number cannot create a new account. Silently.
        if (await this.repo.isIdentifierBanned(identifierHash, client)) {
          this.logInternal('register_blocked_banned_identifier', cmd.correlationId);
          return;
        }

        // EDGE-029: held by an account that was erased. The hash outlives the
        // account precisely so this check can be made - see
        // `isIdentifierReserved`. Silent, like every other branch here.
        if (await this.repo.isIdentifierReserved(identifierHash, client)) {
          this.logInternal('register_blocked_reserved_identifier', cmd.correlationId);
          return;
        }

        // Already held by an account: do nothing, say nothing (EDGE-003).
        const existing = await this.repo.findUserIdByIdentifierHash(identifierHash, client);
        if (existing !== null) {
          this.logInternal('register_existing_identifier', cmd.correlationId);
          return;
        }

        // Hash the password INSIDE the accepted path only. Doing it before the
        // ban/exists checks would burn ~236 ms on every probe and hand an
        // attacker a cheap denial-of-service.
        const passwordHash = await this.hasher.hash(cmd.password);

        const user = await this.repo.createUserWithPrimaryPhone(
          {
            id: randomUUID(),
            passwordHash,
            dateOfBirth: cmd.dateOfBirth,
            termsVersion: cmd.termsVersion,
            accountType: cmd.accountType ?? 'INDIVIDUAL',
          },
          { id: randomUUID(), normalized: phone, hash: identifierHash },
          client,
        );

        // EDGE-001: a concurrent request won the UNIQUE index. Identical
        // outcome to "already registered", because it IS that.
        if (user === null) {
          this.logInternal('register_lost_uniqueness_race', cmd.correlationId);
          return;
        }

        const code = generateOtpCode();
        await this.repo.replaceOtpChallenge(
          {
            id: randomUUID(),
            identifierHash,
            purpose: 'REGISTRATION',
            codeHash: hashOtpCode(code),
            expiresAt: otpExpiryFrom(this.clock.now()),
          },
          client,
        );

        // Held until the transaction commits: sending a code for a registration
        // that then rolls back would tell the holder an account exists when it
        // does not.
        otpCode = code;
      });
    } catch (e) {
      // A database failure must not become a distinguishable response either.
      this.logger.error(
        JSON.stringify({ event: 'register_failed', correlationId: cmd.correlationId }),
        e instanceof Error ? e.stack : String(e),
        'identity',
      );
      return { status: 'ACCEPTED' };
    }

    if (otpCode !== null) {
      await this.dispatchOtp(phone, otpCode, cmd.correlationId);
    }

    return { status: 'ACCEPTED' };
  }

  /**
   * Deliver the code.
   *
   * Failure is logged and swallowed: the account exists and the user can
   * request a resend. Surfacing a delivery error here would, again, confirm
   * that registration proceeded.
   *
   * TODO(EPIC-11): move to the transactional outbox so delivery survives a
   * process restart. Direct dispatch is acceptable while the only adapter is
   * the deterministic fake and no real provider is selected (DEP-002).
   */
  private async dispatchOtp(
    phone: string,
    code: string,
    correlationId: string | undefined,
  ): Promise<void> {
    const result = await this.sms.send({
      to: phone,
      // The code is the ONLY sensitive element and it is never logged.
      body: `Mohalla: your verification code is ${code}. It expires in 10 minutes.`,
      correlationId,
    });

    if (!result.ok) {
      this.logger.warn(
        JSON.stringify({
          event: 'otp_dispatch_failed',
          retryable: result.retryable,
          reason: result.reason,
          correlationId,
          // No phone number, no code (SEC-002, PRIV-010).
        }),
        'identity',
      );
    }
  }

  /**
   * Internal-only outcome logging.
   *
   * Records WHAT happened without the identifier, so an operator can see that
   * registrations are being blocked without the log itself becoming the
   * membership oracle the response refuses to be.
   */
  private logInternal(event: string, correlationId: string | undefined): void {
    this.logger.log(JSON.stringify({ event, correlationId }), 'identity');
  }
}
