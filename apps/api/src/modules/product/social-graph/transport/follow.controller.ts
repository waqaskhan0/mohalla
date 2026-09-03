import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Put,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { FoundationErrorCode } from '@mohalla/contracts';
import { ZodValidationPipe } from '../../../../common/validation/zod-validation.pipe.js';
import { Principal, RequiresWrite } from '../../../platform/identity/transport/session.guard.js';
import type { AuthenticatedPrincipal } from '../../../platform/identity/application/session.service.js';
import { FollowService } from '../application/follow.service.js';
import { ProfileService } from '../../profile/application/profile.service.js';

const targetParam = z.object({ id: z.string().uuid() }).strict();
type TargetParam = z.infer<typeof targetParam>;

const pageQuery = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).optional(),
    before: z.string().datetime().optional(),
  })
  .strict();
type PageQuery = z.infer<typeof pageQuery>;

/**
 * Following (SOC-API-001…005).
 *
 * `PUT` / `DELETE` on the same path, because following is a STATE and both
 * directions are idempotent (SOCIAL-FR-001 and -002 both specify it). A repeat
 * follow returns the same 204 as the first, and the counts do not move.
 *
 * A REFUSED FOLLOW IS A NEUTRAL 404. Blocked, banned, deleted and never-existed
 * are one answer (BR-023, BR-025) — a distinct "you are blocked" would disclose
 * the block, which is the one thing blocking must never do.
 *
 * Lists return PROFILES, not bare ids. A client showing a follower list needs a
 * name, a photo and a badge for each row, and returning ids would force it into
 * N+1 requests — on the connections this platform targets, that is the
 * difference between a list that loads and one that does not.
 */
@ApiTags('social-graph')
@Controller()
export class FollowController {
  constructor(
    private readonly follows: FollowService,
    private readonly profiles: ProfileService,
  ) {}

  @Put('users/:id/follow')
  @RequiresWrite()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Follow a user (SOC-API-001, SOCIAL-FR-001).',
    description:
      'No approval step - all profiles are public, so following needs no consent (BR-018). ' +
      'Idempotent: a repeat follow leaves exactly one relationship and does not change the ' +
      'count. Refused with a neutral 404 across a block, in either direction (BR-023).',
  })
  async follow(
    @Principal() principal: AuthenticatedPrincipal,
    @Param(new ZodValidationPipe(targetParam)) params: TargetParam,
  ) {
    const result = await this.follows.follow(principal.userId, params.id);

    if (result.status === 'CANNOT_FOLLOW_SELF') {
      throw new BadRequestException({
        code: FoundationErrorCode.VALIDATION_FAILED,
        message: 'You cannot follow yourself.',
      });
    }
    if (result.status === 'NOT_AVAILABLE') throw resourceUnavailable();
  }

  @Delete('users/:id/follow')
  @RequiresWrite()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Unfollow (SOC-API-002, SOCIAL-FR-002).',
    description:
      'Idempotent, and SILENT: no notification is ever produced (BR-020). Succeeds even when ' +
      'no relationship existed - the caller asked for a state, and that state now holds.',
  })
  async unfollow(
    @Principal() principal: AuthenticatedPrincipal,
    @Param(new ZodValidationPipe(targetParam)) params: TargetParam,
  ) {
    await this.follows.unfollow(principal.userId, params.id);
  }

  @Get('users/:id/followers')
  @ApiOperation({
    summary: "A profile's followers (SOC-API-003, SOCIAL-FR-003).",
    description:
      'Paginated at 20. Excludes anyone blocked in either direction relative to the VIEWER, ' +
      'and excludes banned and deleted accounts. Suspended accounts are included, because a ' +
      'suspension is temporary and hiding them would silently rewrite the social graph.',
  })
  async followers(
    @Principal() principal: AuthenticatedPrincipal,
    @Param(new ZodValidationPipe(targetParam)) params: TargetParam,
    @Query(new ZodValidationPipe(pageQuery)) query: PageQuery,
  ) {
    const page = await this.follows.listFollowers(
      principal.userId,
      params.id,
      query.limit ?? 20,
      query.before === undefined ? undefined : new Date(query.before),
    );
    if (page === null) throw resourceUnavailable();
    return this.hydrate(principal.userId, page.userIds, page.nextBefore);
  }

  @Get('users/:id/following')
  @ApiOperation({
    summary: 'Accounts a profile follows (SOC-API-004, SOCIAL-FR-004).',
    description: 'Same rules and pagination as the follower list.',
  })
  async following(
    @Principal() principal: AuthenticatedPrincipal,
    @Param(new ZodValidationPipe(targetParam)) params: TargetParam,
    @Query(new ZodValidationPipe(pageQuery)) query: PageQuery,
  ) {
    const page = await this.follows.listFollowing(
      principal.userId,
      params.id,
      query.limit ?? 20,
      query.before === undefined ? undefined : new Date(query.before),
    );
    if (page === null) throw resourceUnavailable();
    return this.hydrate(principal.userId, page.userIds, page.nextBefore);
  }

  @Get('suggestions')
  @ApiOperation({
    summary: 'Suggested accounts (SOC-API-005, SOCIAL-FR-005).',
    description:
      'Excludes self, accounts already followed, blocked accounts in either direction, and ' +
      'accounts that are not publicly visible. Verified organizations first, then by reach. ' +
      'Returns a non-empty set even when no interests are selected (PROFILE-FR-011 AC).',
  })
  async suggestions(
    @Principal() principal: AuthenticatedPrincipal,
    @Query(new ZodValidationPipe(pageQuery)) query: PageQuery,
  ) {
    const ids = await this.follows.suggestions(principal.userId, query.limit ?? 20);
    return this.hydrate(principal.userId, ids, null);
  }

  /**
   * Turn ids into public profiles.
   *
   * Goes through `ProfileService`, so these rows carry the SAME projection as
   * every other surface — one definition of what a person looks like (§162).
   * A row that has become unavailable between the list query and here is
   * dropped rather than rendered as a gap, which also closes the small window
   * where a block created mid-request could otherwise leak one profile.
   */
  private async hydrate(viewerId: string, ids: readonly string[], nextBefore: Date | null) {
    const users = [];
    for (const id of ids) {
      const view = await this.profiles.viewByUserId(viewerId, id);
      if (view.status === 'FOUND') users.push(view.profile);
    }
    return { users, nextBefore: nextBefore?.toISOString() ?? null };
  }
}

/** One neutral state for blocked, banned, deleted and never-existed (BR-025). */
function resourceUnavailable(): NotFoundException {
  return new NotFoundException({
    code: 'RESOURCE_UNAVAILABLE',
    message: 'This content is no longer available.',
  });
}
