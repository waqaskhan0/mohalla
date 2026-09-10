/**
 * "Has this viewer liked these posts?"
 *
 * WHY A PORT, WHEN `engagement` ALREADY DEPENDS ON `posts`.
 *
 * `engagement` imports `posts` because every like and comment checks the
 * post's own visibility first, and that is the heavier, more frequently
 * exercised edge. `posts` needs one thing back — whether the viewer has liked
 * the post it is about to render — and the two together are a cycle. Following
 * `follow-removal.port.ts`, the lighter direction is inverted rather than
 * resolved with `forwardRef`, so the import graph stays a statement about
 * layering. `likes` keeps exactly one writer and one reader-of-record: its
 * owner.
 *
 * WHY IT IS NEEDED AT ALL (INTEGRATION-006).
 *
 * `FeedItemResponse` carries `viewerHasLiked`; `PostResponse` did not, and the
 * Android field defaults to `false`. So a post opened at its own screen —
 * from a deep link, a notification, search, or a tap in the feed — always
 * rendered an empty heart, whatever the viewer had actually done. Measured: a
 * post the viewer had just liked showed "Like" and a count of 1, and tapping
 * it optimistically moved the count to 2 while the database still held one
 * row. Nothing reconciled it, because from the client's point of view nothing
 * had gone wrong.
 */
export const VIEWER_LIKES = Symbol.for('mohalla.posts.viewerLikes');

export interface ViewerLikes {
  /**
   * The subset of `postIds` this viewer has liked.
   *
   * A SET FOR A PAGE rather than a boolean for one post, because
   * `listByAuthor` renders twenty at a time and twenty round trips on a slow
   * connection is the thing the feed's own lookup was written to avoid.
   */
  likedAmong(viewerId: string, postIds: readonly string[]): Promise<Set<string>>;
}
