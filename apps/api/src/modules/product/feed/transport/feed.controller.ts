import {
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
import { ZodValidationPipe } from '../../../../common/validation/zod-validation.pipe.js';
import { Principal, RequiresWrite } from '../../../platform/identity/transport/session.guard.js';
import type { AuthenticatedPrincipal } from '../../../platform/identity/application/session.service.js';
import { FeedService } from '../application/feed.service.js';

const feedQuery = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).optional(),
    cursorCreatedAt: z.string().datetime().optional(),
    cursorId: z.string().uuid().optional(),
    /** FEED-FR-006: one category. Filtering never changes ordering. */
    category: z.string().min(1).max(64).optional(),
    /** FEED-FR-005: pull-to-refresh asks for what is newer than the top item. */
    since: z.string().datetime().optional(),
  })
  .strict();
type FeedQuery = z.infer<typeof feedQuery>;

const idParam = z.object({ id: z.string().uuid() }).strict();
type IdParam = z.infer<typeof idParam>;

/**
 * Feeds (FEED-API-001…006).
 *
 * `/feed/featured` IS ITS OWN ENDPOINT BY REQUIREMENT, not by convenience
 * (§145). FEED-FR-002 is the cold-start guarantee: a brand-new account
 * following nobody must not see a blank app, so the announcements query takes
 * no viewer, touches no follow data, and cannot be delayed by the Following
 * query it exists to compensate for.
 *
 * PAGINATION IS KEYSET, NOT OFFSET (FEED-FR-004). The requirement is explicit:
 * "a post inserted during browsing must not cause an item to repeat or be
 * skipped", with the acceptance criterion being 100 posts read while new ones
 * are created. OFFSET fails that by construction — every insertion shifts every
 * later page by one.
 *
 * BOTH CURSOR HALVES OR NEITHER. A partial cursor would silently page from the
 * beginning, which to a reader looks exactly like duplicated content.
 */
@ApiTags('feed')
@Controller()
export class FeedController {
  constructor(private readonly feed: FeedService) {}

  @Get('feed/following')
  @ApiOperation({
    summary: 'The following feed (FEED-API-001, FEED-FR-001).',
    description:
      'Posts from accounts the viewer follows, STRICTLY newest-first (BR-026) - there is no ' +
      'ranking and no sort parameter. Excludes blocked, auto-hidden, deleted and banned-author ' +
      'content (BR-027/028); posts from SUSPENDED users remain visible. Pass `since` for ' +
      'pull-to-refresh (FEED-API-004).',
  })
  async following(
    @Principal() principal: AuthenticatedPrincipal,
    @Query(new ZodValidationPipe(feedQuery)) query: FeedQuery,
  ) {
    return this.feed.following(this.toRequest(principal.userId, query));
  }

  @Get('feed/discover')
  @ApiOperation({
    summary: 'The discover feed (FEED-API-002, FEED-FR-003).',
    description:
      'Every visible post platform-wide, newest first, whether or not the viewer follows the ' +
      'author. The primary answer to cold start: a brand-new account following nobody still ' +
      'sees the platform. Same exclusions as the following feed.',
  })
  async discover(
    @Principal() principal: AuthenticatedPrincipal,
    @Query(new ZodValidationPipe(feedQuery)) query: FeedQuery,
  ) {
    return this.feed.discover(this.toRequest(principal.userId, query));
  }

  @Get('feed/featured')
  @ApiOperation({
    summary: 'Featured announcements (FEED-API-003, FEED-FR-002).',
    description:
      'Up to five unexpired announcements, newest first. Resolves INDEPENDENTLY of follow ' +
      'data by requirement - this is the cold-start guarantee (RSK-001). An empty array means ' +
      'the client hides the section entirely rather than rendering an empty container.',
  })
  async featured() {
    // No viewer parameter, deliberately. See the class comment.
    return { announcements: await this.feed.featured() };
  }

  @Get('me/saved')
  @ApiOperation({
    summary: 'Saved posts (FEED-API-006, FEED-FR-007).',
    description:
      'Newest-SAVED-first, and private to the caller. There is no route that reveals who saved ' +
      'a given post, and saving generates no notification to its author.',
  })
  async saved(
    @Principal() principal: AuthenticatedPrincipal,
    @Query(new ZodValidationPipe(feedQuery)) query: FeedQuery,
  ) {
    return this.feed.saved(this.toRequest(principal.userId, query));
  }

  @Put('posts/:id/save')
  @RequiresWrite()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Save a post (FEED-API-005, FEED-FR-007).',
    description: 'Private, idempotent, and silent - the author is never told.',
  })
  async save(
    @Principal() principal: AuthenticatedPrincipal,
    @Param(new ZodValidationPipe(idParam)) params: IdParam,
  ) {
    const result = await this.feed.save(principal.userId, params.id);
    if (result.status === 'NOT_AVAILABLE') {
      throw new NotFoundException({
        code: 'RESOURCE_UNAVAILABLE',
        message: 'This content is no longer available.',
      });
    }
  }

  @Delete('posts/:id/save')
  @RequiresWrite()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a saved post. Idempotent.' })
  async unsave(
    @Principal() principal: AuthenticatedPrincipal,
    @Param(new ZodValidationPipe(idParam)) params: IdParam,
  ) {
    await this.feed.unsave(principal.userId, params.id);
  }

  private toRequest(viewerId: string, query: FeedQuery) {
    return {
      viewerId,
      ...(query.limit !== undefined ? { limit: query.limit } : {}),
      // Both halves or neither - a partial cursor pages from the start, which
      // reads as duplicated content.
      ...(query.cursorCreatedAt !== undefined && query.cursorId !== undefined
        ? { cursor: { createdAt: new Date(query.cursorCreatedAt), id: query.cursorId } }
        : {}),
      ...(query.category !== undefined ? { categorySlug: query.category } : {}),
      ...(query.since !== undefined ? { since: new Date(query.since) } : {}),
    };
  }
}
