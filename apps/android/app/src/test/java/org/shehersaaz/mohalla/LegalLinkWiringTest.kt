package org.shehersaaz.mohalla

import java.io.File
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * QA-004 — the registration consent step's legal links must go somewhere.
 *
 * WHAT WENT WRONG. `RegisterTermsScreen` draws "Read the Terms" and "Read the
 * Community Guidelines" above a checkbox that says *"I have read and accept the
 * Terms and the Community Guidelines."* Both buttons were wired to `{}`. They
 * looked and behaved like controls — pressable, no disabled styling — and did
 * nothing at all, at the exact moment the reader is asked to affirm they have
 * read the documents.
 *
 * The empty lambda was deliberate and its reasoning was written down: OD-015
 * means the documents do not exist, so nothing should open a browser at a URL
 * that would 404 and nothing should ship placeholder legal text. Both of those
 * are right. What the reasoning missed is that the app had already solved this
 * exact problem somewhere else — `LegalDocumentScreen` says *"This document is
 * not available yet"* and explains why, and Settings had been routing to it all
 * along. So the choice was never "a 404, invented text, or nothing"; there was
 * a fourth option already built, tested and reachable.
 *
 * WHY THIS IS A SOURCE CHECK. The destination lives in the top-level `NavHost`
 * and the register screens live in `authGraph`, so proving the navigation
 * behaviourally means either driving the whole app or hand-assembling a graph —
 * and `PasswordResetNavigationTest` records why a hand-assembled graph is worse
 * than useless here: the Stage 9 defect it pins was IN the graph wiring, so a
 * test that builds its own copy passes while the app is broken. The runtime
 * evidence for this fix is a measured device run, recorded in the QA register.
 * This test exists so the empty lambda cannot come back silently.
 *
 * [IntegrationWiringTest] is the natural relative — it exists because "a
 * callback nothing passes looks exactly like a callback that works" — and it
 * did not catch this one, because here the callback *was* passed. It was passed
 * as a no-op, which looks identical to a working callback from one layer up.
 */
class LegalLinkWiringTest {
    private val navHost = File(
        "src/main/java/org/shehersaaz/mohalla/navigation/MohallaNavHost.kt",
    ).readText()

    /** The `composable(Routes.TERMS) { … }` block, and nothing either side of it. */
    private fun termsRouteBlock(): String {
        val start = navHost.indexOf("composable(Routes.TERMS)")
        assertTrue("the register terms route is no longer declared", start >= 0)
        val next = navHost.indexOf("composable(Routes.OTP)", start)
        assertTrue("could not bound the terms route block", next > start)
        return navHost.substring(start, next)
    }

    @Test
    fun `the registration terms link opens the legal screen`() {
        val block = termsRouteBlock()
        assertTrue(
            "onOpenTerms must navigate to the legal Terms screen, not do nothing",
            block.contains("onOpenTerms = { navController.navigate(Routes.legal(Routes.LEGAL_TERMS)) }"),
        )
    }

    @Test
    fun `the registration guidelines link opens the legal screen`() {
        val block = termsRouteBlock()
        assertTrue(
            "onOpenGuidelines must navigate to the legal Guidelines screen",
            block.contains(
                "onOpenGuidelines = { navController.navigate(Routes.legal(Routes.LEGAL_GUIDELINES)) }",
            ),
        )
    }

    @Test
    fun `neither legal control is wired to an empty lambda again`() {
        val block = termsRouteBlock()
        assertFalse(
            "onOpenTerms is inert again — a control that looks pressable and does nothing",
            block.contains("onOpenTerms = {}") || block.contains("onOpenTerms = { }"),
        )
        assertFalse(
            "onOpenGuidelines is inert again",
            block.contains("onOpenGuidelines = {}") || block.contains("onOpenGuidelines = { }"),
        )
    }

    @Test
    fun `the destination those links point at actually exists`() {
        // Guards the other half: the links could be wired to a route nobody
        // declares, which navigates to nothing and throws at runtime rather
        // than silently doing nothing — a different failure, equally bad.
        assertTrue(
            "the legal route is not registered in the NavHost",
            navHost.contains("composable(Routes.LEGAL_PATTERN)"),
        )
        val destinations = File(
            "src/main/java/org/shehersaaz/mohalla/navigation/MohallaDestinations.kt",
        ).readText()
        assertTrue(destinations.contains("const val LEGAL_TERMS"))
        assertTrue(destinations.contains("const val LEGAL_GUIDELINES"))
    }

    @Test
    fun `and it still refuses to invent legal text`() {
        // The fix must not have quietly become "show something". OD-015 is
        // unresolved; the screen's whole job is to say so.
        val legal = File(
            "src/main/java/org/shehersaaz/mohalla/feature/settings/SettingsScreens.kt",
        ).readText()
        assertTrue(
            "the legal screen no longer states that the document is unavailable",
            legal.contains("R.string.legal_unavailable"),
        )
    }
}
