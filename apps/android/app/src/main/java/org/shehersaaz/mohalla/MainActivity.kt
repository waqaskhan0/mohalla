package org.shehersaaz.mohalla

import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import android.os.Build
import android.os.Bundle
import android.os.LocaleList
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.lifecycle.viewmodel.compose.viewModel
import java.util.Locale
import org.shehersaaz.mohalla.core.config.BuildEnvironment
import org.shehersaaz.mohalla.core.design.MohallaTheme
import org.shehersaaz.mohalla.core.di.AppContainer
import org.shehersaaz.mohalla.core.locale.AppLocale
import org.shehersaaz.mohalla.core.locale.LocaleStore
import org.shehersaaz.mohalla.core.ui.LoadingState
import org.shehersaaz.mohalla.core.ui.LocalMediaBaseUrl
import org.shehersaaz.mohalla.feature.auth.LanguageSelectionScreen
import org.shehersaaz.mohalla.feature.startup.StartupDestination
import org.shehersaaz.mohalla.feature.startup.StartupViewModel
import org.shehersaaz.mohalla.navigation.DeepLinks
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

    /**
     * Resolve resources in the chosen language.
     *
     * THE DEFECT THIS FIXES made "switch language" not switch the language.
     * `applyLanguage` stored the choice and called `recreate()`, and the theme
     * derived `LayoutDirection` from the stored value — so the app **mirrored**
     * and went on reading every string out of `values/`. On the emulator,
     * choosing اردو flipped the whole layout, moved the back arrow to the
     * right, mirrored the chevron, ticked اردو, and left the screen in English.
     *
     * Nothing told Android to USE the Urdu resources. The manifest declares
     * `localeConfig`, the build declares `localeFilters += setOf("en", "ur")`,
     * so `values-ur/` ships in the APK — it was simply never selected. Which
     * means all ~400 translated strings (OD-016) had never once been rendered.
     *
     * DONE HERE, in `attachBaseContext`, because this runs before `onCreate`
     * and therefore before the first `Resources` lookup. Setting the locale in
     * `onCreate` would leave frame one in the wrong language.
     *
     * `LocaleStore` is plain `SharedPreferences` (deliberately — see its own
     * comment about the first read on a cold start), so it is safe to read at
     * this point in the lifecycle, where the DI container does not exist yet.
     */
    override fun attachBaseContext(newBase: Context) {
        val stored = LocaleStore(newBase).stored()
        if (stored == null) {
            // No choice made yet: the language screen is about to ask.
            super.attachBaseContext(newBase)
            return
        }

        val locale = Locale.forLanguageTag(stored.tag)
        val config = Configuration(newBase.resources.configuration)
        config.setLocale(locale)
        // Set explicitly rather than inferred: `setLocale` alone leaves the
        // layout direction on some API levels, and the direction is the half
        // of this that was already working.
        config.setLayoutDirection(locale)

        super.attachBaseContext(newBase.createConfigurationContext(config))
    }

    private lateinit var container: AppContainer

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)

        container = AppContainer.create(applicationContext)

        // §42 - read before `setContent`, so the graph's first composition
        // already knows whether a link is waiting. Read on EVERY launch path:
        // a cold start from a browser chooser and a warm one both arrive here.
        holdDeepLink(intent)

        // BR-040 — `null` is a real answer, and the direction of the very first
        // frame depends on this value.
        val stored = container.localeStore.stored()

        setContent {
            // The API base, provided once and read by every media composable.
            //
            // A COMPOSITION LOCAL because the base URL has to reach an avatar
            // buried in a comment row without every composable between here and
            // there threading it through — the one that forgot would render a
            // broken image.
            //
            // THE IMAGE LOADER IS NOT PROVIDED HERE. Coil's `LocalImageLoader`
            // is deprecated precisely because providing it does not replace the
            // singleton, so a code path that missed the local would build a
            // SECOND loader — with its own caches on the same directory and no
            // auth interceptor. `MohallaApplication` implements
            // `ImageLoaderFactory` instead, which is the supported mechanism
            // and gives every entry point the same instance.
            CompositionLocalProvider(
                LocalMediaBaseUrl provides container.apiBaseUrl,
            ) {
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
    }

    /**
     * The app was already running when the link was tapped.
     *
     * `launchMode` is the default, so Android delivers a second VIEW intent
     * here rather than recreating the activity. Without this override the link
     * would be silently dropped — which is the common case, because somebody
     * following a shared post usually has the app open behind their messaging
     * app.
     */
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        holdDeepLink(intent)
    }

    /**
     * Hold what the link names, if anything.
     *
     * NOTHING IS NAVIGATED FROM HERE. §9 forbids an unauthorised screen
     * flashing, and the startup resolver — not a URL — decides where anybody
     * lands. The graph consumes this once the reader is somewhere they are
     * entitled to be.
     */
    private fun holdDeepLink(intent: Intent?) {
        if (intent?.action != Intent.ACTION_VIEW) return

        val route = DeepLinks.resolve(
            url = intent.dataString,
            host = BuildEnvironment.appHost,
        ) ?: return

        container.pendingDeepLink.hold(route)
    }

    /**
     * Settings uses the same path, so there is one way to change language.
     *
     * TWO MECHANISMS, CHOSEN BY API LEVEL, and the reason is the manifest.
     *
     * This app declares `android:localeConfig`, which opts it into the
     * platform's **per-app language** feature. From API 33 the system then owns
     * locale selection for the app: it applies its own locale list while the
     * activity is being attached, AFTER `attachBaseContext` has run — so the
     * `createConfigurationContext` override there is silently discarded and the
     * app renders in the system language. That is exactly what happened on the
     * emulator: `ur` was stored, the layout mirrored, and every string stayed
     * English because the platform put `en-US` back.
     *
     * So on 33+ the choice is handed to the system, which is the supported API
     * for a `localeConfig` app and additionally survives reinstall-free
     * upgrades and appears in Android's own per-app language settings. Below 33
     * the platform feature does not exist and `attachBaseContext` is the
     * mechanism, so both are kept and neither is guessed at.
     */
    fun applyLanguage(locale: AppLocale) {
        container.localeStore.store(locale)

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            // The system recreates the activity itself for this change.
            getSystemService(android.app.LocaleManager::class.java)
                ?.applicationLocales = LocaleList.forLanguageTags(locale.tag)
            return
        }

        recreate()
    }
}
