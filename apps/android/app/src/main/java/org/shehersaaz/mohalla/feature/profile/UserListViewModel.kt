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
import org.shehersaaz.mohalla.core.network.PublicProfileResponse
import org.shehersaaz.mohalla.core.state.ViewerRelations

/**
 * Followers and Following — UX-PROFILE-004 · UX-PROFILE-005
 * (SOCIAL-FR-003/004).
 *
 * ONE VIEWMODEL FOR TWO LISTS, because they differ only in which endpoint they
 * call: same page size, same `before` cursor, same rows, same rules. A second
 * class would be the first one with a different word in one method.
 *
 * THE LIST IS FILTERED RELATIVE TO THE VIEWER, NOT TO ITS OWNER. The server
 * excludes anyone blocked in either direction relative to whoever is asking:
 * "GIVEN B has blocked A, WHEN A views B's follower list, THEN A is not
 * listed." So two people looking at the same profile can legitimately see
 * different lists and different lengths, and the count on the profile can
 * legitimately disagree with the number of rows here. Neither is a bug to
 * reconcile on the client — reconciling it would mean re-deriving a block, which
 * is exactly what BR-025 does not permit.
 *
 * OPENING THE VIEWER'S OWN *FOLLOWING* LIST TEACHES THE APP SOMETHING. It is the
 * one place the API answers "does this viewer follow that person" — for twenty
 * people at a time, incidentally — so the ids are recorded in [ViewerRelations].
 * Nothing else in the product answers it (GAP-M-011), and a Follow control that
 * is right more often is worth the two lines this costs.
 */
class UserListViewModel(
    private val profiles: ProfileSource,
    private val relations: ViewerRelations,
    private val userId: String,
    private val kind: UserListKind,
    private val viewerId: () -> String?,
) : ViewModel() {

    private val _state = MutableStateFlow(UserListUiState(kind = kind))
    val state: StateFlow<UserListUiState> = _state.asStateFlow()

    init {
        refresh()
    }

    fun refresh() {
        _state.update {
            it.copy(
                loadingFirst = it.users.isEmpty(),
                refreshing = it.users.isNotEmpty(),
                firstPageFailure = null,
            )
        }

        viewModelScope.launch {
            when (val result = fetch(before = null)) {
                is ApiResult.Ok -> {
                    _state.update {
                        it.copy(
                            users = result.value.users,
                            nextBefore = result.value.nextBefore,
                            loaded = true,
                            loadingFirst = false,
                            refreshing = false,
                        )
                    }
                    learn(result.value.users)
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
        val before = current.nextBefore ?: return
        if (current.loadingMore) return

        _state.update { it.copy(loadingMore = true) }

        viewModelScope.launch {
            when (val result = fetch(before)) {
                is ApiResult.Ok -> {
                    _state.update { s ->
                        s.copy(
                            // De-duplicated by user id: the list is ordered by
                            // when each relationship was created, and one
                            // created between two page reads shifts the window.
                            users = s.users + result.value.users
                                .filterNot { incoming -> s.users.any { it.userId == incoming.userId } },
                            nextBefore = result.value.nextBefore,
                            loadingMore = false,
                        )
                    }
                    learn(result.value.users)
                }

                is ApiResult.Err -> _state.update {
                    it.copy(loadingMore = false, pageFailure = result.failure)
                }
            }
        }
    }

    private suspend fun fetch(before: String?) = when (kind) {
        UserListKind.FOLLOWERS -> profiles.followers(userId, before)
        UserListKind.FOLLOWING -> profiles.following(userId, before)
    }

    /**
     * Record what this page proved.
     *
     * ONLY THE VIEWER'S OWN FOLLOWING LIST PROVES ANYTHING. Somebody else's
     * following list says who THEY follow, and a follower list says who follows
     * the profile — neither answers the question the Follow control asks.
     * Recording either would put a confident wrong answer into the store, which
     * is worse than the honest `Unknown` it replaced.
     */
    private fun learn(users: List<PublicProfileResponse>) {
        if (kind != UserListKind.FOLLOWING) return
        if (userId != viewerId()) return
        relations.recordFollowing(users.map { it.userId })
    }

    class Factory(
        private val profiles: ProfileSource,
        private val relations: ViewerRelations,
        private val userId: String,
        private val kind: UserListKind,
        private val viewerId: () -> String?,
    ) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T =
            UserListViewModel(profiles, relations, userId, kind, viewerId) as T
    }
}

enum class UserListKind {
    FOLLOWERS,
    FOLLOWING,
}

data class UserListUiState(
    val kind: UserListKind = UserListKind.FOLLOWERS,

    val users: List<PublicProfileResponse> = emptyList(),
    /** A TIMESTAMP. `null` means the end. */
    val nextBefore: String? = null,

    val loaded: Boolean = false,
    val loadingFirst: Boolean = true,
    val loadingMore: Boolean = false,
    val refreshing: Boolean = false,

    val firstPageFailure: ApiFailure? = null,
    val pageFailure: ApiFailure? = null,
) {
    val atEnd: Boolean get() = loaded && nextBefore == null

    /**
     * Genuinely nobody, as opposed to a list that could not be read.
     *
     * "No followers yet" after a timeout is a statement about somebody's
     * standing in their neighbourhood that the request never established.
     */
    val isEmpty: Boolean get() = loaded && users.isEmpty() && firstPageFailure == null
}
