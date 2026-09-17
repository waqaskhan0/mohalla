package org.shehersaaz.mohalla.core.push

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import org.shehersaaz.mohalla.core.locale.AppLocale
import org.shehersaaz.mohalla.core.logging.Logger
import org.shehersaaz.mohalla.core.network.ApiResult
import org.shehersaaz.mohalla.core.network.MohallaApi
import org.shehersaaz.mohalla.core.network.RegisterDeviceRequest
import org.shehersaaz.mohalla.core.network.UnregisterDeviceRequest
import org.shehersaaz.mohalla.core.network.apiCall
import retrofit2.Response

/**
 * Where the FCM registration token comes from.
 *
 * Behind a port so the whole registrar is testable without Google Play
 * Services — the same reason the backend puts SMS and push behind ports. The
 * real implementation asks Firebase; a test supplies a string.
 */
fun interface PushTokenSource {
    /** The current token, or `null` when Firebase cannot supply one. */
    suspend fun currentToken(): String?
}

/**
 * The two calls this registrar makes, and no more.
 *
 * NARROWER THAN `MohallaApi` ON PURPOSE. Depending on the whole interface would
 * mean a test had to implement every endpoint in the app to assert one
 * registration, which is the kind of friction that stops tests being written.
 * It also states the dependency honestly: this class touches two routes.
 */
interface DeviceTokenApi {
    suspend fun register(body: RegisterDeviceRequest): Response<Unit>
    suspend fun unregister(body: UnregisterDeviceRequest): Response<Unit>
}

/** The production binding, delegating to the app's Retrofit client. */
class RetrofitDeviceTokenApi(private val api: MohallaApi) : DeviceTokenApi {
    override suspend fun register(body: RegisterDeviceRequest) = api.registerDevice(body)
    override suspend fun unregister(body: UnregisterDeviceRequest) = api.unregisterDevice(body)
}

/**
 * The device-token half of NOTIF-FR-001 (QA-009).
 *
 * `04-mobile-architecture.md`: *"Token registered after login and on permission
 * grant; removed on logout; refreshed on FCM rotation."* This is that sentence,
 * and nothing more — it deliberately owns no product rules.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO. It does not decide whether a notification
 * should be sent. Message Requests producing no push (BR-027), a blocked person
 * producing nothing at all, and per-category preferences are all decided
 * server-side in `decideEligibility`, and a client that re-implemented any of
 * them would be a second, weaker copy that eventually disagrees. The client's
 * only job is to make sure the server knows where to deliver.
 *
 * THE TOKEN IS NEVER LOGGED. It is an operational identifier that addresses a
 * specific handset; `05-security.md` treats those the way it treats session
 * tokens. Log lines here record that something happened, never what the value
 * was.
 */
private const val TAG = "push"

class PushTokenRegistrar(
    private val api: DeviceTokenApi,
    private val tokenSource: PushTokenSource,
    private val language: () -> AppLocale,
    private val logger: Logger,
) {
    /**
     * The token this installation last told the server about.
     *
     * Held so `onNewToken` can retire the previous one, and so logout can
     * unregister without asking Firebase again — a signed-out app should not be
     * making Firebase calls to find out what to delete.
     */
    @Volatile
    private var registered: String? = null

    /**
     * Register after an authenticated session exists.
     *
     * ONLY AFTER. The endpoint requires a session and associates the token with
     * whoever is calling, so registering before login would either fail or —
     * worse, on a shared handset — attach this device to the wrong account.
     */
    suspend fun onAuthenticated(): Boolean {
        val token = tokenSource.currentToken()
        if (token.isNullOrBlank()) {
            logger.debug(TAG, "push_token_unavailable")
            return false
        }
        return register(token)
    }

    /**
     * Firebase rotated the token.
     *
     * The new one is registered; the old one is NOT deleted. Re-registering
     * reassigns server-side, and the old token is already dead as far as FCM is
     * concerned — asking the server to delete a token it will never be given
     * again adds a call that can fail for no benefit. ADR-014 has the server
     * drop tokens FCM reports as invalid, which is the path that actually
     * cleans up.
     */
    suspend fun onTokenRotated(token: String): Boolean {
        if (token.isBlank()) return false
        return register(token)
    }

    /**
     * Logout: stop this handset receiving the departing account's notifications.
     *
     * CALLED BEFORE THE SESSION IS CLEARED, because the endpoint needs the
     * session to authorise the removal. Failure is swallowed deliberately: a
     * logout must complete even offline, and leaving a stale token is recovered
     * on the next sign-in, which reassigns it.
     */
    suspend fun onLoggedOut() {
        val token = registered ?: return
        registered = null
        when (apiCall { api.unregister(UnregisterDeviceRequest(token)) }) {
            is ApiResult.Ok -> logger.debug(TAG, "push_token_unregistered")
            is ApiResult.Err -> logger.debug(TAG, "push_token_unregister_failed")
        }
    }

    private suspend fun register(token: String): Boolean {
        val request = RegisterDeviceRequest(token = token, language = language().tag)
        return when (apiCall { api.register(request) }) {
            is ApiResult.Ok -> {
                registered = token
                logger.debug(TAG, "push_token_registered")
                true
            }

            is ApiResult.Err -> {
                logger.debug(TAG, "push_token_registration_failed")
                false
            }
        }
    }

    /** Fire-and-forget wrapper for callers that are not in a coroutine. */
    fun registerInBackground(scope: CoroutineScope) {
        scope.launch { onAuthenticated() }
    }

    /** For tests and for logout, which needs to know whether anything is held. */
    fun registeredToken(): String? = registered
}
