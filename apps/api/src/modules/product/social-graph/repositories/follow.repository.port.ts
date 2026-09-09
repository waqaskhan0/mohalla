import type { PoolClient } from 'pg';

export const FOLLOW_REPOSITORY = Symbol.for('mohalla.socialGraph.followRepository');

export interface FollowEdge {
  followerId: string;
  followeeId: string;
  createdAt: Date;
}

/** One page of a follower or following list, keyset-paginated. */
export interface FollowPage {
  userIds: string[];
  /** Cursor for the next page, or null at the end. */
  nextBefore: Date | null;
}

export interface FollowRepository {
  /**
   * Create the edge.
   *
   * @returns false when it already existed. Idempotent by the composite
   * PRIMARY KEY, not by a prior existence check — SOCIAL-FR-001's acceptance
   * criterion ("exactly one relationship exists and the count is unchanged")
   * is then a property of the schema rather than of this code path.
   */
  follow(followerId: string, followeeId: string, client: PoolClient): Promise<boolean>;

  /** @returns false when no edge existed. Idempotent (SOCIAL-FR-002 error case). */
  unfollow(followerId: string, followeeId: string, client: PoolClient): Promise<boolean>;

  isFollowing(followerId: string, followeeId: string, client?: PoolClient): Promise<boolean>;

  /**
   * Remove both directions at once, for BR-024.
   *
   * Lives here because `follows` is this module's table; `safety` asks for it
   * through a port rather than writing the table itself.
   */
  removeBothDirections(userA: string, userB: string, client: PoolClient): Promise<number>;

  /**
   * Who follows this person (SOCIAL-FR-003).
   *
   * `viewerId` is required, not optional: the list must exclude anyone blocked
   * in either direction relative to the VIEWER, and a signature that let the
   * viewer be omitted would make the unfiltered query the easy one to call.
   */
  listFollowers(
    viewerId: string,
    subjectId: string,
    limit: number,
    before?: Date,
    client?: PoolClient,
  ): Promise<FollowPage>;

  /** Who this person follows (SOCIAL-FR-004). Same filtering rules. */
  listFollowing(
    viewerId: string,
    subjectId: string,
    limit: number,
    before?: Date,
    client?: PoolClient,
  ): Promise<FollowPage>;

  /**
   * Candidate accounts to suggest (SOCIAL-FR-005).
   *
   * Excludes self, anyone already followed, anyone blocked in either
   * direction, and any account that is not publicly visible. Verified
   * organizations first, then by follower count — the requirement asks for a
   * non-empty default set even with no interests selected, so this must never
   * depend on interests being present.
   */
  suggestions(viewerId: string, limit: number, client?: PoolClient): Promise<string[]>;
}
