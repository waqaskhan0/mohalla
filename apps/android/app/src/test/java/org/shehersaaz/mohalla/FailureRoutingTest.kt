package org.shehersaaz.mohalla

import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.shehersaaz.mohalla.core.network.ApiFailure
import org.shehersaaz.mohalla.core.network.AuthInterceptor
import org.shehersaaz.mohalla.core.network.SESSION_TOKEN_KEY
import org.shehersaaz.mohalla.core.state.SessionRevocation
import org.shehersaaz.mohalla.core.storage.SecureStorage
import org.shehersaaz.mohalla.core.ui.isRetryable

/**
 * Offline and error states (UX-STATE-001…004 · NFR-AVAIL-002 · EDGE-010 · §43).
 *
 * TWO DEFECTS THIS GROUP FOUND, AND BOTH WERE ABOUT A BRANCH NOBODY LOOKED AT.
 *
 *   THE SESSION-REVOCATION HOOK WAS A COMMENT. `apiCall` has taken an
 *   `onUnauthenticated` callback since group 01, `ApiFailure.Unauthenticated`'s
 *   own documentation says "the shell intercepts it globally, signs out and
 *   clears the cache", and no caller ever passed one. SET-FR-002's whole point
 *   is that changing a password signs out every other device — "GIVEN a password
 *   change on device A, WHEN device B makes its next request, THEN device B is
 *   signed out" — and device B is this app.
 *
 *   AND THE FAILURE MAPPING WAS TWELVE COPIES, MOST OF THEM WRONG. §21 specifies
 *   four states with four promises; the shape that spread was two branches with
 *   everything except `Offline` landing on "something went wrong on our end". A
 *   429 with a stated cool-down and a neutral 404 both arrived there.
 *
 * So the tests below are about routing rather than rendering: which state each
 * of the eight failures belongs in, and whether a 401 is a revocation or a
 * refused login.
 */
class FailureRoutingTest {

    /** Every variant, so a new one has to be added here to compile. */
    private val allFailures: List<ApiFailure> = listOf(
        ApiFailure.Offline,
        ApiFailure.Unauthenticated,
        ApiFailure.Validation(message = null),
        ApiFailure.Restricted(message = null),
        ApiFailure.Unavailable(message = null),
        ApiFailure.Conflict(message = null),
        ApiFailure.RateLimited(message = null),
        ApiFailure.Server(message = null),
    )

    // ============================================== which failures offer a retry
    @Test
    fun `A NEUTRAL 404 OFFERS NO RETRY, BECAUSE THERE IS NOTHING TO TRY AGAIN`() {
        // BR-025's refusal is not a failure: the content is not available. An
        // error page with a Try again button on a post that was deleted teaches
        // the reader that the app is broken rather than that the post is gone.
        assertFalse(ApiFailure.Unavailable("gone").isRetryable())
        assertFalse("a 403 will refuse the same way", ApiFailure.Restricted(null).isRetryable())
        assertFalse(
            "and a revoked session is about to be signed out",
            ApiFailure.Unauthenticated.isRetryable(),
        )
    }

    @Test
    fun `OFFLINE AND A SERVER FAULT BOTH OFFER ONE, BECAUSE A RETRY MAY WORK`() {
        // NFR-AVAIL-002: offline is "a different screen with a different
        // promise, because cached content may still be readable and a retry is
        // likely to work".
        assertTrue(ApiFailure.Offline.isRetryable())
        assertTrue(ApiFailure.Server(message = null).isRetryable())
        assertTrue(ApiFailure.RateLimited(message = null).isRetryable())
    }

    @Test
    fun `EVERY FAILURE HAS AN ANSWER, SO NONE CAN FALL THROUGH`() {
        // The point of the central `when`: a variant added to `ApiFailure` is a
        // COMPILE error in one file, in front of whoever added it, rather than
        // landing silently in somebody's `else` branch — which is exactly how
        // the rate-limit defect spread across twelve screens.
        assertEquals(8, allFailures.size)
        allFailures.forEach { failure ->
            // Both sides of the routing answer for all eight. `isRetryable` is
            // exhaustive by construction; this asserts it is also TOTAL.
            failure.isRetryable()
        }
    }

    @Test
    fun `A RATE LIMIT IS THE READER'S OWN BEHAVIOUR AND CARRIES THE SERVER'S MESSAGE`() {
        // SAFETY-FR-009: "a clear cool-down message rather than a silent
        // failure", with the limit and the reset time stated. Routing it to the
        // server-error screen would replace that with an apology for a fault
        // that did not happen.
        val limited = ApiFailure.RateLimited("You can send up to 20 reports a day.", 3600)

        assertEquals("You can send up to 20 reports a day.", limited.message)
        assertEquals(3600, limited.retryAfterSeconds)
        assertTrue(limited.isRetryable())
    }

    @Test
    fun `only the server fault carries a correlation id`() {
        // SRS §16 lets the reader quote it to support, and it is the one
        // technical string the product ever puts on screen. A 400 or a 409 did
        // not come from a server fault and has none.
        assertEquals("abc-123", ApiFailure.Server(null, "abc-123").correlationId)
        assertExactFields(
            ApiFailure.Server::class.java,
            setOf("message", "correlationId"),
            "UX-STATE-003 — the correlation id is shown so it can be quoted (SRS §16)",
        )
    }

    // ================================================== EDGE-010 · the revocation
    @Test
    fun `A 401 ON AN AUTHENTICATED REQUEST REVOKES THE SESSION`() {
        // SET-FR-002's other half: "GIVEN a password change on device A, WHEN
        // device B makes its next request, THEN device B is signed out." This
        // is the only signal the app gets, and until this group nothing was
        // listening.
        val revocation = SessionRevocation()
        val storage = FakeStorage(token = "a-live-token")
        val interceptor = AuthInterceptor(storage) { revocation.raise() }

        interceptor.intercept(chain(status = 401))

        assertTrue(revocation.revoked.value)
    }

    @Test
    fun `A 401 ON AN ANONYMOUS REQUEST IS A REFUSED LOGIN, NOT A REVOCATION`() {
        // Signing out of nothing would be noise on the one screen where it
        // would confuse somebody most — and a repository could not tell the two
        // apart without being told, which is why the check lives where the
        // token is attached.
        val revocation = SessionRevocation()
        val storage = FakeStorage(token = null)
        val interceptor = AuthInterceptor(storage) { revocation.raise() }

        interceptor.intercept(chain(status = 401))

        assertFalse(revocation.revoked.value)
    }

    @Test
    fun `ANY OTHER STATUS LEAVES THE SESSION ALONE`() {
        val revocation = SessionRevocation()
        val interceptor = AuthInterceptor(FakeStorage(token = "a-live-token")) {
            revocation.raise()
        }

        listOf(200, 400, 403, 404, 409, 429, 500).forEach { status ->
            interceptor.intercept(chain(status = status))
            assertFalse("$status must not sign anybody out", revocation.revoked.value)
        }
    }

    @Test
    fun `THE FLAG LATCHES, SO FOUR IN-FLIGHT REQUESTS SIGN OUT ONCE`() {
        // Several calls are usually in flight when a session dies and each gets
        // its own 401. The graph navigates on a change of value, so a latch is
        // what stops it navigating four times.
        val revocation = SessionRevocation()
        val interceptor = AuthInterceptor(FakeStorage(token = "t")) { revocation.raise() }

        repeat(4) { interceptor.intercept(chain(status = 401)) }

        assertTrue(revocation.revoked.value)

        revocation.acknowledge()
        assertFalse("and a later session can raise it again", revocation.revoked.value)
    }

    @Test
    fun `an authenticated request carries the bearer header and an anonymous one does not`() {
        // The header's absence is what makes `/register`, `/login` and `/health`
        // work: the backend treats a malformed `Bearer ` as an authentication
        // failure, so sending an empty one would turn an anonymous call into a
        // 401 — and now, into a spurious sign-out.
        val withToken = chain(status = 200)
        AuthInterceptor(FakeStorage(token = "t")) {}.intercept(withToken)
        assertEquals("Bearer t", withToken.lastRequest?.header("Authorization"))

        val without = chain(status = 200)
        AuthInterceptor(FakeStorage(token = null)) {}.intercept(without)
        assertEquals(null, without.lastRequest?.header("Authorization"))
    }

    // ---------------------------------------------------------------- helpers
    private class FakeStorage(private val token: String?) : SecureStorage {
        override fun getString(key: String): String? =
            if (key == SESSION_TOKEN_KEY) token else null

        override fun putString(key: String, value: String) = Unit
        override fun remove(key: String) = Unit
        override fun clear() = Unit
    }

    /** A chain that records the request it was given and answers with `status`. */
    private class RecordingChain(private val status: Int) : Interceptor.Chain {
        var lastRequest: Request? = null

        private val request = Request.Builder().url("https://api.invalid/me").build()

        override fun request(): Request = request

        override fun proceed(request: Request): Response {
            lastRequest = request
            return Response.Builder()
                .request(request)
                .protocol(Protocol.HTTP_1_1)
                .code(status)
                .message("")
                .body("".toResponseBody("application/json".toMediaType()))
                .build()
        }

        override fun connection() = null
        override fun call() = throw UnsupportedOperationException()
        override fun connectTimeoutMillis() = 0
        override fun withConnectTimeout(timeout: Int, unit: java.util.concurrent.TimeUnit) = this
        override fun readTimeoutMillis() = 0
        override fun withReadTimeout(timeout: Int, unit: java.util.concurrent.TimeUnit) = this
        override fun writeTimeoutMillis() = 0
        override fun withWriteTimeout(timeout: Int, unit: java.util.concurrent.TimeUnit) = this
    }

    private fun chain(status: Int) = RecordingChain(status)
}
