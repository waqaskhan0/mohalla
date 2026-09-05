import { Module } from '@nestjs/common';
import { IdentityModule } from '../../platform/identity/identity.module.js';
import { AuditModule } from '../../platform/audit/audit.module.js';
import { NotificationsModule } from '../../platform/notifications/notifications.module.js';
import { ModerationModule } from '../moderation/moderation.module.js';
import { AdminOpsService } from './application/admin-ops.service.js';
import { AdminOpsController } from './transport/admin-ops.controller.js';

/**
 * `admin-ops` — admin tier. EPIC-13.
 *
 * The dashboard, announcements and the audit-log search. Owns `announcements`
 * as a writer; `feed` reads them (FEED-FR-002), which is the correct direction
 * — a product module reading an admin-owned table is fine, and an admin module
 * writing a product one would not be.
 *
 * `NotificationsModule` supplies the outbox: a broadcast announcement writes
 * its domain event in the SAME transaction as the announcement (ADR-014), so a
 * push cannot exist for an announcement that rolled back, nor an announcement
 * be published with a broadcast nobody receives.
 *
 * NOTHING HERE MUTATES THE AUDIT LOG. BR-039 makes it append-only, and this
 * module exposes exactly one audit method: a search.
 */
@Module({
  imports: [IdentityModule, AuditModule, NotificationsModule, ModerationModule],
  controllers: [AdminOpsController],
  providers: [AdminOpsService],
  exports: [AdminOpsService],
})
export class AdminOpsModule {}
