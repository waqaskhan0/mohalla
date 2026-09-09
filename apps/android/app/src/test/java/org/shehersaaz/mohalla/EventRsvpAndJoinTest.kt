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
import org.shehersaaz.mohalla.core.network.ApiErrorBody
import org.shehersaaz.mohalla.core.network.ApiFailure
import org.shehersaaz.mohalla.core.network.ApiResult
import org.shehersaaz.mohalla.core.network.EventResponse
import org.shehersaaz.mohalla.core.network.PublicProfileResponse
import org.shehersaaz.mohalla.core.network.RsvpResponse
import org.shehersaaz.mohalla.feature.events.CancelOutcome
import org.shehersaaz.mohalla.feature.events.EventChanges
import org.shehersaaz.mohalla.feature.events.EventCursor
import org.shehersaaz.mohalla.feature.events.EventDetailViewModel
import org.shehersaaz.mohalla.feature.events.EventDraft
import org.shehersaaz.mohalla.feature.events.EventPage
import org.shehersaaz.mohalla.feature.events.EventSource
import org.shehersaaz.mohalla.feature.events.EventsTab
import org.shehersaaz.mohalla.feature.events.EventsViewModel
import org.shehersaaz.mohalla.feature.events.JoinOutcome
import org.shehersaaz.mohalla.feature.events.JoinRefusal
import org.shehersaaz.mohalla.feature.events.RsvpRefusal
import org.shehersaaz.mohalla.feature.events.toJoinRefusal
import org.shehersaaz.mohalla.feature.events.toRsvpRefusal

/**
 * RSVP, the join gate, and the cancel-or-delete outcome.
 *
 * THE JOIN GATE IS THE MOST SECURITY-SENSITIVE THING IN THIS EPIC.
 * EVENT-FR-003 withholds the meeting link from anybody who has not responded,
 * and from everybody until thirty minutes before the start, "which limits
 * scraping of open meeting rooms". A room link is a credential — anybody holding
 * it can walk in — and the people most likely to be targeted are the ones
 * organising a neighbourhood meeting about something contentious. So these tests
 * assert what the client must NOT do as much as what it does.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class EventRsvpAndJoinTest {

    private val dispatcher = StandardTestDispatcher()

    @Before fun setUp() = Dispatchers.setMain(dispatcher)

    @After fun tearDown() = Dispatchers.resetMain()

    private fun event(
        id: String = "e1",
        creatorId: String = "someone-else",
        myResponse: String? = null,
        going: Int = 0,
        interested: Int = 0,
        type: String = "ONLINE",
        status: String = "SCHEDULED",
        joinAvailable: Boolean = false,
        joinFrom: String? = null,
    ) = EventResponse(
        id = id,
        creatorId = creatorId,
        title = "Budget meeting",
        description = "A discussion of the union council budget.",
        startsAt = "2026-09-14T04:00:00Z",
        eventType = type,
        locationText = if (type == "PHYSICAL") "Model Town Park" else null,
        status = status,
        goingCount = going,
        interestedCount = interested,
        joinLinkAvailable = joinAvailable,
        joinLinkAvailableFrom = joinFrom,
        myResponse = myResponse,
        createdAt = "2026-09-01T10:00:00Z",
    )

    /** A scripted [EventSource]. See `FeedPagingTest` for why a script, not a mock. */
    private class Script(
        var detail: ApiResult<EventResponse>,
        var rsvpResult: ApiResult<EventResponse>? = null,
        var withdrawResult: ApiResult<EventResponse>? = null,
        var joinResult: ApiResult<String> = ApiResult.Ok("https://meet.example.org/room"),
        var cancelResult: ApiResult<CancelOutcome> = ApiResult.Ok(CancelOutcome(false, 0)),
        val upcomingPages: MutableList<ApiResult<EventPage>> = mutableListOf(),
        val minePages: MutableList<ApiResult<EventPage>> = mutableListOf(),
    ) : EventSource {
        val rsvpCalls = mutableListOf<RsvpResponse>()
        var withdrawCalls = 0
        var joinCalls = 0
        var creatorCalls = 0
        val byCreatorIds = mutableListOf<String>()
        val requestedCursors = mutableListOf<EventCursor?>()

        override suspend fun upcoming(cursor: EventCursor?): ApiResult<EventPage> {
            requestedCursors += cursor
            return upcomingPages.removeFirstOrNull() ?: ApiResult.Ok(EventPage(emptyList(), null))
        }

        override suspend fun byCreator(
            userId: String,
            cursor: EventCursor?,
        ): ApiResult<EventPage> {
            byCreatorIds += userId
            requestedCursors += cursor
            return minePages.removeFirstOrNull() ?: ApiResult.Ok(EventPage(emptyList(), null))
        }

        override suspend fun detail(eventId: String) = detail

        override suspend fun creator(userId: String): ApiResult<PublicProfileResponse> {
            creatorCalls++
            return ApiResult.Ok(
                PublicProfileResponse(
                    userId = userId,
                    displayName = "Green Lahore",
                    verifiedBadge = true,
                ),
            )
        }

        override suspend fun rsvp(
            eventId: String,
            response: RsvpResponse,
        ): ApiResult<EventResponse> {
            rsvpCalls += response
            return rsvpResult ?: detail
        }

        override suspend fun withdrawRsvp(eventId: String): ApiResult<EventResponse> {
            withdrawCalls++
            return withdrawResult ?: detail
        }

        override suspend fun join(eventId: String): ApiResult<String> {
            joinCalls++
            return joinResult
        }

        override suspend fun create(draft: EventDraft) = detail

        override suspend fun update(eventId: String, changes: EventChanges) = detail

        override suspend fun cancel(eventId: String) = cancelResult
    }

    // ------------------------------------------------------------- the gate
    @Test
    fun `AN EVENT BODY CARRIES EXACTLY THESE FIELDS AND NO OTHERS`() {
        // TWO REQUIREMENTS AT ONCE, and both are absences:
        //
        //   EVENT-FR-003 — no meeting credential. The link arrives only from
        //   `POST /events/{id}/join`, so no screen, log, cache or crash report
        //   can contain one by accident. It is not "hidden in the UI"; it is
        //   absent from the type.
        //
        //   EVENT-FR-004 — no attendee identity. The list is not shown in V1
        //   (ARCH-CONFLICT-006 / D-17), so the prototype's avatar stack cannot
        //   be built: there is nothing to build it from.
        //
        // ASSERTED AS AN EXACT SET, not as an absence of guessed names. The
        // earlier version of this test checked that no field name CONTAINED
        // "meeting" — and a measurement proved it worthless: fields called
        // `roomUrl` and `participantIds` were added to this very class and all
        // 271 tests still passed. Naming the complete allowed set means any
        // addition fails and the message names it.
        assertExactFields(
            type = EventResponse::class.java,
            expected = setOf(
                "id", "creatorId", "title", "description", "startsAt", "eventType",
                "locationText", "categorySlug", "status",
                // Aggregates. EVENT-FR-006 calls the count "social proof"; the
                // MEMBERSHIP behind it is what stays private.
                "goingCount", "interestedCount",
                // The server's decision about the join gate, never the link.
                "joinLinkAvailable", "joinLinkAvailableFrom",
                // The viewer's OWN response, which is theirs to know.
                "myResponse",
                "underReview", "editedAt", "createdAt",
            ),
            because = "EVENT-FR-003 keeps the meeting link out of every body except the " +
                "join route, and EVENT-FR-004 keeps attendee identities out of all of them",
        )
    }

    @Test
    fun `THE FOUR JOIN REFUSALS ARE READ FROM THE CODE, NEVER THE MESSAGE`() {
        // The message is already localised for the caller and differs between
        // English and Urdu. A client that branched on its text would work in one
        // language and fall through to the generic case in the other.
        assertEquals(
            JoinRefusal.RsvpRequired,
            ApiFailure.Restricted(message = "کوئی بھی متن", code = "RSVP_REQUIRED")
                .toJoinRefusal(),
        )

        val tooEarly = ApiFailure.Restricted(
            message = "anything",
            code = "JOIN_LINK_NOT_YET_AVAILABLE",
            details = mapOf("availableFrom" to "2026-09-14T03:30:00Z"),
        ).toJoinRefusal()
        assertEquals(JoinRefusal.TooEarly("2026-09-14T03:30:00Z"), tooEarly)

        assertEquals(
            JoinRefusal.NotOnline,
            ApiFailure.Validation(message = null, code = "NOT_AN_ONLINE_EVENT").toJoinRefusal(),
        )
        assertEquals(
            JoinRefusal.Cancelled,
            ApiFailure.Validation(message = null, code = "EVENT_CANCELLED").toJoinRefusal(),
        )
    }

    @Test
    fun `A MISSING EVENT STAYS NEUTRAL EVEN THOUGH THE OTHER REFUSALS DO NOT`() {
        // The one exception to this epic's unusual candour. 403 concerns
        // permission on an already-public event and discloses nothing; 404
        // concerns EXISTENCE, so it collapses as it does everywhere else
        // (BR-025, mandatory test A).
        assertEquals(
            JoinRefusal.Unavailable,
            ApiFailure.Unavailable("This content is no longer available.").toJoinRefusal(),
        )
    }

    @Test
    fun `AN UNRECOGNISED 403 CODE DOES NOT BECOME A SPECIFIC REFUSAL`() {
        // A suspension is also a 403 (BR-034). Guessing it was one of the join
        // cases would tell somebody to respond to an event when the real problem
        // is their account.
        val refusal = ApiFailure.Restricted(message = "Your account is limited.")
            .toJoinRefusal()
        assertTrue(refusal is JoinRefusal.Other)
    }

    @Test
    fun `the availability time survives the 403 details`() {
        // EVENT-FR-003's acceptance criterion: "the join control is not yet
        // active AND the availability time is stated". The time arrives inside
        // `details[]`, so `ApiFailure.Restricted` has to carry them — which is
        // the one place a non-404 failure keeps its payload.
        val failure = ApiFailure.Restricted(
            message = "The joining link opens 30 minutes before the event starts.",
            code = "JOIN_LINK_NOT_YET_AVAILABLE",
            details = mapOf("availableFrom" to "2026-09-14T03:30:00Z"),
        )
        val refusal = failure.toJoinRefusal() as JoinRefusal.TooEarly
        assertEquals("2026-09-14T03:30:00Z", refusal.availableFromIso)
    }

    @Test
    fun `THE LINK IS DELIVERED ONCE AND CLEARED, NEVER PARKED IN STATE`() = runTest(dispatcher) {
        val script = Script(detail = ApiResult.Ok(event(joinAvailable = true)))
        val vm = EventDetailViewModel(script, "e1") { "me" }
        advanceUntilIdle()

        vm.join()
        advanceUntilIdle()

        val outcome = vm.state.value.joinOutcome
        assertTrue(outcome is JoinOutcome.Open)
        assertEquals("https://meet.example.org/room", (outcome as JoinOutcome.Open).meetingUrl)

        // The screen hands it to the system and clears it. Leaving it would
        // relaunch the browser on the next recomposition and keep a credential
        // alive in memory for the life of the screen.
        vm.onJoinHandled()
        assertNull(vm.state.value.joinOutcome)
    }

    @Test
    fun `A REFUSED JOIN NEVER LEAVES A LINK BEHIND`() = runTest(dispatcher) {
        val script = Script(
            detail = ApiResult.Ok(event()),
            joinResult = ApiResult.Err(
                ApiFailure.Restricted(message = null, code = "RSVP_REQUIRED"),
            ),
        )
        val vm = EventDetailViewModel(script, "e1") { "me" }
        advanceUntilIdle()

        vm.join()
        advanceUntilIdle()

        val outcome = vm.state.value.joinOutcome
        assertEquals(JoinOutcome.Refused(JoinRefusal.RsvpRequired), outcome)
        assertFalse(outcome is JoinOutcome.Open)
    }

    @Test
    fun `THE JOIN CONTROL FOLLOWS THE SERVER, NOT THE DEVICE CLOCK`() = runTest(dispatcher) {
        // A device half an hour fast would show a button the server refuses; one
        // behind would hide a link that works. `joinLinkAvailable` is the only
        // input, and the ViewModel never compares `startsAt` to a clock.
        val script = Script(detail = ApiResult.Ok(event(joinAvailable = false)))
        val vm = EventDetailViewModel(script, "e1") { "me" }
        advanceUntilIdle()

        assertFalse(vm.state.value.event!!.joinLinkAvailable)
        // The control is still SHOWN — in its not-yet state — because
        // EVENT-FR-003 asks for the time to be stated rather than for the
        // control to vanish.
        assertTrue(vm.state.value.showsJoinControl)
    }

    @Test
    fun `a physical event has no join control at all`() = runTest(dispatcher) {
        val script = Script(detail = ApiResult.Ok(event(type = "PHYSICAL")))
        val vm = EventDetailViewModel(script, "e1") { "me" }
        advanceUntilIdle()

        assertFalse(vm.state.value.showsJoinControl)
    }

    @Test
    fun `a cancelled online event has no join control`() = runTest(dispatcher) {
        val script = Script(
            detail = ApiResult.Ok(event(status = "CANCELLED", joinAvailable = true)),
        )
        val vm = EventDetailViewModel(script, "e1") { "me" }
        advanceUntilIdle()

        assertTrue(vm.state.value.isCancelled)
        assertFalse(vm.state.value.showsJoinControl)
        assertFalse(vm.state.value.canRespond)
    }

    // ------------------------------------------------------------------ RSVP
    @Test
    fun `THE SERVER'S COUNTS REPLACE THE CLIENT'S, NEVER ARITHMETIC`() = runTest(dispatcher) {
        // Interested → Going moves one person between two counts, and the person
        // must be COUNTED ONCE (EVENT-FR-004's acceptance criterion). Simulating
        // that on the device double-counts anybody whose previous response the
        // screen held stale. The server sends both numbers in the same response.
        val script = Script(
            detail = ApiResult.Ok(event(myResponse = "INTERESTED", going = 17, interested = 5)),
            rsvpResult = ApiResult.Ok(
                event(myResponse = "GOING", going = 18, interested = 4),
            ),
        )
        val vm = EventDetailViewModel(script, "e1") { "me" }
        advanceUntilIdle()

        vm.respond(RsvpResponse.GOING)
        advanceUntilIdle()

        val settled = vm.state.value.event!!
        assertEquals("GOING", settled.myResponse)
        assertEquals(18, settled.goingCount)
        assertEquals(4, settled.interestedCount)
        assertEquals(listOf(RsvpResponse.GOING), script.rsvpCalls)
    }

    @Test
    fun `TAPPING THE RESPONSE YOU ALREADY HOLD WITHDRAWS IT`() = runTest(dispatcher) {
        // "The user may change or withdraw the response at any time" — with two
        // controls and no third, because a dedicated Withdraw button is a third
        // target on a row that has to fit 360dp in Urdu as well as English.
        val script = Script(
            detail = ApiResult.Ok(event(myResponse = "GOING", going = 18)),
            withdrawResult = ApiResult.Ok(event(myResponse = null, going = 17)),
        )
        val vm = EventDetailViewModel(script, "e1") { "me" }
        advanceUntilIdle()

        vm.respond(RsvpResponse.GOING)
        advanceUntilIdle()

        assertEquals(1, script.withdrawCalls)
        assertTrue(script.rsvpCalls.isEmpty())
        assertNull(vm.state.value.event!!.myResponse)
    }

    @Test
    fun `a refused RSVP puts the previous response back`() = runTest(dispatcher) {
        val script = Script(
            detail = ApiResult.Ok(event(myResponse = "INTERESTED")),
            rsvpResult = ApiResult.Err(ApiFailure.Offline),
        )
        val vm = EventDetailViewModel(script, "e1") { "me" }
        advanceUntilIdle()

        vm.respond(RsvpResponse.GOING)
        advanceUntilIdle()

        // A filled Going button on a response the server refused tells somebody
        // they are expected somewhere they are not.
        assertEquals("INTERESTED", vm.state.value.event!!.myResponse)
        assertTrue(vm.state.value.refusal is RsvpRefusal.Other)
    }

    @Test
    fun `THE THREE RSVP REFUSALS LEAD TO DIFFERENT NEXT ACTIONS`() {
        // A started event and a cancelled one are told apart because they are
        // different facts about the world; the neutral one stays neutral.
        assertEquals(
            RsvpRefusal.AlreadyStarted,
            ApiFailure.Validation(message = null, code = "EVENT_HAS_STARTED").toRsvpRefusal(),
        )
        assertEquals(
            RsvpRefusal.Cancelled,
            ApiFailure.Validation(message = null, code = "EVENT_CANCELLED").toRsvpRefusal(),
        )
        assertEquals(
            RsvpRefusal.Unavailable,
            ApiFailure.Unavailable(null).toRsvpRefusal(),
        )
    }

    @Test
    fun `a second tap while an RSVP is in flight is ignored`() = runTest(dispatcher) {
        val script = Script(detail = ApiResult.Ok(event()))
        val vm = EventDetailViewModel(script, "e1") { "me" }
        advanceUntilIdle()

        vm.respond(RsvpResponse.GOING)
        vm.respond(RsvpResponse.INTERESTED)
        advanceUntilIdle()

        // Otherwise the two requests race and the server applies whichever
        // lands last — an answer the user did not choose.
        assertEquals(listOf(RsvpResponse.GOING), script.rsvpCalls)
    }

    // -------------------------------------------------------------- creator
    @Test
    fun `THE CREATOR IS FETCHED SEPARATELY AND NEVER BLOCKS THE EVENT`() =
        runTest(dispatcher) {
            // EVENT-FR-006 asks for "creator with badge" and the event body
            // carries only `creatorId`, so the name needs a second call. One per
            // DETAIL screen — never per list row, where twenty round trips would
            // cost more than the list itself on 3G.
            val script = Script(detail = ApiResult.Ok(event(creatorId = "gl")))
            val vm = EventDetailViewModel(script, "e1") { "me" }
            advanceUntilIdle()

            assertEquals(1, script.creatorCalls)
            assertEquals("Green Lahore", vm.state.value.creator?.displayName)
            assertTrue(vm.state.value.creator?.verifiedBadge == true)
        }

    @Test
    fun `the viewer's own event is marked as theirs`() = runTest(dispatcher) {
        val mine = Script(detail = ApiResult.Ok(event(creatorId = "me")))
        val vmMine = EventDetailViewModel(mine, "e1") { "me" }
        advanceUntilIdle()
        assertTrue(vmMine.state.value.isMine)

        val theirs = Script(detail = ApiResult.Ok(event(creatorId = "somebody")))
        val vmTheirs = EventDetailViewModel(theirs, "e1") { "me" }
        advanceUntilIdle()
        assertFalse(vmTheirs.state.value.isMine)
    }

    // ---------------------------------------------------------------- lists
    @Test
    fun `THE UPCOMING LIST PAGES FORWARD IN TIME`() = runTest(dispatcher) {
        // EVENT-FR-005: "soonest first" — the only ascending list in the
        // product. The cursor advances toward LATER events, which is why the
        // feed's cursor type is not reused for it.
        val cursor = EventCursor("2026-09-14T04:00:00Z", "e1")
        val script = Script(
            detail = ApiResult.Ok(event()),
            upcomingPages = mutableListOf(
                ApiResult.Ok(EventPage(listOf(event("e1")), cursor)),
                ApiResult.Ok(EventPage(listOf(event("e2")), null)),
            ),
        )
        val vm = EventsViewModel(script) { "me" }
        advanceUntilIdle()

        vm.loadMore()
        advanceUntilIdle()

        assertEquals(listOf(null, cursor), script.requestedCursors)
        assertEquals(listOf("e1", "e2"), vm.state.value.upcoming.events.map { it.id })
        assertTrue(vm.state.value.upcoming.atEnd)
    }

    @Test
    fun `MINE ASKS FOR THE VIEWER'S OWN EVENTS`() = runTest(dispatcher) {
        val script = Script(
            detail = ApiResult.Ok(event()),
            minePages = mutableListOf(
                ApiResult.Ok(EventPage(listOf(event("mine-1", creatorId = "me")), null)),
            ),
        )
        val vm = EventsViewModel(script) { "me" }
        advanceUntilIdle()

        vm.selectTab(EventsTab.MINE)
        advanceUntilIdle()

        assertEquals(listOf("me"), script.byCreatorIds)
        assertEquals(listOf("mine-1"), vm.state.value.mine.events.map { it.id })
    }

    @Test
    fun `MINE MAKES NO REQUEST WITHOUT A VIEWER ID`() = runTest(dispatcher) {
        // A missing id means the session went away between screens, which is
        // `apiCall`'s 401 path. Requesting `users//events` would be a 404 that
        // renders as an error the user cannot act on.
        val script = Script(detail = ApiResult.Ok(event()))
        val vm = EventsViewModel(script) { null }
        advanceUntilIdle()

        vm.selectTab(EventsTab.MINE)
        advanceUntilIdle()

        assertTrue(script.byCreatorIds.isEmpty())
        assertFalse(vm.state.value.loadingFirstPage)
    }

    @Test
    fun `an empty upcoming list is an invitation, not a failure`() = runTest(dispatcher) {
        val script = Script(
            detail = ApiResult.Ok(event()),
            upcomingPages = mutableListOf(ApiResult.Ok(EventPage(emptyList(), null))),
        )
        val vm = EventsViewModel(script) { "me" }
        advanceUntilIdle()

        assertTrue(vm.state.value.isEmpty)
        assertNull(vm.state.value.firstPageFailure)
    }

    @Test
    fun `A FAILED FIRST PAGE IS NEVER RENDERED AS AN EMPTY LIST`() = runTest(dispatcher) {
        val script = Script(
            detail = ApiResult.Ok(event()),
            upcomingPages = mutableListOf(ApiResult.Err(ApiFailure.Offline)),
        )
        val vm = EventsViewModel(script) { "me" }
        advanceUntilIdle()

        assertFalse(
            "a timeout must not say the neighbourhood has planned nothing",
            vm.state.value.isEmpty,
        )
        assertEquals(ApiFailure.Offline, vm.state.value.firstPageFailure)
    }

    @Test
    fun `an RSVP from a list row updates BOTH lists`() = runTest(dispatcher) {
        // The same event can sit in Upcoming and in Mine at once. Updating one
        // and not the other means switching tabs shows two different answers
        // about the viewer's own response.
        val script = Script(
            detail = ApiResult.Ok(event()),
            upcomingPages = mutableListOf(
                ApiResult.Ok(EventPage(listOf(event("shared", creatorId = "me")), null)),
            ),
            minePages = mutableListOf(
                ApiResult.Ok(EventPage(listOf(event("shared", creatorId = "me")), null)),
            ),
            rsvpResult = ApiResult.Ok(
                event("shared", creatorId = "me", myResponse = "GOING", going = 1),
            ),
        )
        val vm = EventsViewModel(script) { "me" }
        advanceUntilIdle()
        vm.selectTab(EventsTab.MINE)
        advanceUntilIdle()
        vm.selectTab(EventsTab.UPCOMING)
        advanceUntilIdle()

        vm.respond(vm.state.value.upcoming.events.first(), RsvpResponse.GOING)
        advanceUntilIdle()

        assertEquals("GOING", vm.state.value.upcoming.events.first().myResponse)
        assertEquals("GOING", vm.state.value.mine.events.first().myResponse)
    }

    // --------------------------------------------------------------- cancel
    @Test
    fun `THE CANCEL OUTCOME IS THE SERVER'S DECISION, NOT THE CREATOR'S`() {
        // EVENT-FR-007: with no RSVPs the event is deleted; once anybody has
        // committed, "deletion outright is not offered" and the event stays
        // visible and marked until its original date passes, so somebody who
        // never opened the notification still finds out. The client reports
        // which happened rather than offering two buttons.
        val deleted = CancelOutcome(deleted = true, notifiedAttendees = 0)
        val cancelled = CancelOutcome(deleted = false, notifiedAttendees = 12)

        assertTrue(deleted.deleted)
        assertEquals(0, deleted.notifiedAttendees)
        assertFalse(cancelled.deleted)
        assertEquals(12, cancelled.notifiedAttendees)
    }

    @Test
    fun `a 403 keeps its code where a 404 does not`() {
        // The asymmetry that makes this epic's candour safe, asserted at the
        // classifier rather than only at the call site.
        val restricted = ApiFailure.Restricted(
            message = "m",
            code = "RSVP_REQUIRED",
            details = mapOf("availableFrom" to "x"),
        )
        assertEquals("RSVP_REQUIRED", restricted.code)

        // The other half — that the neutral 404 carries no discriminator at all
        // — lives in `ApiFailureShapeTest`, as an EXHAUSTIVE `when` over the
        // sealed hierarchy plus an exact field set. A check for the absence of a
        // field named `code` was measured to be worthless here: adding
        // `Unavailable.reason` left every test passing.
    }

    @Test
    fun `an error body with a null path is dropped rather than keyed on blank`() {
        // A detail keyed on "" would never be found by a form looking up by
        // path, and one with a null message would render blank under a field
        // that is actually fine.
        val body = ApiErrorBody(
            code = "VALIDATION_FAILED",
            details = listOf(
                org.shehersaaz.mohalla.core.network.ApiErrorDetail(path = null, message = "x"),
                org.shehersaaz.mohalla.core.network.ApiErrorDetail(path = "title", message = null),
                org.shehersaaz.mohalla.core.network.ApiErrorDetail(
                    path = "startsAt",
                    message = "MUST_BE_IN_THE_FUTURE",
                ),
            ),
        )
        // Exercised through the public failure type, since the mapper is private.
        assertEquals(3, body.details?.size)
    }
}
