import { Inject, Injectable } from '@nestjs/common';
import { DatabaseService } from '../../../../database/database.service.js';
import { StructuredLogger } from '../../../../common/logging/structured.logger.js';
import { BlockService } from '../../safety/application/block.service.js';
import { ProfileService } from '../../profile/application/profile.service.js';
import {
  FOLLOW_REPOSITORY,
  type FollowPage,
  type FollowRepository,
} from '../repositories/follow.repository.port.js';
import { REQUEST_PROMOTION, type RequestPromotion } from '../ports/request-promotion.port.js';
import { OutboxService } from '../../../platform/notifications/application/outbox.service.js';

export type FollowResult =
  | { status: 'FOLLOWING'; created: boolean }
  | { status: 'CANNOT_FOLLOW_SELF' }
  | { status: 'NOT_AVAILABLE' };

export type UnfollowResult = { status: 'NOT_FOLLOWING' };

/**
 * Following (SOCIAL-FR-001…005 · BR-018…024 · EDGE-015/016).
 *
 * FOLLOWING NEEDS NO CONSENT (BR-018), because every profile is public in V1.
 * There is no request, no approval and no pending state — a follow is a
 * one-directional statement about whose posts you want to see.
 *
 * FOUR THINGS THIS SERVICE IS CAREFUL ABOUT.
 *
 * 1. IDEMPOTENCE (EDGE-015). A repeat follow is not an error. The composite
 *    primary key guarantees one row, so this reports success either way and
 *    the counts do not move — which is SOCIAL-FR-001's acceptance criterion
 *    stated exactly.
 *
 * 2. A BLOCK BLOCKS THE FOLLOW (BR-023, EDGE-016), in either direction, and
 *    the refusal is the same neutral NOT_AVAILABLE used for a banned or
 *    missing account. Saying "you are blocked" would disclose the block.
 *
 * 3. AN UNFOLLOW IS SILENT (BR-020). No notification, ever. A follow notifies
 *    the target; an unfollow must not, because "X unfollowed you" is an
 *    invitation to social friction with no upside.
 *
 * 4. THE COUNTS ARE NOT THIS SERVICE'S JOB. A database trigger maintains them
 *    on every insert and delete, including the deletes that blocking and
 *    account deletion cause. Doing it here would mean every future path that
 *    touches a follow has to remember.
 */
@Injectable()
export class FollowService {
  constructor(
    private readonly db: DatabaseService,
    @Inject(FOLLOW_REPOSITORY) private readonly repo: FollowRepository,
    @Inject(REQUEST_PROMOTION) private readonly requests: RequestPromotion,
    private readonly outbox: OutboxService,
    private readonly blocks: BlockService,
    private readonly profiles: ProfileService,
    private readonly logger: StructuredLogger,
  ) {}

  async follow(followerId: string, followeeId: string): Promise<FollowResult> {
    // BR-019. Refused explicitly rather than left to the CHECK constraint, so
    // the user gets an answer instead of a 500.
    if (followerId === followeeId) return { status: 'CANNOT_FOLLOW_SELF' };

    // Visibility first, and it covers three refusals with one answer: the
    // target does not exist, is banned or deleted, or there is a block either
    // way (BR-023, BR-025). The profile read path already collapses these.
    const target = await this.profiles.viewByUserId(followerId, followeeId);
    if (target.status === 'NOT_AVAILABLE') return { status: 'NOT_AVAILABLE' };

    return this.db.withTransaction(async (client) => {
      const created = await this.repo.follow(followerId, followeeId, client);

      // MSG-FR-005 A3: "Recipient later follows the sender -> any pending
      // request is promoted to the inbox automatically." Same transaction, so a
      // follow that commits cannot leave the message it was about still sitting
      // in a request area the user rarely looks at.
      //
      // Run even when `created` is false. It costs one UPDATE that usually
      // matches nothing, and it repairs the state if an earlier attempt was
      // interrupted between the two writes.
      const promoted = await this.requests.promotePendingRequest(followerId, followeeId, client);

      // SOCIAL-FR-001: "the target receives a notification". Only when
      // `created` - a repeat follow must not produce a second one, which is
      // the same idempotence the composite primary key gives the row itself.
      if (created) {
        await this.outbox.emit(
          { topic: 'social.followed', followeeId, actorId: followerId },
          client,
        );
      }

      this.log(created ? 'follow_created' : 'follow_repeated');
      if (promoted) this.log('message_request_promoted');
      return { status: 'FOLLOWING', created } as const;
    });
  }

  /**
   * Unfollow (SOCIAL-FR-002).
   *
   * Reports the same result whether or not a follow existed: the caller asked
   * for a state, and that state now holds. There is no notification and
   * nothing is emitted — BR-020, and the module's own test is that an unfollow
   * produces no notification.
   */
  async unfollow(followerId: string, followeeId: string): Promise<UnfollowResult> {
    await this.db.withTransaction(async (client) => {
      await this.repo.unfollow(followerId, followeeId, client);
    });
    this.log('unfollow');
    return { status: 'NOT_FOLLOWING' };
  }

  async isFollowing(followerId: string, followeeId: string): Promise<boolean> {
    return this.repo.isFollowing(followerId, followeeId);
  }

  /**
   * Follower and following lists (SOCIAL-FR-003/004), paginated at 20.
   *
   * The SUBJECT's own visibility is checked first: a banned profile has no
   * viewable follower list, and a blocked one must not expose through this
   * route what the profile route refuses to show.
   */
  async listFollowers(
    viewerId: string,
    subjectId: string,
    limit = 20,
    before?: Date,
  ): Promise<FollowPage | null> {
    if (!(await this.subjectVisible(viewerId, subjectId))) return null;
    return this.repo.listFollowers(viewerId, subjectId, clampLimit(limit), before);
  }

  async listFollowing(
    viewerId: string,
    subjectId: string,
    limit = 20,
    before?: Date,
  ): Promise<FollowPage | null> {
    if (!(await this.subjectVisible(viewerId, subjectId))) return null;
    return this.repo.listFollowing(viewerId, subjectId, clampLimit(limit), before);
  }

  /**
   * Suggested accounts (SOCIAL-FR-005).
   *
   * Must return a non-empty set where one is possible, even for a user with no
   * interests selected — PROFILE-FR-011's acceptance criterion. So this is
   * ordered by verified organizations and reach rather than by interest
   * overlap, and interests inform ranking in a later epic rather than gating
   * the result now.
   */
  async suggestions(viewerId: string, limit = 20): Promise<string[]> {
    return this.repo.suggestions(viewerId, clampLimit(limit));
  }

  private async subjectVisible(viewerId: string, subjectId: string): Promise<boolean> {
    if (viewerId === subjectId) return true;
    const target = await this.profiles.viewByUserId(viewerId, subjectId);
    return target.status === 'FOUND';
  }

  private log(event: string): void {
    // No ids: a log pairing a follower with a followee is a record of the
    // social graph, and the graph is already in the database under access
    // control. The event alone is what operations needs.
    this.logger.log(JSON.stringify({ event }), 'social-graph');
  }
}

/**
 * 20 per page by requirement, 100 as a hard ceiling.
 *
 * A client asking for 10,000 followers in one request is either a mistake or
 * an attempt to make the server do expensive work; either way the answer is
 * the same.
 */
function clampLimit(limit: number): number {
  if (!Number.isFinite(limit) || limit < 1) return 20;
  return Math.min(Math.trunc(limit), 100);
}
