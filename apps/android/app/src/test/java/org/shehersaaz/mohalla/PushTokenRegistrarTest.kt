package org.shehersaaz.mohalla

import kotlinx.coroutines.test.runTest
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.shehersaaz.mohalla.core.locale.AppLocale
import org.shehersaaz.mohalla.core.logging.Logger
import org.shehersaaz.mohalla.core.network.RegisterDeviceRequest
import org.shehersaaz.mohalla.core.network.UnregisterDeviceRequest
import org.shehersaaz.mohalla.core.push.DeviceTokenApi
import org.shehersaaz.mohalla.core.push.PushTokenRegistrar
import org.shehersaaz.mohalla.core.push.PushTokenSource
import retrofit2.Response

/**
 * QA-009 — the device-token lifecycle.
 *
 * Drives the registrar against a recording fake of the API, so every assertion
 * is about what the client actually sent rather than about what it logged. The
 * token source is a port precisely so this runs with no Google Play Services.
 *
 * WHAT IS DELIBERATELY NOT TESTED HERE. Message Requests producing no push,
 * blocked people producing nothing, and per-category preferences are decided
 * SERVER-SIDE in `decideEligibility`. Asserting them on the client would be
 * asserting a rule the client does not own — and a client that enforced them
 * would be a second, weaker copy. They are proven against the running backend
 * in the Stage 10 notification suite.
 */
class PushTokenRegistrarTest {

    private class RecordingApi : DeviceTokenApi {
        val registered = mutableListOf<RegisterDeviceRequest>()
        val unregistered = mutableListOf<UnregisterDeviceRequest>()
        var failNext = false

        private fun noContent(): Response<Unit> =
            Response.success(204, Unit)

        override suspend fun register(body: RegisterDeviceRequest): Response<Unit> {
            if (failNext) {
                failNext = false
                return Response.error(500, "".toResponseBody("application/json".toMediaType()))
            }
            registered += body
            // 204, matching the real endpoint's @HttpCode(NO_CONTENT). The
            // first version returned 200 with a null body, which `apiCall`
            // correctly treats as a failure — the fake was wrong about the
            // contract, not the client.
            return noContent()
        }

        override suspend fun unregister(body: UnregisterDeviceRequest): Response<Unit> {
            unregistered += body
            return noContent()
        }
    }

    private val silent = object : Logger {
        override fun debug(tag: String, message: String) = Unit
        override fun info(tag: String, message: String) = Unit
        override fun warn(tag: String, message: String, throwable: Throwable?) = Unit
        override fun error(tag: String, message: String, throwable: Throwable?) = Unit
    }

    private fun registrar(
        api: RecordingApi,
        token: String? = "token-one",
        language: AppLocale = AppLocale.ENGLISH,
    ) = PushTokenRegistrar(
        api = api,
        tokenSource = PushTokenSource { token },
        language = { language },
        logger = silent,
    )

    // 1 — registration happens, and carries what the contract requires.
    @Test
    fun `registers the token after authentication`() = runTest {
        val api = RecordingApi()
        assertTrue(registrar(api).onAuthenticated())

        assertEquals(1, api.registered.size)
        assertEquals("token-one", api.registered[0].token)
        assertEquals("ANDROID", api.registered[0].platform)
    }

    // The language is THIS device's, not a server guess (BR-040).
    @Test
    fun `sends the device's own language`() = runTest {
        val api = RecordingApi()
        registrar(api, language = AppLocale.URDU).onAuthenticated()
        assertEquals("ur", api.registered.single().language)
    }

    // Nothing to register is not a failure — NOTIF-FR-001 degrades only
    // notifications, so a missing token must not break sign-in.
    @Test
    fun `no token means no call and no error`() = runTest {
        val api = RecordingApi()
        assertFalse(registrar(api, token = null).onAuthenticated())
        assertTrue(api.registered.isEmpty())
    }

    // 2 — rotation reaches the backend.
    @Test
    fun `a rotated token is registered`() = runTest {
        val api = RecordingApi()
        val r = registrar(api)
        r.onAuthenticated()
        assertTrue(r.onTokenRotated("token-two"))

        assertEquals(listOf("token-one", "token-two"), api.registered.map { it.token })
        assertEquals("token-two", r.registeredToken())
    }

    @Test
    fun `a blank rotated token is ignored`() = runTest {
        val api = RecordingApi()
        val r = registrar(api)
        r.onAuthenticated()
        assertFalse(r.onTokenRotated("  "))
        assertEquals(1, api.registered.size)
    }

    // 3 — logout unregisters, and does so with the token it actually holds.
    @Test
    fun `logout unregisters the held token`() = runTest {
        val api = RecordingApi()
        val r = registrar(api)
        r.onAuthenticated()
        r.onLoggedOut()

        assertEquals(listOf("token-one"), api.unregistered.map { it.token })
        assertNull(r.registeredToken())
    }

    @Test
    fun `logout without a registration calls nothing`() = runTest {
        val api = RecordingApi()
        registrar(api).onLoggedOut()
        assertTrue(api.unregistered.isEmpty())
    }

    // 8 — THE SHARED-HANDSET CASE. After USER_A logs out and USER_B logs in,
    // the token must not still be associated with USER_A. The client's part is
    // to unregister on the way out and re-register on the way in; the server
    // reassigns on re-registration.
    @Test
    fun `an account switch retires the old association and creates a new one`() = runTest {
        val api = RecordingApi()
        val a = registrar(api)
        a.onAuthenticated()
        a.onLoggedOut()

        val b = registrar(api)
        b.onAuthenticated()

        assertEquals(listOf("token-one"), api.unregistered.map { it.token })
        assertEquals(listOf("token-one", "token-one"), api.registered.map { it.token })
        assertEquals("token-one", b.registeredToken())
    }

    // 4 — a failed registration must not be remembered as successful, or logout
    // would try to retire a token the server never had.
    @Test
    fun `a failed registration is not recorded`() = runTest {
        val api = RecordingApi()
        api.failNext = true
        val r = registrar(api)

        assertFalse(r.onAuthenticated())
        assertNull(r.registeredToken())

        r.onLoggedOut()
        assertTrue(api.unregistered.isEmpty())
    }
}
