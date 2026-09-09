package org.shehersaaz.mohalla.feature.startup

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import org.shehersaaz.mohalla.core.locale.AppLocale
import org.shehersaaz.mohalla.core.locale.LocaleStore

/**
 * Resolves where the app opens (§9 · §37).
 *
 * WHY A VIEWMODEL AND NOT STATE IN THE ACTIVITY. Two reasons, and the second
 * is the one that bit: a language change calls `recreate()`
 * (`04-mobile-architecture.md` §3 rule 2), so activity-held state is destroyed
 * on every switch — and Android lint caught an earlier version of this holding
 * the destination in an unremembered `mutableStateOf`, which reset it on every
 * recomposition. A `ViewModel` survives configuration change, which a language
 * switch is.
 *
 * IT DOES ONE NETWORK CALL AND ONLY WHEN THERE IS A TOKEN. NFR-PERF-003 gives
 * 4 seconds to cold start, and §9 says not to block startup on unrelated
 * requests. With no token there is no call at all; with one there is exactly
 * `GET /me`, whose failure resolves to Welcome rather than hanging the splash.
 */
class StartupViewModel(
    private val sessions: SessionRepository,
    private val localeStore: LocaleStore,
    private val deviceSuggestion: AppLocale,
) : ViewModel() {

    private val _destination = MutableStateFlow<StartupDestination>(StartupDestination.Resolving)
    val destination: StateFlow<StartupDestination> = _destination.asStateFlow()

    init {
        resolve()
    }

    fun resolve() {
        val stored = localeStore.stored()

        // BR-040 — answered without touching the network, so the language
        // screen appears immediately on a first launch.
        if (stored == null) {
            _destination.value = StartupDestination.ChooseLanguage(deviceSuggestion)
            return
        }

        // No token: no request, no wait.
        if (!sessions.hasToken()) {
            _destination.value = StartupDestination.Welcome
            return
        }

        _destination.value = StartupDestination.Resolving
        viewModelScope.launch {
            val me = sessions.me()
            _destination.value = resolveDestination(
                StartupFacts(
                    storedLocale = stored,
                    deviceSuggestion = deviceSuggestion,
                    hasSessionToken = true,
                    session = me.toSessionFacts(),
                ),
            )
        }
    }

    /** Called after the language is chosen, so the same instance re-routes. */
    fun onLanguageChosen(locale: AppLocale) {
        localeStore.store(locale)
        // The activity recreates; this instance is replaced. Resolving here
        // anyway means the next instance starts from a settled preference
        // rather than racing the write.
        resolve()
    }

    class Factory(
        private val sessions: SessionRepository,
        private val localeStore: LocaleStore,
        private val deviceSuggestion: AppLocale,
    ) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T =
            StartupViewModel(sessions, localeStore, deviceSuggestion) as T
    }
}
