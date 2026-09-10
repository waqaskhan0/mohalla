import { Module } from '@nestjs/common';
import { IdentityModule } from '../../platform/identity/identity.module.js';
import { MediaModule } from '../../platform/media/media.module.js';
import { ProfileModule } from '../profile/profile.module.js';
import { SafetyModule } from '../safety/safety.module.js';
import { PgEngagementRepository } from '../engagement/repositories/pg-engagement.repository.js';
import { ENGAGEMENT_REPOSITORY } from '../engagement/repositories/engagement.repository.port.js';
import { ViewerLikesAdapter } from '../engagement/adapters/viewer-likes.adapter.js';
import { VIEWER_LIKES } from './ports/viewer-likes.port.js';
import { POST_REPOSITORY } from './repositories/post.repository.port.js';
import { PgPostRepository } from './repositories/pg-post.repository.js';
import { PostService } from './application/post.service.js';
import { PostController } from './transport/post.controller.js';

/**
 * `posts` - product tier. EPIC-06.
 *
 * Owns `posts`, `post_media` and `link_previews`.
 *
 * Depends on `profile` for the author projection every post renders (§162),
 * on `engagement` for the viewer's like state — through an inverted port,
 * because `engagement` already imports this module (see `ports/`) —
 * on `safety` for the block predicate, and on `media` - though only for the
 * attachment LIMITS. Whether a given media id may be attached is decided by
 * the database trigger (ADR-013 step 7), not by asking the media module, which
 * is what closes the race between checking and inserting.
 */
@Module({
  imports: [IdentityModule, ProfileModule, SafetyModule, MediaModule],
  controllers: [PostController],
  providers: [
    PgPostRepository,
    { provide: POST_REPOSITORY, useExisting: PgPostRepository },

    // The viewer's like state, for INTEGRATION-006. Bound here rather than by
    // importing `EngagementModule`, which imports this one: see
    // `ports/viewer-likes.port.ts` for why the lighter edge is inverted. The
    // repository's only dependency is the global `DatabaseService`, so binding
    // it creates no import edge back into `EngagementModule` — the same shape
    // `SafetyModule` uses for `FOLLOW_REMOVAL`.
    PgEngagementRepository,
    { provide: ENGAGEMENT_REPOSITORY, useExisting: PgEngagementRepository },
    ViewerLikesAdapter,
    { provide: VIEWER_LIKES, useExisting: ViewerLikesAdapter },

    PostService,
  ],
  // Exported for the feed (EPIC-07), engagement, and search.
  exports: [PostService],
})
export class PostsModule {}
