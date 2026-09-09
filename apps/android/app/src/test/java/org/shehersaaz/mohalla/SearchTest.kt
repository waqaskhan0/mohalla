package org.shehersaaz.mohalla

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceTimeBy
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
import org.shehersaaz.mohalla.core.network.EventResponse
import org.shehersaaz.mohalla.core.network.FeedItemResponse
import org.shehersaaz.mohalla.core.network.PublicProfileResponse
import org.shehersaaz.mohalla.feature.search.EventsPage
import org.shehersaaz.mohalla.feature.search.PeoplePage
import org.shehersaaz.mohalla.feature.search.PostsPage
import org.shehersaaz.mohalla.feature.search.RecentSearches
import org.shehersaaz.mohalla.feature.search.SEARCH_QUERY_MIN_LENGTH
import org.shehersaaz.mohalla.feature.search.SearchFailure
import org.shehersaaz.mohalla.feature.search.SearchSource
import org.shehersaaz.mohalla.feature.search.SearchTab
import org.shehersaaz.mohalla.feature.search.SearchViewModel
import org.shehersaaz.mohalla.feature.search.isSearchable
import org.shehersaaz.mohalla.feature.search.toSearchFailure

/**
 * Search (SEARCH-FR-001…005 · PRIV-011).
 *
 * THE ASSERTION THAT MATTERS MOST IS SEARCH-FR-003's ACCEPTANCE CRITERION:
 *
 *   "GIVEN the search service is unavailable WHEN a query is submitted THEN an
 *   explicit service-unavailable state is shown and NEVER an empty-results
 *   state."
 *
 * This is the screen people use to ask "did anyone raise this before?", and a
 * zero-results page after an outage answers "no" to a question nobody asked it.
 * So `isEmpty` is false whenever a failure is present, and false again when no
 * request has come back — asserted separately, because either condition alone
 * would let the defect through.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class SearchTest {

    private val dispatcher = StandardTestDispatcher()

    @Before fun setUp() = Dispatchers.setMain(dispatcher)

    @After fun tearDown() = Dispatchers.resetMain()

    private fun person(id: String) =
        PublicProfileResponse(userId = id, username = id, displayName = "Person $id")

    private fun post(id: String) = FeedItemResponse(
        id = id,
        author = person("author"),
        body = "Post $id",
        createdAt = "2026-09-01T10:00:00Z",
    )

    private fun event(id: String) = EventResponse(
        id = id,
        creatorId = "creator",
        title = "Event $id",
        description = "Description",
        startsAt = "2026-09-14T04:00:00Z",
        eventType = "PHYSICAL",
        status = "SCHEDULED",
        createdAt = "2026-09-01T10:00:00Z",
    )

    private class Script(
        val peoplePages: MutableList<ApiResult<PeoplePage>> = mutableListOf(),
        val postPages: MutableList<ApiResult<PostsPage>> = mutableListOf(),
        val eventPages: MutableList<ApiResult<EventsPage>> = mutableListOf(),
    ) : SearchSource {
        /** Every query sent, so a debounce can be proved rather than assumed. */
        val peopleQueries = mutableListOf<Pair<String, Int?>>()
        val postQueries = mutableListOf<Pair<String, Int?>>()
        val eventQueries = mutableListOf<Pair<String, Int?>>()

        override suspend fun people(query: String, offset: Int?): ApiResult<PeoplePage> {
            peopleQueries += query to offset
            return peoplePages.removeFirstOrNull() ?: ApiResult.Ok(PeoplePage(emptyList(), null))
        }

        override suspend fun posts(query: String, offset: Int?): ApiResult<PostsPage> {
            postQueries += query to offset
            return postPages.removeFirstOrNull() ?: ApiResult.Ok(PostsPage(emptyList(), null))
        }

        override suspend fun events(query: String, offset: Int?): ApiResult<EventsPage> {
            eventQueries += query to offset
            return eventPages.removeFirstOrNull() ?: ApiResult.Ok(EventsPage(emptyList(), null))
        }
    }

    /** An in-memory stand-in for the Keystore-backed store. */
    private class MemoryStorage : org.shehersaaz.mohalla.core.storage.SecureStorage {
        private val map = mutableMapOf<String, String>()
        override fun putString(key: String, value: String) { map[key] = value }
        override fun getString(key: String): String? = map[key]
        override fun remove(key: String) { map.remove(key) }
        override fun clear() = map.clear()
    }

    private fun searchVm(
        script: Script,
        recents: RecentSearches = RecentSearches(MemoryStorage()),
    ) = SearchViewModel(source = script, recents = recents)

    // -------------------------------------------------- failed versus empty
    @Test
    fun `AN UNAVAILABLE SERVICE IS NEVER AN EMPTY-RESULTS STATE`() = runTest(dispatcher) {
        // SEARCH-FR-003's acceptance criterion, and the reason it exists: a
        // zero-results page after an outage tells somebody the content does not
        // exist. On the screen people use to ask "did anyone raise this
        // before?", that is a lie with consequences.
        val script = Script(
            peoplePages = mutableListOf(ApiResult.Err(ApiFailure.Server("Search is temporarily unavailable."))),
        )
        val vm = searchVm(script)

        vm.submit("pani")
        advanceUntilIdle()

        val tab = vm.state.value.people
        assertFalse("a failed search must never render as 'nothing found'", tab.isEmpty)
        assertTrue(tab.failure is SearchFailure.Unavailable)
        assertFalse(tab.searched)
    }

    @Test
    fun `AN OFFLINE SEARCH IS ALSO NEVER AN EMPTY-RESULTS STATE`() = runTest(dispatcher) {
        val script = Script(peoplePages = mutableListOf(ApiResult.Err(ApiFailure.Offline)))
        val vm = searchVm(script)

        vm.submit("pani")
        advanceUntilIdle()

        assertFalse(vm.state.value.people.isEmpty)
        assertEquals(SearchFailure.Offline, vm.state.value.people.failure)
    }

    @Test
    fun `A SUCCESSFUL SEARCH WITH NOTHING IN IT IS EMPTY`() = runTest(dispatcher) {
        // The one case where "nothing found" is the truth — and the only case
        // where §21's advice to try the other spelling makes sense.
        val script = Script(peoplePages = mutableListOf(ApiResult.Ok(PeoplePage(emptyList(), null))))
        val vm = searchVm(script)

        vm.submit("zzzzz")
        advanceUntilIdle()

        assertTrue(vm.state.value.people.isEmpty)
        assertNull(vm.state.value.people.failure)
        assertTrue(vm.state.value.people.searched)
    }

    @Test
    fun `A TAB THAT HAS NEVER BEEN ASKED IS NOT EMPTY EITHER`() = runTest(dispatcher) {
        // Three states, not two: never asked, asked and found nothing, and
        // failed. Only the middle one may say "nothing found".
        val script = Script(peoplePages = mutableListOf(ApiResult.Ok(PeoplePage(listOf(person("a")), null))))
        val vm = searchVm(script)

        vm.submit("pani")
        advanceUntilIdle()

        // People was searched; Posts was not.
        assertTrue(vm.state.value.people.hasResults)
        assertFalse("an unasked tab must not claim to be empty", vm.state.value.posts.isEmpty)
        assertFalse(vm.state.value.posts.searched)
    }

    @Test
    fun `A REFUSED QUERY IS ITS OWN STATE, AND CARRIES THE SERVER'S MESSAGE`() {
        // SEARCH-FR-003 E2 asks for the minimum to be STATED. The server's own
        // copy does that, so it is shown as sent rather than replaced.
        val failure = ApiFailure.Validation(
            message = "Enter at least 2 characters to search.",
            fieldErrors = mapOf("q" to "MIN_LENGTH_2"),
            code = "SEARCH_QUERY_TOO_SHORT",
        ).toSearchFailure()

        assertTrue(failure is SearchFailure.QueryRefused)
        assertEquals(
            "Enter at least 2 characters to search.",
            (failure as SearchFailure.QueryRefused).message,
        )
    }

    @Test
    fun `a 503 and a 500 both mean the service could not look`() {
        // Both arrive as `Server`, and the screen needs no finer distinction:
        // "we could not look" is the whole message, and both are retryable.
        assertTrue(ApiFailure.Server("unavailable").toSearchFailure() is SearchFailure.Unavailable)
        assertTrue(ApiFailure.Server(null).toSearchFailure() is SearchFailure.Unavailable)
    }

    @Test
    fun `an unrecognised failure is not silently treated as unavailable`() {
        // A rate limit or a restriction would otherwise be reported as an
        // outage, sending somebody to retry a request that will be refused
        // again for a different reason.
        val failure = ApiFailure.RateLimited("Too many searches.").toSearchFailure()
        assertTrue(failure is SearchFailure.Other)
    }

    // ------------------------------------------------------- the query rules
    @Test
    fun `THE MINIMUM MATCHES THE BACKEND`() {
        // `search-query.ts` says 2. Duplicated across a Kotlin app and a
        // TypeScript API with no shared schema, so a divergence shows up as a
        // field that refuses a query the server would have accepted.
        assertEquals(2, SEARCH_QUERY_MIN_LENGTH)
    }

    @Test
    fun `A QUERY TOO SHORT IS NOT SENT`() {
        // The server would refuse it with the minimum stated; spending a round
        // trip to be told that is a round trip wasted on a metered connection.
        assertFalse(isSearchable(""))
        assertFalse(isSearchable("p"))
        assertTrue(isSearchable("pa"))
    }

    @Test
    fun `WHITESPACE IS TRIMMED BEFORE THE LENGTH IS JUDGED`() {
        // Two spaces would otherwise pass a length check and be refused by the
        // server, and a leading space is not a character somebody meant to
        // search for.
        assertFalse(isSearchable("  "))
        assertFalse(isSearchable(" p "))
        assertTrue(isSearchable("  pa  "))
    }

    @Test
    fun `A SHORT QUERY CLEARS THE RESULTS RATHER THAN SEARCHING`() = runTest(dispatcher) {
        val script = Script(peoplePages = mutableListOf(ApiResult.Ok(PeoplePage(listOf(person("a")), null))))
        val vm = searchVm(script)

        vm.submit("pani")
        advanceUntilIdle()
        assertTrue(vm.state.value.people.hasResults)

        // Backspacing to one character returns the screen to the recent
        // searches, which is where a one-character query belongs.
        vm.onQueryChanged("p")
        advanceUntilIdle()

        assertFalse(vm.state.value.people.hasResults)
        assertTrue(vm.state.value.showingRecents)
        // And nothing further was sent.
        assertEquals(1, script.peopleQueries.size)
    }

    // -------------------------------------------------------------- debounce
    @Test
    fun `TYPING SENDS ONE REQUEST, NOT ONE PER KEYSTROKE`() = runTest(dispatcher) {
        val script = Script()
        val vm = searchVm(script)

        // "pa", "pan", "pani" in quick succession.
        vm.onQueryChanged("pa")
        advanceTimeBy(50)
        vm.onQueryChanged("pan")
        advanceTimeBy(50)
        vm.onQueryChanged("pani")
        advanceUntilIdle()

        assertEquals(
            "the debounce must collapse a burst of keystrokes into one query",
            listOf("pani" to null),
            script.peopleQueries,
        )
    }

    @Test
    fun `a submit bypasses the debounce`() = runTest(dispatcher) {
        val script = Script()
        val vm = searchVm(script)

        vm.submit("pani")
        advanceUntilIdle()

        assertEquals(listOf("pani" to null), script.peopleQueries)
    }

    // ------------------------------------------------------------------ tabs
    @Test
    fun `EACH TAB IS SEARCHED ONLY WHEN IT IS OPENED`() = runTest(dispatcher) {
        // Three simultaneous requests on a 3G connection would triple the cost
        // of one search for two results the reader has not asked to see.
        val script = Script()
        val vm = searchVm(script)

        vm.submit("pani")
        advanceUntilIdle()

        assertEquals(1, script.peopleQueries.size)
        assertTrue(script.postQueries.isEmpty())
        assertTrue(script.eventQueries.isEmpty())

        vm.selectTab(SearchTab.POSTS)
        advanceUntilIdle()

        assertEquals(1, script.postQueries.size)
        assertTrue(script.eventQueries.isEmpty())
    }

    @Test
    fun `A TAB ALREADY SEARCHED IS NOT RE-RUN`() = runTest(dispatcher) {
        // Switching back and forth on a metered connection should cost nothing.
        val script = Script()
        val vm = searchVm(script)

        vm.submit("pani")
        advanceUntilIdle()
        vm.selectTab(SearchTab.POSTS)
        advanceUntilIdle()
        vm.selectTab(SearchTab.PEOPLE)
        advanceUntilIdle()
        vm.selectTab(SearchTab.POSTS)
        advanceUntilIdle()

        assertEquals(1, script.peopleQueries.size)
        assertEquals(1, script.postQueries.size)
    }

    @Test
    fun `CHANGING THE QUERY CLEARS EVERY TAB AND RE-RUNS ONLY THE ONE IN VIEW`() =
        runTest(dispatcher) {
            // Keeping old results while new ones arrive would show answers to a
            // question the reader has stopped asking. So every tab is cleared —
            // and only the tab actually on screen is fetched again, because the
            // other two are not being looked at and would cost two round trips
            // for results nobody has asked for.
            val script = Script(
                peoplePages = mutableListOf(
                    ApiResult.Ok(PeoplePage(listOf(person("a")), null)),
                ),
                postPages = mutableListOf(
                    ApiResult.Ok(PostsPage(listOf(post("p1")), null)),
                    ApiResult.Ok(PostsPage(listOf(post("p2")), null)),
                ),
            )
            val vm = searchVm(script)

            vm.submit("pani")
            advanceUntilIdle()
            vm.selectTab(SearchTab.POSTS)
            advanceUntilIdle()
            assertEquals(listOf("p1"), vm.state.value.posts.posts.map { it.id })
            assertTrue(vm.state.value.people.hasResults)

            vm.submit("bijli")
            advanceUntilIdle()

            // Posts is in view, so it holds results for the NEW query.
            assertEquals(listOf("p2"), vm.state.value.posts.posts.map { it.id })
            assertEquals(listOf("pani" to null, "bijli" to null), script.postQueries)

            // People was cleared and NOT re-run: stale rather than wrong, and
            // opening it is what fetches for the new query.
            assertFalse(vm.state.value.people.searched)
            assertFalse(vm.state.value.people.hasResults)
            assertEquals(listOf("pani" to null), script.peopleQueries)
        }

    @Test
    fun `the tab in view when the query is submitted is the one searched`() = runTest(dispatcher) {
        val script = Script()
        val vm = searchVm(script)

        vm.selectTab(SearchTab.EVENTS)
        vm.submit("cleanup")
        advanceUntilIdle()

        assertEquals(listOf("cleanup" to null), script.eventQueries)
        assertTrue(script.peopleQueries.isEmpty())
    }

    // ------------------------------------------------------------ pagination
    @Test
    fun `RESULTS PAGE BY OFFSET, WHICH IS CORRECT FOR A RELEVANCE ORDERING`() =
        runTest(dispatcher) {
            // Every other list in the product uses a cursor. Relevance is not a
            // column, so there is no position a later page could resume from —
            // an offset is honest about being approximate where a cursor would
            // imply a stability the ordering does not have.
            val script = Script(
                peoplePages = mutableListOf(
                    ApiResult.Ok(PeoplePage(listOf(person("a")), nextOffset = 20)),
                    ApiResult.Ok(PeoplePage(listOf(person("b")), nextOffset = null)),
                ),
            )
            val vm = searchVm(script)

            vm.submit("pani")
            advanceUntilIdle()
            vm.loadMore()
            advanceUntilIdle()

            assertEquals(listOf("pani" to null, "pani" to 20), script.peopleQueries)
            assertEquals(listOf("a", "b"), vm.state.value.people.people.map { it.userId })
            assertNull(vm.state.value.people.nextOffset)
        }

    @Test
    fun `a null next offset stops paging`() = runTest(dispatcher) {
        val script = Script(
            peoplePages = mutableListOf(ApiResult.Ok(PeoplePage(listOf(person("a")), null))),
        )
        val vm = searchVm(script)

        vm.submit("pani")
        advanceUntilIdle()
        vm.loadMore()
        vm.loadMore()
        advanceUntilIdle()

        assertEquals(1, script.peopleQueries.size)
    }

    @Test
    fun `A RESULT APPEARING ON TWO PAGES IS ADDED ONCE`() = runTest(dispatcher) {
        // Offset pagination over a relevance ordering can legitimately repeat a
        // row if content changed between pages, and a duplicate key crashes a
        // LazyColumn.
        val script = Script(
            peoplePages = mutableListOf(
                ApiResult.Ok(PeoplePage(listOf(person("a")), nextOffset = 20)),
                ApiResult.Ok(PeoplePage(listOf(person("a"), person("b")), nextOffset = null)),
            ),
        )
        val vm = searchVm(script)

        vm.submit("pani")
        advanceUntilIdle()
        vm.loadMore()
        advanceUntilIdle()

        assertEquals(listOf("a", "b"), vm.state.value.people.people.map { it.userId })
    }

    @Test
    fun `a failed later page keeps what was already found`() = runTest(dispatcher) {
        val script = Script(
            peoplePages = mutableListOf(
                ApiResult.Ok(PeoplePage(listOf(person("a")), nextOffset = 20)),
                ApiResult.Err(ApiFailure.Offline),
            ),
        )
        val vm = searchVm(script)

        vm.submit("pani")
        advanceUntilIdle()
        vm.loadMore()
        advanceUntilIdle()

        assertTrue(vm.state.value.people.hasResults)
        assertEquals(SearchFailure.Offline, vm.state.value.people.failure)
        // And still not "empty", because there are results AND a failure.
        assertFalse(vm.state.value.people.isEmpty)
    }

    // ------------------------------------------- the on-device history
    @Test
    fun `A SUBMITTED QUERY IS RECORDED AND A KEYSTROKE IS NOT`() = runTest(dispatcher) {
        // A history of every prefix would fill with "p", "pa", "pan" — and
        // would record a query somebody typed and then thought better of.
        val recents = RecentSearches(MemoryStorage())
        val vm = searchVm(Script(), recents)

        vm.onQueryChanged("pani")
        advanceUntilIdle()
        assertTrue("typing must not write history", recents.all().isEmpty())

        vm.submit("pani")
        advanceUntilIdle()
        assertEquals(listOf("pani"), recents.all())
    }

    @Test
    fun `THE HISTORY KEEPS TEN, NEWEST FIRST`() {
        // SEARCH-FR-005 — "the last 10 queries".
        val recents = RecentSearches(MemoryStorage())
        (1..12).forEach { recents.add("query$it") }

        val all = recents.all()
        assertEquals(10, all.size)
        assertEquals("query12", all.first())
        assertFalse(all.contains("query1"))
        assertFalse(all.contains("query2"))
    }

    @Test
    fun `SEARCHING THE SAME THING TWICE MOVES IT UP RATHER THAN DUPLICATING`() {
        val recents = RecentSearches(MemoryStorage())
        recents.add("pani")
        recents.add("bijli")
        recents.add("pani")

        assertEquals(listOf("pani", "bijli"), recents.all())
    }

    @Test
    fun `DE-DUPLICATION IS CASE-INSENSITIVE, AND THE NEW CASING WINS`() {
        // "Pani" and "pani" are one entry — but the casing kept is the one the
        // person most recently chose to type.
        val recents = RecentSearches(MemoryStorage())
        recents.add("pani")
        recents.add("Pani")

        assertEquals(listOf("Pani"), recents.all())
    }

    @Test
    fun `a query below the minimum is never recorded`() {
        val recents = RecentSearches(MemoryStorage())
        recents.add("p")
        recents.add("  ")
        assertTrue(recents.all().isEmpty())
    }

    @Test
    fun `CLEARING LEAVES THE HISTORY EMPTY ON REOPEN`() {
        // SEARCH-FR-005's acceptance criterion, verbatim: "GIVEN a user clears
        // recent searches, WHEN they reopen search, THEN the list is empty."
        val storage = MemoryStorage()
        val recents = RecentSearches(storage)
        recents.add("pani")
        recents.add("bijli")

        recents.clear()

        // A fresh reader over the same storage — which is what reopening is.
        assertTrue(RecentSearches(storage).all().isEmpty())
    }

    @Test
    fun `ONE ENTRY CAN BE REMOVED WITHOUT DISCARDING THE REST`() {
        // Somebody who looked up a name they would rather not leave on the
        // screen of a shared phone should not have to clear everything.
        val recents = RecentSearches(MemoryStorage())
        recents.add("pani")
        recents.add("a neighbour's name")
        recents.add("bijli")

        recents.remove("a neighbour's name")

        assertEquals(listOf("bijli", "pani"), recents.all())
    }

    @Test
    fun `A QUERY WITH A COMMA SURVIVES THE ROUND TRIP`() {
        // The entries are newline-separated for exactly this reason: "water,
        // drains" is one query somebody would plausibly type, and a comma
        // separator would split it into two history rows.
        val storage = MemoryStorage()
        val recents = RecentSearches(storage)
        recents.add("water, drains")

        assertEquals(listOf("water, drains"), RecentSearches(storage).all())
    }

    @Test
    fun `SIGNING OUT TAKES THE HISTORY WITH IT`() {
        // `SecureStorage.clear()` is what SET-FR-006's sign-out calls. A history
        // left behind would offer the previous account's queries to whoever
        // signs in next — a common arrangement on a shared phone.
        val storage = MemoryStorage()
        val recents = RecentSearches(storage)
        recents.add("pani")

        storage.clear()

        assertTrue(recents.all().isEmpty())
    }

    @Test
    fun `the view model exposes and clears the history`() = runTest(dispatcher) {
        val recents = RecentSearches(MemoryStorage())
        recents.add("pani")
        val vm = searchVm(Script(), recents)

        // Read synchronously, so the first frame already offers it.
        assertEquals(listOf("pani"), vm.state.value.recents)

        vm.clearRecents()
        assertTrue(vm.state.value.recents.isEmpty())
    }

    @Test
    fun `picking a recent query runs it`() = runTest(dispatcher) {
        val script = Script()
        val recents = RecentSearches(MemoryStorage())
        recents.add("pani")
        val vm = searchVm(script, recents)

        vm.submit("pani")
        advanceUntilIdle()

        assertEquals(listOf("pani" to null), script.peopleQueries)
        assertEquals("pani", vm.state.value.query)
    }

    // ----------------------------------------------------------- cross-script
    @Test
    fun `THE CLIENT SENDS WHAT WAS TYPED AND NEVER TRANSLITERATES`() = runTest(dispatcher) {
        // SEARCH-FR-003 puts the normalisation on the SERVER, against an index
        // holding both the original text and its transliterated form. A
        // client-side romanisation would disagree with the index it is
        // querying, so the same word would match different things depending on
        // which side did the folding.
        val script = Script()
        val vm = searchVm(script)

        vm.submit("پانی")
        advanceUntilIdle()

        assertEquals(
            "the Urdu query must reach the server unchanged",
            listOf("پانی" to null),
            script.peopleQueries,
        )
    }

    @Test
    fun `a query is trimmed but not otherwise altered`() = runTest(dispatcher) {
        val script = Script()
        val vm = searchVm(script)

        vm.submit("  Pani Ka Masla  ")
        advanceUntilIdle()

        // Trimmed, and the casing left alone — the server folds case, and
        // lowercasing here would be the client doing normalisation it was told
        // not to do.
        assertEquals(listOf("Pani Ka Masla" to null), script.peopleQueries)
    }
}
