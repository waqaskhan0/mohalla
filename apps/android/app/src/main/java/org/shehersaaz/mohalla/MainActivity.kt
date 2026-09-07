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
import org.shehersaaz.mohalla.feature.auth.WelcomeScreen
import org.shehersaaz.mohalla.feature.startup.StartupDestination
import org.shehersaaz.mohalla.feature.startup.StartupViewModel

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
                    // The splash. Nothing else is composed while the
                    // destination is unknown, so an unauthorised screen can
                    // never flash (§9).
                    StartupDestination.Resolving -> LoadingState()

                    is StartupDestination.ChooseLanguage -> LanguageSelectionScreen(
                        suggestion = current.suggestion,
                        onConfirm = { chosen ->
                            startup.onLanguageChosen(chosen)
                            recreate()
                        },
                    )

                    StartupDestination.Welcome -> WelcomeScreen(
                        // UX-AUTH-005 and UX-AUTH-004 arrive with the auth
                        // slice; the shell routes to them then.
                        onCreateAccount = {},
                        onLogIn = {},
                    )

                    // Every remaining destination is a screen from a later
                    // slice. The splash is held rather than showing a wrong
                    // screen, which is the §9 rule.
                    else -> LoadingState()
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
