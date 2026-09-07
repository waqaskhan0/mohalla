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
import org.shehersaaz.mohalla.core.network.MohallaApi
import org.shehersaaz.mohalla.core.network.MohallaJson
import org.shehersaaz.mohalla.feature.startup.SessionRepository
import retrofit2.Retrofit
import org.shehersaaz.mohalla.core.storage.AndroidSecureStorage
import org.shehersaaz.mohalla.core.storage.SecureStorage
import java.util.concurrent.TimeUnit

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
     * The three interceptors `04-mobile-architecture.md` §2 names.
     *
     * NO LOGGING INTERCEPTOR, in any build. A request body on this product
     * contains message text, phone numbers and a bearer token, and SEC-028
     * forbids logging all three. `okhttp-logging` is not on the classpath for
     * that reason — leaving it out is easier to keep true than remembering to
     * gate it behind `BuildConfig.DEBUG`.
     */
    val httpClient: OkHttpClient = OkHttpClient.Builder()
        .addInterceptor(AuthInterceptor(secureStorage))
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
