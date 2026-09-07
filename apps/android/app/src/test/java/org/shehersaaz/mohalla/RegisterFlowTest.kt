package org.shehersaaz.mohalla

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.shehersaaz.mohalla.feature.auth.PasswordResetUiState
import org.shehersaaz.mohalla.feature.auth.RegisterUiState
import org.shehersaaz.mohalla.feature.auth.formatDateOfBirth
import org.shehersaaz.mohalla.feature.auth.parseIsoDate

/**
 * The registration and reset flows' own rules.
 *
 * The ViewModels themselves need a coroutine test dispatcher and a fake
 * repository, which is worth doing and is the next increment. What is asserted
 * here is the logic that would be silently wrong: the date round trip, and the
 * shape of the two reset states.
 */
class RegisterFlowTest {

    // ------------------------------------------------------------ the date

    @Test
    fun `THE DATE ROUND TRIP PRESERVES THE MONTH`() {
        // The one bug this cannot be allowed to have. `parseIsoDate` returns a
        // ZERO-BASED month because `Calendar` and `formatDateOfBirth` expect
        // one; an off-by-one here shifts every birthday by a month, silently,
        // and BR-002's age check would then be a month wrong for everybody.
        listOf("1995-06-15", "2000-01-01", "1999-12-31", "2013-09-07").forEach { iso ->
            val parsed = parseIsoDate(iso)
            assertTrue("$iso should parse", parsed != null)
            val (y, m, d) = parsed!!
            assertEquals("$iso did not round-trip", iso, formatDateOfBirth(y, m, d))
        }
    }

    @Test
    fun `January is month zero and December is month eleven`() {
        assertEquals(Triple(2000, 0, 1), parseIsoDate("2000-01-01"))
        assertEquals(Triple(2000, 11, 31), parseIsoDate("2000-12-31"))
    }

    @Test
    fun `a partial or malformed date is null rather than a guess`() {
        // Returning a partially-parsed date would submit a birthday the user
        // never typed.
        listOf("", "1995", "1995-06", "95-06-15", "1995/06/15", "1995-13-01", "1995-06-32")
            .forEach { assertNull("$it should not parse", parseIsoDate(it)) }
    }

    // ------------------------------------------------ registration state

    @Test
    fun `nothing is submittable until every step is done`() {
        val empty = RegisterUiState()
        assertTrue(!empty.termsAccepted)
        assertNull(empty.dateOfBirth)
        assertTrue(empty.password.isEmpty())
    }

    @Test
    fun `BR-004 — TERMS ARE NEVER PRE-ACCEPTED`() {
        // The default matters: `termsAccepted = true` would let somebody create
        // an account without the affirmative act BR-004 requires, and PRIV-014
        // records a version and timestamp against that act — so a default of
        // true would make the stored record untrue.
        assertTrue(!RegisterUiState().termsAccepted)
    }

    @Test
    fun `an underage date is FLAGGED but does not clear the field`() {
        // The client warns and still submits (a device clock is user-settable,
        // so the client cannot be trusted with BR-002). What it must not do is
        // discard what the user typed.
        val state = RegisterUiState(dateOfBirth = "2020-01-01", looksUnderage = true)
        assertTrue(state.looksUnderage)
        assertEquals("2020-01-01", state.dateOfBirth)
    }

    // ----------------------------------------------------- password reset

    @Test
    fun `THE FORGOT-PASSWORD STATE CANNOT SAY WHETHER AN ACCOUNT EXISTS`() {
        // SEC-006. `requestSent` is set on any accepted request, and there is
        // deliberately no companion field — a `accountFound` boolean here would
        // turn the screen into a registered-number lookup available to anyone
        // with the app.
        // An exact set. A denylist here would be testing the five names that
        // occurred to whoever wrote it, and the leak this guards against is a
        // registered-number lookup available to anyone with the app — worth
        // more than a guess.
        assertExactFields(
            type = PasswordResetUiState::class.java,
            expected = setOf(
                "phoneInput", "phoneCheck",
                // Set once the request is ACCEPTED, which happens whether or
                // not an account exists.
                "e164Phone", "requestSent",
                "code", "newPassword", "passwordProblem", "submitting", "resetComplete",
                // Safe to distinguish: holding the code proves possession of
                // the number, so the advice genuinely differs.
                "invalidCode", "expiredCode", "lockedOut",
                "serverMessage", "failure",
            ),
            because = "SEC-006 stops this screen becoming a registered-number lookup; " +
                "`requestSent` is set on any accepted request and has no companion",
        )
    }

    @Test
    fun `but the RESET step may distinguish wrong from expired`() {
        // Holding the code proves possession of the number, so the distinction
        // reveals nothing to a third party and the advice genuinely differs.
        val invalid = PasswordResetUiState(invalidCode = true)
        val expired = PasswordResetUiState(expiredCode = true)

        assertTrue(invalid.invalidCode && !invalid.expiredCode)
        assertTrue(expired.expiredCode && !expired.invalidCode)
    }

    @Test
    fun `the reset screen shows a MASKED number, and only when it has one`() {
        assertNull(PasswordResetUiState().maskedPhone)
        assertEquals(
            "+92 3** *** **67",
            PasswordResetUiState(e164Phone = "+923001234567").maskedPhone,
        )
    }
}
