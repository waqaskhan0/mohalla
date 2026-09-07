package org.shehersaaz.mohalla

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.lifecycle.viewmodel.compose.viewModel
import org.shehersaaz.mohalla.core.design.MohallaTheme
import org.shehersaaz.mohalla.core.di.AppContainer
import org.shehersaaz.mohalla.core.locale.AppLocale
import org.shehersaaz.mohalla.core.ui.LoadingState
import org.shehersaaz.mohalla.feature.auth.LanguageSelectionScreen
import org.shehersaaz.mohalla.feature.startup.StartupDestination
import org.shehersaaz.mohalla.feature.startup.StartupViewModel
import org.shehersaaz.mohalla.navigation.MohallaNavHost
import org.shehersaaz.mohalla.navigation.startRoute

/**
 * The only activity.
 *
 * WHY THE LANGUAGE IS READ BEFORE `setContent`. `LayoutDirection` has to be
 * known before the first frame is laid out. Reading it inside composition means
 * frame one is composed in the default direction and frame two corrects it — a
 * visible flip on every cold start in Urdu, on exactly the low-end devices
 * where it is most visible. So the read is synchronous, from plain
 * `SharedPreferences`, and costs microseconds (see `LocaleStore`).
 *
 * WHY A LANGUAGE CHANGE CALLS `recreate()`. `04-mobile-architecture.md` §3
 * rule 2 chooses the platform's own mechanism: it re-resolves every layout
 * direction, string and configuration-dependent resource in one step, and
 * `rememberSaveable` state survives it. Doing it by hand leaves whatever the
 * app forgot in the old direction, and RSK-004 is precisely the risk of
 * "whatever we forgot".
 */
class MainActivity : ComponentActivity() {

    private lateinit var container: AppContainer

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)

        container = AppContainer.create(applicationContext)

        // BR-040 — `null` is a real answer, and the direction of the very first
        // frame depends on this value.
        val stored = container.localeStore.stored()

        setContent {
            MohallaTheme(isUrdu = stored?.isRtl == true) {
                val startup: StartupViewModel = viewModel(
                    factory = StartupViewModel.Factory(
                        sessions = container.sessionRepository,
                        localeStore = container.localeStore,
                        deviceSuggestion = container.localeStore.deviceSuggestion(this),
                    ),
                )
                val destination by startup.destination.collectAsState()

                when (val current = destination) {
                    // The splash. NOTHING else is composed while the
                    // destination is unknown, so an unauthorised screen can
                    // never flash (§9) — and the NavHost below is not created
                    // either, because a NavHost needs its start destination at
                    // construction and would otherwise have to be built with a
                    // guess and then corrected.
                    StartupDestination.Resolving -> LoadingState()

                    // Outside the graph on purpose. BR-040's language choice
                    // happens before there is a back stack to put it on, and it
                    // ends in `recreate()` — so a destination here would be
                    // destroyed by its own completion.
                    is StartupDestination.ChooseLanguage -> LanguageSelectionScreen(
                        suggestion = current.suggestion,
                        onConfirm = { chosen ->
                            startup.onLanguageChosen(chosen)
                            recreate()
                        },
                    )

                    else -> MohallaNavHost(
                        container = container,
                        startRoute = current.startRoute(),
                        onRequestLanguageChange = {},
                    )
                }
            }
        }
    }

    /** Settings uses the same path, so there is one way to change language. */
    fun applyLanguage(locale: AppLocale) {
        container.localeStore.store(locale)
        recreate()
    }
}
