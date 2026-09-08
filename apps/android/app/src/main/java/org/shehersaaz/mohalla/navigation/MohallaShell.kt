package org.shehersaaz.mohalla.navigation

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import org.shehersaaz.mohalla.core.design.MohallaTheme
import org.shehersaaz.mohalla.core.ui.MohallaBottomNav
import org.shehersaaz.mohalla.feature.safety.SuspensionBanner

/**
 * The authenticated shell: chrome that is the same on all five tabs.
 *
 * WHY THE SHELL DOES NOT KNOW ITS SCREENS. `content` is a lambda taking the
 * selected tab, so this file has no dependency on Home, Events, Messages or
 * Profile. That is not decoration: it means the shell can be built and its RTL
 * behaviour tested before four of the five tabs exist (§36 requires each screen
 * tested in both directions before moving on, which is impossible if the shell
 * can only render once every tab is finished), and it keeps the banner and
 * suspension rules in ONE place rather than repeated per tab — which is how a
 * suspended account eventually finds the one screen that forgot to check.
 *
 * BANNER ORDER IS DELIBERATE: suspension above offline. Both can be true at
 * once, and if only one row is read, it should be the one that explains a
 * permanent restriction rather than a temporary one. Offline resolves itself;
 * suspension does not.
 *
 * THE CREATE TAB IS INTERCEPTED HERE, not inside the composer. A suspended
 * account must never reach a composer it cannot submit from (§6.2), so the tap
 * is diverted to the explainer before any navigation happens. Doing this check
 * inside the composer would mean the composer exists, opens, and then refuses —
 * which is the failure the requirement is written to prevent.
 */
@Composable
fun MohallaShell(
    state: ShellUiState,
    onSelectTab: (MohallaTab) -> Unit,
    onCreate: () -> Unit,
    onShowSuspensionExplainer: () -> Unit,
    modifier: Modifier = Modifier,
    content: @Composable (MohallaTab) -> Unit,
) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .background(MohallaTheme.colors.BgPrimary)
            // The status bar only. The bottom inset is consumed by the
            // navigation bar below, so content between them is not padded twice
            // and the nav bar's own background reaches the screen edge.
            .windowInsetsPadding(WindowInsets.statusBars),
    ) {
        if (state.isSuspended) {
            SuspensionBanner(
                untilLabel = state.suspendedUntilLabel,
                onLearnMore = onShowSuspensionExplainer,
            )
        }

        // THE OFFLINE BANNER IS NOT HERE ANY MORE. §43 wants it above the
        // content, and the shell is five destinations out of forty — somebody
        // who followed a notification into a conversation saw no banner while
        // every request they made failed. It moved to the navigation graph,
        // which is above all of them.

        Box(modifier = Modifier.weight(1f)) {
            content(state.selectedTab)
        }

        MohallaBottomNav(
            selected = state.selectedTab,
            onSelect = { tab ->
                if (tab == MohallaTab.CREATE) {
                    // Intercepted. A suspended account gets the explanation;
                    // everyone else gets the composer.
                    if (state.isSuspended) onShowSuspensionExplainer() else onCreate()
                } else {
                    onSelectTab(tab)
                }
            },
            messagesBadgeCount = state.unreadConversations,
            createLocked = state.isSuspended,
            profileAttention = state.isSuspended || state.hasContentUnderReview,
            modifier = Modifier
                .fillMaxWidth()
                .background(MohallaTheme.colors.SurfacePrimary)
                // §26: "bottom bar height 56px plus the device safe-area
                // inset". Applied INSIDE the bar's own background so the colour
                // extends behind the system gesture area rather than leaving a
                // strip of page showing under it.
                .padding(WindowInsets.navigationBars.asPaddingValues()),
        )
    }
}

/**
 * Everything the shell's chrome needs, and nothing about any tab's contents.
 *
 * The five tabs each own their own state; this is the state of the frame around
 * them.
 */
data class ShellUiState(
    val selectedTab: MohallaTab = MohallaTab.HOME,

    /**
     * BR-034. Derived from the account's capability rather than passed as a
     * boolean by each caller, so there is one definition of "suspended" in the
     * app and no screen can hold a different opinion.
     */
    val capability: AccountCapability = AccountCapability.FULL,

    /** Pre-formatted in the reader's locale by the ViewModel. */
    val suspendedUntilLabel: String? = null,

    /** BR-032 — drives the neutral dot on Profile, never a red badge. */
    val hasContentUnderReview: Boolean = false,

    /** BR-027 — accepted conversations only. Requests are counted elsewhere. */
    val unreadConversations: Int = 0,

    val unreadNotifications: Int = 0,

    /** Starts `true`: the banner is an exception, not the default state. */
    val isOnline: Boolean = true,
) {
    val isSuspended: Boolean get() = capability == AccountCapability.READ_ONLY
}

/**
 * What the account may do.
 *
 * TWO VALUES, NOT A SET OF FLAGS. The server reports `FULL` or `READ_ONLY`, and
 * a finer-grained permission model on the client would be inventing authority
 * the API does not grant — every write is still refused server-side regardless
 * of what this says. This exists to decide what to SHOW, never to decide what is
 * ALLOWED.
 */
enum class AccountCapability {
    FULL,
    READ_ONLY,
    ;

    companion object {
        /**
         * Anything unrecognised is treated as FULL.
         *
         * Deliberately the permissive direction, which looks wrong for a
         * security decision and is right for a display one: this value only
         * gates UI affordances, and the server refuses every write from a
         * suspended account whatever the client believes. Failing closed here
         * would mean a new server-side capability string silently locks working
         * accounts out of posting — a self-inflicted outage — while failing
         * open shows a control that returns a clear refusal.
         */
        fun fromServer(value: String?): AccountCapability =
            if (value == "READ_ONLY") READ_ONLY else FULL
    }
}
