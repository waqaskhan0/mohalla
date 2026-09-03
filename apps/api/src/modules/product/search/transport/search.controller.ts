import {
  BadRequestException,
  Controller,
  Get,
  Query,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { FoundationErrorCode } from '@mohalla/contracts';
import { ZodValidationPipe } from '../../../../common/validation/zod-validation.pipe.js';
import { Principal } from '../../../platform/identity/transport/session.guard.js';
import type { AuthenticatedPrincipal } from '../../../platform/identity/application/session.service.js';
import { SearchService, type SearchResult } from '../application/search.service.js';
import { SEARCH_QUERY_MAX_LENGTH } from '../domain/search-query.js';

const searchQuery = z
  .object({
    // Named `q` by the frozen contract: GET /search/people?q=
    q: z.string().max(SEARCH_QUERY_MAX_LENGTH * 4),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    offset: z.coerce.number().int().min(0).max(1000).optional(),
  })
  .strict();
type SearchQuery = z.infer<typeof searchQuery>;

/**
 * Search (SRCH-API-001…003).
 *
 * THE STATUS CODES CARRY A DISTINCTION THE REST OF THIS API DELIBERATELY
 * COLLAPSES. Everywhere else, failures become one neutral answer so a caller
 * cannot probe what exists. Search is the exception, because SEARCH-FR-003 E3
 * says an outage "must not present as a zero-results state, which would mislead
 * the user into thinking the content does not exist":
 *
 *   200 with an empty list  -> we looked, and there is nothing
 *   503 SEARCH_UNAVAILABLE  -> we could not look
 *   400 with the minimum    -> the query was too short to run (E2)
 *
 * On a civic platform those lead to different actions, so they are different
 * responses. Note this leaks nothing extra: the distinction is about the
 * SEARCH, not about any particular record.
 */
@ApiTags('search')
@Controller()
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Get('search/people')
  @ApiOperation({
    summary: 'Find people by display name or username (SRCH-API-001).',
    description:
      'Cross-script: an Urdu-script name is found by its Roman spelling and the reverse ' +
      '(SEARCH-FR-003). Excludes blocked users in either direction and banned or deleted ' +
      'accounts; SUSPENDED accounts are INCLUDED, because a suspension is temporary and ' +
      'hiding the account would break existing conversations.',
  })
  async people(
    @Principal() principal: AuthenticatedPrincipal,
    @Query(new ZodValidationPipe(searchQuery)) query: SearchQuery,
  ) {
    return this.render(
      await this.search.people({
        viewerId: principal.userId,
        query: query.q,
        ...(query.limit !== undefined ? { limit: query.limit } : {}),
        ...(query.offset !== undefined ? { offset: query.offset } : {}),
      }),
    );
  }

  @Get('search/posts')
  @ApiOperation({
    summary: 'Find posts by text (SRCH-API-002).',
    description:
      'Ranked by relevance then recency. Cross-script, so a post written in Urdu is found by ' +
      'a Roman Urdu query. Auto-hidden, deleted and blocked-author posts are excluded - ' +
      "searching an auto-hidden post's exact text returns nothing.",
  })
  async posts(
    @Principal() principal: AuthenticatedPrincipal,
    @Query(new ZodValidationPipe(searchQuery)) query: SearchQuery,
  ) {
    return this.render(
      await this.search.posts({
        viewerId: principal.userId,
        query: query.q,
        ...(query.limit !== undefined ? { limit: query.limit } : {}),
        ...(query.offset !== undefined ? { offset: query.offset } : {}),
      }),
    );
  }

  private render<T>(result: SearchResult<T>) {
    if (result.status === 'QUERY_TOO_SHORT') {
      // E2: refused with the minimum STATED, so the client can say why rather
      // than showing an empty screen.
      throw new BadRequestException({
        code: 'SEARCH_QUERY_TOO_SHORT',
        message: `Enter at least ${result.minimum} characters to search.`,
        details: [{ path: 'q', message: `MIN_LENGTH_${result.minimum}` }],
      });
    }
    if (result.status === 'INVALID_QUERY') {
      throw new BadRequestException({
        code: FoundationErrorCode.VALIDATION_FAILED,
        message: 'That search could not be run.',
        details: [{ path: 'q', message: result.reason }],
      });
    }
    if (result.status === 'UNAVAILABLE') {
      // E3, and the reason this is not an empty 200: a zero-results page would
      // tell the user the content does not exist.
      throw new ServiceUnavailableException({
        code: 'SEARCH_UNAVAILABLE',
        message: 'Search is temporarily unavailable. Please try again.',
      });
    }
    return { results: result.results, nextOffset: result.nextOffset };
  }
}
