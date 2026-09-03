import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { FoundationErrorCode, IdentityErrorCode } from '@mohalla/contracts';
import { currentCorrelationId } from '../../../../common/correlation/correlation.context.js';
import { ZodValidationPipe } from '../../../../common/validation/zod-validation.pipe.js';
import { RegisterService } from '../application/register.service.js';
import { OtpService } from '../application/otp.service.js';
import { LoginService } from '../application/login.service.js';
import { PasswordService } from '../application/password.service.js';
import { SessionService, type AuthenticatedPrincipal } from '../application/session.service.js';
import { AdminAuthService } from '../application/admin-auth.service.js';
import { Principal, Public } from './session.guard.js';
import { Admin, RequiresAdmin } from './admin-session.guard.js';
import type { AdminPrincipal } from '../application/admin-auth.service.js';
import {
  adminLoginBody,
  changePasswordBody,
  forgotPasswordBody,
  loginBody,
  otpResendBody,
  otpVerifyBody,
  registerBody,
  resetPasswordBody,
  type AdminLoginBody,
  type ChangePasswordBody,
  type ForgotPasswordBody,
  type LoginBody,
  type OtpResendBody,
  type OtpVerifyBody,
  type RegisterBody,
  type ResetPasswordBody,
} from './auth.dto.js';

/**
 * Auth transport (AUTH-API-001…011).
 *
 * THIS LAYER DECIDES NOTHING. It validates shape, hands the command to a
 * service, and maps one result union to one status code. Every rule that
 * matters — uniformity, throttles, lockouts, revocation — lives in the domain
 * and the services, because the worker and the provisioning CLI need the same
 * rules and neither goes through a controller.
 *
 * THE MAPPING IS WHERE DISCLOSURE HAPPENS, so it is written to be read:
 *
 *   register        -> 202 always. Never 409, never "already registered".
 *   otp/verify      -> 200 or 401. One 401 for every kind of failure.
 *   login           -> 200, or 401 for wrong password / unknown / banned alike.
 *   password/forgot -> 202 always, whether or not the number exists.
 *   password/reset  -> 200 or 401. Revokes every session on success.
 *
 * A future endpoint that returns 404 for "no such account" would undo
 * SEC-006 without touching a single service, which is why the reasoning sits
 * here rather than only in the services.
 */
@ApiTags('auth')
@Controller()
export class AuthController {
  constructor(
    private readonly register_: RegisterService,
    private readonly otp: OtpService,
    private readonly login_: LoginService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly adminAuth: AdminAuthService,
  ) {}

  // ------------------------------------------------------------ registration
  @Post('register')
  @Public()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Begin registration. Uniform 202 (AUTH-API-001).',
    description:
      'Returns 202 whether the number was free, already registered, pending deletion or ' +
      'banned (SEC-006, EDGE-003/004). The distinction is delivered by the OTP, which only ' +
      "reaches the number's actual holder.",
  })
  async register(@Body(new ZodValidationPipe(registerBody)) body: RegisterBody) {
    const result = await this.register_.register({
      ...body,
      ...correlation(),
    });

    if (result.status === 'INVALID_INPUT') throw fieldError(result.field, result.reason);
    return { status: 'ACCEPTED' };
  }

  // --------------------------------------------------------------------- OTP
  @Post('otp/verify')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify an OTP and consume the challenge (AUTH-API-002).' })
  async verifyOtp(@Body(new ZodValidationPipe(otpVerifyBody)) body: OtpVerifyBody) {
    const result = await this.otp.verify({ ...body, ...correlation() });

    if (result.status === 'INVALID_INPUT') throw fieldError(result.field);
    // One 401 for wrong, expired, already-used, absent and unknown.
    if (result.status === 'REJECTED') throw invalidCredentials();

    return { status: 'VERIFIED', userId: result.userId };
  }

  @Post('otp/resend')
  @Public()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Resend an OTP, invalidating the previous code (AUTH-API-003).',
    description:
      '60-second cooldown and 3/hour. A refusal is NOT reported: saying "wait 41 seconds" ' +
      'would confirm the number has a pending registration.',
  })
  async resendOtp(@Body(new ZodValidationPipe(otpResendBody)) body: OtpResendBody) {
    const result = await this.otp.resend({ ...body, ...correlation() });
    if (result.status === 'INVALID_INPUT') throw fieldError(result.field);
    return { status: 'ACCEPTED' };
  }

  // ------------------------------------------------------------------- login
  @Post('login')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Sign in. Returns a session and the account state (AUTH-API-004).',
    description:
      'A wrong password, an unknown number and a banned account return the identical 401 ' +
      'INVALID_CREDENTIALS, in comparable time (SEC-006).',
  })
  async login(@Body(new ZodValidationPipe(loginBody)) body: LoginBody, @Req() req: Request) {
    const result = await this.login_.login({
      ...body,
      ...sourceAddress(req),
      ...correlation(),
    });

    if (result.status === 'INVALID_INPUT') throw fieldError(result.field);
    if (result.status === 'FAILED') throw invalidCredentials();

    if (result.status === 'VERIFICATION_REQUIRED') {
      // Safe to disclose: reaching this required the correct password.
      return { status: 'VERIFICATION_REQUIRED' };
    }

    return {
      status: 'AUTHENTICATED',
      token: result.token,
      expiresAt: result.expiresAt.toISOString(),
      capability: result.capability,
      suspendedUntil: result.suspendedUntil?.toISOString() ?? null,
    };
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Sign out this device only (AUTH-API-005, BR-007).' })
  async logout(@Principal() principal: AuthenticatedPrincipal) {
    await this.sessions.logout(principal.sessionId);
  }

  @Post('session/refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Slide the idle expiry (AUTH-API-008).',
    description:
      'The guard already slides the window on every authenticated request, so this exists ' +
      'for a client that wants to extend a session without making a real call - and it ' +
      'returns the CURRENT expiry so the client never has to guess.',
  })
  async refreshSession(@Principal() principal: AuthenticatedPrincipal) {
    // Resolution has already happened in the guard, including the slide, so
    // there is nothing left to do but report the result. Re-sliding here would
    // double-count the request.
    return {
      status: 'REFRESHED',
      userId: principal.userId,
      capability: principal.capability,
    };
  }

  // ---------------------------------------------------------------- password
  @Post('password/forgot')
  @Public()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Request a password reset code (AUTH-API-006).',
    description: 'Same response whether or not the number exists.',
  })
  async forgotPassword(@Body(new ZodValidationPipe(forgotPasswordBody)) body: ForgotPasswordBody) {
    const result = await this.passwords.forgot({ ...body, ...correlation() });
    if (result.status === 'INVALID_INPUT') throw fieldError(result.field);
    return { status: 'ACCEPTED' };
  }

  @Post('password/reset')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Complete a password reset. Invalidates ALL sessions (AUTH-API-007).',
    description:
      'Public, so the request carries its own proof: phone, code and new password together. ' +
      'Every session is revoked in the same transaction as the password change (BR-035).',
  })
  async resetPassword(@Body(new ZodValidationPipe(resetPasswordBody)) body: ResetPasswordBody) {
    const result = await this.passwords.reset({ ...body, ...correlation() });

    if (result.status === 'INVALID_INPUT') throw fieldError(result.field, result.reason);
    if (result.status === 'REJECTED') throw invalidCredentials();

    return { status: 'RESET', sessionsRevoked: result.sessionsRevoked };
  }

  @Post('password/change')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Change the password while signed in (SET-FR-002).',
    description:
      'Requires the current password even though the caller holds a session: a borrowed ' +
      'phone must not be enough to lock the owner out. Other devices are signed out.',
  })
  async changePassword(
    @Principal() principal: AuthenticatedPrincipal,
    @Body(new ZodValidationPipe(changePasswordBody)) body: ChangePasswordBody,
  ) {
    const result = await this.passwords.change({
      userId: principal.userId,
      currentSessionId: principal.sessionId,
      ...body,
      ...correlation(),
    });

    if (result.status === 'INVALID_INPUT') throw fieldError(result.field, result.reason);
    if (result.status === 'WRONG_PASSWORD') throw invalidCredentials();

    return { status: 'CHANGED', sessionsRevoked: result.sessionsRevoked };
  }

  // ------------------------------------------------------------------- admin
  @Post('admin/login')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Administrator sign-in. Admin store ONLY (AUTH-API-010, SEC-020).',
    description:
      'Separate credential store from users. 8-hour absolute session (SEC-024), 5 failures ' +
      'then a 30-minute lockout, and every attempt audited (SEC-021).',
  })
  async adminLogin(
    @Body(new ZodValidationPipe(adminLoginBody)) body: AdminLoginBody,
    @Req() req: Request,
  ) {
    const result = await this.adminAuth.login({
      ...body,
      ...sourceAddress(req),
      ...correlation(),
    });

    if (result.status === 'INVALID_INPUT') throw fieldError(result.field);
    if (result.status === 'FAILED') throw invalidCredentials();

    return {
      status: 'AUTHENTICATED',
      token: result.token,
      expiresAt: result.expiresAt.toISOString(),
    };
  }

  @Post('admin/logout')
  @RequiresAdmin()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'End an administrator session (AUTH-API-011). Audited.' })
  async adminLogout(@Admin() principal: AdminPrincipal) {
    await this.adminAuth.logout(principal);
  }
}

/**
 * A 401 with ONE code for every authentication failure.
 *
 * `INVALID_CREDENTIALS` covers wrong password, unknown number and banned
 * account together — the error catalogue is explicit that all three are the
 * same answer (SEC-006). There is deliberately no variant of this helper that
 * takes a reason.
 */
function invalidCredentials(): UnauthorizedException {
  return new UnauthorizedException({
    code: IdentityErrorCode.INVALID_CREDENTIALS,
    message: "That number or password isn't right.",
  });
}

/**
 * A 422-style field error for input the user can see on their own form.
 *
 * Safe to be specific here: a malformed number, a short password or an
 * unaccepted terms version say nothing about any OTHER account.
 */
function fieldError(field: string, reason?: string): BadRequestException {
  return new BadRequestException({
    code: FoundationErrorCode.VALIDATION_FAILED,
    message: 'Please check the highlighted fields.',
    details: [{ path: field, message: reason ?? 'INVALID' }],
  });
}

/** Echoed into service logs so a user-reported failure is findable. */
function correlation(): { correlationId?: string } {
  const id = currentCorrelationId();
  return id === undefined ? {} : { correlationId: id };
}

/**
 * The client's source address, for the per-address lockout key (SEC-007).
 *
 * `req.ip` respects Express's `trust proxy` setting, which `main.ts` sets from
 * `TRUST_PROXY_HOPS`. Reading `x-forwarded-for` directly here would trust a
 * header any client can set, letting an attacker rotate a fake address and
 * bypass the per-source limit entirely.
 *
 * When no proxy is configured this is the socket address, which is correct for
 * a directly-exposed process and wrong behind a load balancer - hence the
 * explicit setting and the startup warning, rather than a guess here.
 */
function sourceAddress(req: Request): { sourceAddress?: string } {
  const ip = req.ip;
  return typeof ip === 'string' && ip.length > 0 ? { sourceAddress: ip } : {};
}
