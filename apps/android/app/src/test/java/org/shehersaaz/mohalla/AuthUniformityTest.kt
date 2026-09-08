package org.shehersaaz.mohalla

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.shehersaaz.mohalla.feature.auth.LoginOutcome
import org.shehersaaz.mohalla.feature.auth.LoginUiState
import org.shehersaaz.mohalla.feature.auth.OtpUiState
import org.shehersaaz.mohalla.feature.auth.OTP_MAX_RESENDS_PER_HOUR

/**
 * SEC-006 — THE UNIFORM RESPONSE, ENFORCED IN THE CLIENT'S TYPES.
 *
 * The backend went to real trouble to make a wrong password, an unknown number
 * and a banned account indistinguishable — including hashing a decoy when there
 * is no account, so that response TIME is not an oracle either. All of that is
 * undone if the client renders three different messages.
 *
 * These tests assert the property structurally rather than by inspecting copy:
 * the state and outcome types have **no field capable of carrying the
 * distinction**, so no screen can render one even by accident. A test that
 * checked "the error string is the same" would pass while a future field
 * quietly reintroduced the leak.
 */
class AuthUniformityTest {

    @Test
    fun `EVERY LoginOutcome IS ACCOUNTED FOR, AND ONLY THREE EXIST`() {
        // Asserted with an EXHAUSTIVE `when` rather than by reflection, which
        // is a stronger guarantee than a runtime check: adding a variant named
        // `WrongPassword`, `NoSuchAccount` or `Banned` does not fail this
        // test - it fails to COMPILE, at the moment somebody writes it, with
        // the reason in front of them. It also needs no kotlin-reflect on the
        // test classpath.
        fun label(outcome: LoginOutcome): String = when (outcome) {
            is LoginOutcome.Authenticated -> "signed in"
            LoginOutcome.VerificationRequired -> "needs the OTP"
            LoginOutcome.Failed -> "refused"
        }

        assertEquals("refused", label(LoginOutcome.Failed))
        assertEquals("needs the OTP", label(LoginOutcome.VerificationRequired))
        assertEquals("signed in", label(LoginOutcome.Authenticated("FULL")))
    }

    @Test
    fun `Failed carries no field that could say why`() {
        // A `data object` has no declared state. `data class Failed(val reason:
        // String)` would compile and would be the leak; this catches it through
        // Java reflection, which needs no extra dependency.
        val fields = LoginOutcome.Failed::class.java.declaredFields
            .filterNot { it.isSynthetic }
            .map { it.name }
            // Kotlin emits INSTANCE for an object and $stable for Compose
            // stability; neither is payload.
            .filterNot { it == "INSTANCE" || it.startsWith("$") }

        assertTrue(
            "LoginOutcome.Failed must carry nothing. Found: " + fields.toString(),
            fields.isEmpty(),
        )
    }

    @Test
    fun `the login state has ONE rejection flag, not one per cause`() {
        val state = LoginUiState(credentialsRejected = true)

        // Present, and singular.
        assertTrue(state.credentialsRejected)

        // AN EXACT SET, not a denylist of guessed names. A denylist tests the
        // names somebody thought of — and a field called `refusalKind` or
        // `authFailureType` would sail past one while carrying exactly the
        // distinction SEC-006 exists to suppress.
        assertExactFields(
            type = LoginUiState::class.java,
            expected = setOf(
                "phoneInput", "phoneCheck", "password", "submitting",
                // ONE rejection flag, not one per cause.
                "credentialsRejected",
                // The one safe disclosure: reaching it PROVED the password.
                "verificationRequired",
                "authenticatedCapability",
                // Where the account belongs, resolved AFTER a correct
                // password (RUNTIME-007). Allowed on the same ground as
                // `verificationRequired`: it is null on every rejected
                // sign-in, so it cannot distinguish a wrong password from an
                // unknown number, and the states it does distinguish -
                // owing a username, owing a profile, pending deletion,
                // suspended - are facts about an account whose password the
                // caller has just proved they hold.
                "destination",
                // The transport-level failure (offline, 5xx), which says
                // nothing about the account.
                "failure",
            ),
            because = "SEC-006 makes a wrong password, an unknown number and a banned " +
                "account one answer; a field per cause would undo the server's uniformity " +
                "at the last step",
        )
    }

    @Test
    fun `verification-required is separate because reaching it PROVED the password`() {
        // The one safe disclosure on this screen. It is a distinct field rather
        // than folded into `credentialsRejected` precisely because the safety
        // argument is different: the caller has already authenticated.
        val state = LoginUiState(verificationRequired = true)
        assertTrue(state.verificationRequired)
        assertTrue(!state.credentialsRejected)
    }

    // ------------------------------------------------------------------ otp

    @Test
    fun `the OTP screen CAN distinguish wrong from expired, and that is deliberate`() {
        // Unlike login, reaching this screen required possession of the number,
        // so the distinction reveals nothing to a third party — and the advice
        // genuinely differs: "check the digits" versus "get a new one".
        val invalid = OtpUiState(maskedPhone = "+92 3** *** **67", invalidCode = true)
        val expired = OtpUiState(maskedPhone = "+92 3** *** **67", expiredCode = true)

        assertTrue(invalid.invalidCode && !invalid.expiredCode)
        assertTrue(expired.expiredCode && !expired.invalidCode)
    }

    @Test
    fun `resend is refused while the cooldown runs and once the cap is reached`() {
        val cooling = OtpUiState(maskedPhone = "x", cooldownSeconds = 42)
        assertTrue(!cooling.canResend)

        val exhausted = OtpUiState(maskedPhone = "x", resendsUsed = OTP_MAX_RESENDS_PER_HOUR)
        assertTrue(!exhausted.canResend)
        assertTrue(exhausted.resendsExhausted)

        val ready = OtpUiState(maskedPhone = "x", cooldownSeconds = 0, resendsUsed = 1)
        assertTrue(ready.canResend)
    }

    @Test
    fun `THE OTP STATE NEVER HOLDS THE FULL PHONE NUMBER`() {
        // §12 and PRIV-003. The screen shows which number the code went to, and
        // the masked form is the only one it has — so there is nothing for a
        // crash report or a screenshot to leak.
        // An exact set, so a field called `e164`, `fullNumber` or `msisdn`
        // cannot appear under a name this test did not anticipate.
        assertExactFields(
            type = OtpUiState::class.java,
            expected = setOf(
                // The masked form is the ONLY one the screen holds.
                "maskedPhone",
                "code", "submitting", "resending", "cooldownSeconds", "resendsUsed",
                "verified",
                // EDGE-005 — wrong and expired are told apart here, because
                // holding the code proves possession of the number.
                "invalidCode", "expiredCode", "lockedOut",
                "codeResent", "serverMessage", "failure",
            ),
            because = "§12 and PRIV-003 keep the full number off this screen, so there is " +
                "nothing for a crash report or a screenshot to leak",
        )
    }
}
