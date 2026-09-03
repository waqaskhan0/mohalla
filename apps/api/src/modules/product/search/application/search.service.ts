import { Inject, Injectable } from '@nestjs/common';
import { StructuredLogger } from '../../../../common/logging/structured.logger.js';
import { ProfileService } from '../../profile/application/profile.service.js';
import { EngagementService } from '../../engagement/application/engagement.service.js';
import type { PublicProfile } from '../../profile/domain/public-profile.js';
import type { FeedItem } from '../../feed/application/feed.service.js';
import {
  SEARCH_QUERY_MIN_LENGTH,
  checkSearchQuery,
  normalizeSearchQuery,
  type SearchQueryRejection,
} from '../domain/search-query.js';
import {
  SEARCH_REPOSITORY,
  type SearchRepository,
} from '../repositories/search.repository.port.js';

/** SEARCH-FR-001/002: "paginated at 20". */
const DEFAULT_PAGE_SIZE = 20;

export type SearchResult<T> =
  | { status: 'OK'; results: T[]; nextOffset: number | null }
  | { status: 'QUERY_TOO_SHORT'; minimum: number }
  | { status: 'INVALID_QUERY'; reason: SearchQueryRejection }
  /**
   * The search itself failed.
   *
   * SEARCH-FR-003 E3 is unusually specific about why this exists: an outage
   * "must not present as a zero-results state, which would mislead the user
   * into thinking the content does not exist". On a civic platform, "nobody has
   * posted about this" and "we could not look" lead to very different actions,
   * so they must be different answers.
   */
  | { status: 'UNAVAILABLE' };

export interface SearchRequest {
  viewerId: string;
  query: string;
  limit?: number;
  offset?: number;
}

/**
 * Search (SEARCH-FR-001/002/003 · BR-042 · ADR-011).
 *
 * SEARCH-FR-002 puts the value plainly: this "is the platform's single largest
 * advantage over WhatsApp, where nothing is findable after the fact." A
 * neighbourhood that discussed a water problem last month should be able to
 * find that discussion.
 *
 * CROSS-SCRIPT MATCHING IS THE HARD PART, and it is solved in the database
 * rather than here — `search_key()` reduces Urdu script and Roman Urdu to one
 * consonant skeleton, and a generated column keeps the index honest. This
 * service validates, delegates, and renders.
 *
 * WHAT IT DOES OWN is the distinction between "no results" and "could not
 * look". Everything else in this codebase collapses failure modes into one
 * neutral answer for privacy reasons; search is the one place where doing that
 * would actively mislead, so a thrown error becomes `UNAVAILABLE` and never an
 * empty list.
 *
 * SEARCH-FR-005 (recent searches) is deliberately absent. PRIV-011: they "are
 * stored on the device only and are never transmitted or retained on the
 * server". There is no endpoint, no table and no column — which is the correct
 * amount of implementation for a requirement that says the server must not
 * hold something.
 */
@Injectable()
export class SearchService {
  constructor(
    @Inject(SEARCH_REPOSITORY) private readonly repo: SearchRepository,
    private readonly profiles: ProfileService,
    private readonly engagement: EngagementService,
    private readonly logger: StructuredLogger,
  ) {}

  /** SRCH-API-001 — find people (SEARCH-FR-001). */
  async people(request: SearchRequest): Promise<SearchResult<PublicProfile>> {
    const query = this.validate(request.query);
    if (query.status !== 'VALID') return query;

    try {
      const page = await this.repo.people({
        viewerId: request.viewerId,
        query: query.query,
        limit: clampLimit(request.limit),
        offset: clampOffset(request.offset),
      });

      // Rendered through ProfileService, so a search result carries the SAME
      // projection as every other surface (§162) - and a badge revocation or a
      // block takes effect here without this module knowing.
      const results: PublicProfile[] = [];
      for (const userId of page.results) {
        if (userId === request.viewerId) {
          const own = await this.profiles.getOwn(userId);
          if (own !== null) results.push(own);
          continue;
        }
        const view = await this.profiles.viewByUserId(request.viewerId, userId);
        // A profile that became invisible between the query and here drops out
        // rather than rendering as a gap.
        if (view.status === 'FOUND') results.push(view.profile);
      }

      this.log('search_people', { results: results.length });
      return { status: 'OK', results, nextOffset: page.nextOffset };
    } catch (e) {
      return this.unavailable('search_people_failed', e);
    }
  }

  /** SRCH-API-002 — find posts (SEARCH-FR-002). */
  async posts(request: SearchRequest): Promise<SearchResult<FeedItem>> {
    const query = this.validate(request.query);
    if (query.status !== 'VALID') return query;

    try {
      const page = await this.repo.posts({
        viewerId: request.viewerId,
        query: query.query,
        limit: clampLimit(request.limit),
        offset: clampOffset(request.offset),
      });

      const authors = new Map<string, PublicProfile>();
      for (const id of new Set(page.results.map((p) => p.authorId))) {
        if (id === request.viewerId) {
          const own = await this.profiles.getOwn(id);
          if (own !== null) authors.set(id, own);
          continue;
        }
        const view = await this.profiles.viewByUserId(request.viewerId, id);
        if (view.status === 'FOUND') authors.set(id, view.profile);
      }

      // ENGAGE-FR-006 applies here too: counts shown in search must exclude
      // contributions from blocked users, exactly as they do in a feed.
      const counts = await this.engagement.adjustedCounts(
        request.viewerId,
        page.results.map((p) => ({
          id: p.id,
          likeCount: p.likeCount,
          commentCount: p.commentCount,
        })),
      );

      const results: FeedItem[] = [];
      for (const post of page.results) {
        const author = authors.get(post.authorId);
        if (author === undefined) continue;
        const c = counts.get(post.id) ?? {
          likeCount: post.likeCount,
          commentCount: post.commentCount,
          viewerHasLiked: false,
        };
        results.push({
          id: post.id,
          author,
          body: post.body,
          categorySlug: post.categorySlug,
          mediaIds: post.mediaIds,
          likeCount: c.likeCount,
          commentCount: c.commentCount,
          viewerHasLiked: c.viewerHasLiked,
          editedAt: post.editedAt?.toISOString() ?? null,
          createdAt: post.createdAt.toISOString(),
        });
      }

      this.log('search_posts', { results: results.length });
      return { status: 'OK', results, nextOffset: page.nextOffset };
    } catch (e) {
      return this.unavailable('search_posts_failed', e);
    }
  }

  // ---- internals --------------------------------------------------------

  /**
   * `VALID` rather than `OK`, so this cannot be confused with a search result.
   * The first version reused `OK` for both and the compiler caught it - the
   * two are different answers to different questions.
   */
  private validate(raw: string): { status: 'VALID'; query: string } | SearchResult<never> {
    const problem = checkSearchQuery(raw);
    if (problem === 'TOO_SHORT') {
      // SEARCH-FR-003 E2: refused, "minimum stated" - so the minimum travels
      // with the refusal rather than the client having to know it.
      return { status: 'QUERY_TOO_SHORT', minimum: SEARCH_QUERY_MIN_LENGTH };
    }
    if (problem !== null) return { status: 'INVALID_QUERY', reason: problem };
    return { status: 'VALID', query: normalizeSearchQuery(raw) };
  }

  private unavailable(event: string, e: unknown): { status: 'UNAVAILABLE' } {
    this.logger.error(
      JSON.stringify({ event }),
      e instanceof Error ? e.stack : String(e),
      'search',
    );
    return { status: 'UNAVAILABLE' };
  }

  private log(event: string, extra: Record<string, unknown>): void {
    // The QUERY is never logged. What somebody searches for is at least as
    // revealing as what they post - more so, since a search is not shared with
    // anyone - and PRIV-011 already says the server does not retain search
    // history. Logging it here would retain it by the back door.
    this.logger.log(JSON.stringify({ event, ...extra }), 'search');
  }
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit) || limit < 1) return DEFAULT_PAGE_SIZE;
  return Math.min(Math.trunc(limit), 100);
}

/**
 * Offset rather than a keyset cursor, and bounded.
 *
 * Relevance ordering is not stable enough for a keyset — two rows can share a
 * score, and a score is not a column that can be compared as a tie-break. The
 * bound matters more than usual as a result: a deep OFFSET makes the database
 * sort the whole match set, so an unbounded one is a cheap way to make the
 * server do expensive work.
 */
function clampOffset(offset: number | undefined): number {
  if (offset === undefined || !Number.isFinite(offset) || offset < 0) return 0;
  return Math.min(Math.trunc(offset), 1000);
}
