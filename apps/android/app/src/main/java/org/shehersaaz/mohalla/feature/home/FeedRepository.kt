package org.shehersaaz.mohalla.feature.home

import org.shehersaaz.mohalla.core.network.ApiResult
import org.shehersaaz.mohalla.core.network.FeaturedItemResponse
import org.shehersaaz.mohalla.core.network.FeedCursorResponse
import org.shehersaaz.mohalla.core.network.FeedItemResponse
import org.shehersaaz.mohalla.core.network.FeedResponse
import org.shehersaaz.mohalla.core.network.MohallaApi
import org.shehersaaz.mohalla.core.network.apiCall
import org.shehersaaz.mohalla.core.network.map
import retrofit2.Response
import org.shehersaaz.mohalla.core.network.CategoryResponse

/**
 * The feeds (FEED-FR-001…006).
 *
 * KEYSET PAGINATION, NOT OFFSET, and the reason is visible to users rather than
 * theoretical. The feed is reverse chronological and new posts arrive at the
 * top; with `?page=2` every new post between requests shifts the window, so
 * page two repeats items the reader has already seen or skips ones they have
 * not. A cursor of `(createdAt, id)` names a position in the ordering rather
 * than a distance from the start, so it stays correct however much arrives
 * above it.
 *
 * FEATURED IS A SEPARATE CALL BY REQUIREMENT (FEED-FR-002), not by convenience.
 * That independence is what makes RSK-001 survivable: a brand-new account
 * follows nobody, so the Following feed is legitimately empty — and if Featured
 * were folded into the same response, an empty feed would render an empty
 * screen. Fetched separately, it renders regardless (REL-005).
 */
class FeedRepository(
    private val api: MohallaApi,
) : FeedSource {

    override suspend fun following(
        cursor: FeedCursor?,
        category: String?,
    ): ApiResult<FeedPage> = page(cursor, category) { limit ->
        api.feedFollowing(
            limit = limit,
            cursorCreatedAt = cursor?.createdAt,
            cursorId = cursor?.id,
            category = category,
        )
    }

    override suspend fun discover(
        cursor: FeedCursor?,
        category: String?,
    ): ApiResult<FeedPage> = page(cursor, category) { limit ->
        api.feedDiscover(
            limit = limit,
            cursorCreatedAt = cursor?.createdAt,
            cursorId = cursor?.id,
            category = category,
        )
    }

    /** FEED-FR-002. Locale-parameterised so announcements arrive translated. */
    override suspend fun categories(): ApiResult<List<CategoryResponse>> =
        apiCall { api.categories() }.map { it.categories }

    override suspend fun featured(locale: String): ApiResult<List<FeaturedItemResponse>> =
        apiCall { api.feedFeatured(locale) }.map { it.announcements }

    override suspend fun like(postId: String): ApiResult<Unit> =
        apiCall { api.like(postId) }.map { }

    override suspend fun unlike(postId: String): ApiResult<Unit> =
        apiCall { api.unlike(postId) }.map { }

    /**
     * The shared shape of both feed calls.
     *
     * The two endpoints differ only in their path, and the cursor-unwrapping
     * step is exactly the part that would be easy to get subtly different
     * between them — a `nextCursor` mapped in one and dropped in the other
     * truncates one feed and not the other, which is the kind of defect that
     * looks like a server problem.
     */
    private suspend inline fun page(
        cursor: FeedCursor?,
        category: String?,
        crossinline request: suspend (limit: Int) -> Response<FeedResponse>,
    ): ApiResult<FeedPage> = apiCall { request(PAGE_SIZE) }.map { response ->
        FeedPage(
            items = response.items,
            nextCursor = response.nextCursor?.toCursor(),
        )
    }

    companion object {
        /**
         * 20 per page.
         *
         * NFR-PERF-001 gives the first feed page 3 seconds on 3G. A larger page
         * is fewer round trips but a slower first paint, and on a 720×1280
         * screen twenty cards is already several screens of scrolling — so the
         * reader reaches the end of what they can see long before the next
         * request is needed.
         */
        const val PAGE_SIZE = 20
    }
}

/**
 * What the feed ViewModel needs from the network, and nothing more.
 *
 * AN INTERFACE SO THE VIEWMODEL'S SEQUENCING CAN BE TESTED. The bugs this
 * product can actually ship in a feed are sequence bugs — a second page
 * requested with the wrong cursor, an empty page mistaken for the end, a
 * duplicate id crashing the list, an optimistic like that does not revert — and
 * none of them are visible in a single call. Testing a SEQUENCE needs a source
 * whose answers can be scripted, and scripting a final class means a mocking
 * framework and bytecode manipulation to test four functions.
 *
 * `limit` is deliberately absent: page size is the repository's decision (see
 * [FeedRepository.PAGE_SIZE]) and not a per-call parameter, so no caller can
 * quietly ask for 500 posts on a 3G connection.
 */
interface FeedSource {
    suspend fun following(cursor: FeedCursor? = null, category: String? = null): ApiResult<FeedPage>
    suspend fun discover(cursor: FeedCursor? = null, category: String? = null): ApiResult<FeedPage>
    suspend fun featured(locale: String): ApiResult<List<FeaturedItemResponse>>

    /**
     * The eleven seeded categories (BR-017), for UX-HOME-005's filter.
     *
     * Read from the server rather than hardcoded, and from the SAME route the
     * composer's picker uses, so the two can never disagree about what exists
     * or what it is called in Urdu.
     */
    suspend fun categories(): ApiResult<List<CategoryResponse>>
    suspend fun like(postId: String): ApiResult<Unit>
    suspend fun unlike(postId: String): ApiResult<Unit>
}

/** A position in the ordering, not a distance from the start. */
data class FeedCursor(val createdAt: String, val id: String)

private fun FeedCursorResponse.toCursor() = FeedCursor(createdAt, id)

data class FeedPage(
    val items: List<FeedItemResponse>,
    /**
     * `null` means the end of the feed.
     *
     * Deliberately distinct from an empty `items` list: a page can come back
     * empty with a cursor still set (every item on it was filtered out by a
     * block), and treating that as the end would truncate the feed. The
     * ViewModel keeps requesting while a cursor exists.
     */
    val nextCursor: FeedCursor?,
)
