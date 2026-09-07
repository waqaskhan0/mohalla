package org.shehersaaz.mohalla.feature.setup

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
import org.shehersaaz.mohalla.core.network.SuggestedUser

/**
 * UX-SETUP-003 — suggested accounts (SOCIAL-FR-004 · RSK-001).
 *
 * FOLLOW IS OPTIMISTIC AND REVERTS (ENGAGE-FR-001 ·
 * `04-mobile-architecture.md` §6: *"Follow — instant state change; on failure,
 * revert"*).
 *
 * The revert is the part worth care. A follow that fails and leaves the button
 * saying "Following" tells the user they follow somebody they do not — and on
 * this screen that matters more than usual, because it is the last step before
 * a feed whose contents depend on exactly these relationships. So the button
 * flips back and says so.
 *
 * `pending` EXISTS SEPARATELY FROM `following` so a double tap cannot queue two
 * requests for one account. Without it, tapping twice quickly sends a follow
 * and an unfollow whose order of arrival decides the outcome.
 */
class SuggestionsViewModel(
    private val setup: SetupRepository,
) : ViewModel() {

    private val _state = MutableStateFlow(SuggestionsUiState(loading = true))
    val state: StateFlow<SuggestionsUiState> = _state.asStateFlow()

    init {
        load()
    }

    fun load() {
        _state.update { it.copy(loading = true, failure = null) }

        viewModelScope.launch {
            when (val result = setup.suggestions()) {
                is ApiResult.Ok -> _state.update {
                    it.copy(loading = false, users = result.value)
                }

                is ApiResult.Err -> _state.update {
                    // An empty list and a failed request are DIFFERENT states.
                    // An empty list on a young platform is normal and Continue
                    // still works; a failure offers a retry.
                    it.copy(loading = false, failure = result.failure)
                }
            }
        }
    }

    fun toggleFollow(user: SuggestedUser) {
        val current = _state.value
        // One request per account at a time. See the class comment.
        if (current.pending.contains(user.userId)) return

        val wasFollowing = current.following.contains(user.userId)

        // Optimistic: flip now.
        _state.update {
            it.copy(
                following = if (wasFollowing) {
                    it.following - user.userId
                } else {
                    it.following + user.userId
                },
                pending = it.pending + user.userId,
                revertedUserId = null,
            )
        }

        viewModelScope.launch {
            val result = if (wasFollowing) {
                setup.unfollow(user.userId)
            } else {
                setup.follow(user.userId)
            }

            when (result) {
                is ApiResult.Ok -> _state.update { it.copy(pending = it.pending - user.userId) }

                is ApiResult.Err -> _state.update {
                    // REVERT to the true server state, and name which row
                    // reverted so the screen can say so rather than silently
                    // flipping a button back.
                    it.copy(
                        following = if (wasFollowing) {
                            it.following + user.userId
                        } else {
                            it.following - user.userId
                        },
                        pending = it.pending - user.userId,
                        revertedUserId = user.userId,
                        failure = result.failure,
                    )
                }
            }
        }
    }

    fun onRevertAcknowledged() = _state.update { it.copy(revertedUserId = null, failure = null) }

    class Factory(private val setup: SetupRepository) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T =
            SuggestionsViewModel(setup) as T
    }
}

data class SuggestionsUiState(
    val loading: Boolean = false,
    val users: List<SuggestedUser> = emptyList(),

    /** Optimistically followed here. Not a server truth until `pending` clears. */
    val following: Set<String> = emptySet(),

    /** In flight. Blocks a second request for the same account. */
    val pending: Set<String> = emptySet(),

    /** Set when a follow was reverted, so the UI can explain rather than flicker. */
    val revertedUserId: String? = null,

    val failure: ApiFailure? = null,
)
