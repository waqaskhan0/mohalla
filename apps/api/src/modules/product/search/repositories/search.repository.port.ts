import type { PoolClient } from 'pg';
import type { PostRecord } from '../../posts/repositories/post.repository.port.js';
import type { EventRecord } from '../../events/repositories/event.repository.port.js';

export const SEARCH_REPOSITORY = Symbol.for('mohalla.search.repository');

export interface SearchPage<T> {
  results: T[];
  /** Offset-based, because relevance ordering is not stable for a keyset. */
  nextOffset: number | null;
}

export interface SearchRequest {
  viewerId: string;
  query: string;
  limit: number;
  offset: number;
}

export interface SearchRepository {
  /**
   * SEARCH-FR-001 — find people by display name or username.
   *
   * Excludes anyone blocked in either direction, and banned or deleted
   * accounts. SUSPENDED accounts are INCLUDED, and the requirement says why:
   * "a suspension is temporary and hiding the account would break existing
   * conversations".
   */
  people(request: SearchRequest, client?: PoolClient): Promise<SearchPage<string>>;

  /**
   * SEARCH-FR-002 — find posts by text.
   *
   * "Ranked by relevance then recency." Excludes auto-hidden, deleted and
   * blocked-author posts — the acceptance criterion is that an auto-hidden post
   * is not found by searching its exact text.
   */
  posts(request: SearchRequest, client?: PoolClient): Promise<SearchPage<PostRecord>>;

  /**
   * SEARCH-FR-004 — find events by title and description.
   *
   * "Upcoming events rank above past ones", which is a THIRD ordering rule on
   * top of relevance and recency, and the acceptance criterion is exactly that:
   * "GIVEN a past and an upcoming event both matching the query, WHEN results
   * render, THEN the upcoming event appears first."
   *
   * Past events are RANKED DOWN rather than excluded. The upcoming list drops
   * them (EVENT-FR-005) because it is a schedule; search is a memory, and
   * "when was that clean-up drive?" is a reasonable question about something
   * that already happened.
   */
  events(request: SearchRequest, client?: PoolClient): Promise<SearchPage<EventRecord>>;
}
