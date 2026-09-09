package org.shehersaaz.mohalla.feature.settings

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
import org.shehersaaz.mohalla.core.network.BlockEntryResponse

/**
 * Blocked accounts — UX-SET-005 (SET-FR-003 · SAFETY-FR-006/007).
 *
 * THE ROWS HAVE NO NAMES, AND THAT IS NOT AN OVERSIGHT. `GET /me/blocks` returns
 * an id and a date per row, and the only route that turns an id into a name —
 * `GET /users/{id}` — answers the neutral 404 for anybody blocked in either
 * direction, which is every single row in this list. There is no request the
 * client can make that would name these people. GAP-M-013.
 *
 * SO THE ROWS SAY WHEN, and are newest-first, which is the one distinguishing
 * fact available. Somebody who blocked one person last week can find them; a
 * list of five is genuinely hard to tell apart, and the register says so rather
 * than the screen pretending otherwise.
 *
 * THE ONE THING NOT DONE: unblocking to read a name and re-blocking. It would
 * work — the profile resolves the moment the block is lifted — and it would mean
 * the app silently unblocking people to render a list. A blocked person becoming
 * able to message somebody for the length of a network round trip is not a
 * trade this screen gets to make on the user's behalf.
 *
 * UNBLOCKING IS IDEMPOTENT AND DOES NOT RESTORE FOLLOWS. SAFETY-FR-006:
 * "re-creating a relationship the user severed would put someone back in their
 * feed unasked." Nothing here tries to.
 */
class BlockedUsersViewModel(
    private val settings: SettingsSource,
) : ViewModel() {

    private val _state = MutableStateFlow(BlockedUsersUiState())
    val state: StateFlow<BlockedUsersUiState> = _state.asStateFlow()

    init {
        refresh()
    }

    fun refresh() {
        _state.update {
            it.copy(
                loadingFirst = it.blocks.isEmpty(),
                refreshing = it.blocks.isNotEmpty(),
                firstPageFailure = null,
            )
        }

        viewModelScope.launch {
            when (val result = settings.blocks(before = null)) {
                is ApiResult.Ok -> _state.update {
                    it.copy(
                        blocks = result.value.blocks,
                        nextBefore = result.value.nextBefore,
                        loaded = true,
                        loadingFirst = false,
                        refreshing = false,
                    )
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
            when (val result = settings.blocks(before)) {
                is ApiResult.Ok -> _state.update { s ->
                    s.copy(
                        blocks = s.blocks + result.value.blocks
                            .filterNot { incoming ->
                                s.blocks.any { it.blockedUserId == incoming.blockedUserId }
                            },
                        nextBefore = result.value.nextBefore,
                        loadingMore = false,
                    )
                }

                is ApiResult.Err -> _state.update { it.copy(loadingMore = false) }
            }
        }
    }

    /**
     * SET-FR-003 — "GIVEN an account is unblocked from this list, WHEN the list
     * reloads, THEN it is no longer present."
     *
     * OPTIMISTIC AND REVERTING. The row leaving is the only feedback there is,
     * and this is a list whose rows are otherwise indistinguishable — one that
     * came back at the bottom would look like a different person.
     */
    fun unblock(userId: String) {
        val removed = _state.value.blocks.firstOrNull { it.blockedUserId == userId } ?: return
        val index = _state.value.blocks.indexOf(removed)
        if (userId in _state.value.acting) return

        _state.update { s ->
            s.copy(
                blocks = s.blocks.filterNot { it.blockedUserId == userId },
                acting = s.acting + userId,
                actionFailed = false,
            )
        }

        viewModelScope.launch {
            when (settings.unblock(userId)) {
                is ApiResult.Ok -> _state.update { it.copy(acting = it.acting - userId) }

                is ApiResult.Err -> _state.update { s ->
                    val restored = s.blocks.toMutableList()
                    restored.add(index.coerceAtMost(restored.size), removed)
                    s.copy(blocks = restored, acting = s.acting - userId, actionFailed = true)
                }
            }
        }
    }

    fun onActionFailureAcknowledged() = _state.update { it.copy(actionFailed = false) }

    class Factory(
        private val settings: SettingsSource,
    ) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T =
            BlockedUsersViewModel(settings) as T
    }
}

data class BlockedUsersUiState(
    val blocks: List<BlockEntryResponse> = emptyList(),
    val nextBefore: String? = null,

    val loaded: Boolean = false,
    val loadingFirst: Boolean = true,
    val loadingMore: Boolean = false,
    val refreshing: Boolean = false,

    val firstPageFailure: ApiFailure? = null,
    val acting: Set<String> = emptySet(),
    val actionFailed: Boolean = false,
) {
    val atEnd: Boolean get() = loaded && nextBefore == null

    /**
     * Nobody blocked — a good state to be in, and stated as one.
     *
     * Distinct from a list that could not be read: "You haven't blocked anyone"
     * after a timeout tells somebody their blocks are gone, which on a safety
     * screen is the most alarming thing this list could say untruthfully.
     */
    val isEmpty: Boolean get() = loaded && blocks.isEmpty() && firstPageFailure == null
}
