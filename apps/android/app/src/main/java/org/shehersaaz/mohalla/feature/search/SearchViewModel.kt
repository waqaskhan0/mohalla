package org.shehersaaz.mohalla.feature.search

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import org.shehersaaz.mohalla.core.network.ApiResult
import org.shehersaaz.mohalla.core.network.EventResponse
import org.shehersaaz.mohalla.core.network.FeedItemResponse
import org.shehersaaz.mohalla.core.network.PublicProfileResponse

/**
 * Search — UX-SEARCH-001/002/003 (SEARCH-FR-001…005 · PRIV-011).
 *
 * THE RULE THAT SHAPES THIS FILE MOST IS SEARCH-FR-003's ACCEPTANCE CRITERION:
 *
 *   "GIVEN the search service is unavailable WHEN a query is submitted THEN an
 *   explicit service-unavailable state is shown and NEVER an empty-results
 *   state."
 *
 * A zero-results page after an outage tells somebody the content does not
 * exist. On a platform whose search is the answer to "what did people say about
 * this last month" — the SRS calls it "the platform's single largest advantage
 * over WhatsApp" — that is a lie with consequences: it can convince a person
 * that nobody raised a problem they in fact raised. So every tab keeps its
 * failure separate from its emptiness, and [SearchTabState.isEmpty] is false
 * whenever a failure is present.
 *
 * THREE TABS ARE SEARCHED SEPARATELY AND ONLY ON DEMAND. Switching to Posts
 * fires the Posts query; the People query is not re-run. Three simultaneous
 * requests on a 3G connection would triple the cost of one search for two
 * results the reader has not asked to see (NFR-PERF-001).
 *
 * THE HISTORY IS RECORDED ON SUBMIT, NEVER ON A KEYSTROKE. PRIV-011 keeps it on
 * the device, and a history of every prefix would be both useless and a record
 * of queries somebody typed and thought better of.
 */
class SearchViewModel(
    private val source: SearchSource,
    private val recents: RecentSearches,
) : ViewModel() {

    private val _state = MutableStateFlow(
        // Read synchronously so the first frame already offers the history —
        // §19 puts recent searches on the entry screen, and a list that
        // appeared a moment later would flash into place under the reader's
        // thumb.
        SearchUiState(recents = recents.all()),
    )
    val state: StateFlow<SearchUiState> = _state.asStateFlow()

    private var debounceJob: Job? = null

    /**
     * The query changed.
     *
     * DEBOUNCED, and the delay is not arbitrary: 350ms is long enough that
     * typing "pani" sends one request rather than four, and short enough that
     * somebody who has stopped typing does not notice the wait. The username
     * availability check uses 400ms for the same reason; this is slightly
     * shorter because a search is a read the reader is actively waiting on.
     *
     * A QUERY BELOW THE MINIMUM CLEARS THE RESULTS RATHER THAN SEARCHING. The
     * server would refuse it with the minimum stated, and spending a round trip
     * to be told that is a round trip wasted — so the screen returns to the
     * recent-searches state, which is where a one-character query belongs.
     */
    fun onQueryChanged(query: String) {
        debounceJob?.cancel()

        _state.update {
            it.copy(
                query = query,
                // Every tab is stale the moment the query changes. Keeping the
                // old results while new ones arrive would show answers to a
                // question the reader has stopped asking.
                people = SearchTabState(),
                posts = SearchTabState(),
                events = SearchTabState(),
            )
        }

        if (!isSearchable(query)) return

        debounceJob = viewModelScope.launch {
            delay(DEBOUNCE_MS)
            runSearch(_state.value.tab, offset = null)
        }
    }

    /**
     * The reader pressed search, or picked a recent query.
     *
     * Bypasses the debounce — an explicit submit should not wait — and records
     * the query in the on-device history.
     */
    fun submit(query: String = _state.value.query) {
        debounceJob?.cancel()

        val trimmed = query.trim()
        if (!isSearchable(trimmed)) return

        recents.add(trimmed)

        _state.update {
            it.copy(
                query = trimmed,
                recents = recents.all(),
                people = SearchTabState(),
                posts = SearchTabState(),
                events = SearchTabState(),
            )
        }

        viewModelScope.launch { runSearch(_state.value.tab, offset = null) }
    }

    /**
     * Switch tab, and search it if it has not been searched yet.
     *
     * A tab that already holds results for this query is NOT re-run: switching
     * back and forth on a metered connection should cost nothing.
     */
    fun selectTab(tab: SearchTab) {
        if (_state.value.tab == tab) return
        _state.update { it.copy(tab = tab) }

        val current = _state.value
        if (isSearchable(current.query) && !current.stateFor(tab).searched) {
            viewModelScope.launch { runSearch(tab, offset = null) }
        }
    }

    /** Offset pagination — see the API's note on why this is not a cursor. */
    fun loadMore() {
        val current = _state.value
        val tab = current.tab
        val tabState = current.stateFor(tab)
        val offset = tabState.nextOffset ?: return
        if (tabState.loadingMore || tabState.loading) return

        _state.update { it.withTab(tab, tabState.copy(loadingMore = true)) }
        viewModelScope.launch { runSearch(tab, offset = offset) }
    }

    fun retry() {
        val current = _state.value
        if (!isSearchable(current.query)) return
        viewModelScope.launch { runSearch(current.tab, offset = null) }
    }

    private suspend fun runSearch(tab: SearchTab, offset: Int?) {
        val query = _state.value.query.trim()
        if (!isSearchable(query)) return

        if (offset == null) {
            _state.update {
                it.withTab(tab, it.stateFor(tab).copy(loading = true, failure = null))
            }
        }

        when (tab) {
            SearchTab.PEOPLE -> when (val result = source.people(query, offset)) {
                is ApiResult.Ok -> _state.update { s ->
                    s.withTab(
                        tab,
                        s.people.merged(
                            people = result.value.results,
                            nextOffset = result.value.nextOffset,
                            appending = offset != null,
                        ),
                    )
                }
                is ApiResult.Err -> _state.update { s ->
                    s.withTab(tab, s.stateFor(tab).failed(result.failure.toSearchFailure()))
                }
            }

            SearchTab.POSTS -> when (val result = source.posts(query, offset)) {
                is ApiResult.Ok -> _state.update { s ->
                    s.withTab(
                        tab,
                        s.posts.merged(
                            posts = result.value.results,
                            nextOffset = result.value.nextOffset,
                            appending = offset != null,
                        ),
                    )
                }
                is ApiResult.Err -> _state.update { s ->
                    s.withTab(tab, s.stateFor(tab).failed(result.failure.toSearchFailure()))
                }
            }

            SearchTab.EVENTS -> when (val result = source.events(query, offset)) {
                is ApiResult.Ok -> _state.update { s ->
                    s.withTab(
                        tab,
                        s.events.merged(
                            events = result.value.results,
                            nextOffset = result.value.nextOffset,
                            appending = offset != null,
                        ),
                    )
                }
                is ApiResult.Err -> _state.update { s ->
                    s.withTab(tab, s.stateFor(tab).failed(result.failure.toSearchFailure()))
                }
            }
        }
    }

    // ---------------------------------------------------- the device history
    fun removeRecent(query: String) {
        recents.remove(query)
        _state.update { it.copy(recents = recents.all()) }
    }

    /** SEARCH-FR-005's acceptance criterion: reopening then shows nothing. */
    fun clearRecents() {
        recents.clear()
        _state.update { it.copy(recents = recents.all()) }
    }

    class Factory(
        private val source: SearchSource,
        private val recents: RecentSearches,
    ) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T =
            SearchViewModel(source, recents) as T
    }

    private companion object {
        /**
         * 350ms.
         *
         * Typing "pani" sends one request rather than four, and somebody who
         * has stopped typing does not notice the wait. Shorter than the username
         * check's 400ms because a search is a read the reader is waiting on.
         */
        const val DEBOUNCE_MS = 350L
    }
}

/** §18.5 — "two or three segments only". Three, and no fourth. */
enum class SearchTab { PEOPLE, POSTS, EVENTS }

/**
 * One tab's results.
 *
 * `searched` IS DISTINCT FROM `results.isNotEmpty()`, and that distinction is
 * the whole point of this type: a tab that has never been asked, a tab that was
 * asked and found nothing, and a tab whose request failed are three different
 * things, and only the middle one may render "nothing found".
 */
data class SearchTabState(
    val people: List<PublicProfileResponse> = emptyList(),
    val posts: List<FeedItemResponse> = emptyList(),
    val events: List<EventResponse> = emptyList(),

    /** `true` once a request for the current query has come back. */
    val searched: Boolean = false,

    val loading: Boolean = false,
    val loadingMore: Boolean = false,

    /** `null` at the end of the results. */
    val nextOffset: Int? = null,

    /**
     * SEARCH-FR-003's rule made structural.
     *
     * While this is non-null, [isEmpty] is false — so a failed search can never
     * render as "nothing found".
     */
    val failure: SearchFailure? = null,
) {
    /**
     * Genuinely nothing matched.
     *
     * Requires `searched` and no failure. §21's copy for this state suggests
     * alternative spellings, which is the right advice when the search WORKED
     * and found nothing on a platform where the same word can be written in two
     * scripts — and exactly the wrong advice after an outage.
     */
    val isEmpty: Boolean
        get() = searched && failure == null &&
            people.isEmpty() && posts.isEmpty() && events.isEmpty()

    val hasResults: Boolean
        get() = people.isNotEmpty() || posts.isNotEmpty() || events.isNotEmpty()

    fun merged(
        people: List<PublicProfileResponse> = emptyList(),
        posts: List<FeedItemResponse> = emptyList(),
        events: List<EventResponse> = emptyList(),
        nextOffset: Int?,
        appending: Boolean,
    ): SearchTabState = copy(
        // De-duplicated by id when appending. Offset pagination over a relevance
        // ordering can legitimately repeat a row if content changed between
        // pages, and a duplicate key crashes a LazyColumn.
        people = if (appending) {
            this.people + people.filterNot { p -> this.people.any { it.userId == p.userId } }
        } else {
            people
        },
        posts = if (appending) {
            this.posts + posts.filterNot { p -> this.posts.any { it.id == p.id } }
        } else {
            posts
        },
        events = if (appending) {
            this.events + events.filterNot { e -> this.events.any { it.id == e.id } }
        } else {
            events
        },
        searched = true,
        loading = false,
        loadingMore = false,
        nextOffset = nextOffset,
        failure = null,
    )

    /**
     * A failure.
     *
     * `searched` STAYS AS IT WAS. A first request that fails leaves it false, so
     * nothing downstream can mistake the empty list for an answer — which is
     * precisely the state SEARCH-FR-003 forbids rendering as zero results.
     */
    fun failed(failure: SearchFailure): SearchTabState = copy(
        loading = false,
        loadingMore = false,
        failure = failure,
    )
}

data class SearchUiState(
    val query: String = "",
    val tab: SearchTab = SearchTab.PEOPLE,

    val people: SearchTabState = SearchTabState(),
    val posts: SearchTabState = SearchTabState(),
    val events: SearchTabState = SearchTabState(),

    /** On the device only (PRIV-011). Newest first, at most ten. */
    val recents: List<String> = emptyList(),
) {
    fun stateFor(tab: SearchTab) = when (tab) {
        SearchTab.PEOPLE -> people
        SearchTab.POSTS -> posts
        SearchTab.EVENTS -> events
    }

    fun withTab(tab: SearchTab, value: SearchTabState) = when (tab) {
        SearchTab.PEOPLE -> copy(people = value)
        SearchTab.POSTS -> copy(posts = value)
        SearchTab.EVENTS -> copy(events = value)
    }

    val current: SearchTabState get() = stateFor(tab)

    /**
     * Whether the screen is showing the entry state rather than results.
     *
     * UX-SEARCH-001 is "a query field plus recent searches"; the results screens
     * are UX-SEARCH-002/003. One screen renders both, and this is the switch: a
     * query too short to search has nothing to show but the history.
     */
    val showingRecents: Boolean get() = !isSearchable(query)
}
