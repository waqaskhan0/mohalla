package org.shehersaaz.mohalla.feature.notifications

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

/**
 * Push preferences — UX-SET-003 (NOTIF-FR-007 · SET-FR-007).
 *
 * SEVEN SWITCHES, AND EVERY ONE OF THEM GOVERNS THE BUZZ AND NOTHING ELSE.
 * NOTIF-FR-007's acceptance criterion is exact: "GIVEN like notifications are
 * disabled, WHEN a like occurs, THEN no push is sent but the entry appears in
 * the in-app centre." A reader cannot see that difference from the switch, so
 * the screen states it — the alternative is somebody turning everything off to
 * stop the buzzing and then wondering why the centre is still full, or worse,
 * believing it is empty and missing something.
 *
 * THE TOGGLE IS OPTIMISTIC AND REVERTS. A switch that waits for a round trip
 * before moving feels broken on a slow connection, and one that moves and stays
 * moved after a failure is a lie about the account's state — this is a setting
 * the reader will not check again. So it moves at once and moves BACK if the
 * server refused, with the refusal stated.
 */
class NotificationPreferencesViewModel(
    private val notifications: NotificationSource,
) : ViewModel() {

    private val _state = MutableStateFlow(NotificationPreferencesUiState())
    val state: StateFlow<NotificationPreferencesUiState> = _state.asStateFlow()

    init {
        load()
    }

    fun load() {
        _state.update { it.copy(loading = true, failure = null) }

        viewModelScope.launch {
            when (val result = notifications.preferences()) {
                is ApiResult.Ok -> _state.update {
                    it.copy(preferences = result.value, loaded = true, loading = false)
                }

                // NOT rendered as seven switches in their default position. A
                // settings screen that shows everything ON after a failed read
                // is stating something about the account it did not learn, and
                // the reader would take it as fact.
                is ApiResult.Err -> _state.update {
                    it.copy(loading = false, failure = result.failure)
                }
            }
        }
    }

    fun toggle(category: PushCategory) {
        val current = _state.value
        if (category in current.saving) return

        val next = !(current.preferences[category] ?: true)

        _state.update {
            it.copy(
                preferences = it.preferences + (category to next),
                saving = it.saving + category,
                saveFailed = false,
            )
        }

        viewModelScope.launch {
            when (notifications.setPreference(category, next)) {
                is ApiResult.Ok -> _state.update { it.copy(saving = it.saving - category) }

                is ApiResult.Err -> _state.update {
                    it.copy(
                        // Back where it was. See the class comment.
                        preferences = it.preferences + (category to !next),
                        saving = it.saving - category,
                        saveFailed = true,
                    )
                }
            }
        }
    }

    fun onSaveFailureAcknowledged() = _state.update { it.copy(saveFailed = false) }

    class Factory(
        private val notifications: NotificationSource,
    ) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T =
            NotificationPreferencesViewModel(notifications) as T
    }
}

data class NotificationPreferencesUiState(
    /** Empty until loaded — never seven defaults standing in for an answer. */
    val preferences: Map<PushCategory, Boolean> = emptyMap(),

    val loaded: Boolean = false,
    val loading: Boolean = true,

    /** Which switches have a request in flight. Each is disabled while it does. */
    val saving: Set<PushCategory> = emptySet(),

    val failure: ApiFailure? = null,
    val saveFailed: Boolean = false,
) {
    fun isEnabled(category: PushCategory): Boolean = preferences[category] ?: true
}
