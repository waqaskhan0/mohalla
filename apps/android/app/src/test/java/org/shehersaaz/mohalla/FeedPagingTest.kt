package org.shehersaaz.mohalla

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.shehersaaz.mohalla.core.network.ApiFailure
import org.shehersaaz.mohalla.core.network.ApiResult
import org.shehersaaz.mohalla.core.network.FeaturedItemResponse
import org.shehersaaz.mohalla.core.network.FeedItemResponse
import org.shehersaaz.mohalla.core.network.PublicProfileResponse
import org.shehersaaz.mohalla.feature.home.FeedCursor
import org.shehersaaz.mohalla.feature.home.FeedPage
import org.shehersaaz.mohalla.feature.home.FeedSource
import org.shehersaaz.mohalla.feature.home.FeedTab
import org.shehersaaz.mohalla.feature.home.FeedViewModel
import org.shehersaaz.mohalla.core.network.CategoryResponse

/**
 * Pagination and optimistic likes, driven through the real [FeedViewModel].
 *
 * The repository is replaced by a scripted stand-in rather than by a mocking
 * framework: what is being tested is a SEQUENCE of pages and the state each one
 * leaves behind, and a script reads as the scenario it describes.
 *
 * EDGE-017 is the requirement under most of this: "pagination is stable — no
 * duplicates, no skips".
 */
@OptIn(ExperimentalCoroutinesApi::class)
class FeedPagingTest {

    private val dispatcher = StandardTestDispatcher()

    @Before fun setUp() = Dispatchers.setMain(dispatcher)

    @After fun tearDown() = Dispatchers.resetMain()

    private fun post(id: String, liked: Boolean = false, likes: Int = 0) = FeedItemResponse(
        id = id,
        author = PublicProfileResponse(userId = "u-$id", displayName = "Neighbour"),
        body = "body $id",
        likeCount = likes,
        viewerHasLiked = liked,
        createdAt = "2026-09-01T10:00:00Z",
    )

    /**
     * A [FeedSource] whose answers are a queue.
     *
     * A script rather than a mock: what is under test is a SEQUENCE of pages and
     * the state each one leaves behind, and a queue of prepared answers reads as
     * the scenario it describes. It also records the cursors it was asked for,
     * which is how the keyset-versus-offset property is actually checked —
     * asserting the resulting list would pass even if every page were requested
     * from the start.
     *
     * Runs out into an empty final page rather than throwing, so a test that
     * paginates one step further than it scripted fails on its assertion rather
     * than on an exception from the fake.
     */
    private class Script(
        val following: MutableList<ApiResult<FeedPage>> = mutableListOf(),
        val discover: MutableList<ApiResult<FeedPage>> = mutableListOf(),
        var likeResult: ApiResult<Unit> = ApiResult.Ok(Unit),
    ) : FeedSource {
        val requestedCursors = mutableListOf<FeedCursor?>()
        val requestedCategories = mutableListOf<String?>()
        var likeCalls = 0
        var unlikeCalls = 0

        override suspend fun following(
            cursor: FeedCursor?,
            category: String?,
        ): ApiResult<FeedPage> = record(cursor, category, following)

        override suspend fun discover(
            cursor: FeedCursor?,
            category: String?,
        ): ApiResult<FeedPage> = record(cursor, category, discover)

        private fun record(
            cursor: FeedCursor?,
            category: String?,
            queue: MutableList<ApiResult<FeedPage>>,
        ): ApiResult<FeedPage> {
            requestedCursors += cursor
            requestedCategories += category
            return queue.removeFirstOrNull() ?: ApiResult.Ok(FeedPage(emptyList(), null))
        }

        override suspend fun featured(locale: String): ApiResult<List<FeaturedItemResponse>> =
            ApiResult.Ok(emptyList())

        // UX-HOME-005's options. Scripted so a test can assert the filter is
        // offered only once they exist, and counted so nothing re-reads a list
        // that cannot change (BR-017 — eleven, not user-extensible).
        var categoriesResult: ApiResult<List<CategoryResponse>> =
            ApiResult.Ok(emptyList())
        var categoryCalls = 0

        override suspend fun categories(): ApiResult<List<CategoryResponse>> {
            categoryCalls++
            return categoriesResult
        }

        override suspend fun like(postId: String): ApiResult<Unit> {
            likeCalls++
            return likeResult
        }

        override suspend fun unlike(postId: String): ApiResult<Unit> {
            unlikeCalls++
            return likeResult
        }
    }

    private fun viewModel(script: Script) =
        FeedViewModel(repository = script, locale = { "en" })

    // ------------------------------------------------------------ pagination
    @Test
    fun `THE SECOND PAGE IS REQUESTED WITH THE FIRST PAGE'S CURSOR`() = runTest(dispatcher) {
        val cursor = FeedCursor("2026-09-01T09:00:00Z", "p1")
        val script = Script(
            following = mutableListOf(
                ApiResult.Ok(FeedPage(listOf(post("a"), post("b")), cursor)),
                ApiResult.Ok(FeedPage(listOf(post("c")), null)),
            ),
        )
        val vm = viewModel(script)
        advanceUntilIdle()

        vm.loadMore()
        advanceUntilIdle()

        // Keyset, not offset: the second request names a POSITION, so posts
        // arriving above it cannot shift the window.
        assertEquals(listOf(null, cursor), script.requestedCursors)
        assertEquals(listOf("a", "b", "c"), vm.state.value.following.items.map { it.id })
        assertTrue(vm.state.value.following.atEnd)
    }

    @Test
    fun `A NULL CURSOR STOPS PAGING AND MAKES NO FURTHER REQUEST`() = runTest(dispatcher) {
        val script = Script(
            following = mutableListOf(ApiResult.Ok(FeedPage(listOf(post("a")), null))),
        )
        val vm = viewModel(script)
        advanceUntilIdle()

        vm.loadMore()
        vm.loadMore()
        advanceUntilIdle()

        // One request in total. The list scroll listener fires `loadMore`
        // repeatedly near the bottom, so an unguarded end-of-feed would hammer
        // the API on a metered connection.
        assertEquals(1, script.requestedCursors.size)
    }

    @Test
    fun `AN EMPTY PAGE WITH A CURSOR KEEPS PAGING`() = runTest(dispatcher) {
        // Every item on the page was filtered out by a block (SEC-019). This is
        // the case that makes "empty page" and "end of feed" different things.
        val c1 = FeedCursor("2026-09-01T09:00:00Z", "p1")
        val c2 = FeedCursor("2026-09-01T08:00:00Z", "p2")
        val script = Script(
            following = mutableListOf(
                ApiResult.Ok(FeedPage(listOf(post("a")), c1)),
                ApiResult.Ok(FeedPage(emptyList(), c2)),
                ApiResult.Ok(FeedPage(listOf(post("z")), null)),
            ),
        )
        val vm = viewModel(script)
        advanceUntilIdle()

        vm.loadMore()
        advanceUntilIdle()
        assertFalse("a page with a cursor is not the end", vm.state.value.following.atEnd)

        vm.loadMore()
        advanceUntilIdle()

        assertEquals(listOf("a", "z"), vm.state.value.following.items.map { it.id })
        assertEquals(listOf(null, c1, c2), script.requestedCursors)
    }

    @Test
    fun `A POST APPEARING ON TWO PAGES IS ADDED ONCE`() = runTest(dispatcher) {
        // EDGE-017. A post edited between requests can legitimately land on
        // both pages, and a duplicate key crashes a LazyColumn outright.
        val c1 = FeedCursor("2026-09-01T09:00:00Z", "p1")
        val script = Script(
            following = mutableListOf(
                ApiResult.Ok(FeedPage(listOf(post("a"), post("b")), c1)),
                ApiResult.Ok(FeedPage(listOf(post("b"), post("c")), null)),
            ),
        )
        val vm = viewModel(script)
        advanceUntilIdle()

        vm.loadMore()
        advanceUntilIdle()

        assertEquals(listOf("a", "b", "c"), vm.state.value.following.items.map { it.id })
    }

    @Test
    fun `A FAILED FIRST PAGE IS RECORDED AS A FAILURE AND NOT AS AN EMPTY FEED`() =
        runTest(dispatcher) {
            val script = Script(following = mutableListOf(ApiResult.Err(ApiFailure.Offline)))
            val vm = viewModel(script)
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(ApiFailure.Offline, state.firstPageFailure)
            assertFalse(state.isEmptyFollowing)
            // `loaded` stays false, so nothing downstream can mistake the empty
            // list for an answer.
            assertFalse(state.following.loaded)
        }

    @Test
    fun `A FAILED SECOND PAGE LEAVES THE FIRST ON SCREEN`() = runTest(dispatcher) {
        val c1 = FeedCursor("2026-09-01T09:00:00Z", "p1")
        val script = Script(
            following = mutableListOf(
                ApiResult.Ok(FeedPage(listOf(post("a")), c1)),
                ApiResult.Err(ApiFailure.Offline),
            ),
        )
        val vm = viewModel(script)
        advanceUntilIdle()

        vm.loadMore()
        advanceUntilIdle()

        val state = vm.state.value
        assertEquals(listOf("a"), state.following.items.map { it.id })
        assertEquals(ApiFailure.Offline, state.following.pageFailure)
        // The full-screen error is driven by `firstPageFailure`, which must
        // stay clear — otherwise a failed page two would blank a working feed.
        assertNull(state.firstPageFailure)
        // And the cursor survives, so retrying asks for the same page.
        assertEquals(c1, state.following.nextCursor)
    }

    @Test
    fun `SWITCHING TABS DOES NOT REFETCH A TAB THAT IS ALREADY LOADED`() = runTest(dispatcher) {
        val script = Script(
            following = mutableListOf(ApiResult.Ok(FeedPage(listOf(post("f")), null))),
            discover = mutableListOf(ApiResult.Ok(FeedPage(listOf(post("d")), null))),
        )
        val vm = viewModel(script)
        advanceUntilIdle()

        vm.selectTab(FeedTab.DISCOVER)
        advanceUntilIdle()
        vm.selectTab(FeedTab.FOLLOWING)
        advanceUntilIdle()
        vm.selectTab(FeedTab.DISCOVER)
        advanceUntilIdle()

        // Two requests, not four. Re-fetching on every tap costs data the user
        // is paying for (NFR-PERF-001's 3G assumption is not an edge case here).
        assertEquals(2, script.requestedCursors.size)
        assertEquals(listOf("f"), vm.state.value.following.items.map { it.id })
        assertEquals(listOf("d"), vm.state.value.discover.items.map { it.id })
    }

    @Test
    fun `CHANGING CATEGORY CLEARS BOTH TABS`() = runTest(dispatcher) {
        // FEED-FR-006 changes membership, so both cached lists are stale. Keeping
        // the other tab's list would show unfiltered posts under a filter.
        val script = Script(
            following = mutableListOf(
                ApiResult.Ok(FeedPage(listOf(post("a")), null)),
                ApiResult.Ok(FeedPage(listOf(post("water")), null)),
            ),
            discover = mutableListOf(ApiResult.Ok(FeedPage(listOf(post("d")), null))),
        )
        val vm = viewModel(script)
        advanceUntilIdle()
        vm.selectTab(FeedTab.DISCOVER)
        advanceUntilIdle()
        vm.selectTab(FeedTab.FOLLOWING)
        advanceUntilIdle()

        vm.selectCategory("water")
        advanceUntilIdle()

        assertEquals(listOf("water"), vm.state.value.following.items.map { it.id })
        assertTrue(vm.state.value.discover.items.isEmpty())
        assertEquals("water", vm.state.value.category)
        // The filter reaches the API rather than being applied client-side to a
        // page that was already trimmed to twenty items — filtering locally
        // would show two posts under a category that has thirty.
        assertEquals("water", script.requestedCategories.last())
    }

    // ------------------------------------------------------- optimistic likes
    @Test
    fun `A LIKE APPLIES IMMEDIATELY AND SURVIVES A SUCCESSFUL CALL`() = runTest(dispatcher) {
        val script = Script(
            following = mutableListOf(ApiResult.Ok(FeedPage(listOf(post("a", likes = 4)), null))),
        )
        val vm = viewModel(script)
        advanceUntilIdle()

        vm.toggleLike(vm.state.value.following.items.first())

        // Before the call resolves: the heart is already filled. ENGAGE-FR-001,
        // and the `instant` motion token — an optimistic action that animates
        // looks like it is still deciding.
        val optimistic = vm.state.value.following.items.first()
        assertTrue(optimistic.viewerHasLiked)
        assertEquals(5, optimistic.likeCount)

        advanceUntilIdle()

        val settled = vm.state.value.following.items.first()
        assertTrue(settled.viewerHasLiked)
        assertEquals(5, settled.likeCount)
        assertEquals(1, script.likeCalls)
        assertFalse(settled.id in vm.state.value.pendingLikes)
    }

    @Test
    fun `A REFUSED LIKE REVERTS THE COUNT AND THE HEART`() = runTest(dispatcher) {
        val script = Script(
            following = mutableListOf(ApiResult.Ok(FeedPage(listOf(post("a", likes = 4)), null))),
            likeResult = ApiResult.Err(ApiFailure.Offline),
        )
        val vm = viewModel(script)
        advanceUntilIdle()

        vm.toggleLike(vm.state.value.following.items.first())
        advanceUntilIdle()

        val reverted = vm.state.value.following.items.first()
        // A filled heart on a like the server refused tells the reader
        // something untrue about their own action.
        assertFalse(reverted.viewerHasLiked)
        assertEquals(4, reverted.likeCount)
        assertTrue(vm.state.value.likeReverted)

        vm.onLikeRevertAcknowledged()
        assertFalse(vm.state.value.likeReverted)
    }

    @Test
    fun `UNLIKING CALLS UNLIKE AND DECREMENTS`() = runTest(dispatcher) {
        val script = Script(
            following = mutableListOf(
                ApiResult.Ok(FeedPage(listOf(post("a", liked = true, likes = 9)), null)),
            ),
        )
        val vm = viewModel(script)
        advanceUntilIdle()

        vm.toggleLike(vm.state.value.following.items.first())
        advanceUntilIdle()

        assertEquals(1, script.unlikeCalls)
        assertEquals(0, script.likeCalls)
        assertEquals(8, vm.state.value.following.items.first().likeCount)
        assertFalse(vm.state.value.following.items.first().viewerHasLiked)
    }

    @Test
    fun `A SECOND TAP WHILE A LIKE IS IN FLIGHT IS IGNORED`() = runTest(dispatcher) {
        // Otherwise a double tap sends like and unlike, and which one the server
        // applies last is a race the user did not intend to enter.
        val script = Script(
            following = mutableListOf(ApiResult.Ok(FeedPage(listOf(post("a")), null))),
        )
        val vm = viewModel(script)
        advanceUntilIdle()

        val item = vm.state.value.following.items.first()
        vm.toggleLike(item)
        vm.toggleLike(vm.state.value.following.items.first())
        advanceUntilIdle()

        assertEquals(1, script.likeCalls)
        assertEquals(0, script.unlikeCalls)
    }

    @Test
    fun `A LIKE COUNT NEVER GOES BELOW ZERO`() = runTest(dispatcher) {
        // The server's count and the client's can disagree — a stale page can
        // report a liked post with a count of zero. A negative count on screen
        // is a visible impossibility.
        val script = Script(
            following = mutableListOf(
                ApiResult.Ok(FeedPage(listOf(post("a", liked = true, likes = 0)), null)),
            ),
        )
        val vm = viewModel(script)
        advanceUntilIdle()

        vm.toggleLike(vm.state.value.following.items.first())

        assertEquals(0, vm.state.value.following.items.first().likeCount)
    }

    // -------------------------------------------------------------- removal
    @Test
    fun `AN UNAVAILABLE POST IS REMOVED FROM BOTH TABS AND EXPLAINED TO NOBODY`() =
        runTest(dispatcher) {
            val script = Script(
                following = mutableListOf(ApiResult.Ok(FeedPage(listOf(post("a"), post("b")), null))),
                discover = mutableListOf(ApiResult.Ok(FeedPage(listOf(post("b")), null))),
            )
            val vm = viewModel(script)
            advanceUntilIdle()
            vm.selectTab(FeedTab.DISCOVER)
            advanceUntilIdle()

            vm.onItemUnavailable("b")

            // Gone from both, and no failure recorded: deleted, hidden, blocked
            // and never-existed are one neutral refusal (UX-STATE-001), so there
            // is nothing the app could truthfully say about which it was.
            assertEquals(listOf("a"), vm.state.value.following.items.map { it.id })
            assertTrue(vm.state.value.discover.items.isEmpty())
            assertNull(vm.state.value.firstPageFailure)
        }

    // ----------------------------------------- UX-HOME-005, the category filter

    @Test
    fun `THE FILTER OPTIONS ARE READ ONCE, NOT PER OPENING`() = runTest {
        // BR-017 fixes eleven categories and makes them non-extensible, so the
        // list cannot change between launches. Re-reading it every time the
        // sheet opens would be a request for an answer already held - and on a
        // 2GB phone over 3G (NFR-COMP-002) that is exactly the kind of request
        // that is free to make and not free to wait for.
        val script = Script()
        script.categoriesResult = ApiResult.Ok(
            listOf(
                CategoryResponse(slug = "water", nameEn = "Water", nameUr = "پانی"),
                CategoryResponse(slug = "power", nameEn = "Power", nameUr = "بجلی"),
            ),
        )
        val vm = FeedViewModel(script) { "en" }

        vm.loadCategories()
        advanceUntilIdle()
        assertEquals(2, vm.state.value.categories.size)
        assertEquals(1, script.categoryCalls)

        // Opening the sheet again must not ask again.
        vm.loadCategories()
        advanceUntilIdle()
        assertEquals(1, script.categoryCalls)
    }

    @Test
    fun `A FILTER WHOSE OPTIONS NEVER ARRIVED IS SIMPLY NOT OFFERED`() = runTest {
        // The control is absent rather than present-and-useless. A sheet that
        // opens onto an error is worse than no filter icon, because the reader
        // has to work out that the failure was not theirs.
        val script = Script()
        script.categoriesResult = ApiResult.Err(ApiFailure.Offline)
        val vm = FeedViewModel(script) { "en" }

        vm.loadCategories()
        advanceUntilIdle()

        assertTrue(
            "no options means the top bar shows no filter control",
            vm.state.value.categories.isEmpty(),
        )
    }

    @Test
    fun `CHOOSING A CATEGORY REFETCHES BOTH TABS THROUGH IT`() = runTest {
        // FEED-FR-006 filters BOTH Home tabs, so the slug has to reach the
        // request rather than being applied to the page already held.
        val script = Script()
        val vm = FeedViewModel(script) { "en" }
        advanceUntilIdle()
        script.requestedCategories.clear()

        vm.selectCategory("water")
        advanceUntilIdle()

        assertEquals(
            "the chosen slug must be sent, not filtered client-side",
            listOf("water"),
            script.requestedCategories,
        )
        assertEquals("water", vm.state.value.category)
    }

    @Test
    fun `ALL CATEGORIES IS A NULL SLUG, AND IS NOT A NO-OP`() = runTest {
        // "All" is a real option in the sheet, not a clear button, so choosing
        // it has to send `null` and refetch - otherwise a reader who filtered
        // can never get back.
        val script = Script()
        val vm = FeedViewModel(script) { "en" }
        advanceUntilIdle()

        vm.selectCategory("water")
        advanceUntilIdle()
        script.requestedCategories.clear()

        vm.selectCategory(null)
        advanceUntilIdle()

        assertEquals(listOf<String?>(null), script.requestedCategories)
        assertNull(vm.state.value.category)
    }
}
