package org.shehersaaz.mohalla

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.shehersaaz.mohalla.core.locale.AppLocale
import org.shehersaaz.mohalla.feature.startup.SessionFacts
import org.shehersaaz.mohalla.feature.startup.StartupDestination
import org.shehersaaz.mohalla.feature.startup.StartupFacts
import org.shehersaaz.mohalla.feature.startup.resolveDestination

/**
 * Startup routing (§9).
 *
 * Every branch has a test because the cost of getting one wrong is showing the
 * authenticated shell to somebody who is not authenticated — and that failure
 * is invisible in the happy path, which is the only path a manual check walks.
 */
class StartupRoutingTest {

    private fun facts(
        locale: AppLocale? = AppLocale.ENGLISH,
        hasToken: Boolean = true,
        state: String? = "ACTIVE",
        hasUsername: Boolean = true,
        hasProfile: Boolean = true,
    ) = StartupFacts(
        storedLocale = locale,
        deviceSuggestion = AppLocale.ENGLISH,
        hasSessionToken = hasToken,
        session = state?.let {
            SessionFacts(
                state = it,
                capability = "FULL",
                hasUsername = hasUsername,
                hasProfile = hasProfile,
            )
        },
    )

    @Test
    fun `no stored language routes to selection, whatever else is true`() {
        // BR-040. Even a fully onboarded ACTIVE session waits behind the
        // language choice, because the direction of the first frame depends on
        // it and asking afterwards means asking in the wrong language.
        val destination = resolveDestination(facts(locale = null))
        assertTrue(destination is StartupDestination.ChooseLanguage)
    }

    @Test
    fun `the device locale is a suggestion, never the answer`() {
        val destination = resolveDestination(
            facts(locale = null).copy(deviceSuggestion = AppLocale.URDU),
        )
        assertEquals(
            StartupDestination.ChooseLanguage(AppLocale.URDU),
            destination,
        )
    }

    @Test
    fun `no token goes to Welcome without a network call`() {
        assertEquals(
            StartupDestination.Welcome,
            resolveDestination(facts(hasToken = false, state = null)),
        )
    }

    @Test
    fun `a token whose session cannot be resolved goes to Welcome`() {
        // Covers a revoked session (EDGE-010) and an unreachable server with
        // the same answer. Guessing in the user's favour here would show an
        // authenticated shell to somebody who has been signed out.
        assertEquals(StartupDestination.Welcome, resolveDestination(facts(state = null)))
    }

    @Test
    fun `an active onboarded account goes Home`() {
        assertEquals(StartupDestination.Home, resolveDestination(facts()))
    }

    @Test
    fun `unverified goes to OTP rather than Welcome`() {
        // EDGE-002: the account exists, so Welcome would offer a "create
        // account" that this number would then be refused for.
        assertEquals(
            StartupDestination.VerifyOtp,
            resolveDestination(facts(state = "UNVERIFIED")),
        )
    }

    @Test
    fun `an active account without a username finishes onboarding first`() {
        assertEquals(
            StartupDestination.ChooseUsername,
            resolveDestination(facts(hasUsername = false, hasProfile = false)),
        )
        assertEquals(
            StartupDestination.CompleteProfile,
            resolveDestination(facts(hasProfile = false)),
        )
    }

    @Test
    fun `suspended reads Home read-only rather than being locked out`() {
        // BR-034 restricts WRITING. Locking a suspended user out of reading
        // would be a harsher penalty than the one imposed.
        assertEquals(
            StartupDestination.HomeReadOnly,
            resolveDestination(facts(state = "SUSPENDED")),
        )
    }

    @Test
    fun `pending deletion is offered restoration`() {
        assertEquals(
            StartupDestination.RestoreAccount,
            resolveDestination(facts(state = "PENDING_DELETION")),
        )
    }

    @Test
    fun `BANNED AND DELETED ARE INDISTINGUISHABLE FROM HAVING NO ACCOUNT`() {
        // SEC-006. The whole point: no screen anywhere says "you are banned",
        // and the destination is byte-identical to a first-ever launch with a
        // stored language.
        assertEquals(StartupDestination.Welcome, resolveDestination(facts(state = "BANNED")))
        assertEquals(StartupDestination.Welcome, resolveDestination(facts(state = "DELETED")))
        assertEquals(
            resolveDestination(facts(hasToken = false, state = null)),
            resolveDestination(facts(state = "BANNED")),
        )
    }

    @Test
    fun `AN UNKNOWN ACCOUNT STATE IS TREATED AS UNUSABLE, NOT AS ACTIVE`() {
        // A client that guesses "probably fine" on a state it does not
        // recognise is a client that grants access the server may have
        // revoked — for instance after a backend adds a state this build
        // predates.
        assertEquals(
            StartupDestination.Welcome,
            resolveDestination(facts(state = "SOME_FUTURE_STATE")),
        )
    }
}
