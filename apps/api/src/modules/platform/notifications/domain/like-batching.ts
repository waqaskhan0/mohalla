/**
 * LIKE BATCHING (NOTIF-FR-003 · ADR-014 rule 5).
 *
 * "Likes on the same post are batched above 5 within an hour into a single
 * summary, TO AVOID NOTIFICATION FATIGUE." The acceptance criterion is concrete:
 * "GIVEN a post receives 12 likes within one hour, WHEN notifications are
 * delivered, THEN the user receives a summary rather than 12 separate alerts."
 *
 * The reason matters more than the mechanism. A neighbourhood notice that
 * suddenly does well is the BEST thing that can happen to somebody on this
 * platform, and twelve consecutive buzzes is how you teach them to turn
 * notifications off — losing every future like, comment and event reminder too.
 * The threshold protects the thing it looks like it is limiting.
 */

/** "Above 5" — the sixth like within the window starts summarising. */
export const LIKE_BATCH_THRESHOLD = 5;
export const LIKE_BATCH_WINDOW_MINUTES = 60;

export type LikeNotificationPlan =
  /** Under the threshold: an ordinary one-actor notification. */
  | { kind: 'INDIVIDUAL' }
  /** At the threshold: replace the individual rows with one summary. */
  | { kind: 'START_SUMMARY'; total: number }
  /** A summary already exists in the window: bump its count, add no row. */
  | { kind: 'EXTEND_SUMMARY'; total: number };

export function planLikeNotification(facts: {
  /** Likes on this post already notified inside the window, summary included. */
  likesInWindow: number;
  /** Whether a summary row already covers this post inside the window. */
  summaryExists: boolean;
}): LikeNotificationPlan {
  if (facts.summaryExists) {
    return { kind: 'EXTEND_SUMMARY', total: facts.likesInWindow + 1 };
  }
  if (facts.likesInWindow >= LIKE_BATCH_THRESHOLD) {
    // The sixth like is where the switch happens. Everything already delivered
    // stays delivered - reaching back to delete five notifications the user may
    // have read would be worse than the duplication it tidies.
    return { kind: 'START_SUMMARY', total: facts.likesInWindow + 1 };
  }
  return { kind: 'INDIVIDUAL' };
}
