import { Inject, Injectable } from '@nestjs/common';
import { DatabaseService } from '../../../../database/database.service.js';
import { StructuredLogger } from '../../../../common/logging/structured.logger.js';
import { EngagementService } from '../../engagement/application/engagement.service.js';
import { PostService } from '../../posts/application/post.service.js';
import { ProfileService } from '../../profile/application/profile.service.js';
import type { PublicProfile } from '../../profile/domain/public-profile.js';
import type { PostRecord } from '../../posts/repositories/post.repository.port.js';
import {
  FEED_REPOSITORY,
  type AnnouncementRecord,
  type FeedCursor,
  type FeedRepository,
} from '../repositories/feed.repository.port.js';

/** FEED-FR-002: "up to 5 announcements". */
const FEATURED_LIMIT = 5;

/** FEED-FR-004: "feeds load 20 items per page". */
const DEFAULT_PAGE_SIZE = 20;

export interface FeedItem {
  id: string;
  author: PublicProfile;
  body: string;
  categorySlug: string | null;
  mediaIds: string[];
  likeCount: number;
  commentCount: number;
  /** So the client can render the like control in the right state. */
  viewerHasLiked: boolean;
  editedAt: string | null;
  createdAt: string;
}

export interface FeedResult {
  items: FeedItem[];
  nextCursor: { createdAt: string; id: string } | null;
}

export interface FeaturedItem {
  id: string;
  title: string;
  body: string;
  expiresAt: string;
}

export interface FeedRequest {
  viewerId: string;
  limit?: number;
  cursor?: FeedCursor;
  categorySlug?: string;
  since?: Date;
}

/**
 * Feeds (FEED-FR-001…007 · BR-026/027/028).
 *
 * A READ-ONLY COMPOSITION MODULE — it owns no table (§234). Everything it
 * returns is assembled from posts, the social graph, profiles and engagement,
 * which is why the exclusions live in one shared query fragment rather than
 * being restated here.
 *
 * BR-026: STRICTLY REVERSE-CHRONOLOGICAL, NEVER ALGORITHMIC. There is no
 * scoring, no ranking parameter, and no "sort" argument anywhere in this
 * module. That is not an omission to be filled in later — a neighbourhood
 * noticeboard where an algorithm decides which neighbour you hear from is a
 * different product, and the requirement says so.
 *
 * FEATURED IS DELIBERATELY INDEPENDENT (§240, RSK-001). It takes no viewer and
 * touches no follow data, so a brand-new account following nobody — or a slow
 * Following query — cannot leave the app blank. FEED-FR-002 is the cold-start
 * guarantee, and a guarantee that depends on the thing it is guaranteeing
 * against is not one.
 */
@Injectable()
export class FeedService {
  constructor(
    private readonly db: DatabaseService,
    @Inject(FEED_REPOSITORY) private readonly repo: FeedRepository,
    private readonly profiles: ProfileService,
    private readonly posts: PostService,
    private readonly engagement: EngagementService,
    private readonly logger: StructuredLogger,
  ) {}

  /** FEED-API-001 / 004 — the following feed, and pull-to-refresh. */
  async following(request: FeedRequest): Promise<FeedResult> {
    const page = await this.repo.following(this.toQuery(request));
    return this.hydrate(request.viewerId, page.posts, page.nextCursor);
  }

  /** FEED-API-002 — discover. */
  async discover(request: FeedRequest): Promise<FeedResult> {
    const page = await this.repo.discover(this.toQuery(request));
    return this.hydrate(request.viewerId, page.posts, page.nextCursor);
  }

  /**
   * FEED-API-003 — featured announcements.
   *
   * Takes no viewer on purpose. Kept as its own endpoint "by requirement, not
   * by convenience" (§145): it must render before follow data resolves.
   */
  async featured(): Promise<FeaturedItem[]> {
    const rows = await this.repo.featured(FEATURED_LIMIT);
    return rows.map((a: AnnouncementRecord) => ({
      id: a.id,
      title: a.title,
      body: a.body,
      expiresAt: a.expiresAt.toISOString(),
    }));
  }

  /** FEED-API-006 — the viewer's saved posts (FEED-FR-007, Could). */
  async saved(request: FeedRequest): Promise<FeedResult> {
    const page = await this.repo.saved(this.toQuery(request));
    return this.hydrate(request.viewerId, page.posts, page.nextCursor);
  }

  /**
   * FEED-API-005 — save a post.
   *
   * "Saving is private and generates no notification to the author." Nothing
   * here emits an event, and there is no endpoint that reveals who saved what.
   */
  async save(
    userId: string,
    postId: string,
  ): Promise<{ status: 'SAVED' } | { status: 'NOT_AVAILABLE' }> {
    // The POST's visibility, not the viewer's profile. Checking the wrong one
    // would let somebody save a post they cannot see - and a nonexistent post
    // id would reach the foreign key and surface as a 500 rather than the
    // neutral answer every other read path gives.
    const post = await this.posts.view(userId, postId);
    if (post.status === 'NOT_AVAILABLE') return { status: 'NOT_AVAILABLE' };

    const saved = await this.db.withTransaction((client) =>
      this.repo.savePost(userId, postId, client),
    );
    this.log('post_saved', { created: saved });
    return { status: 'SAVED' };
  }

  async unsave(userId: string, postId: string): Promise<{ status: 'NOT_SAVED' }> {
    await this.db.withTransaction((client) => this.repo.unsavePost(userId, postId, client));
    this.log('post_unsaved', {});
    return { status: 'NOT_SAVED' };
  }

  // ---- internals --------------------------------------------------------

  private toQuery(request: FeedRequest) {
    return {
      viewerId: request.viewerId,
      limit: clampLimit(request.limit ?? DEFAULT_PAGE_SIZE),
      cursor: request.cursor,
      categorySlug: request.categorySlug,
      since: request.since,
    };
  }

  /**
   * Turn post rows into what a client renders.
   *
   * Two batched lookups rather than per-post queries: author projections once
   * per distinct author, and engagement counts for the whole page in one go.
   * A 20-post feed doing this per row would be forty round trips, which on the
   * connections this platform targets is the difference between a feed that
   * loads and one that does not.
   */
  private async hydrate(
    viewerId: string,
    posts: readonly PostRecord[],
    nextCursor: FeedCursor | null,
  ): Promise<FeedResult> {
    if (posts.length === 0) {
      return { items: [], nextCursor: null };
    }

    const authors = new Map<string, PublicProfile>();
    for (const id of new Set(posts.map((p) => p.authorId))) {
      if (id === viewerId) {
        const own = await this.profiles.getOwn(id);
        if (own !== null) authors.set(id, own);
        continue;
      }
      const view = await this.profiles.viewByUserId(viewerId, id);
      if (view.status === 'FOUND') authors.set(id, view.profile);
    }

    // ENGAGE-FR-006: what this viewer is shown excludes contributions from
    // anyone blocked in either direction.
    const counts = await this.engagement.adjustedCounts(
      viewerId,
      posts.map((p) => ({ id: p.id, likeCount: p.likeCount, commentCount: p.commentCount })),
    );

    const items: FeedItem[] = [];
    for (const post of posts) {
      const author = authors.get(post.authorId);
      // An author who became invisible between the query and here - newly
      // blocked, just banned - drops out rather than rendering as a gap.
      if (author === undefined) continue;

      const c = counts.get(post.id) ?? {
        likeCount: post.likeCount,
        commentCount: post.commentCount,
        viewerHasLiked: false,
      };

      items.push({
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

    return {
      items,
      nextCursor:
        nextCursor === null
          ? null
          : { createdAt: nextCursor.createdAt.toISOString(), id: nextCursor.id },
    };
  }

  private log(event: string, extra: Record<string, unknown>): void {
    // No post ids and no user ids: a log pairing the two is a record of what
    // somebody reads, which is the most sensitive thing a feed knows.
    this.logger.log(JSON.stringify({ event, ...extra }), 'feed');
  }
}

function clampLimit(limit: number): number {
  if (!Number.isFinite(limit) || limit < 1) return DEFAULT_PAGE_SIZE;
  return Math.min(Math.trunc(limit), 100);
}
