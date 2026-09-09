/**
 * PER-USER RATE LIMITS (SAFETY-FR-009 · SEC-005).
 *
 * "Limits are enforced server-side; exceeding one produces A CLEAR COOL-DOWN
 * MESSAGE rather than a silent failure." That second half is the part worth
 * holding onto: a silent failure teaches a user the app is broken, and on a
 * platform where the whole point is to raise a problem with your neighbourhood,
 * "my post didn't send" is indistinguishable from "nobody listened".
 *
 * THE NUMBERS ARE DELIBERATELY GENEROUS. Every one of them sits far above
 * ordinary use — twenty posts, a hundred comments, two hundred messages in a
 * day. The cost of a false positive here is a real neighbour silenced at the
 * moment they had something to say; the cost of a false negative is a spammer
 * who gets a day's head start on a moderator. Those are not symmetric.
 *
 * TWO OF THESE ALREADY EXIST ELSEWHERE, and this file does not duplicate them —
 * it records them, so the whole set is visible in one place:
 *
 *   events   — enforced in `events/domain/event-fields.ts` (EVENT-FR-001 E4)
 *   messages — the MESSAGE REQUEST limit in messaging is a different, tighter
 *              rule (10 new requests/day, MSG-FR-005 E3): it limits opening
 *              cold threads rather than sending messages, and the two coexist.
 */

export const RATE_LIMITS = {
  POSTS_PER_DAY: 20,
  COMMENTS_PER_DAY: 100,
  MESSAGES_PER_DAY: 200,
  FOLLOWS_PER_DAY: 100,
  EVENTS_PER_DAY: 5,
  REPORTS_PER_DAY: 20,
} as const;

export type RateLimitedAction = keyof typeof RATE_LIMITS;

export const RATE_LIMIT_WINDOW_HOURS = 24;

export interface RateLimitVerdict {
  allowed: boolean;
  limit: number;
  used: number;
  /** When the window rolls forward. Stated, because the message must say so. */
  resetsAt: Date;
}

/**
 * A rolling window, not a calendar day.
 *
 * "GIVEN a user who has created 20 posts today, WHEN they attempt a 21st, THEN
 * it is refused WITH THE LIMIT AND RESET TIME STATED." A calendar day would
 * make the reset time a cliff at local midnight — which, for a user in a
 * different timezone from the server, arrives at an hour that makes no sense to
 * them. A rolling window resets exactly 24 hours after the action that filled
 * it, which is both fairer and explainable.
 */
export function checkRateLimit(
  action: RateLimitedAction,
  usedInWindow: number,
  oldestInWindow: Date | null,
  now: Date,
): RateLimitVerdict {
  const limit = RATE_LIMITS[action];
  const windowMs = RATE_LIMIT_WINDOW_HOURS * 60 * 60 * 1000;

  return {
    allowed: usedInWindow < limit,
    limit,
    used: usedInWindow,
    // The window clears when the OLDEST action in it ages out — not `now + 24h`,
    // which would tell a user to wait a full day when they might be one minute
    // from their next slot.
    resetsAt:
      oldestInWindow === null
        ? new Date(now.getTime() + windowMs)
        : new Date(oldestInWindow.getTime() + windowMs),
  };
}
