package org.shehersaaz.mohalla.core.di

import android.content.Context
import kotlinx.serialization.json.Json
import okhttp3.OkHttpClient
import org.shehersaaz.mohalla.BuildConfig
import org.shehersaaz.mohalla.core.config.BuildEnvironment
import org.shehersaaz.mohalla.core.locale.AppLocale
import org.shehersaaz.mohalla.core.locale.LocaleManager
import org.shehersaaz.mohalla.core.locale.LocaleStore
import org.shehersaaz.mohalla.core.logging.AndroidLogger
import org.shehersaaz.mohalla.core.logging.Logger
import org.shehersaaz.mohalla.core.network.AuthInterceptor
import org.shehersaaz.mohalla.core.network.CorrelationInterceptor
import org.shehersaaz.mohalla.core.network.LanguageInterceptor
import com.jakewharton.retrofit2.converter.kotlinx.serialization.asConverterFactory
import okhttp3.MediaType.Companion.toMediaType
import org.shehersaaz.mohalla.core.network.ApiResult
import org.shehersaaz.mohalla.core.network.ConnectivityObserver
import org.shehersaaz.mohalla.core.network.PublicProfileResponse
import org.shehersaaz.mohalla.core.network.MohallaApi
import org.shehersaaz.mohalla.core.network.PostCache
import org.shehersaaz.mohalla.core.network.MohallaJson
import org.shehersaaz.mohalla.core.media.ImagePicker
import org.shehersaaz.mohalla.core.media.ImageUploader
import org.shehersaaz.mohalla.feature.auth.AuthRepository
import org.shehersaaz.mohalla.feature.create.DraftStore
import org.shehersaaz.mohalla.feature.create.PostRepository
import org.shehersaaz.mohalla.feature.create.SecureDraftStore
import org.shehersaaz.mohalla.feature.events.EventRepository
import org.shehersaaz.mohalla.feature.post.PostDetailRepository
import org.shehersaaz.mohalla.feature.search.RecentSearches
import org.shehersaaz.mohalla.feature.search.SearchRepository
import org.shehersaaz.mohalla.feature.home.FeedRepository
import org.shehersaaz.mohalla.feature.messages.MessagingRepository
import org.shehersaaz.mohalla.core.state.SessionRevocation
import org.shehersaaz.mohalla.navigation.PendingDeepLink
import org.shehersaaz.mohalla.core.state.ViewerRelations
import org.shehersaaz.mohalla.feature.notifications.NotificationRepository
import org.shehersaaz.mohalla.feature.profile.ProfileRepository
import org.shehersaaz.mohalla.feature.safety.SafetyRepository
import org.shehersaaz.mohalla.feature.settings.SettingsRepository
import org.shehersaaz.mohalla.feature.setup.SetupRepository
import org.shehersaaz.mohalla.feature.startup.SessionRepository
import retrofit2.Retrofit
import org.shehersaaz.mohalla.core.storage.AndroidSecureStorage
import org.shehersaaz.mohalla.core.storage.SecureStorage
import java.util.concurrent.TimeUnit
import org.shehersaaz.mohalla.core.util.formatLongDate

/**
 * Manual dependency container.
 *
 * STILL NOT HILT, DELIBERATELY. The Stage 5 reasoning holds and Stage 7 does
 * not overturn it: annotation processing adds a build step and a class of
 * generated-code failure for a graph that is a few dozen objects wide and has
 * no scoping requirements beyond "one of each, for the process". Constructor
 * injection wired here is testable by construction — a test builds a container
 * with fakes and passes nothing else.
 *
 * The one thing that changed is that this file now knows about `Context`,
 * because `EncryptedSharedPreferences` needs one (SEC-004). It takes the
 * APPLICATION context, never an activity's, so a configuration change — which
 * on this app includes every language switch — cannot leak an activity through
 * a singleton that outlives it.
 */
class AppContainer private constructor(
    context: Context,
    apiBaseUrl: String,
    debugEnabled: Boolean,
) {
    val logger: Logger = AndroidLogger(debugEnabled)

    /** SEC-004 — Keystore-backed, and never silently plaintext. */
    val secureStorage: SecureStorage = AndroidSecureStorage.create(context)

    /** BR-040 — the stored choice, and the absence of one. */
    val localeStore: LocaleStore = LocaleStore(context)

    /**
     * Seeded from the store so the in-memory language and the persisted one
     * agree from the first read. Defaults to English only when nothing is
     * stored, and in that case the selection screen is what the user sees.
     */
    val localeManager: LocaleManager = LocaleManager(
        initial = localeStore.stored() ?: AppLocale.ENGLISH,
    )

    val json: Json = MohallaJson

    /**
     * EDGE-010 — raised by the auth interceptor, observed by the navigation
     * graph.
     *
     * Declared BEFORE `httpClient` because the interceptor closes over it. The
     * clearing happens here rather than in the interceptor so that a revocation
     * and a deliberate sign-out remove exactly the same things - the token, the
     * cached identity, and every session-scoped relationship - and cannot drift
     * apart.
     */
    val sessionRevocation: SessionRevocation = SessionRevocation()

    /**
     * §42 - a link that arrived before the reader was allowed to follow it.
     *
     * ON THE CONTAINER because the activity receives it and the graph honours
     * it, and those are two different lifetimes: a link tapped while signed out
     * has to survive the whole login flow. In memory only - see the class
     * comment for why a link on disk would eventually open one account's
     * content inside another's session.
     */
    val pendingDeepLink: PendingDeepLink = PendingDeepLink()

    /**
     * Everything an account owns, removed at once.
     *
     * FOUR PATHS REACH A SIGN-OUT — the Settings row, account deletion, the
     * restore screen's "not now", and EDGE-010's revocation — and each of them
     * was clearing a different subset. That is how a name from the previous
     * account greets the next one on a shared phone, which is a common
     * arrangement in this market.
     *
     * WHAT GOES: the token and cached identity (SET-FR-006's "no cached personal
     * content is visible"), every session-scoped relationship
     * ([ViewerRelations]), and any deep link that was waiting - it belonged to
     * the session that received it.
     */
    fun clearSession() {
        sessionRepository.signOut()
        viewerRelations.clear()
        pendingDeepLink.clear()
    }

    /**
     * What this viewer's relationship to a person or a post is.
     *
     * ON THE CONTAINER RATHER THAN IN A VIEWMODEL, because it has to outlive
     * every screen that reads it: following somebody from their profile must
     * still read as "Following" when the same person is opened from search two
     * taps later. Session-scoped and never persisted - see the class comment
     * for why a stale answer on disk would be worse than an honest `Unknown`.
     */
    val viewerRelations: ViewerRelations = ViewerRelations()

    /**
     * The three interceptors `04-mobile-architecture.md` §2 names.
     *
     * NO LOGGING INTERCEPTOR, in any build. A request body on this product
     * contains message text, phone numbers and a bearer token, and SEC-028
     * forbids logging all three. `okhttp-logging` is not on the classpath for
     * that reason — leaving it out is easier to keep true than remembering to
     * gate it behind `BuildConfig.DEBUG`.
     */
    val httpClient: OkHttpClient = OkHttpClient.Builder()
        .addInterceptor(
            AuthInterceptor(secureStorage) {
                // EDGE-010. Everything an account owns goes at once, and then
                // the graph is told - the same removal a deliberate sign-out
                // performs, so the two cannot drift apart.
                clearSession()
                sessionRevocation.raise()
            },
        )
        .addInterceptor(CorrelationInterceptor())
        .addInterceptor(LanguageInterceptor { localeManager.locale.value })
        // Generous but bounded. Pakistani mobile data is slow and expensive
        // (NFR-PERF-001 assumes 3G), so a short timeout would fail requests
        // that were going to succeed; an unbounded one would hang a screen.
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .retryOnConnectionFailure(true)
        .build()

    val apiBaseUrl: String = apiBaseUrl

    val retrofit: Retrofit = Retrofit.Builder()
        // Retrofit requires a trailing slash for relative paths to resolve
        // against the base rather than replacing its path.
        .baseUrl(if (apiBaseUrl.endsWith("/")) apiBaseUrl else "$apiBaseUrl/")
        .client(httpClient)
        .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
        .build()

    val api: MohallaApi = retrofit.create(MohallaApi::class.java)

    val sessionRepository: SessionRepository = SessionRepository(api, secureStorage)

    val authRepository: AuthRepository = AuthRepository(api, sessionRepository)

    val imageUploader: ImageUploader = ImageUploader(api, httpClient)

    val setupRepository: SetupRepository = SetupRepository(api)

    val feedRepository: FeedRepository = FeedRepository(api)

    val eventRepository: EventRepository = EventRepository(api)

    val postRepository: PostRepository = PostRepository(api, imageUploader)

    val postDetailRepository: PostDetailRepository = PostDetailRepository(api)

    val searchRepository: SearchRepository = SearchRepository(api)

    val messagingRepository: MessagingRepository = MessagingRepository(api)

    val notificationRepository: NotificationRepository = NotificationRepository(api)

    val profileRepository: ProfileRepository = ProfileRepository(api)

    val settingsRepository: SettingsRepository = SettingsRepository(api)

    val safetyRepository: SafetyRepository = SafetyRepository(api)


    /**
     * One person's public profile, as a function.
     *
     * Passed to view models rather than a whole repository because that is all
     * they need: the inbox resolves the other participant of each row, the
     * conversation resolves its header, and the event detail screen resolves a
     * creator. A shared function keeps one call site for the neutral 404 that
     * covers a deleted, banned or blocking account (BR-025).
     */
    val publicProfile: suspend (String) -> ApiResult<PublicProfileResponse> =
        { userId -> eventRepository.creator(userId) }

    /**
     * The last ten queries, on THIS DEVICE ONLY (SEARCH-FR-005 - PRIV-011).
     *
     * Keystore-backed rather than plain preferences. A search history is a list
     * of what somebody is worried about and who they are checking on, and
     * PRIV-011 is absolute that it never reaches the server - so it is also
     * kept out of a filesystem backup. Cleared with everything else on sign-out.
     */
    val recentSearches: RecentSearches = RecentSearches(secureStorage)

    /**
     * The posts the reader has actually seen (§19 - UX-HOME-003).
     *
     * "Post renders from the feed's cached copy instantly; only comments load."
     * Bounded at one feed page and never a source of truth - see [PostCache].
     */
    val postCache: PostCache = PostCache()

    /** MEDIA-FR-001 - the photo picker's read-and-compress side. */
    val imagePicker: ImagePicker = ImagePicker(context)

    /**
     * The composer's draft (SS19 - "draft persists locally, never uploads").
     *
     * Keystore-backed rather than plain preferences. See [SecureDraftStore] for
     * why an UNPUBLISHED draft is the one piece of user text on this device
     * whose exposure the author has not consented to yet.
     */
    val draftStore: DraftStore = SecureDraftStore(secureStorage)

    /**
     * The reader's locale as a `java.util.Locale`, for date and number
     * formatting.
     *
     * DERIVED FROM THE APP'S OWN CHOICE, not from `Locale.getDefault()`. The two
     * differ whenever somebody runs the app in Urdu on an English phone, which
     * BR-040 makes a first-class case rather than an oddity - and a date
     * formatted from the system default would come out in Latin numerals inside
     * an Urdu sentence.
     */
    val formattingLocale: () -> java.util.Locale = {
        java.util.Locale.forLanguageTag(localeManager.locale.value.tag)
    }

    /**
     * The device's time zone, read fresh on every call.
     *
     * NOT cached: a phone crossing a border, or a user correcting their zone
     * after landing, changes it mid-session - and an events list is exactly
     * where a stale zone shows up, as every start time being an hour out.
     */
    val displayZone: () -> java.time.ZoneId = { java.time.ZoneId.systemDefault() }

    /** §43 - a banner hint, never a gate on making a request. */
    val connectivity: ConnectivityObserver = ConnectivityObserver(context)

    /** AUTH-FR-002. Empty until OD-015 is resolved; see [BuildEnvironment]. */
    val termsVersion: String = BuildEnvironment.termsVersion

    /**
     * Formats a server timestamp as a date in the reader's locale.
     *
     * A CONTAINER-LEVEL FUNCTION rather than a utility call inside each
     * ViewModel, for one reason: Urdu dates need the Urdu locale's own numerals
     * and month names, and a ViewModel that reached for `DateTimeFormatter`
     * defaults would silently produce Latin digits in an Urdu sentence. Passing
     * it in also keeps ViewModels free of platform formatting, so they stay
     * testable on the JVM without Robolectric.
     *
     * Returns `null` for anything unparseable rather than echoing the raw
     * string - "2026-09-14T00:00:00Z" in the middle of a suspension banner
     * would be worse than the indefinite wording the banner falls back to.
     */
    val formatDate: (String) -> String? = { iso ->
        // The formatting itself moved to `formatLongDate` so a composable can
        // use it too - see RUNTIME-010. This stays as the container's way of
        // binding it to the reader's chosen language.
        formatLongDate(iso, java.util.Locale.forLanguageTag(localeManager.locale.value.tag))
    }

    companion object {
        @Volatile
        private var instance: AppContainer? = null

        fun create(
            context: Context,
            apiBaseUrl: String = BuildEnvironment.apiBaseUrl,
            debugEnabled: Boolean = BuildConfig.DEBUG,
        ): AppContainer = instance ?: synchronized(this) {
            instance ?: AppContainer(
                context.applicationContext,
                apiBaseUrl,
                debugEnabled,
            ).also { instance = it }
        }
    }
}
