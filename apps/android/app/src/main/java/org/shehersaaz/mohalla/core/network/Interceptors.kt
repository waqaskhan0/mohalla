package org.shehersaaz.mohalla.core.network

import okhttp3.Interceptor
import okhttp3.Response
import org.shehersaaz.mohalla.core.locale.AppLocale
import org.shehersaaz.mohalla.core.storage.SecureStorage
import java.util.UUID

/**
 * The three interceptors `04-mobile-architecture.md` §2 names: auth,
 * correlation and language.
 */

/** Where the opaque session token lives (ADR-008 — opaque, not a JWT). */
const val SESSION_TOKEN_KEY = "session.token"

/**
 * The signed-in user's own id.
 *
 * Beside the token deliberately: the two are written and cleared together, and
 * a user id that outlived a sign-out would let the next account's screens ask
 * "is this mine?" against the previous account's identity.
 */
const val USER_ID_KEY = "session.userId"

/**
 * The signed-in person's own name, handle and photo.
 *
 * Cached so the composer's author row can confirm whose name is about to be
 * attached to a post without waiting on a request (UI/UX §19 item 3). Under the
 * same `session.` prefix as the token, so `SecureStorage.clear()` on sign-out
 * takes them with it — a name left behind would greet the next account with the
 * previous one's.
 */
const val USERNAME_KEY = "session.username"
const val DISPLAY_NAME_KEY = "session.displayName"
const val PHOTO_KEY = "session.photoMediaId"

/**
 * `Authorization: Bearer` on every request that has a token.
 *
 * ADDS NOTHING WHEN THERE IS NO TOKEN, rather than sending an empty header.
 * The backend's guard is closed by default and treats a malformed header as an
 * authentication failure, so `Bearer ` with nothing after it would turn an
 * anonymous call into a 401 — and `/register`, `/login` and `/health` are all
 * legitimately anonymous.
 */
class AuthInterceptor(
    private val storage: SecureStorage,
    /**
     * EDGE-010 — the session was revoked while the app was open.
     *
     * RAISED HERE BECAUSE THIS IS THE ONE PLACE THAT KNOWS A TOKEN WAS SENT. A
     * 401 on a request that carried no token is a LOGIN being refused, not a
     * session being revoked, and signing out of nothing would be noise on the
     * one screen where it would confuse somebody most. A repository could not
     * tell the two apart without being told, and there are ten of them.
     */
    private val onSessionRevoked: () -> Unit = {},
) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val token = storage.getString(SESSION_TOKEN_KEY)
        val authenticated = !token.isNullOrBlank()

        val request = if (!authenticated) {
            chain.request()
        } else {
            chain.request().newBuilder()
                .header("Authorization", "Bearer $token")
                .build()
        }

        val response = chain.proceed(request)

        // SET-FR-002's other half made real: "GIVEN a password change on device
        // A, WHEN device B makes its next request, THEN device B is signed
        // out." This app is device B, and this is the only signal it gets.
        if (authenticated && response.code == HTTP_UNAUTHORIZED) {
            onSessionRevoked()
        }

        return response
    }

    private companion object {
        const val HTTP_UNAUTHORIZED = 401
    }
}

/**
 * A correlation id per request, so a user-visible failure can be traced.
 *
 * SRS §16 lets the user quote a correlation id to support. That only works if
 * the id the server logs is the id the client saw, which means the CLIENT has
 * to originate it — a server-generated id never reaches the screen when the
 * failure is a timeout.
 */
class CorrelationInterceptor : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val request = chain.request().newBuilder()
            .header("X-Correlation-Id", UUID.randomUUID().toString())
            .build()
        return chain.proceed(request)
    }
}

/**
 * `Accept-Language` from the INTERFACE language, not the device's.
 *
 * LOCALE-FR-006: server-composed text — notification bodies, error messages —
 * arrives in the user's language. The device locale is the wrong source: a
 * Pakistani handset set to English is common, and the user may have chosen Urdu
 * in the app. The app's own choice is the only one that reflects a decision.
 *
 * Reads through a lambda rather than taking a value, because the language can
 * change at runtime (LOCALE-FR-002) and an interceptor built at startup would
 * otherwise pin the language it was born with.
 */
class LanguageInterceptor(private val locale: () -> AppLocale) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val request = chain.request().newBuilder()
            .header("Accept-Language", locale().tag)
            .build()
        return chain.proceed(request)
    }
}
