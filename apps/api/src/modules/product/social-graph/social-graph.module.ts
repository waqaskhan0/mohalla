import { Module } from '@nestjs/common';
import { IdentityModule } from '../../platform/identity/identity.module.js';
import { ProfileModule } from '../profile/profile.module.js';
import { SafetyModule } from '../safety/safety.module.js';
import { FOLLOW_REPOSITORY } from './repositories/follow.repository.port.js';
import { PgFollowRepository } from './repositories/pg-follow.repository.js';
import { REQUEST_PROMOTION } from './ports/request-promotion.port.js';
import { RequestPromotionAdapter } from '../messaging/adapters/request-promotion.adapter.js';
import { MESSAGING_REPOSITORY } from '../messaging/repositories/messaging.repository.port.js';
import { PgMessagingRepository } from '../messaging/repositories/pg-messaging.repository.js';
import { FollowService } from './application/follow.service.js';
import { FollowController } from './transport/follow.controller.js';

/**
 * `social-graph` — product tier. EPIC-05.
 *
 * Owns `follows`. Depends on `profile` (for the public projection every list
 * row renders) and on `safety` (for the block predicate, §174) — both real
 * imports in the direction the design describes.
 *
 * The reverse need, safety removing follows when a block is placed (BR-024),
 * arrives through the `FollowRemoval` port instead, which is what keeps these
 * two modules from importing each other. See `follow-removal.port.ts`.
 *
 * The follower and following COUNTS are not maintained here. A database trigger
 * keeps them on every insert and delete — including the deletes caused by
 * blocking and by account deletion — so a future path that touches a follow
 * cannot forget.
 */
@Module({
  imports: [IdentityModule, ProfileModule, SafetyModule],
  controllers: [FollowController],
  providers: [
    PgFollowRepository,
    { provide: FOLLOW_REPOSITORY, useExisting: PgFollowRepository },

    // MSG-FR-005 A3: following someone promotes their pending request, in the
    // same transaction as the follow. The edge is inverted for the reason given
    // in `ports/request-promotion.port.ts`.
    PgMessagingRepository,
    { provide: MESSAGING_REPOSITORY, useExisting: PgMessagingRepository },
    RequestPromotionAdapter,
    { provide: REQUEST_PROMOTION, useExisting: RequestPromotionAdapter },

    FollowService,
  ],
  // Exported for the feed (EPIC-07), which needs "whom does this person
  // follow", and for notifications.
  exports: [FollowService],
})
export class SocialGraphModule {}
