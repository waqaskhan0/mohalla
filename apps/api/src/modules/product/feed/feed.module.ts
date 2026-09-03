import { Module } from '@nestjs/common';
import { IdentityModule } from '../../platform/identity/identity.module.js';
import { EngagementModule } from '../engagement/engagement.module.js';
import { PostsModule } from '../posts/posts.module.js';
import { ProfileModule } from '../profile/profile.module.js';
import { SafetyModule } from '../safety/safety.module.js';
import { SocialGraphModule } from '../social-graph/social-graph.module.js';
import { FEED_REPOSITORY } from './repositories/feed.repository.port.js';
import { PgFeedRepository } from './repositories/pg-feed.repository.js';
import { FeedService } from './application/feed.service.js';
import { FeedController } from './transport/feed.controller.js';

/**
 * `feed` - product tier. EPIC-07.
 *
 * OWNS NOTHING (§234). A read-only composition module: it assembles posts, the
 * social graph, profiles and engagement into the three surfaces a reader sees.
 *
 * It does read `saved_posts` and `announcements`, which are owned elsewhere -
 * saved posts by this feature's own requirement (FEED-FR-007) and announcements
 * by `admin-ops` (ADMIN-FR-009), which writes them. Reading another module's
 * table is the exception a composition module exists to make; nothing here
 * writes one.
 */
@Module({
  imports: [
    IdentityModule,
    PostsModule,
    ProfileModule,
    SafetyModule,
    SocialGraphModule,
    EngagementModule,
  ],
  controllers: [FeedController],
  providers: [
    PgFeedRepository,
    { provide: FEED_REPOSITORY, useExisting: PgFeedRepository },
    FeedService,
  ],
  exports: [FeedService],
})
export class FeedModule {}
