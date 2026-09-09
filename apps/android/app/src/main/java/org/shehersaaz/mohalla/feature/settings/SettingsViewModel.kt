package org.shehersaaz.mohalla.feature.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import org.shehersaaz.mohalla.core.locale.AppLocale
import org.shehersaaz.mohalla.core.network.ApiFailure
import org.shehersaaz.mohalla.core.network.ApiResult

/**
 * The settings index and the language switch — UX-SET-001 · UX-SET-002
 * (SET-FR-001/006 · LOCALE-FR-002 · AUTH-FR-006).
 *
 * THE INDEX RENDERS WITHOUT ITS REQUEST. Every row on it is a destination that
 * exists whether or not `GET /me/settings` came back; what the request adds is
 * two pieces of DETAIL — which language the account has stored, and how many
 * accounts are blocked. So a failure greys out two subtitles and leaves eight
 * working rows, rather than replacing a navigation screen with an error page
 * that strands somebody who came here to sign out.
 *
 * SIGNING OUT IS THE ONE ROW THAT MUST WORK OFFLINE. AUTH-FR-006 and SET-FR-006:
 * "GIVEN logout completes, WHEN the app reopens, THEN the welcome screen is
 * shown and no cached personal content is visible." The server call revokes the
 * session and the LOCAL clear is what satisfies that criterion — so the local
 * clear happens whatever the server said. A sign-out that failed because a train
 * went into a tunnel, on a shared phone, is the worst possible time to leave
 * somebody signed in.
 *
 * THE LANGUAGE IS WRITTEN LOCALLY FIRST AND TO THE ACCOUNT SECOND, and a failed
 * request does not undo the local switch. LOCALE-FR-002 promises the interface
 * changes immediately, and it did; the account copy is what makes the choice
 * follow the user to another device (SET-FR-001), and it is retried simply by
 * choosing again.
 */
class SettingsViewModel(
    private val settings: SettingsSource,
    private val storedLocale: () -> AppLocale?,
    private val storeLocale: (AppLocale) -> Unit,
    private val signOutLocally: () -> Unit,
    private val signOutRemotely: suspend () -> ApiResult<Unit>,
) : ViewModel() {

    private val _state = MutableStateFlow(SettingsUiState(deviceLanguage = storedLocale()))
    val state: StateFlow<SettingsUiState> = _state.asStateFlow()

    init {
        load()
    }

    fun load() {
        _state.update { it.copy(loading = true, failure = null) }

        viewModelScope.launch {
            when (val result = settings.screen()) {
                is ApiResult.Ok -> _state.update {
                    it.copy(
                        accountLanguage = result.value.language,
                        blockedCount = result.value.blockedCount,
                        loaded = true,
                        loading = false,
                    )
                }

                // Not a screen failure. See the class comment.
                is ApiResult.Err -> _state.update {
                    it.copy(loading = false, failure = result.failure)
                }
            }
        }
    }

    /**
     * SET-FR-001 — choose a language.
     *
     * THE DEVICE IS WRITTEN SYNCHRONOUSLY, BEFORE ANYTHING ELSE, because the
     * caller recreates the activity the moment this returns and the new activity
     * reads the stored value to decide its layout direction. An asynchronous
     * write that lost that race would compose the whole app in the old
     * direction — the exact defect `LocaleStore.store` uses `commit()` to avoid.
     */
    fun chooseLanguage(locale: AppLocale) {
        if (locale == _state.value.effectiveLanguage) return

        storeLocale(locale)
        _state.update { it.copy(deviceLanguage = locale, accountLanguage = locale) }

        viewModelScope.launch {
            when (settings.setLanguage(locale)) {
                is ApiResult.Ok -> Unit

                // Silent, and NOT reverted. The interface has already changed,
                // which is what LOCALE-FR-002 promised; what failed is the
                // account copy that carries the choice to another device, and
                // choosing again is the retry.
                is ApiResult.Err -> _state.update { it.copy(languageSyncFailed = true) }
            }
        }
    }

    /**
     * SET-FR-006 · AUTH-FR-006 — sign out.
     *
     * THE LOCAL CLEAR IS UNCONDITIONAL. The server call revokes the session and
     * is worth making; the criterion is about what this device shows afterwards,
     * and that is satisfied locally. Ordering matters too: the remote call needs
     * the token, so it goes first and the clear follows regardless of the answer.
     */
    fun signOut(onSignedOut: () -> Unit) {
        if (_state.value.signingOut) return
        _state.update { it.copy(signingOut = true) }

        viewModelScope.launch {
            signOutRemotely()
            signOutLocally()
            _state.update { it.copy(signingOut = false) }
            onSignedOut()
        }
    }

    class Factory(
        private val settings: SettingsSource,
        private val storedLocale: () -> AppLocale?,
        private val storeLocale: (AppLocale) -> Unit,
        private val signOutLocally: () -> Unit,
        private val signOutRemotely: suspend () -> ApiResult<Unit>,
    ) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T = SettingsViewModel(
            settings,
            storedLocale,
            storeLocale,
            signOutLocally,
            signOutRemotely,
        ) as T
    }
}

data class SettingsUiState(
    /** What this install is rendering in. Never null after first launch. */
    val deviceLanguage: AppLocale? = null,

    /** What the ACCOUNT has stored. Null when the user has never chosen (BR-040). */
    val accountLanguage: AppLocale? = null,

    val blockedCount: Int = 0,

    val loaded: Boolean = false,
    val loading: Boolean = false,
    val signingOut: Boolean = false,

    /** Greys out two subtitles. It does not take the screen down. */
    val failure: ApiFailure? = null,

    val languageSyncFailed: Boolean = false,
) {
    /**
     * Which language to show as current.
     *
     * THE ACCOUNT'S, THEN THE DEVICE'S. An account that has never chosen has no
     * stored language, and showing "not set" on a screen the user is reading in
     * Urdu would be true and useless — the device's choice is what they are
     * looking at.
     */
    val effectiveLanguage: AppLocale? get() = accountLanguage ?: deviceLanguage

    /** The count is detail; a failed request must not render it as zero. */
    val blockedCountKnown: Boolean get() = loaded
}
