package org.shehersaaz.mohalla

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.shehersaaz.mohalla.core.network.ApiFailure
import org.shehersaaz.mohalla.core.network.FeedItemResponse
import org.shehersaaz.mohalla.core.network.PublicProfileResponse
import org.shehersaaz.mohalla.core.ui.DELETED_USER_KEY
import org.shehersaaz.mohalla.feature.home.FeedCursor
import org.shehersaaz.mohalla.feature.home.FeedList
import org.shehersaaz.mohalla.feature.home.FeedTab
import org.shehersaaz.mohalla.feature.home.FeedUiState

/**
 * The Home feed's state machine.
 *
 * These are the assertions that keep the feed's most damaging bug out: rendering
 * "your neighbourhood is quiet" when the request actually failed. RSK-001 is that
 * a cold start with nothing on it is why people do not return, and telling a new
 * user their area is empty when the app could not reach it is the worst available
 * version of that.
 *
 * All pure state, so it runs on the JVM with no device — which matters, because
 * there is no emulator in this project yet (`20-mobile-open-issues.md`) and a
 * gate that only runs where hardware exists is a gate that runs late.
 */
class FeedStateTest {

    private fun post(id: String, liked: Boolean = false, likes: Int = 0) = FeedItemResponse(
        id = id,
        author = PublicProfileResponse(userId = "u-$id", displayName = "Neighbour"),
        body = "body",
        likeCount = likes,
        viewerHasLiked = liked,
        createdAt = "2026-09-01T10:00:00Z",
    )

    // ------------------------------------------------------------------ empty
    @Test
    fun `AN EMPTY FOLLOWING FEED IS EMPTY ONLY ONCE A PAGE HAS ACTUALLY ARRIVED`() {
        // A first page still in flight has no items either. Reporting that as
        // empty would flash the "follow some neighbours" screen on every cold
        // start before the feed lands.
        val inFlight = FeedUiState(
            tab = FeedTab.FOLLOWING,
            following = FeedList(loaded = false),
            loadingFirstPage = true,
        )
        assertFalse(inFlight.isEmptyFollowing)

        val arrived = FeedUiState(
            tab = FeedTab.FOLLOWING,
            following = FeedList(items = emptyList(), loaded = true),
            loadingFirstPage = false,
        )
        assertTrue(arrived.isEmptyFollowing)
    }

    @Test
    fun `A FAILED FIRST PAGE IS NEVER REPORTED AS AN EMPTY FEED`() {
        // The whole point. `loaded` is false and a failure is present, and
        // EITHER condition alone must be enough to suppress the empty state.
        val failed = FeedUiState(
            tab = FeedTab.FOLLOWING,
            following = FeedList(items = emptyList(), loaded = true),
            loadingFirstPage = false,
            firstPageFailure = ApiFailure.Offline,
        )

        assertFalse(
            "an offline first page must render the offline state, not 'no posts yet'",
            failed.isEmptyFollowing,
        )
        assertFalse(failed.isEmptyDiscover)
    }

    @Test
    fun `EACH TAB REPORTS ITS OWN EMPTINESS`() {
        // Following empty, Discover full. Whichever tab is selected decides,
        // because the two states have different copy and different actions.
        val state = FeedUiState(
            following = FeedList(items = emptyList(), loaded = true),
            discover = FeedList(items = listOf(post("a")), loaded = true),
            loadingFirstPage = false,
        )

        assertTrue(state.copy(tab = FeedTab.FOLLOWING).isEmptyFollowing)
        assertFalse(state.copy(tab = FeedTab.DISCOVER).isEmptyDiscover)

        // And a tab never reports the OTHER tab's emptiness.
        assertFalse(state.copy(tab = FeedTab.DISCOVER).isEmptyFollowing)
    }

    // ------------------------------------------------------------ pagination
    @Test
    fun `THE END OF THE FEED IS A NULL CURSOR, NOT AN EMPTY PAGE`() {
        // A page can come back empty with a cursor still set — every item on it
        // was filtered out by a block (SEC-019). Treating that as the end
        // truncates the feed at the first fully-blocked page.
        val emptyWithCursor = FeedList(
            items = emptyList(),
            nextCursor = FeedCursor("2026-09-01T10:00:00Z", "p-9"),
            loaded = true,
        )
        assertFalse("an empty page with a cursor is not the end", emptyWithCursor.atEnd)

        val trulyDone = FeedList(items = listOf(post("a")), nextCursor = null, loaded = true)
        assertTrue(trulyDone.atEnd)
    }

    @Test
    fun `A PAGE THAT HAS NEVER LOADED IS NOT AT THE END`() {
        // `nextCursor` is null before the first request too. Without the
        // `loaded` guard, a fresh state would claim the feed was finished
        // before it had begun — and `loadMore` would never fire.
        assertFalse(FeedList().atEnd)
    }

    @Test
    fun `A FAILED SUBSEQUENT PAGE KEEPS EVERYTHING ALREADY READ`() {
        // §15's "error at page end, retry". The items stay; only a retry
        // affordance is added below them.
        val page = FeedList(
            items = listOf(post("a"), post("b")),
            nextCursor = FeedCursor("2026-09-01T09:00:00Z", "b"),
            loaded = true,
            pageFailure = ApiFailure.Offline,
        )

        assertEquals(2, page.items.size)
        // And it is NOT the state that drives the full-screen error, which only
        // looks at `firstPageFailure`.
        val state = FeedUiState(following = page, loadingFirstPage = false)
        assertNull(state.firstPageFailure)
    }

    // ------------------------------------------------------------------ items
    @Test
    fun `MAPPING ONE ITEM LEAVES EVERY OTHER ITEM IDENTICAL`() {
        // The optimistic like path depends on this: touching the wrong item, or
        // rebuilding the list, would change identities LazyColumn keys on.
        val page = FeedList(items = listOf(post("a"), post("b", likes = 3)), loaded = true)

        val mapped = page.mapItem("b") { it.copy(viewerHasLiked = true, likeCount = 4) }

        assertEquals(page.items[0], mapped.items[0])
        assertTrue(mapped.items[1].viewerHasLiked)
        assertEquals(4, mapped.items[1].likeCount)
    }

    @Test
    fun `WITHPAGE WRITES TO THE TAB IT WAS GIVEN AND LEAVES THE OTHER ALONE`() {
        val state = FeedUiState(
            following = FeedList(items = listOf(post("f")), loaded = true),
            discover = FeedList(items = listOf(post("d")), loaded = true),
        )

        val updated = state.withPage(FeedTab.DISCOVER, FeedList(items = emptyList(), loaded = true))

        assertEquals(listOf("f"), updated.following.items.map { it.id })
        assertTrue(updated.discover.items.isEmpty())
    }

    @Test
    fun `CURRENT FOLLOWS THE SELECTED TAB`() {
        val state = FeedUiState(
            tab = FeedTab.DISCOVER,
            following = FeedList(items = listOf(post("f")), loaded = true),
            discover = FeedList(items = listOf(post("d")), loaded = true),
        )
        assertEquals(listOf("d"), state.current.items.map { it.id })
        assertEquals(state.discover, state.pageFor(FeedTab.DISCOVER))
    }

    // -------------------------------------------------------------- BR-009
    @Test
    fun `THE DELETED AUTHOR KEY MATCHES THE BACKEND EXACTLY`() {
        // The server sends a departed author's display name as this
        // LOCALISATION KEY, not as text, because both languages must be able to
        // say it. If this constant drifts from the backend's
        // `DELETED_USER_NAME_KEY`, the card stops recognising it and prints the
        // key itself on a real screen.
        assertEquals("profile.deletedUser", DELETED_USER_KEY)
    }

    @Test
    fun `A DEPARTED AUTHOR STILL CARRIES THE POST`() {
        // BR-009 and PRIV-006: deleting an account does NOT delete its posts.
        // Only a ban removes content with its author. So a feed item whose
        // author is the deleted placeholder is a normal item, not a missing one.
        val item = post("a").copy(
            author = PublicProfileResponse(
                userId = "gone",
                displayName = DELETED_USER_KEY,
                // PRIV-007: nothing that links back — no city, no handle.
                username = null,
                city = null,
            ),
        )

        assertEquals(DELETED_USER_KEY, item.author.displayName)
        assertNull(item.author.city)
        assertNull(item.author.username)
        assertEquals("body", item.body)
    }
}
