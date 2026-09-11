package org.shehersaaz.mohalla

import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipeDown
import androidx.compose.ui.test.onRoot
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.shehersaaz.mohalla.core.design.MohallaTheme
import org.shehersaaz.mohalla.core.network.FeedItemResponse
import org.shehersaaz.mohalla.core.network.PublicProfileResponse
import org.shehersaaz.mohalla.feature.home.FeedList
import org.shehersaaz.mohalla.feature.home.FeedTab
import org.shehersaaz.mohalla.feature.home.FeedUiState
import org.shehersaaz.mohalla.feature.home.HomeScreen

/**
 * FEED-FR-005 — the GESTURE, not the call behind it (INTEGRATION-005).
 *
 * `FeedViewModel.refresh()` and `FeedUiState.refreshing` were both present and
 * correct, and `FeedStateTest` covered them. Nothing in any screen called
 * `onRefresh` except the failed-first-page retry button, so a reader looking at
 * a populated feed had no way to ask for new posts — and every existing test
 * passed, because none of them touched a screen.
 *
 * So this asserts the half the unit suite cannot reach: that a swipe down on a
 * feed with posts in it reaches `onRefresh`. It needs a device only because
 * Compose gestures do; it needs no backend and no fixtures.
 */
class FeedPullToRefreshTest {
    @get:Rule val compose = createComposeRule()

    private fun post(id: String) = FeedItemResponse(
        id = id,
        author = PublicProfileResponse(userId = "u-$id", displayName = "Neighbour"),
        body = "A post that is already on screen",
        likeCount = 0,
        viewerHasLiked = false,
        createdAt = "2026-09-01T10:00:00Z",
    )

    @Test fun swipingDownOnAPopulatedFeedAsksForNewPosts() {
        var refreshes = 0
        val state = FeedUiState(
            tab = FeedTab.DISCOVER,
            discover = FeedList(items = listOf(post("a"), post("b")), loaded = true),
            loadingFirstPage = false,
        )

        compose.setContent {
            MohallaTheme(isUrdu = false) {
                HomeScreen(
                    state = state,
                    onSelectTab = {},
                    onRefresh = { refreshes++ },
                    onLoadMore = {},
                    onOpenPost = {},
                    onOpenAuthor = {},
                    onToggleLike = {},
                    onShare = {},
                    onOpenAnnouncement = {},
                    onFindPeople = {},
                    onSelectCategory = {},
                    onSearch = {},
                    onOpenNotifications = {},
                )
            }
        }

        // The feed really is populated: a swipe on an empty or failed screen
        // would be testing a different branch than the one that was broken.
        assertEquals(
            "both fixture posts should be on screen",
            2,
            compose.onAllNodesWithText("A post that is already on screen", useUnmergedTree = true)
                .fetchSemanticsNodes().size,
        )
        assertEquals("nothing should refresh before the gesture", 0, refreshes)

        // FROM THE MIDDLE OF THE LIST, not from the top of the root. A bare
        // `swipeDown()` on the root starts on the top bar, which is outside the
        // scrollable and never reaches the nested-scroll connection — it fails
        // against the FIXED code too, which would make this test worthless.
        // Slowly, as well: a 200 ms flick is a fling, and a pull is a drag.
        compose.onRoot().performTouchInput {
            swipeDown(startY = centerY, endY = bottom, durationMillis = 700)
        }
        compose.waitForIdle()

        assertEquals("a swipe down on a populated feed must reach onRefresh", 1, refreshes)
    }
}
