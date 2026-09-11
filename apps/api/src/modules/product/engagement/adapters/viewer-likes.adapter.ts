import { Inject, Injectable } from '@nestjs/common';
import { adjustCounts } from '../domain/adjusted-counts.js';
import type { ViewerEngagement, ViewerLikes } from '../../posts/ports/viewer-likes.port.js';
import {
  ENGAGEMENT_REPOSITORY,
  type EngagementRepository,
} from '../repositories/engagement.repository.port.js';

/**
 * Supplies `posts` with the viewer's like state, without `posts` reading this
 * module's table.
 *
 * This is the inverted edge described in `posts/ports/viewer-likes.port.ts`.
 * It delegates to the same `likedPostIds` the feed uses, so a post rendered at
 * its own screen and the same post rendered in a feed answer the question the
 * same way — which is exactly what INTEGRATION-006 was: two surfaces
 * disagreeing about whether the reader had liked something.
 */
@Injectable()
export class ViewerLikesAdapter implements ViewerLikes {
  constructor(@Inject(ENGAGEMENT_REPOSITORY) private readonly repo: EngagementRepository) {}

  async likedAmong(viewerId: string, postIds: readonly string[]): Promise<Set<string>> {
    return this.repo.likedPostIds(viewerId, postIds);
  }

  async adjustedFor(
    viewerId: string,
    posts: readonly { id: string; likeCount: number; commentCount: number }[],
  ): Promise<Map<string, ViewerEngagement>> {
    const ids = posts.map((p) => p.id);
    const [hidden, liked] = await Promise.all([
      this.repo.hiddenEngagementFor(viewerId, ids),
      this.repo.likedPostIds(viewerId, ids),
    ]);
    return adjustCounts(posts, hidden, liked);
  }
}
