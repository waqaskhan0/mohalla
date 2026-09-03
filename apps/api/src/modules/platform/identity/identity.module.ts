import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ENV } from '../../../config/env.token.js';
import type { Env } from '../../../config/env.js';
import { AuditModule } from '../audit/audit.module.js';
import { IdentifierHasher } from './domain/identifier-hash.js';
import { CLOCK, SystemClock } from './ports/clock.port.js';
import { PASSWORD_HASHER } from './ports/password-hasher.port.js';
import { SMS_PROVIDER } from './ports/sms-provider.port.js';
import { Argon2PasswordHasher } from './adapters/argon2-password-hasher.js';
import { FakeSmsProvider } from './adapters/fake-sms-provider.js';
import { IDENTITY_REPOSITORY } from './repositories/identity.repository.port.js';
import { PgIdentityRepository } from './repositories/pg-identity.repository.js';
import { ADMIN_IDENTITY_REPOSITORY } from './repositories/admin-identity.repository.port.js';
import { PgAdminIdentityRepository } from './repositories/pg-admin-identity.repository.js';
import { RegisterService } from './application/register.service.js';
import { OtpService } from './application/otp.service.js';
import { LoginService } from './application/login.service.js';
import { PasswordService } from './application/password.service.js';
import { SessionService } from './application/session.service.js';
import { AdminAuthService } from './application/admin-auth.service.js';
import { AuthController } from './transport/auth.controller.js';
import { SessionGuard } from './transport/session.guard.js';
import { AdminSessionGuard } from './transport/admin-session.guard.js';

/**
 * `identity` — platform tier. EPIC-02.
 *
 * Holds phone numbers, dates of birth and password hashes: the highest privacy
 * risk in the system. No service here returns a raw identifier to a caller
 * outside this module — `AuthenticatedPrincipal` carries only ids and a
 * capability (PRIV-002/003).
 *
 * `DatabaseModule` is `@Global()`, so `ENV`, `StructuredLogger` and
 * `DatabaseService` are ambient and are deliberately NOT imported here: adding
 * that import edge is exactly what the global module exists to avoid.
 *
 * THE SESSION GUARD IS REGISTERED GLOBALLY, via `APP_GUARD`.
 *
 * Every route in the application is authenticated unless it opts out with
 * `@Public()`. Registered per-controller instead, the failure mode of
 * forgetting would be an OPEN endpoint; registered globally, it is a dead one
 * that fails loudly in the first test that calls it. With fifteen modules still
 * to come, that difference is the entire point of doing it here.
 */
@Module({
  imports: [AuditModule],
  controllers: [AuthController],
  providers: [
    // ---- clock ----------------------------------------------------------
    SystemClock,
    { provide: CLOCK, useExisting: SystemClock },

    // ---- adapters -------------------------------------------------------
    {
      provide: PASSWORD_HASHER,
      // Parameters come from configuration, not from the class default, so a
      // production host can be re-benchmarked without a code change (SEC-001).
      useFactory: (env: Env) =>
        new Argon2PasswordHasher({
          memoryCost: env.ARGON2_MEMORY_KIB,
          timeCost: env.ARGON2_ITERATIONS,
          parallelism: env.ARGON2_PARALLELISM,
        }),
      inject: [ENV],
    },
    {
      provide: IdentifierHasher,
      useFactory: (env: Env) => new IdentifierHasher(env.IDENTIFIER_HASH_PEPPER),
      inject: [ENV],
    },
    {
      // DEP-002: no SMS provider is selected, and the public-repository
      // addendum forbids sending to a real recipient from CI. The deterministic
      // fake is the ONLY adapter that exists; a real one is chosen in EPIC-11.
      provide: SMS_PROVIDER,
      useClass: FakeSmsProvider,
    },

    // ---- repositories ---------------------------------------------------
    // Two SEPARATE ports, bound to two separate adapters (SEC-020). Keeping
    // them distinct here is what makes "authenticate against the wrong store"
    // a compile error rather than a review question.
    PgIdentityRepository,
    { provide: IDENTITY_REPOSITORY, useExisting: PgIdentityRepository },
    PgAdminIdentityRepository,
    { provide: ADMIN_IDENTITY_REPOSITORY, useExisting: PgAdminIdentityRepository },

    // ---- application ----------------------------------------------------
    RegisterService,
    OtpService,
    LoginService,
    PasswordService,
    SessionService,
    AdminAuthService,

    // ---- transport ------------------------------------------------------
    // Both registered globally. The user guard authenticates every route by
    // default and steps aside for `@RequiresAdmin()`; the admin guard does the
    // reverse. Neither needs to know about the other beyond that one flag.
    { provide: APP_GUARD, useClass: SessionGuard },
    { provide: APP_GUARD, useClass: AdminSessionGuard },
  ],
  // Exported so later epics can resolve a principal and revoke sessions
  // (moderation suspends, settings deletes). The repositories are NOT exported:
  // nothing outside identity may read a password hash or an identifier row.
  exports: [SessionService, AdminAuthService],
})
export class IdentityModule {}
