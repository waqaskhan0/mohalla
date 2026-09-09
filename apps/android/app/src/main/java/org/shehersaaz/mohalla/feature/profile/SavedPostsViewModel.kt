package org.shehersaaz.mohalla.feature.profile

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
import org.shehersaaz.mohalla.core.network.FeedItemResponse
import org.shehersaaz.mohalla.core.state.ViewerRelations
import org.shehersaaz.mohalla.feature.home.FeedCursor

/**
 * Saved posts — UX-PROFILE-006 (FEED-FR-007).
 *
 * PRIVATE, AND THE PRIVACY IS THE SERVER'S RATHER THAN THIS SCREEN'S. "There is
 * no route that reveals who saved a given post, and saving generates no
 * notification to its author" — so there is nothing here to keep secret, because
 * nothing about a save ever leaves the caller's own account.
 *
 * ORDERED BY WHEN IT WAS SAVED, not when it was posted. A three-year-old post
 * saved this morning belongs at the top: the list is a record of the reader's
 * own actions, and sorting it by the authors' actions would scatter this
 * morning's saves through three years of other people's posts.
 *
 * UNSAVING IS OFFERED HERE AND SAVING IS NOT. Everything in this list is saved,
 * so the control's state is known for certain — which is the opposite of the
 * situation everywhere else, where nothing tells the client whether a given post
 * is saved at all (GAP-M-012).
 *
 * A DELETED POST SIMPLY IS NOT HERE. The requirement says "a deleted post
 * disappears from saved lists", and the server does the removing, so this screen
 * needs no dead-entry handling and must not invent any.
 */
class SavedPostsViewModel(
    private val profiles: ProfileSource,
    private val relations: ViewerRelations,
) : ViewModel() {

    private val _state = MutableStateFlow(SavedPostsUiState())
    val state: StateFlow<SavedPostsUiState> = _state.asStateFlow()

    init {
        refresh()
    }

    fun refresh() {
        _state.update {
            it.copy(
                loadingFirst = it.posts.isEmpty(),
                refreshing = it.posts.isNotEmpty(),
                firstPageFailure = null,
            )
        }

        viewModelScope.launch {
            when (val result = profiles.saved(cursor = null)) {
                is ApiResult.Ok -> {
                    _state.update {
                        it.copy(
                            posts = result.value.posts,
                            nextCursor = result.value.nextCursor,
                            loaded = true,
                            loadingFirst = false,
                            refreshing = false,
                        )
                    }
                    // Every row here is saved, by definition of the list — the
                    // one place the client can learn this for certain.
                    result.value.posts.forEach { relations.recordSave(it.id, true) }
                }

                is ApiResult.Err -> _state.update {
                    it.copy(
                        loadingFirst = false,
                        refreshing = false,
                        firstPageFailure = result.failure,
                    )
                }
            }
        }
    }

    fun loadMore() {
        val current = _state.value
        val cursor = current.nextCursor ?: return
        if (current.loadingMore) return

        _state.update { it.copy(loadingMore = true) }

        viewModelScope.launch {
            when (val result = profiles.saved(cursor)) {
                is ApiResult.Ok -> {
                    _state.update { s ->
                        s.copy(
                            posts = s.posts + result.value.posts
                                .filterNot { incoming -> s.posts.any { it.id == incoming.id } },
                            nextCursor = result.value.nextCursor,
                            loadingMore = false,
                        )
                    }
                    result.value.posts.forEach { relations.recordSave(it.id, true) }
                }

                is ApiResult.Err -> _state.update { it.copy(loadingMore = false) }
            }
        }
    }

    /**
     * Remove one.
     *
     * OPTIMISTIC AND REVERTING, like every other list action in the product. The
     * row is the only feedback there is — an unsave that waited for a round trip
     * would leave the reader tapping it again.
     */
    fun unsave(postId: String) {
        val removed = _state.value.posts.firstOrNull { it.id == postId } ?: return
        val index = _state.value.posts.indexOf(removed)

        _state.update { s ->
            s.copy(posts = s.posts.filterNot { it.id == postId }, actionFailed = false)
        }
        relations.recordSave(postId, false)

        viewModelScope.launch {
            when (profiles.unsave(postId)) {
                is ApiResult.Ok -> Unit

                is ApiResult.Err -> {
                    // Back where it was, at the position it was at — appending
                    // it to the end would look like a different post arriving.
                    relations.recordSave(postId, true)
                    _state.update { s ->
                        val restored = s.posts.toMutableList()
                        restored.add(index.coerceAtMost(restored.size), removed)
                        s.copy(posts = restored, actionFailed = true)
                    }
                }
            }
        }
    }

    /**
     * Like, or unlike (ENGAGE-FR-001).
     *
     * OPTIMISTIC AND REVERTING, identical to the feed's — "network failure ->
     * the interface reverts to the true server state rather than showing an
     * optimistic value indefinitely". The endpoints return no body, so an
     * optimistic count is the only way to show the change happened at all.
     */
    fun toggleLike(postId: String) {
        val post = _state.value.posts.firstOrNull { it.id == postId } ?: return
        if (postId in _state.value.pendingLikes) return

        val wasLiked = post.viewerHasLiked
        _state.update { s ->
            s.copy(
                posts = s.posts.map {
                    if (it.id == postId) {
                        it.copy(
                            viewerHasLiked = !wasLiked,
                            likeCount = (it.likeCount + if (wasLiked) -1 else 1).coerceAtLeast(0),
                        )
                    } else {
                        it
                    }
                },
                pendingLikes = s.pendingLikes + postId,
            )
        }

        viewModelScope.launch {
            val result = if (wasLiked) profiles.unlike(postId) else profiles.like(postId)

            _state.update { s ->
                val cleared = s.copy(pendingLikes = s.pendingLikes - postId)
                when (result) {
                    is ApiResult.Ok -> cleared

                    // REVERT. A filled heart on a like the server refused tells
                    // the reader something untrue about their own action.
                    is ApiResult.Err -> cleared.copy(
                        posts = cleared.posts.map {
                            if (it.id == postId) {
                                it.copy(
                                    viewerHasLiked = wasLiked,
                                    likeCount = (it.likeCount + if (wasLiked) 1 else -1)
                                        .coerceAtLeast(0),
                                )
                            } else {
                                it
                            }
                        },
                    )
                }
            }
        }
    }

    fun onActionFailureAcknowledged() = _state.update { it.copy(actionFailed = false) }

    class Factory(
        private val profiles: ProfileSource,
        private val relations: ViewerRelations,
    ) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T =
            SavedPostsViewModel(profiles, relations) as T
    }
}

data class SavedPostsUiState(
    val posts: List<FeedItemResponse> = emptyList(),
    val nextCursor: FeedCursor? = null,

    val loaded: Boolean = false,
    val loadingFirst: Boolean = true,
    val loadingMore: Boolean = false,
    val refreshing: Boolean = false,

    val firstPageFailure: ApiFailure? = null,
    val actionFailed: Boolean = false,

    val pendingLikes: Set<String> = emptySet(),
) {
    val atEnd: Boolean get() = loaded && nextCursor == null

    val isEmpty: Boolean get() = loaded && posts.isEmpty() && firstPageFailure == null
}
