import { Module } from '@nestjs/common';
import { IdentityModule } from '../../platform/identity/identity.module.js';
import { AuditModule } from '../../platform/audit/audit.module.js';
import { NotificationsModule } from '../../platform/notifications/notifications.module.js';
import { SafetyModule } from '../safety/safety.module.js';
import { DELETION_REPOSITORY } from './repositories/deletion.repository.port.js';
import { PgDeletionRepository } from './repositories/pg-deletion.repository.js';
import { ANONYMISABLE } from './ports/anonymisable.port.js';
import {
  ContentAnonymiser,
  GraphAnonymiser,
  IdentityAnonymiser,
  MessagingAnonymiser,
  SafetyAnonymiser,
} from './adapters/content-anonymiser.js';
import { DeletionService } from './application/deletion.service.js';
import { SettingsService } from './application/settings.service.js';
import { SettingsController } from './transport/settings.controller.js';

/**
 * `settings` — product tier. EPIC-14.
 *
 * Owns `deletion_requests`, `reserved_identifiers` and the stored language.
 *
 * MOST OF THE SETTINGS SCREEN IS OTHER MODULES' WORK, and the requirements say
 * so: SET-FR-002 "see AUTH-FR-007", SET-FR-003 "see SAFETY-FR-007", SET-FR-006
 * "see AUTH-FR-006", SET-FR-007 "see NOTIF-FR-007". A settings screen is a
 * place in the interface rather than in the domain, so this module composes
 * rather than re-implements.
 *
 * THE ANONYMISATION REGISTRY IS THE PIECE WORTH UNDERSTANDING. ADR-019 names
 * its own weakness — "per-entity anonymisation logic is real work and must be
 * maintained as entities are added" — and prescribes "a registry each module
 * implements". `ANONYMISABLE` is a MULTI-PROVIDER: every contributor is
 * injected as an array, and the erasure job walks it.
 *
 * The five contributors live in this module rather than in the modules whose
 * tables they touch, and that is a deliberate compromise. Putting each one in
 * its owning module would be cleaner by the tier rules, but would require
 * `settings` to import every product module to collect them — inverting more
 * edges than it resolves. Keeping the SQL here, one class per bounded area with
 * the requirement that governs it quoted above each, keeps the whole erasure
 * contract readable in one file. That is the property that matters: somebody
 * adding a table needs to see, in one place, what erasure already covers.
 *
 * A partial erasure is the worst outcome, so every contributor runs inside ONE
 * transaction — the account unusable AND the data still present, with nothing
 * recording which half succeeded, is worse than either alone.
 */
@Module({
  imports: [IdentityModule, AuditModule, NotificationsModule, SafetyModule],
  controllers: [SettingsController],
  providers: [
    PgDeletionRepository,
    { provide: DELETION_REPOSITORY, useExisting: PgDeletionRepository },

    ContentAnonymiser,
    GraphAnonymiser,
    MessagingAnonymiser,
    SafetyAnonymiser,
    IdentityAnonymiser,
    {
      // The registry. Order matters: identity runs LAST, because the earlier
      // contributors read `user_identifiers` and the profile, and erasing the
      // identity first would leave them nothing to work from.
      provide: ANONYMISABLE,
      useFactory: (
        content: ContentAnonymiser,
        graph: GraphAnonymiser,
        messaging: MessagingAnonymiser,
        safety: SafetyAnonymiser,
        identity: IdentityAnonymiser,
      ) => [content, graph, messaging, safety, identity],
      inject: [
        ContentAnonymiser,
        GraphAnonymiser,
        MessagingAnonymiser,
        SafetyAnonymiser,
        IdentityAnonymiser,
      ],
    },

    DeletionService,
    SettingsService,
  ],
  // Exported for the login flow (SET-FR-005 offers restoration) and for the
  // worker, which runs the day-30 sweep.
  exports: [DeletionService, SettingsService],
})
export class SettingsModule {}
