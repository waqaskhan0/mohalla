import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { DatabaseModule } from './database/database.module.js';
import { HealthModule } from './health/health.module.js';
import { RealtimeModule } from './realtime/realtime.module.js';
import { CorrelationMiddleware } from './common/correlation/correlation.middleware.js';

// The 17 modules defined in docs/architecture/06-backend-modules.md section 4.
// Every one is registered; `identity` and `audit` are implemented (EPIC-02) and
// the rest are still shells awaiting their epic.
import { IdentityModule } from './modules/platform/identity/identity.module.js';
import { LocalizationModule } from './modules/platform/localization/localization.module.js';
import { MediaModule } from './modules/platform/media/media.module.js';
import { AuditModule } from './modules/platform/audit/audit.module.js';
import { NotificationsModule } from './modules/platform/notifications/notifications.module.js';
import { ProfileModule } from './modules/product/profile/profile.module.js';
import { SocialGraphModule } from './modules/product/social-graph/social-graph.module.js';
import { SafetyModule } from './modules/product/safety/safety.module.js';
import { PostsModule } from './modules/product/posts/posts.module.js';
import { EngagementModule } from './modules/product/engagement/engagement.module.js';
import { FeedModule } from './modules/product/feed/feed.module.js';
import { EventsModule } from './modules/product/events/events.module.js';
import { MessagingModule } from './modules/product/messaging/messaging.module.js';
import { SearchModule } from './modules/product/search/search.module.js';
import { SettingsModule } from './modules/product/settings/settings.module.js';
import { ModerationModule } from './modules/admin/moderation/moderation.module.js';
import { AdminOpsModule } from './modules/admin/admin-ops/admin-ops.module.js';

// EPIC-11's cross-tier wiring. See the `providers` block below for why it is
// here and not inside NotificationsModule.
import { OutboxDrainService } from './modules/platform/notifications/application/outbox-drain.service.js';
import { BLOCK_CHECK } from './modules/platform/notifications/ports/block-check.port.js';
import { ACTOR_NAMES } from './modules/platform/notifications/ports/actor-names.port.js';
import { BlockCheckAdapter } from './modules/product/safety/adapters/block-check.adapter.js';
import { ActorNamesAdapter } from './modules/product/profile/adapters/actor-names.adapter.js';

/**
 * Root application module.
 *
 * All 17 modules are registered so the boundary set is complete and the
 * dependency-direction check has something real to verify. The unimplemented
 * ones export nothing and provide nothing, so registering them cannot create a
 * coupling.
 *
 * NOTE ON ORDER: `IdentityModule` registers the session guard as an `APP_GUARD`,
 * which applies to EVERY route in every module listed here - including health,
 * which therefore opts out with `@Public()`. Authentication is the default and
 * opting out is explicit, so a new controller that forgets is closed rather
 * than open.
 *
 * Routes served: the auth endpoints (EPIC-02), the three health endpoints, and
 * the Socket.IO foundation ping.
 */
@Module({
  imports: [
    DatabaseModule,
    HealthModule,
    RealtimeModule,

    // ---- Platform tier (depends on nothing in the product tier) ----
    IdentityModule,
    LocalizationModule,
    MediaModule,
    AuditModule,
    NotificationsModule,

    // ---- Product tier ----
    ProfileModule,
    SocialGraphModule,
    SafetyModule,
    PostsModule,
    EngagementModule,
    FeedModule,
    EventsModule,
    MessagingModule,
    SearchModule,
    SettingsModule,

    // ---- Admin tier ----
    ModerationModule,
    AdminOpsModule,
  ],
  /**
   * THE ONE PIECE OF WIRING THAT CANNOT LIVE IN A MODULE.
   *
   * `OutboxDrainService` turns domain events into notifications, and to do that
   * it needs two facts that PRODUCT modules own: whether two people have
   * blocked each other (`safety`, and §165 says that predicate has exactly one
   * implementation) and what somebody is called (`profile`). The service itself
   * belongs to `notifications`, which is PLATFORM tier — and §3 forbids platform
   * importing product, upward being the one direction that is never allowed.
   *
   * Both needs are therefore ports, declared in `notifications` and implemented
   * in the product modules that own the data. Their BINDING has to happen
   * somewhere that may see both tiers, and that place is the composition root:
   * this file. Putting it in a module would either invert a dependency or
   * duplicate the block predicate, and the second is worse — a block that leaks
   * on one surface leaks entirely.
   *
   * Nothing else in the application is wired here, and nothing else should be.
   */
  providers: [
    BlockCheckAdapter,
    { provide: BLOCK_CHECK, useExisting: BlockCheckAdapter },
    ActorNamesAdapter,
    { provide: ACTOR_NAMES, useExisting: ActorNamesAdapter },
    OutboxDrainService,
  ],
  exports: [OutboxDrainService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Every route, including health - a health check failure is exactly the
    // kind of event that needs to be correlatable with its logs.
    consumer.apply(CorrelationMiddleware).forRoutes('*');
  }
}
