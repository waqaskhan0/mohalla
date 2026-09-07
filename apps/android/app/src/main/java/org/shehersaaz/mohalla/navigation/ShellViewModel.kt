package org.shehersaaz.mohalla.navigation

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import org.shehersaaz.mohalla.core.network.ConnectivityObserver
import org.shehersaaz.mohalla.feature.startup.MeResult
import org.shehersaaz.mohalla.feature.startup.SessionRepository

/**
 * The shell's own state: tab selection, capability, connectivity, badges.
 *
 * SEPARATE FROM EVERY TAB'S VIEWMODEL ON PURPOSE. The suspension rule has to
 * hold on all five tabs, and a rule that lives in five ViewModels is a rule that
 * eventually holds in four.
 *
 * THE CAPABILITY IS RE-READ, NOT CACHED FOR THE SESSION. A suspension can be
 * applied by a moderator while the app is open, and an app that only learned the
 * capability at startup would keep offering write controls for as long as the
 * process lived — then refuse them one by one. [refreshCapability] is called
 * when the shell resumes.
 */
class ShellViewModel(
    private val sessions: SessionRepository,
    private val connectivity: ConnectivityObserver,
    /** Injected so the date can be formatted in the reader's locale and calendar. */
    private val formatUntil: (String) -> String?,
) : ViewModel() {

    private val _state = MutableStateFlow(
        // Seeded with the synchronous read so the first frame is right. A
        // banner that appears a moment after launch, on a connection that was
        // never up, reads as a glitch rather than an explanation.
        ShellUiState(isOnline = connectivity.isOnlineNow()),
    )
    val state: StateFlow<ShellUiState> = _state.asStateFlow()

    init {
        viewModelScope.launch {
            connectivity.isOnline().collect { online ->
                _state.update { it.copy(isOnline = online) }
            }
        }
        refreshCapability()
    }

    fun selectTab(tab: MohallaTab) {
        // CREATE never becomes the selected tab. It is an action, not a
        // location (§14: "the one item that reads as a button rather than a
        // location"), and leaving it selected after the composer closes would
        // show the user as standing on a screen that is not there.
        if (tab == MohallaTab.CREATE) return
        _state.update { it.copy(selectedTab = tab) }
    }

    /**
     * Re-reads the account's capability.
     *
     * A FAILURE CHANGES NOTHING. If `/me` cannot be reached, the previous
     * capability stands rather than defaulting either way: defaulting to
     * READ_ONLY would lock a working account out of posting every time the
     * network hiccuped, and defaulting to FULL would clear a suspension banner
     * that is still in force. Keeping the last known answer is the only option
     * that does not invent a state change from a missing reply.
     */
    fun refreshCapability() {
        viewModelScope.launch {
            when (val me = sessions.me()) {
                is MeResult.Profile -> {
                    val profile = me.profile
                    _state.update {
                        it.copy(
                            capability = AccountCapability.fromServer(
                                if (profile.state == "SUSPENDED") "READ_ONLY" else "FULL",
                            ),
                            suspendedUntilLabel = profile.suspendedUntil?.let(formatUntil),
                        )
                    }
                }

                // Onboarding is unfinished, which the shell never renders for —
                // startup routes those to the setup screens. Nothing to change.
                MeResult.NeedsProfile -> Unit

                // Unreachable: keep what is known. See the doc comment.
                MeResult.Unreachable -> Unit

                // The session is gone (EDGE-010). The shell does not sign the
                // user out itself — `apiCall`'s unauthenticated handler owns
                // that path, so there is one place that does it and it cannot
                // race with this call.
                MeResult.NoSession -> Unit
            }
        }
    }

    class Factory(
        private val sessions: SessionRepository,
        private val connectivity: ConnectivityObserver,
        private val formatUntil: (String) -> String?,
    ) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T =
            ShellViewModel(sessions, connectivity, formatUntil) as T
    }
}
