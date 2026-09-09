import { Module } from '@nestjs/common';
import { IdentityModule } from '../../platform/identity/identity.module.js';
import { AuditModule } from '../../platform/audit/audit.module.js';
import { SafetyModule } from '../../product/safety/safety.module.js';
import { MessagingModule } from '../../product/messaging/messaging.module.js';
import { ENFORCEMENT_REPOSITORY } from './repositories/enforcement.repository.port.js';
import { PgEnforcementRepository } from './repositories/pg-enforcement.repository.js';
import { EnforcementService } from './application/enforcement.service.js';
import { ModerationController } from './transport/moderation.controller.js';

/**
 * `moderation` — admin tier. EPIC-13.
 *
 * Owns `enforcement_actions` and the routes an administrator uses to act.
 * `reports` and `moderation_cases` belong to `safety` (EPIC-12), because the
 * threshold that fills the queue is a product rule rather than an admin one —
 * this module consumes the queue and resolves it.
 *
 * ADMIN TIER, so it may import from product and platform and nothing may import
 * it. That direction is what stops an ordinary product path reaching an
 * enforcement method: `posts` cannot import `moderation`, so there is no way
 * for a user-facing route to suspend anybody even by mistake.
 *
 * BR-ADM-001 AND SEC-021 ARE CLOSED IN THREE PLACES, and this module holds two
 * of them: `EnforcementTarget` cannot describe an administrator, and
 * `EnforcementService.act` asks `isAdministrator` before anything else. The
 * third is the schema — `enforcement_actions` has no foreign key to `admins`
 * (migration 0019).
 */
@Module({
  imports: [IdentityModule, AuditModule, SafetyModule, MessagingModule],
  controllers: [ModerationController],
  providers: [
    PgEnforcementRepository,
    { provide: ENFORCEMENT_REPOSITORY, useExisting: PgEnforcementRepository },
    EnforcementService,
  ],
  // Exported for `admin-ops`, which reads the dashboard counts and the audit
  // log through the same repository.
  exports: [EnforcementService, ENFORCEMENT_REPOSITORY],
})
export class ModerationModule {}
