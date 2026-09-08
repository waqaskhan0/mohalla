package org.shehersaaz.mohalla.feature.home

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import org.shehersaaz.mohalla.core.network.ApiFailure
import org.shehersaaz.mohalla.core.network.ApiResult
import org.shehersaaz.mohalla.core.network.FeaturedItemResponse
import org.shehersaaz.mohalla.core.network.FeedItemResponse
import org.shehersaaz.mohalla.core.network.CategoryResponse

/**
 * Home — UX-HOME-001 (Following) and UX-HOME-002 (Discover).
 *
 * ONE VIEWMODEL, TWO TABS. They differ only in which endpoint they call and in
 * what an empty result MEANS, so two ViewModels would duplicate pagination,
 * optimistic likes, refresh and category filtering in order to change one
 * function reference.
 *
 * THE DISTINCTION THAT MATTERS MOST HERE IS EMPTY versus FAILED, and it is not
 * cosmetic. §15 requires an "empty following state", and the two cases need
 * opposite copy and opposite affordances:
 *
 *   - Following is empty because the reader follows nobody. That is not an
 *     error — it is the expected state of a new account, and the answer is
 *     "find people", which is why [FeedUiState.isEmptyFollowing] is its own
 *     property.
 *   - The request failed. The answer is "try again".
 *
 * Rendering "no posts yet" after a timeout tells a new user their neighbourhood
 * is empty when the app simply could not reach it — and on a platform whose
 * cold-start risk is RSK-001, that is the worst available wrong message.
 *
 * FEATURED IS LOADED INDEPENDENTLY and its failure never blocks the feed
 * (FEED-FR-002). Nothing below waits on it.
 */
class FeedViewModel(
    private val repository: FeedSource,
    private val locale: () -> String,
) : ViewModel() {

    private val _state = MutableStateFlow(FeedUiState())
    val state: StateFlow<FeedUiState> = _state.asStateFlow()

    init {
        loadFeatured()
        refresh()
    }

    fun selectTab(tab: FeedTab) {
        if (_state.value.tab == tab) return
        _state.update {
            it.copy(
                tab = tab,
                // Each tab keeps its own list, so switching back does not
                // re-fetch what was already read on a metered connection.
                loadingFirstPage = it.pageFor(tab).items.isEmpty(),
            )
        }
        if (_state.value.pageFor(tab).items.isEmpty()) refresh()
    }

    /** FEED-FR-006 — filtering changes membership, never ordering. */
    /**
     * Load UX-HOME-005's options.
     *
     * ONCE, AND SILENTLY ON FAILURE. The list is fixed at eleven rows that do
     * not change between launches, so re-reading it on every sheet open would
     * be a request for an answer already held. And a filter whose options did
     * not arrive is a filter that cannot be offered — there is nothing useful to
     * say about it, so the control simply does not appear rather than opening a
     * sheet with an error in it.
     */
    fun loadCategories() {
        if (_state.value.categories.isNotEmpty()) return

        viewModelScope.launch {
            when (val result = repository.categories()) {
                is ApiResult.Ok -> _state.update { it.copy(categories = result.value) }
                is ApiResult.Err -> Unit
            }
        }
    }

    fun selectCategory(slug: String?) {
        if (_state.value.category == slug) return
        _state.update {
            it.copy(
                category = slug,
                following = FeedList(),
                discover = FeedList(),
                loadingFirstPage = true,
            )
        }
        refresh()
    }

    fun refresh() {
        val tab = _state.value.tab
        _state.update {
            it.copy(
                refreshing = it.pageFor(tab).items.isNotEmpty(),
                loadingFirstPage = it.pageFor(tab).items.isEmpty(),
                firstPageFailure = null,
            )
        }

        viewModelScope.launch {
            val result = fetch(tab, cursor = null)

            _state.update { current ->
                when (result) {
                    is ApiResult.Ok -> current.withPage(
                        tab,
                        FeedList(
                            items = result.value.items,
                            nextCursor = result.value.nextCursor,
                            loaded = true,
                        ),
                    ).copy(refreshing = false, loadingFirstPage = false)

                    is ApiResult.Err -> current.copy(
                        refreshing = false,
                        loadingFirstPage = false,
                        // Kept SEPARATE from an empty list. See the class
                        // comment: a failure must never render as "no posts".
                        firstPageFailure = result.failure,
                    )
                }
            }
        }
    }

    /** Called as the reader nears the end of the list. */
    fun loadMore() {
        val current = _state.value
        val page = current.pageFor(current.tab)

        // A null cursor is the END of the feed and is not retried. An empty
        // page WITH a cursor is not the end — every item on it was filtered out
        // by a block — so that case keeps paging.
        val cursor = page.nextCursor ?: return
        if (page.loadingMore || current.refreshing) return

        _state.update { it.withPage(it.tab, page.copy(loadingMore = true, pageFailure = null)) }

        viewModelScope.launch {
            val tab = current.tab
            when (val result = fetch(tab, cursor)) {
                is ApiResult.Ok -> _state.update { s ->
                    val existing = s.pageFor(tab)
                    s.withPage(
                        tab,
                        existing.copy(
                            // De-duplicated by id: a post edited between pages
                            // can legitimately appear twice, and a duplicate
                            // key crashes a LazyColumn.
                            items = existing.items + result.value.items.filterNot { incoming ->
                                existing.items.any { it.id == incoming.id }
                            },
                            nextCursor = result.value.nextCursor,
                            loadingMore = false,
                        ),
                    )
                }

                is ApiResult.Err -> _state.update { s ->
                    s.withPage(
                        tab,
                        s.pageFor(tab).copy(
                            loadingMore = false,
                            // §15's "error-at-page-end retry". What was already
                            // read stays on screen — a failed second page must
                            // not clear the first.
                            pageFailure = result.failure,
                        ),
                    )
                }
            }
        }
    }

    private suspend fun fetch(tab: FeedTab, cursor: FeedCursor?) = when (tab) {
        FeedTab.FOLLOWING -> repository.following(cursor, _state.value.category)
        FeedTab.DISCOVER -> repository.discover(cursor, _state.value.category)
    }

    private fun loadFeatured() {
        viewModelScope.launch {
            when (val result = repository.featured(locale())) {
                is ApiResult.Ok -> _state.update { it.copy(featured = result.value) }
                // Silent. Featured failing must not put an error on a screen
                // whose feed loaded fine (FEED-FR-002).
                is ApiResult.Err -> Unit
            }
        }
    }

    /**
     * ENGAGE-FR-001 — optimistic, and reverts to the true server state.
     *
     * `04-mobile-architecture.md` §6 assigns Like the `instant` motion token:
     * an optimistic action that animates looks like it is still deciding.
     */
    fun toggleLike(post: FeedItemResponse) {
        val tab = _state.value.tab
        if (_state.value.pendingLikes.contains(post.id)) return

        val wasLiked = post.viewerHasLiked

        _state.update { s ->
            s.withPage(
                tab,
                s.pageFor(tab).mapItem(post.id) {
                    it.copy(
                        viewerHasLiked = !wasLiked,
                        likeCount = (it.likeCount + if (wasLiked) -1 else 1).coerceAtLeast(0),
                    )
                },
            ).copy(pendingLikes = s.pendingLikes + post.id)
        }

        viewModelScope.launch {
            val result = if (wasLiked) repository.unlike(post.id) else repository.like(post.id)

            _state.update { s ->
                val cleared = s.copy(pendingLikes = s.pendingLikes - post.id)
                when (result) {
                    is ApiResult.Ok -> cleared

                    is ApiResult.Err -> cleared.withPage(
                        tab,
                        cleared.pageFor(tab).mapItem(post.id) {
                            // REVERT. A filled heart on a like the server
                            // refused tells the reader something untrue about
                            // their own action.
                            it.copy(
                                viewerHasLiked = wasLiked,
                                likeCount = (it.likeCount + if (wasLiked) 1 else -1)
                                    .coerceAtLeast(0),
                            )
                        },
                        // THE FAILURE, NOT A BOOLEAN. `likeReverted = true`
                        // was what this said, and nothing anywhere read it -
                        // so a suspended reader's like reverted its heart and
                        // explained nothing (RUNTIME-010).
                    ).copy(likeFailure = result.failure)
                }
            }
        }
    }

    fun onLikeRevertAcknowledged() = _state.update { it.copy(likeFailure = null) }

    /**
     * A post became unavailable while being read (§15).
     *
     * Removed from the list rather than left showing stale content — but the
     * reader is not told WHY, because the server does not say: deleted, hidden,
     * blocked and never-existed are one neutral refusal (UX-STATE-001).
     */
    fun onItemUnavailable(postId: String) {
        _state.update { s ->
            s.copy(
                following = s.following.copy(
                    items = s.following.items.filterNot { it.id == postId },
                ),
                discover = s.discover.copy(
                    items = s.discover.items.filterNot { it.id == postId },
                ),
            )
        }
    }

    class Factory(
        private val repository: FeedSource,
        private val locale: () -> String,
    ) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T =
            FeedViewModel(repository, locale) as T
    }
}

enum class FeedTab { FOLLOWING, DISCOVER }

data class FeedList(
    val items: List<FeedItemResponse> = emptyList(),
    val nextCursor: FeedCursor? = null,
    /** `true` once a first page has actually arrived. */
    val loaded: Boolean = false,
    val loadingMore: Boolean = false,
    /** A failed SUBSEQUENT page. What was already read stays on screen. */
    val pageFailure: ApiFailure? = null,
) {
    fun mapItem(id: String, transform: (FeedItemResponse) -> FeedItemResponse) =
        copy(items = items.map { if (it.id == id) transform(it) else it })

    val atEnd: Boolean get() = loaded && nextCursor == null
}

data class FeedUiState(
    val tab: FeedTab = FeedTab.FOLLOWING,
    val category: String? = null,

    /** UX-HOME-005's options, loaded once (BR-017 — eleven, not extensible). */
    val categories: List<CategoryResponse> = emptyList(),

    val following: FeedList = FeedList(),
    val discover: FeedList = FeedList(),

    /** FEED-FR-002 — loaded independently, never blocking the feed. */
    val featured: List<FeaturedItemResponse> = emptyList(),

    val loadingFirstPage: Boolean = true,
    val refreshing: Boolean = false,

    /** A failed FIRST page. Never rendered as "no posts". */
    val firstPageFailure: ApiFailure? = null,

    val pendingLikes: Set<String> = emptySet(),
    /**
     * Why the last like did not take, or `null`.
     *
     * THE FAILURE RATHER THAN A FLAG, because the reason is the whole point: a
     * suspended account, an offline device and a deleted post are three
     * different things to be told, and `true` is none of them.
     */
    val likeFailure: ApiFailure? = null,
) {
    fun pageFor(tab: FeedTab) = when (tab) {
        FeedTab.FOLLOWING -> following
        FeedTab.DISCOVER -> discover
    }

    fun withPage(tab: FeedTab, page: FeedList) = when (tab) {
        FeedTab.FOLLOWING -> copy(following = page)
        FeedTab.DISCOVER -> copy(discover = page)
    }

    val current: FeedList get() = pageFor(tab)

    /**
     * The reader follows nobody — an expected state, not a failure.
     *
     * Requires `loaded`, so a first page still in flight cannot be mistaken for
     * an empty one, and requires no failure, so a timeout is never rendered as
     * "your neighbourhood is quiet".
     */
    val isEmptyFollowing: Boolean
        get() = tab == FeedTab.FOLLOWING &&
            following.loaded &&
            following.items.isEmpty() &&
            firstPageFailure == null

    val isEmptyDiscover: Boolean
        get() = tab == FeedTab.DISCOVER &&
            discover.loaded &&
            discover.items.isEmpty() &&
            firstPageFailure == null
}
