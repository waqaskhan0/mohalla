import { Module } from '@nestjs/common';
import { IdentityModule } from '../../platform/identity/identity.module.js';
import { PostsModule } from '../posts/posts.module.js';
import { ProfileModule } from '../profile/profile.module.js';
import { SafetyModule } from '../safety/safety.module.js';
import { ENGAGEMENT_REPOSITORY } from './repositories/engagement.repository.port.js';
import { PgEngagementRepository } from './repositories/pg-engagement.repository.js';
import { EngagementService } from './application/engagement.service.js';
import { EngagementController } from './transport/engagement.controller.js';

/**
 * `engagement` - product tier. EPIC-07.
 *
 * Owns `likes` and `comments`. Depends on `posts` (every write checks the
 * post's own visibility first) and on `safety` through the profile read path,
 * which already composes the block predicate.
 *
 * The COUNTS on `posts` are maintained by database triggers, not by this
 * module - so the cascades from deleting a post, deleting a parent comment or
 * erasing an account move them too.
 */
@Module({
  imports: [IdentityModule, PostsModule, ProfileModule, SafetyModule],
  controllers: [EngagementController],
  providers: [
    PgEngagementRepository,
    { provide: ENGAGEMENT_REPOSITORY, useExisting: PgEngagementRepository },
    EngagementService,
  ],
  // Exported for the feed, which needs the per-viewer count adjustment
  // (ENGAGE-FR-006), and later for notifications.
  exports: [EngagementService],
})
export class EngagementModule {}
