package org.shehersaaz.mohalla

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.shehersaaz.mohalla.feature.startup.StartupDestination
import org.shehersaaz.mohalla.navigation.AccountCapability
import org.shehersaaz.mohalla.navigation.MohallaTab
import org.shehersaaz.mohalla.navigation.Routes
import org.shehersaaz.mohalla.navigation.ShellUiState
import org.shehersaaz.mohalla.navigation.isPreGraph
import org.shehersaaz.mohalla.navigation.startRoute

/**
 * The authenticated shell's rules, and the seam between startup and navigation.
 *
 * The suspension rules are the ones worth guarding here. BR-034 restricts
 * WRITING and nothing else, and every way of getting that wrong is a real
 * penalty applied to someone who was not given it: a suspended account locked
 * out of reading has been banned by accident.
 */
class ShellStateTest {

    // ------------------------------------------------------------ capability
    @Test
    fun `ONLY READ_ONLY IS A SUSPENSION`() {
        assertTrue(
            ShellUiState(capability = AccountCapability.READ_ONLY).isSuspended,
        )
        assertFalse(ShellUiState(capability = AccountCapability.FULL).isSuspended)
    }

    @Test
    fun `AN UNRECOGNISED CAPABILITY FAILS OPEN, AND THAT IS DELIBERATE`() {
        // This looks like the wrong direction for anything security-shaped, and
        // it is right here because this value gates AFFORDANCES, never
        // permissions — the server refuses every write from a suspended account
        // whatever the client believes. Failing closed would mean a new
        // capability string on the server silently locks working accounts out of
        // posting, which is a self-inflicted outage; failing open shows a
        // control that returns a clear refusal.
        assertEquals(AccountCapability.FULL, AccountCapability.fromServer(null))
        assertEquals(AccountCapability.FULL, AccountCapability.fromServer(""))
        assertEquals(AccountCapability.FULL, AccountCapability.fromServer("SOMETHING_NEW"))
        assertEquals(AccountCapability.FULL, AccountCapability.fromServer("read_only"))
        assertEquals(AccountCapability.READ_ONLY, AccountCapability.fromServer("READ_ONLY"))
    }

    @Test
    fun `THE DEFAULT SHELL IS ONLINE, ACTIVE AND ON HOME`() {
        // Every banner is an EXCEPTION. A default that started offline or
        // suspended would show both banners for the moment before the first
        // read resolved, on every cold start.
        val state = ShellUiState()
        assertTrue(state.isOnline)
        assertFalse(state.isSuspended)
        assertFalse(state.hasContentUnderReview)
        assertEquals(MohallaTab.HOME, state.selectedTab)
        assertEquals(0, state.unreadConversations)
    }

    @Test
    fun `THE PROFILE DOT APPEARS FOR A SUSPENSION OR FOR CONTENT UNDER REVIEW`() {
        // §14: "a small dot appears when the account is suspended or has content
        // under review". Two independent causes, one indicator — and neither is
        // the red count badge, because this is information rather than a demand.
        val suspended = ShellUiState(capability = AccountCapability.READ_ONLY)
        val underReview = ShellUiState(hasContentUnderReview = true)

        assertTrue(suspended.isSuspended || suspended.hasContentUnderReview)
        assertTrue(underReview.isSuspended || underReview.hasContentUnderReview)

        val ordinary = ShellUiState()
        assertFalse(ordinary.isSuspended || ordinary.hasContentUnderReview)
    }

    // ------------------------------------------------------------------- tabs
    @Test
    fun `CREATE IS NOT A DESTINATION`() {
        // §14 calls it "the one item that reads as a button rather than a
        // location". It has a route so the enum is uniform, but nothing in the
        // shell ever selects it — the tap is intercepted.
        assertNotEquals(MohallaTab.CREATE, ShellUiState().selectedTab)
        assertEquals("create", MohallaTab.CREATE.route)
    }

    @Test
    fun `THE FIVE TABS ARE IN LOGICAL ORDER WITH CREATE IN THE MIDDLE`() {
        // Restated here, next to the shell that depends on it, because the
        // shell's RTL correctness comes entirely from never reversing this list.
        assertEquals(
            listOf(
                MohallaTab.HOME,
                MohallaTab.EVENTS,
                MohallaTab.CREATE,
                MohallaTab.MESSAGES,
                MohallaTab.PROFILE,
            ),
            MohallaTab.ordered,
        )
    }

    // ------------------------------------------------------- startup routing
    @Test
    fun `A SUSPENDED ACCOUNT LANDS EXACTLY WHERE AN ACTIVE ONE DOES`() {
        // BR-034 again, and the most important single assertion in this file.
        // The banner is the difference; the destination is not.
        assertEquals(Routes.SHELL, StartupDestination.Home.startRoute())
        assertEquals(Routes.SHELL, StartupDestination.HomeReadOnly.startRoute())
    }

    @Test
    fun `EVERY UNFINISHED STATE ROUTES TO ITS OWN NEXT STEP`() {
        assertEquals(Routes.OTP, StartupDestination.VerifyOtp.startRoute())
        assertEquals(Routes.USERNAME, StartupDestination.ChooseUsername.startRoute())
        assertEquals(Routes.PROFILE_SETUP, StartupDestination.CompleteProfile.startRoute())
        assertEquals(Routes.RESTORE_ACCOUNT, StartupDestination.RestoreAccount.startRoute())
        assertEquals(Routes.WELCOME, StartupDestination.Welcome.startRoute())
    }

    @Test
    fun `THE PRE-GRAPH DESTINATIONS ARE THE TWO THAT ARE RENDERED DIRECTLY`() {
        // The splash and the language choice both happen before a back stack
        // exists — the language choice ends in `recreate()`, which would destroy
        // its own destination. Anything else must be routable, or it would sit
        // behind an `else` branch and silently render as Welcome.
        assertTrue(StartupDestination.Resolving.isPreGraph())
        assertTrue(
            StartupDestination.ChooseLanguage(
                org.shehersaaz.mohalla.core.locale.AppLocale.URDU,
            ).isPreGraph(),
        )

        assertFalse(StartupDestination.Home.isPreGraph())
        assertFalse(StartupDestination.HomeReadOnly.isPreGraph())
        assertFalse(StartupDestination.Welcome.isPreGraph())
        assertFalse(StartupDestination.VerifyOtp.isPreGraph())
        assertFalse(StartupDestination.ChooseUsername.isPreGraph())
        assertFalse(StartupDestination.CompleteProfile.isPreGraph())
        assertFalse(StartupDestination.RestoreAccount.isPreGraph())
    }

    @Test
    fun `THE REGISTER GRAPH IS NOT ONE OF ITS OWN STEPS`() {
        // The graph route exists to be a shared ViewModel owner. If it collided
        // with a step's route, entering the graph and entering step one would be
        // the same navigation and the shared scope would collapse.
        assertNotEquals(Routes.REGISTER_GRAPH, Routes.REGISTER_PHONE)
        assertTrue(Routes.REGISTER_PHONE.startsWith(Routes.REGISTER_GRAPH))
    }
}
