package org.shehersaaz.mohalla.feature.search

import org.shehersaaz.mohalla.core.network.ApiFailure
import org.shehersaaz.mohalla.core.network.ApiResult
import org.shehersaaz.mohalla.core.network.EventResponse
import org.shehersaaz.mohalla.core.network.FeedItemResponse
import org.shehersaaz.mohalla.core.network.MohallaApi
import org.shehersaaz.mohalla.core.network.PublicProfileResponse
import org.shehersaaz.mohalla.core.network.apiCall
import org.shehersaaz.mohalla.core.network.map

/**
 * Search (SEARCH-FR-001…004).
 *
 * THIS IS THE PLATFORM'S SINGLE LARGEST ADVANTAGE OVER WHATSAPP, which the SRS
 * says in those words about SEARCH-FR-002: on WhatsApp "nothing is findable
 * after the fact". A neighbourhood that discussed a broken drain three months
 * ago can find that discussion here.
 *
 * CROSS-SCRIPT MATCHING IS ENTIRELY THE SERVER'S (SEARCH-FR-003). The server
 * normalises case, diacritics and common Roman Urdu spelling variants, and
 * matches against an index holding both the original text and its transliterated
 * form. THE CLIENT MUST NOT TRANSLITERATE, and that is worth stating because it
 * is a tempting thing to add: a client-side romanisation would disagree with the
 * index it is querying, so "pani" would match different things depending on
 * which side did the folding. The client sends what was typed.
 */
interface SearchSource {
    suspend fun people(query: String, offset: Int? = null): ApiResult<PeoplePage>
    suspend fun posts(query: String, offset: Int? = null): ApiResult<PostsPage>
    suspend fun events(query: String, offset: Int? = null): ApiResult<EventsPage>
}

class SearchRepository(
    private val api: MohallaApi,
) : SearchSource {

    /**
     * SEARCH-FR-001 — people, by display name or username.
     *
     * SUSPENDED ACCOUNTS ARE INCLUDED in the server's results, "because a
     * suspension is temporary and hiding the account would break existing
     * conversations" — so the client shows them like any other. Blocked users in
     * either direction, and banned or deleted accounts, are already absent: the
     * acceptance criterion is that searching a blocker's exact username returns
     * nothing, and that is enforced server-side where it cannot be probed.
     */
    override suspend fun people(query: String, offset: Int?): ApiResult<PeoplePage> = apiCall {
        api.searchPeople(query = query, limit = PAGE_SIZE, offset = offset)
    }.map { PeoplePage(results = it.results, nextOffset = it.nextOffset) }

    override suspend fun posts(query: String, offset: Int?): ApiResult<PostsPage> = apiCall {
        api.searchPosts(query = query, limit = PAGE_SIZE, offset = offset)
    }.map { PostsPage(results = it.results, nextOffset = it.nextOffset) }

    override suspend fun events(query: String, offset: Int?): ApiResult<EventsPage> = apiCall {
        api.searchEvents(query = query, limit = PAGE_SIZE, offset = offset)
    }.map { EventsPage(results = it.results, nextOffset = it.nextOffset) }

    companion object {
        /** SEARCH-FR-001/002: "paginated at 20". */
        const val PAGE_SIZE = 20
    }
}

data class PeoplePage(
    val results: List<PublicProfileResponse>,
    /** `null` means the end. Not the same as an empty page. */
    val nextOffset: Int?,
)

data class PostsPage(
    val results: List<FeedItemResponse>,
    val nextOffset: Int?,
)

data class EventsPage(
    val results: List<EventResponse>,
    val nextOffset: Int?,
)

/**
 * The query rules, client side (SEARCH-FR-003 E2).
 *
 * MIRRORS THE SERVER'S `search-query.ts`. Two characters is the minimum, and the
 * point of checking here is not validation — the server checks too, and its
 * answer counts — but to avoid firing a request per keystroke on a connection
 * where each one costs money. A one-character query cannot usefully match
 * anything, so not sending it is free.
 */
const val SEARCH_QUERY_MIN_LENGTH = 2
const val SEARCH_QUERY_MAX_LENGTH = 200

/**
 * `true` when the query is worth sending.
 *
 * TRIMMED FIRST, because a leading space is not a character somebody meant to
 * search for — and a query of two spaces would otherwise pass a length check and
 * be refused by the server.
 */
fun isSearchable(query: String): Boolean =
    query.trim().length >= SEARCH_QUERY_MIN_LENGTH

/**
 * How a search failed, from the screen's point of view.
 *
 * THE DISTINCTION THIS TYPE EXISTS FOR IS THE ONE SEARCH-FR-003 SPELLS OUT:
 *
 *   "GIVEN the search service is unavailable WHEN a query is submitted THEN an
 *   explicit service-unavailable state is shown and NEVER an empty-results
 *   state."
 *
 * A zero-results page after an outage tells somebody the content does not
 * exist — and on a platform whose search is the answer to "what was said about
 * this last month", that is a lie with consequences. The API is unusually
 * candid here for the same reason: it returns 200 with an empty list for "we
 * looked and there is nothing", 503 for "we could not look", and 400 with the
 * minimum for "the query was too short to run". Three answers because they lead
 * to three different actions.
 */
sealed interface SearchFailure {

    /**
     * The service could not be reached or could not answer.
     *
     * Covers the server's 503 `SEARCH_UNAVAILABLE` and an ordinary 5xx: both
     * mean "we could not look", both are worth retrying, and neither may render
     * as "nothing found". [message] is the server's own localised copy when it
     * sent some.
     */
    data class Unavailable(val message: String?) : SearchFailure

    /** No usable connection. Also never an empty-results state. */
    data object Offline : SearchFailure

    /**
     * The query was refused (SEARCH-FR-003 E2).
     *
     * [message] is the server's, which STATES THE MINIMUM — the requirement asks
     * for exactly that rather than a bare refusal, so the copy is shown as sent
     * rather than replaced with a generic complaint.
     */
    data class QueryRefused(val message: String?) : SearchFailure

    /** Anything else — a rate limit, a restriction, an unrecognised failure. */
    data class Other(val failure: ApiFailure) : SearchFailure
}

/**
 * Read the failure.
 *
 * A 401 IS DELIBERATELY NOT HANDLED HERE. `apiCall`'s unauthenticated hook owns
 * that path so there is one place that signs out, and mapping it to a search
 * state would put a "try again" button on a screen whose session has gone.
 */
fun ApiFailure.toSearchFailure(): SearchFailure = when (this) {
    ApiFailure.Offline -> SearchFailure.Offline

    // The server's 503 arrives as `Server`, because `classify` maps every
    // non-enumerated status there. Both a 503 and a 500 mean "we could not
    // look", which is the only distinction the screen needs.
    is ApiFailure.Server -> SearchFailure.Unavailable(message)

    is ApiFailure.Validation -> SearchFailure.QueryRefused(message)

    else -> SearchFailure.Other(this)
}
