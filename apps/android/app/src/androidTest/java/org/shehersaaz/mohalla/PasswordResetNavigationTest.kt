package org.shehersaaz.mohalla

import androidx.activity.ComponentActivity
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.rememberNavController
import androidx.test.platform.app.InstrumentationRegistry
import java.net.HttpURLConnection
import java.net.URL
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.shehersaaz.mohalla.core.design.MohallaTheme
import org.shehersaaz.mohalla.core.di.AppContainer
import org.shehersaaz.mohalla.feature.auth.maskPhoneForOwner
import org.shehersaaz.mohalla.navigation.Routes
import org.shehersaaz.mohalla.navigation.authGraph

/**
 * INT-21 support / INTEGRATION-004 regression, on a device against the real
 * local backend and its existing fake SMS adapter.
 *
 * This runs the PRODUCTION auth graph, not a hand-built copy of it. That is the
 * whole point: the defect was not in a screen or in the ViewModel — both were
 * correct — it was in how the graph scoped the ViewModel, so any test that
 * wired the two screens up itself would have passed while the app was broken.
 *
 * Requires a local API and three instrumentation arguments:
 *   syntheticPhone       — a registered synthetic fixture, e.g. 03xxxxxxxxx
 *   syntheticNewPassword — the password the second test sets
 *   codeChannel          — base URL of the local harness that reads the fake
 *                          provider's outbox, e.g. http://10.0.2.2:3000
 * None has a default: a fixture baked into a public repository is a fixture
 * somebody eventually treats as real. The second test CHANGES the fixture's
 * password, so a rerun needs a fresh one.
 */
class PasswordResetNavigationTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()

    private val args get() = InstrumentationRegistry.getArguments()

    private fun requiredArg(name: String) = requireNotNull(args.getString(name)) {
        "Provide a synthetic local fixture via the $name instrumentation argument"
    }

    @Test fun theAcceptedNumberSurvivesTheResetStepBoundary() {
        val phoneInput = requiredArg("syntheticPhone")
        startAtWelcome()
        requestResetCode(phoneInput)

        // BEFORE THE FIX this assertion is what fails. The second destination
        // built its own PasswordResetViewModel, so `e164Phone` was null: no
        // masked recipient in the body, and `submitReset` returned at its first
        // line — an enabled Save button that issued no request at all.
        compose.onNodeWithText("We sent a 6-digit code to ${maskPhoneForOwner(e164(phoneInput))}")
            .assertIsDisplayed()
    }

    @Test fun theResetCompletesThroughTheRealGraph() {
        val phoneInput = requiredArg("syntheticPhone")
        val newPassword = requiredArg("syntheticNewPassword")
        val channel = requiredArg("codeChannel")

        startAtWelcome()
        requestResetCode(phoneInput)

        val code = lastResetCode(channel, e164(phoneInput))
        // The two fields on UX-AUTH-011, in order: the code, then the password.
        val fields = compose.onAllNodes(hasSetTextAction())
        fields[0].performTextInput(code)
        fields[1].performTextInput(newPassword)
        compose.onNodeWithText("Save new password").performClick()

        // The flow ends on Login (the graph is popped), which only happens if
        // the API accepted the reset — the ViewModel sets `resetComplete` from
        // a 2xx and nothing else. Session revocation is asserted server-side.
        compose.waitUntil(timeoutMillis = 30_000) {
            compose.onAllNodesWithText("Forgotten your password?").fetchSemanticsNodes().isNotEmpty()
        }
    }

    private fun startAtWelcome() {
        val container = AppContainer.create(compose.activity)
        compose.setContent {
            MohallaTheme(isUrdu = false) {
                val nav = rememberNavController()
                NavHost(navController = nav, startDestination = Routes.WELCOME) {
                    authGraph(nav, container)
                }
            }
        }
    }

    private fun requestResetCode(phoneInput: String) {
        compose.onNodeWithText("Log in").performClick()
        compose.onNodeWithText("Forgotten your password?").performClick()
        compose.onNode(hasSetTextAction()).performTextInput(phoneInput)
        compose.onNodeWithText("Send code").performClick()
        compose.waitUntil(timeoutMillis = 30_000) {
            compose.onAllNodesWithText("Choose a new password").fetchSemanticsNodes().isNotEmpty()
        }
    }

    /** `03xxxxxxxxx` as the app normalises it, so the assertion masks the same string. */
    private fun e164(input: String) = "+92" + input.filter(Char::isDigit).removePrefix("0")

    private fun lastResetCode(channel: String, e164: String): String {
        val url = URL("$channel/__local-harness__/last-code?phone=" + e164.replace("+", "%2B"))
        val connection = (url.openConnection() as HttpURLConnection).apply { connectTimeout = 10_000 }
        try {
            assertTrue(
                "The local harness has no reset code for the fixture",
                connection.responseCode == 200,
            )
            val body = connection.inputStream.bufferedReader().readText()
            return requireNotNull(Regex("\"code\":\"(\\d{6})\"").find(body)) {
                "Unexpected harness response"
            }.groupValues[1]
        } finally {
            connection.disconnect()
        }
    }
}
