import { Injectable } from '@nestjs/common';
import type { PoolClient, QueryResult, QueryResultRow } from 'pg';
import { DatabaseService } from '../../../../database/database.service.js';
import { notBlockedSql } from '../../safety/domain/visibility-policy.js';
import type { PostRecord } from '../../posts/repositories/post.repository.port.js';
import type { PostVisibilityState } from '../../posts/domain/post-visibility.js';
import type { EventRecord } from '../../events/repositories/event.repository.port.js';
import type {
  EventStatus,
  EventType,
  EventVisibilityState,
} from '../../events/domain/event-fields.js';
import { SEARCH_KEY_MIN_LENGTH } from '../domain/search-query.js';
import type { SearchPage, SearchRepository, SearchRequest } from './search.repository.port.js';

/**
 * How close a normalised key must be to count as a hit.
 *
 * `word_similarity` compares the query key against the best WORD-length extent
 * of the stored key, which is the right question here — "does this short query
 * appear as a word in this document" — where plain `similarity()` compares two
 * whole strings and scores a two-character query against a paragraph at nearly
 * zero. That difference is not academic: the first version of this search
 * returned nothing at all for "pani" because it used the wrong operator.
 *
 * 0.6 was chosen by measurement, not taste: at 0.5, 0.6 and 0.7 every genuine
 * cross-script pair scored 1.00 and nonsense scored nothing, so the threshold
 * sits in the middle of a wide safe band rather than on an edge.
 */
const WORD_SIMILARITY_THRESHOLD = 0.6;

interface PostRow {
  id: string;
  author_id: string;
  body: string;
  category_id: string | null;
  category_slug: string | null;
  visibility_state: PostVisibilityState;
  like_count: number;
  comment_count: number;
  edited_at: Date | null;
  created_at: Date;
  media_ids: string[] | null;
}

interface EventRow {
  id: string;
  creator_id: string;
  title: string;
  description: string;
  starts_at: Date;
  event_type: EventType;
  meeting_url: string | null;
  location_text: string | null;
  category_id: string | null;
  category_slug: string | null;
  status: EventStatus;
  visibility_state: EventVisibilityState;
  going_count: number;
  interested_count: number;
  edited_at: Date | null;
  cancelled_at: Date | null;
  created_at: Date;
}

const toEvent = (r: EventRow): EventRecord => ({
  id: r.id,
  creatorId: r.creator_id,
  title: r.title,
  description: r.description,
  startsAt: r.starts_at,
  eventType: r.event_type,
  meetingUrl: r.meeting_url,
  locationText: r.location_text,
  categoryId: r.category_id,
  categorySlug: r.category_slug,
  status: r.status,
  visibilityState: r.visibility_state,
  goingCount: r.going_count,
  interestedCount: r.interested_count,
  editedAt: r.edited_at,
  cancelledAt: r.cancelled_at,
  createdAt: r.created_at,
});

const toPost = (r: PostRow): PostRecord => ({
  id: r.id,
  authorId: r.author_id,
  body: r.body,
  categoryId: r.category_id,
  categorySlug: r.category_slug,
  visibilityState: r.visibility_state,
  likeCount: r.like_count,
  commentCount: r.comment_count,
  editedAt: r.edited_at,
  createdAt: r.created_at,
  mediaIds: r.media_ids ?? [],
});

@Injectable()
export class PgSearchRepository implements SearchRepository {
  constructor(private readonly db: DatabaseService) {}

  private q<R extends QueryResultRow>(
    client: PoolClient | undefined,
    sql: string,
    params: unknown[],
  ): Promise<QueryResult<R>> {
    return client === undefined ? this.db.query<R>(sql, params) : client.query<R>(sql, params);
  }

  /**
   * Set the trigram threshold for THIS transaction only.
   *
   * `SET LOCAL` rather than `SET`: a pooled connection is reused, and a session
   * setting would leak this threshold into whatever query ran next on the same
   * connection.
   */
  private async withThreshold<T>(
    client: PoolClient | undefined,
    run: (c: PoolClient) => Promise<T>,
  ): Promise<T> {
    if (client !== undefined) {
      await client.query(
        `SET LOCAL pg_trgm.word_similarity_threshold = ${WORD_SIMILARITY_THRESHOLD}`,
      );
      return run(client);
    }
    return this.db.withTransaction(async (c) => {
      await c.query(`SET LOCAL pg_trgm.word_similarity_threshold = ${WORD_SIMILARITY_THRESHOLD}`);
      return run(c);
    });
  }

  async people(request: SearchRequest, client?: PoolClient): Promise<SearchPage<string>> {
    return this.withThreshold(client, async (c) => {
      // Two matching paths, OR-ed, because they answer different questions.
      // The KEY path is what makes cross-script search work at all. The RAW
      // path is what finds an exact username or an English word, which the
      // key deliberately mangles - "committee" and کمیٹی do not share a key,
      // but an English query still finds an English word directly.
      //
      // The key path is skipped only when the key normalised away to nothing
      // (a query of pure vowels or punctuation); see SEARCH_KEY_MIN_LENGTH for
      // why a one-character key is kept rather than excluded.
      const r = await c.query<{ user_id: string; score: number }>(
        `SELECT p.user_id,
                GREATEST(
                  word_similarity(search_key($2), p.search_key),
                  similarity(lower($2), lower(p.display_name || ' ' || p.username::text))
                ) AS score
           FROM profiles p
           JOIN users u ON u.id = p.user_id
          WHERE u.state IN ('ACTIVE', 'SUSPENDED')
            AND ${notBlockedSql('$1', 'p.user_id')}
            AND (
              (length(search_key($2)) >= ${SEARCH_KEY_MIN_LENGTH}
                AND search_key($2) <% p.search_key)
              OR p.username::text ILIKE '%' || $2 || '%'
              OR p.display_name ILIKE '%' || $2 || '%'
            )
          ORDER BY score DESC, p.follower_count DESC, p.user_id
          LIMIT $3 OFFSET $4`,
        [request.viewerId, request.query, request.limit + 1, request.offset],
      );

      const hasMore = r.rows.length > request.limit;
      const rows = hasMore ? r.rows.slice(0, request.limit) : r.rows;
      return {
        results: rows.map((row) => row.user_id),
        nextOffset: hasMore ? request.offset + request.limit : null,
      };
    });
  }

  async events(request: SearchRequest, client?: PoolClient): Promise<SearchPage<EventRecord>> {
    return this.withThreshold(client, async (c) => {
      const r = await c.query<EventRow & { score: number }>(
        `SELECT e.id, e.creator_id, e.title, e.description, e.starts_at, e.event_type,
                e.meeting_url, e.location_text, e.category_id, cat.slug AS category_slug,
                e.status, e.visibility_state, e.going_count, e.interested_count,
                e.edited_at, e.cancelled_at, e.created_at,
                GREATEST(
                  word_similarity(search_key($2), e.search_key),
                  similarity(lower($2), lower(e.title || ' ' || e.description))
                ) AS score,
                (e.starts_at > now()) AS is_upcoming
           FROM events e
           JOIN users u ON u.id = e.creator_id
           LEFT JOIN categories cat ON cat.id = e.category_id
          WHERE e.visibility_state = 'VISIBLE'
            AND u.state IN ('ACTIVE', 'SUSPENDED')
            AND ${notBlockedSql('$1', 'e.creator_id')}
            AND (
              (length(search_key($2)) >= ${SEARCH_KEY_MIN_LENGTH}
                AND search_key($2) <% e.search_key)
              OR e.title ILIKE '%' || $2 || '%'
              OR e.description ILIKE '%' || $2 || '%'
            )
          -- SEARCH-FR-004's own criterion: "upcoming events rank above past
          -- ones". FIRST, ahead of relevance - a perfectly-matching event that
          -- happened last year is less useful than a near-matching one next
          -- week, because only one of them can still be attended.
          --
          -- Then soonest-first among the upcoming, and most-recent-first among
          -- the past: both orderings mean "nearest to now", which is what a
          -- reader is looking for from either side.
          ORDER BY (e.starts_at > now()) DESC,
                   score DESC,
                   CASE WHEN e.starts_at > now() THEN e.starts_at END ASC,
                   CASE WHEN e.starts_at <= now() THEN e.starts_at END DESC,
                   e.id
          LIMIT $3 OFFSET $4`,
        [request.viewerId, request.query, request.limit + 1, request.offset],
      );

      const hasMore = r.rows.length > request.limit;
      const rows = hasMore ? r.rows.slice(0, request.limit) : r.rows;
      return {
        results: rows.map(toEvent),
        nextOffset: hasMore ? request.offset + request.limit : null,
      };
    });
  }

  async posts(request: SearchRequest, client?: PoolClient): Promise<SearchPage<PostRecord>> {
    return this.withThreshold(client, async (c) => {
      const r = await c.query<PostRow & { score: number }>(
        `SELECT p.id, p.author_id, p.body, p.category_id, cat.slug AS category_slug,
                p.visibility_state, p.like_count, p.comment_count, p.edited_at, p.created_at,
                (
                  SELECT array_agg(pm.media_id ORDER BY pm.position)
                    FROM post_media pm WHERE pm.post_id = p.id
                ) AS media_ids,
                GREATEST(
                  word_similarity(search_key($2), p.search_key),
                  similarity(lower($2), lower(p.body))
                ) AS score
           FROM posts p
           JOIN users u ON u.id = p.author_id
           LEFT JOIN categories cat ON cat.id = p.category_id
          WHERE p.visibility_state = 'VISIBLE'
            AND u.state IN ('ACTIVE', 'SUSPENDED')
            AND ${notBlockedSql('$1', 'p.author_id')}
            AND (
              (length(search_key($2)) >= ${SEARCH_KEY_MIN_LENGTH}
                AND search_key($2) <% p.search_key)
              OR p.body ILIKE '%' || $2 || '%'
            )
          -- SEARCH-FR-002: "ranked by relevance then recency". Both, in that
          -- order - relevance alone surfaces a five-year-old post above
          -- today's, and recency alone makes search a feed.
          ORDER BY score DESC, p.created_at DESC, p.id DESC
          LIMIT $3 OFFSET $4`,
        [request.viewerId, request.query, request.limit + 1, request.offset],
      );

      const hasMore = r.rows.length > request.limit;
      const rows = hasMore ? r.rows.slice(0, request.limit) : r.rows;
      return {
        results: rows.map(toPost),
        nextOffset: hasMore ? request.offset + request.limit : null,
      };
    });
  }
}
