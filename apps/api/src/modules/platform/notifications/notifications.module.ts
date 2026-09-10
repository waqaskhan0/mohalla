import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module.js';
import { NOTIFICATION_REPOSITORY } from './repositories/notification.repository.port.js';
import { PgNotificationRepository } from './repositories/pg-notification.repository.js';
import { PUSH_SENDER } from './ports/push-sender.port.js';
import { FakePushSender } from './adapters/fake-push-sender.js';
import { NotificationService } from './application/notification.service.js';
import { OutboxService } from './application/outbox.service.js';

/**
 * `notifications` — platform tier. EPIC-11, ADR-014.
 *
 * Owns `notifications`, `notification_preferences`, `device_tokens` and the
 * `outbox`.
 *
 * WHAT THIS MODULE EXPORTS AND WHY THE SPLIT MATTERS.
 *
 * `OutboxService` is what PRODUCERS use — engagement, social-graph, messaging,
 * events. Its single method takes a transaction client, so an outbox row cannot
 * be written outside the business transaction that justifies it. Producers say
 * what happened; they decide nothing about who is notified.
 *
 * `NotificationService` is the delivery pipeline and the in-app centre. It
 * applies ADR-014's eligibility rules in order, in one place.
 *
 * `NotificationController` is deliberately NOT here either, and for the same
 * reason: BR-025 has to reach the centre's READ path, the block predicate is
 * `safety`'s, and a platform module cannot import a product one. It is
 * registered at the application root beside `OutboxDrainService`.
 *
 * `OutboxDrainService` — the consumer that joins the two — is deliberately NOT
 * here. It needs the block predicate (`safety`) and display names (`profile`),
 * both PRODUCT tier, and `06-backend-modules.md` §3 forbids platform importing
 * product. It is composed at the application root instead, where cross-tier
 * wiring belongs; the ports it consumes are declared in `ports/` so this module
 * still imports nothing upward.
 *
 * THE PUSH SENDER IS THE FAKE, and that is not a placeholder. DEP-003 has no
 * technical owner and no FCM project exists; the security addendum forbids any
 * CI test sending a real notification to a real user. The fake is what CI must
 * keep using even after a real adapter is written — a real one replaces this
 * single binding and nothing else in the module changes.
 */
@Module({
  imports: [IdentityModule],
  providers: [
    PgNotificationRepository,
    { provide: NOTIFICATION_REPOSITORY, useExisting: PgNotificationRepository },

    // One instance, so a test can read what "would have been sent" from the
    // same object the service pushed to.
    FakePushSender,
    { provide: PUSH_SENDER, useExisting: FakePushSender },

    NotificationService,
    OutboxService,
  ],
  exports: [NotificationService, OutboxService, NOTIFICATION_REPOSITORY, PUSH_SENDER],
})
export class NotificationsModule {}
