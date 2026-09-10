import type { HiddenEngagement } from '../repositories/engagement.repository.port.js';

/** What a given viewer should be shown for one post. */
export interface AdjustedEngagement {
  likeCount: number;
  commentCount: number;
  viewerHasLiked: boolean;
}

/**
 * Turn stored counters into the counters a particular viewer should see
 * (ENGAGE-FR-006).
 *
 * EXTRACTED SO THERE IS ONE OF IT. `EngagementService.adjustedCounts` had this
 * logic and the feed used it; a post's own screen and a profile's post list did
 * not, and rendered the stored counters straight. With one block in place the
 * feed reported 0 likes and 0 comments while the same post's own screen
 * reported 1 and 1 — and the only liker was the person the reader had blocked
 * (INTEGRATION-010).
 *
 * The fix needed a second caller, and a second caller needed this to stop being
 * a private method. Copying the arithmetic into the adapter would have produced
 * exactly the drift that caused the defect, so it lives here and both paths
 * call it.
 *
 * THE STORED COUNTERS ARE NEVER MUTATED. They remain the platform-wide truth
 * that moderation and ranking read; this is a per-viewer projection.
 */
export function adjustCounts(
  posts: readonly { id: string; likeCount: number; commentCount: number }[],
  hidden: Map<string, HiddenEngagement>,
  liked: Set<string>,
): Map<string, AdjustedEngagement> {
  const out = new Map<string, AdjustedEngagement>();
  for (const post of posts) {
    const h: HiddenEngagement = hidden.get(post.id) ?? { likes: 0, comments: 0 };
    out.set(post.id, {
      // Clamped at zero. The stored count and the hidden count are read in
      // separate statements, so a like removed between them could otherwise
      // produce a negative — which would look like a bug to a user.
      likeCount: Math.max(post.likeCount - h.likes, 0),
      commentCount: Math.max(post.commentCount - h.comments, 0),
      viewerHasLiked: liked.has(post.id),
    });
  }
  return out;
}
