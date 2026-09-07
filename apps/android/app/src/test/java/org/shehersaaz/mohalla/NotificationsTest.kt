package org.shehersaaz.mohalla

import java.time.ZoneId
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
import org.shehersaaz.mohalla.core.format.Ago
import org.shehersaaz.mohalla.core.format.NotificationDay
import org.shehersaaz.mohalla.core.format.RelativeTime
import org.shehersaaz.mohalla.core.network.ApiFailure
import org.shehersaaz.mohalla.core.network.ApiResult
import org.shehersaaz.mohalla.core.network.NotificationResponse
import org.shehersaaz.mohalla.core.network.PublicProfileResponse
import org.shehersaaz.mohalla.feature.home.FeedCursor
import org.shehersaaz.mohalla.feature.notifications.AppNotification
import org.shehersaaz.mohalla.feature.notifications.NotificationCategory
import org.shehersaaz.mohalla.feature.notifications.NotificationDestination
import org.shehersaaz.mohalla.feature.notifications.NotificationPage
import org.shehersaaz.mohalla.feature.notifications.NotificationPreferencesViewModel
import org.shehersaaz.mohalla.feature.notifications.NotificationSource
import org.shehersaaz.mohalla.feature.notifications.NotificationTargetType
import org.shehersaaz.mohalla.feature.notifications.NotificationsViewModel
import org.shehersaaz.mohalla.feature.notifications.PushCategory
import org.shehersaaz.mohalla.feature.notifications.toAppNotification

/**
 * Notifications (NOTIF-FR-001…007 · BR-027 · PRIV-015 · LOCALE-FR-002).
 *
 * THE REQUIREMENT THAT SHAPES EVERY OTHER ONE IS THAT THE CENTRE ALWAYS HAS
 * EVERYTHING. NOTIF-FR-001: "GIVEN a user who denied the push permission, WHEN
 * someone comments on their post, THEN the notification is present in the in-app
 * centre." NOTIF-FR-007: "GIVEN like notifications are disabled, WHEN a like
 * occurs, THEN no push is sent but the entry appears in the in-app centre."
 *
 * Both are the same claim from opposite ends — a preference and a permission
 * cost the BUZZ, never the RECORD — and both are asserted here structurally
 * rather than behaviourally: the request carries no filter, the response type has
 * no field saying whether a push happened, and no code path in the module can
 * therefore drop a row for either reason. That is a stronger guarantee than a
 * test of one scenario, because it cannot be satisfied by a special case.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class NotificationsTest {

    private val dispatcher = StandardTestDispatcher()
    private val karachi: ZoneId = ZoneId.of("Asia/Karachi")

    @Before fun setUp() = Dispatchers.setMain(dispatcher)

    @After fun tearDown() = Dispatchers.resetMain()

    private fun response(
        id: String,
        category: String = "COMMENT",
        actorId: String? = "alice",
        targetType: String = "POST",
        targetId: String? = "p1",
        text: String = "Sana Bashir commented on your post",
        batchCount: Int = 1,
        readAt: String? = null,
        createdAt: String = "2026-09-07T10:00:00Z",
    ) = NotificationResponse(
        id = id,
        category = category,
        actorId = actorId,
        targetType = targetType,
        targetId = targetId,
        text = text,
        batchCount = batchCount,
        readAt = readAt,
        createdAt = createdAt,
    )

    private class Script(
        val pages: MutableList<ApiResult<NotificationPage>> = mutableListOf(),
        var count: ApiResult<Int> = ApiResult.Ok(0),
        var preferences: ApiResult<Map<PushCategory, Boolean>> =
            ApiResult.Ok(PushCategory.entries.associateWith { true }),
        var setResult: ApiResult<Unit> = ApiResult.Ok(Unit),
    ) : NotificationSource {
        val locales = mutableListOf<String>()
        val cursors = mutableListOf<FeedCursor?>()

        /** Every batch of ids passed to `markRead`, in order. */
        val marked = mutableListOf<List<String>>()
        var markAllCalls = 0
        val written = mutableListOf<Pair<PushCategory, Boolean>>()

        override suspend fun list(
            locale: String,
            cursor: FeedCursor?,
        ): ApiResult<NotificationPage> {
            locales += locale
            cursors += cursor
            return pages.removeFirstOrNull() ?: ApiResult.Ok(NotificationPage(emptyList(), null))
        }

        override suspend fun unreadCount() = count

        override suspend fun markRead(ids: List<String>): ApiResult<Int> {
            marked += ids
            return ApiResult.Ok(ids.size)
        }

        override suspend fun markAllRead(): ApiResult<Int> {
            markAllCalls++
            return ApiResult.Ok(0)
        }

        override suspend fun preferences() = preferences

        override suspend fun setPreference(
            category: PushCategory,
            pushEnabled: Boolean,
        ): ApiResult<Unit> {
            written += category to pushEnabled
            return setResult
        }
    }

    private fun centreVm(
        script: Script,
        locale: String = "en",
        nowMillis: Long = instant("2026-09-07T12:00:00Z"),
    ) = NotificationsViewModel(
        notifications = script,
        locale = { locale },
        profiles = { ApiResult.Ok(PublicProfileResponse(userId = it, displayName = it)) },
        now = { nowMillis },
        zone = { karachi },
    )

    private fun instant(iso: String) = java.time.Instant.parse(iso).toEpochMilli()

    // -------------------------------------------------- NOTIF-FR-001 · FR-007
    @Test
    fun `NOTHING IN THE REQUEST OR THE RESPONSE CAN FILTER BY WHETHER A PUSH HAPPENED`() {
        // The two acceptance criteria that matter most are both about a
        // notification the user was NEVER BUZZED ABOUT still being here:
        // NOTIF-FR-001's denied permission, and NOTIF-FR-007's disabled
        // category. The guarantee is structural — there is no `pushed` flag and
        // no `deliveredAt` on the wire, so no client code can branch on one, and
        // a field added under any name fails here with the reason quoted.
        assertExactFields(
            NotificationResponse::class.java,
            setOf(
                "id", "category", "actorId", "targetType", "targetId",
                "text", "batchCount", "readAt", "createdAt",
            ),
            "NOTIF-FR-001 — 'a declined push permission degrades to in-app notifications " +
                "only'; NOTIF-FR-007 — 'the in-app centre always records everything, so " +
                "disabling push never loses information'. A field saying whether a push was " +
                "sent would invite a client to draw the distinction both requirements exist " +
                "to erase",
        )
    }

    @Test
    fun `THE CLIENT NEVER BUILDS A NOTIFICATION SENTENCE`() {
        // LOCALE-FR-002 — "the entire interface updates without reinstall". The
        // server renders each sentence at READ time in the language the request
        // named, which is why the model carries `text` and no template
        // parameters: a client-side template would be a second copy of thirteen
        // strings, and the copies would disagree the first time one was
        // reworded.
        assertExactFields(
            AppNotification::class.java,
            setOf(
                "id", "category", "actorId", "targetType", "targetId",
                "text", "batchCount", "readAt", "createdAt",
            ),
            "LOCALE-FR-002 — the sentence arrives rendered; there is deliberately nowhere " +
                "here to put an actor's name, a template key or its parameters",
        )
    }

    @Test
    fun `THE LOCALE RIDES EVERY REQUEST, NOT A STORED PREFERENCE`() = runTest(dispatcher) {
        // The client is the only party that knows what the interface is
        // displaying RIGHT NOW; the server's copy of the preference can be a
        // sync behind, and LOCALE-FR-002 promises the switch takes effect
        // immediately rather than eventually.
        val script = Script(
            pages = mutableListOf(
                ApiResult.Ok(NotificationPage(listOf(response("n1").toAppNotification()), null)),
            ),
        )
        centreVm(script, locale = "ur")
        advanceUntilIdle()

        assertEquals(listOf("ur"), script.locales)
    }

    // ------------------------------------------------------------ NOTIF-FR-002
    @Test
    fun `THE DOTS SURVIVE THE VISIT, AND LEAVING MARKS WHAT WAS SHOWN`() =
        runTest(dispatcher) {
            // The wireframe settles this by what it does NOT contain: an unread
            // dot on every row and no "Mark all read" control. Marking
            // everything on open would blank the dots before the reader looked
            // at one; marking only on tap would leave the badge lit for
            // somebody who read the list and opened nothing.
            val script = Script(
                pages = mutableListOf(
                    ApiResult.Ok(
                        NotificationPage(
                            listOf(
                                response("n1").toAppNotification(),
                                response("n2", readAt = "2026-09-07T09:00:00Z").toAppNotification(),
                                response("n3").toAppNotification(),
                            ),
                            null,
                        ),
                    ),
                ),
                count = ApiResult.Ok(2),
            )
            val vm = centreVm(script)
            advanceUntilIdle()

            // Still unread while the centre is open.
            assertEquals(
                listOf(true, false, true),
                vm.state.value.notifications.map { it.isUnread },
            )
            assertTrue(script.marked.isEmpty())

            vm.onLeave()
            advanceUntilIdle()

            // ONLY the two that were unread, and never `read-all`.
            assertEquals(listOf(listOf("n1", "n3")), script.marked)
            assertEquals(0, script.markAllCalls)
            assertEquals(0, vm.state.value.unread)
        }

    @Test
    fun `LEAVING NEVER MARKS EVERYTHING, ONLY WHAT WAS ACTUALLY LISTED`() =
        runTest(dispatcher) {
            // `read-all` would clear notifications further down a list the
            // reader never scrolled to. Somebody who opens the centre, sees
            // three new things and leaves has read three things, not ninety.
            val script = Script(
                pages = mutableListOf(
                    ApiResult.Ok(
                        NotificationPage(
                            listOf(response("n1").toAppNotification()),
                            FeedCursor("2026-09-07T09:00:00Z", "n1"),
                        ),
                    ),
                ),
                count = ApiResult.Ok(90),
            )
            val vm = centreVm(script)
            advanceUntilIdle()

            vm.onLeave()
            advanceUntilIdle()

            assertEquals(listOf(listOf("n1")), script.marked)
            assertEquals(0, script.markAllCalls)
            // 90 waiting, one read.
            assertEquals(89, vm.state.value.unread)
        }

    @Test
    fun `OPENING A ROW MARKS THAT ONE AT ONCE`() = runTest(dispatcher) {
        // A row the reader opened is read beyond argument, and waiting for the
        // round trip would leave the dot lit while the post it points at is
        // already on screen.
        val script = Script(
            pages = mutableListOf(
                ApiResult.Ok(NotificationPage(listOf(response("n1").toAppNotification()), null)),
            ),
            count = ApiResult.Ok(1),
        )
        val vm = centreVm(script)
        advanceUntilIdle()

        val destination = vm.open(vm.state.value.notifications.single())

        assertEquals(NotificationDestination.Post("p1"), destination)
        assertFalse(vm.state.value.notifications.single().isUnread)
        assertEquals(0, vm.state.value.unread)

        advanceUntilIdle()
        assertEquals(listOf(listOf("n1")), script.marked)

        // And leaving does not mark it a second time.
        vm.onLeave()
        advanceUntilIdle()
        assertEquals(1, script.marked.size)
    }

    @Test
    fun `A ROW ALREADY READ IS NOT MARKED AGAIN`() = runTest(dispatcher) {
        val script = Script(
            pages = mutableListOf(
                ApiResult.Ok(
                    NotificationPage(
                        listOf(response("n1", readAt = "2026-09-07T09:00:00Z").toAppNotification()),
                        null,
                    ),
                ),
            ),
        )
        val vm = centreVm(script)
        advanceUntilIdle()

        vm.open(vm.state.value.notifications.single())
        vm.onLeave()
        advanceUntilIdle()

        assertTrue(script.marked.isEmpty())
    }

    @Test
    fun `A ROW ARRIVING TWICE BETWEEN PAGES IS LISTED ONCE`() = runTest(dispatcher) {
        // The centre is newest-first, so a notification arriving between two
        // page reads shifts the keyset and the same row can come back on both.
        val script = Script(
            pages = mutableListOf(
                ApiResult.Ok(
                    NotificationPage(
                        listOf(response("n1").toAppNotification(), response("n2").toAppNotification()),
                        FeedCursor("2026-09-07T09:00:00Z", "n2"),
                    ),
                ),
                ApiResult.Ok(
                    NotificationPage(
                        listOf(response("n2").toAppNotification(), response("n3").toAppNotification()),
                        null,
                    ),
                ),
            ),
        )
        val vm = centreVm(script)
        advanceUntilIdle()

        vm.loadMore()
        advanceUntilIdle()

        assertEquals(listOf("n1", "n2", "n3"), vm.state.value.notifications.map { it.id })
        assertTrue(vm.state.value.atEnd)
    }

    @Test
    fun `A FAILED CENTRE IS NEVER RENDERED AS AN EMPTY ONE`() = runTest(dispatcher) {
        // "Nothing yet — when people interact with your posts, you'll see it
        // here" after a timeout tells somebody nobody has engaged with them,
        // which on this screen is a discouraging thing to say untruthfully.
        val script = Script(pages = mutableListOf(ApiResult.Err(ApiFailure.Offline)))
        val vm = centreVm(script)
        advanceUntilIdle()

        assertFalse(vm.state.value.isEmpty)
        assertEquals(ApiFailure.Offline, vm.state.value.firstPageFailure)
    }

    @Test
    fun `a genuinely empty centre is empty`() = runTest(dispatcher) {
        val script = Script(pages = mutableListOf(ApiResult.Ok(NotificationPage(emptyList(), null))))
        val vm = centreVm(script)
        advanceUntilIdle()

        assertTrue(vm.state.value.isEmpty)
        assertNull(vm.state.value.firstPageFailure)
    }

    @Test
    fun `a failed unread count leaves the badge alone rather than zeroing it`() =
        runTest(dispatcher) {
            // Zeroing on failure would tell the reader they have nothing
            // waiting, which is a claim the call just failed to verify.
            val script = Script(count = ApiResult.Err(ApiFailure.Offline))
            val vm = centreVm(script)
            advanceUntilIdle()

            assertEquals(0, vm.state.value.unread)
            assertNull("a count failure is not a screen failure", vm.state.value.firstPageFailure)
        }

    @Test
    fun `THE ACTOR'S PHOTO IS FETCHED ONCE PER DISTINCT PERSON, AND NEVER BLOCKS THE LIST`() =
        runTest(dispatcher) {
            // The sentence already names the actor, so a row whose avatar has
            // not arrived is fully readable — which is what lets these be
            // fetched after the list renders instead of before it.
            var calls = 0
            val script = Script(
                pages = mutableListOf(
                    ApiResult.Ok(
                        NotificationPage(
                            listOf(
                                response("n1", actorId = "alice").toAppNotification(),
                                response("n2", actorId = "bob").toAppNotification(),
                                response("n3", actorId = "alice").toAppNotification(),
                                // An event change has no actor at all.
                                response(
                                    "n4",
                                    category = "EVENT",
                                    actorId = null,
                                    targetType = "EVENT",
                                    targetId = "e1",
                                ).toAppNotification(),
                            ),
                            null,
                        ),
                    ),
                ),
            )
            val vm = NotificationsViewModel(
                notifications = script,
                locale = { "en" },
                profiles = { userId ->
                    calls++
                    ApiResult.Ok(PublicProfileResponse(userId = userId, displayName = userId))
                },
                now = { instant("2026-09-07T12:00:00Z") },
                zone = { karachi },
            )
            advanceUntilIdle()

            assertEquals("four rows, two people, two requests", 2, calls)
            assertEquals(4, vm.state.value.notifications.size)
        }

    // ---------------------------------------------------------- day grouping
    @Test
    fun `A NOTIFICATION AT 23-58 IS YESTERDAY AT 00-02, NOT TWO HOURS AGO`() {
        // The only interesting thing about day grouping is the boundary, and it
        // is a CALENDAR boundary rather than a rolling 24 hours: "yesterday"
        // means the day before the reader's today, which is how a person reads
        // their own day.
        //
        // Karachi is UTC+5, so 18:58Z is 23:58 local.
        val late = "2026-09-06T18:58:00Z"
        val justAfterMidnight = java.time.Instant.parse("2026-09-06T19:02:00Z").toEpochMilli()

        assertEquals(
            NotificationDay.YESTERDAY,
            RelativeTime.day(late, justAfterMidnight, karachi),
        )
        // Four minutes, by the clock.
        assertEquals(Ago.Minutes(4), RelativeTime.ago(late, justAfterMidnight, karachi))
    }

    @Test
    fun `GROUPING IS IN THE READER'S ZONE, NOT UTC`() {
        // Grouping by UTC dates would put an evening notification in Karachi
        // under "Today" for five hours after midnight had passed for the reader.
        val evening = "2026-09-06T20:00:00Z" // 01:00 on the 7th in Karachi
        val now = java.time.Instant.parse("2026-09-07T06:00:00Z").toEpochMilli()

        assertEquals(NotificationDay.TODAY, RelativeTime.day(evening, now, karachi))
        assertEquals(NotificationDay.YESTERDAY, RelativeTime.day(evening, now, ZoneId.of("UTC")))
    }

    @Test
    fun `THE SECTIONS COME OUT IN THE ORDER THE SCREEN DRAWS THEM`() = runTest(dispatcher) {
        // The server's list is newest-first and grouping preserves encounter
        // order, so Today, Yesterday and Earlier fall out without being sorted
        // into place.
        val now = instant("2026-09-07T12:00:00Z")
        val script = Script(
            pages = mutableListOf(
                ApiResult.Ok(
                    NotificationPage(
                        listOf(
                            response("today", createdAt = "2026-09-07T09:00:00Z").toAppNotification(),
                            response("yday", createdAt = "2026-09-06T09:00:00Z").toAppNotification(),
                            response("old", createdAt = "2026-08-30T09:00:00Z").toAppNotification(),
                        ),
                        null,
                    ),
                ),
            ),
        )
        val vm = centreVm(script, nowMillis = now)
        advanceUntilIdle()

        assertEquals(
            listOf(NotificationDay.TODAY, NotificationDay.YESTERDAY, NotificationDay.EARLIER),
            vm.sections().map { it.day },
        )
        assertEquals(listOf("old"), vm.sections().last().notifications.map { it.id })
    }

    @Test
    fun `A TIMESTAMP SLIGHTLY IN THE FUTURE IS TODAY AND JUST NOW`() {
        // A few seconds of skew between the device and the server is ordinary.
        // Reading it as "in -1 days" would file the newest row under EARLIER, at
        // the bottom of the screen.
        val now = instant("2026-09-07T12:00:00Z")
        val soon = "2026-09-07T12:00:30Z"

        assertEquals(NotificationDay.TODAY, RelativeTime.day(soon, now, karachi))
        assertEquals(Ago.JustNow, RelativeTime.ago(soon, now, karachi))
    }

    @Test
    fun `an unparseable timestamp yields nothing rather than throwing`() {
        assertNull(RelativeTime.day("not a date", 0L, karachi))
        assertNull(RelativeTime.ago("not a date", 0L, karachi))
    }

    @Test
    fun `the units change at the hour and at the day`() {
        val now = instant("2026-09-07T12:00:00Z")

        assertEquals(Ago.Minutes(59), RelativeTime.ago("2026-09-07T11:01:00Z", now, karachi))
        assertEquals(Ago.Hours(1), RelativeTime.ago("2026-09-07T11:00:00Z", now, karachi))
        assertEquals(Ago.Hours(23), RelativeTime.ago("2026-09-06T13:00:00Z", now, karachi))
        assertEquals(Ago.Days(2), RelativeTime.ago("2026-09-05T09:00:00Z", now, karachi))
    }

    // ------------------------------------------------------- where a row goes
    @Test
    fun `A REPLY NOTIFICATION HAS NOWHERE TO GO, AND SAYS SO BY NOT BEING TAPPABLE`() {
        // GAP-M-009. A REPLY carries the COMMENT's id, and no route in the API
        // turns a comment id into the post it belongs to — the deep link the
        // server builds for the PUSH has both halves, but the centre's body
        // carries only the comment. Opening a post chosen by guesswork would be
        // worse than a row that plainly does not offer a tap.
        val reply = response(
            "n1",
            category = "REPLY",
            targetType = "COMMENT",
            targetId = "c1",
        ).toAppNotification()

        assertEquals(NotificationCategory.REPLY, reply.category)
        assertEquals(NotificationDestination.None, reply.destination)
        assertFalse(reply.isActionable)
    }

    @Test
    fun `THE DESTINATION COMES FROM THE TARGET, NOT FROM THE CATEGORY`() {
        // A LIKE and a batched LIKE both point at a post; an EVENT notification
        // points at an event whether it was an RSVP, a change, a cancellation or
        // a reminder. Branching on the category would be four cases doing the
        // same thing, and a fifth that would be missed.
        assertEquals(
            NotificationDestination.Post("p1"),
            response("a", category = "LIKE", targetType = "POST", targetId = "p1")
                .toAppNotification().destination,
        )
        assertEquals(
            NotificationDestination.Event("e1"),
            response("b", category = "EVENT", targetType = "EVENT", targetId = "e1")
                .toAppNotification().destination,
        )
        assertEquals(
            NotificationDestination.Conversation("c1"),
            response("c", category = "MESSAGE", targetType = "CONVERSATION", targetId = "c1")
                .toAppNotification().destination,
        )
        assertEquals(
            NotificationDestination.Profile("u1"),
            response("d", category = "FOLLOW", targetType = "PROFILE", targetId = "u1")
                .toAppNotification().destination,
        )
    }

    @Test
    fun `A CATEGORY THIS CLIENT HAS NEVER HEARD OF IS STILL A ROW`() {
        // The text is rendered server-side, so an unknown category still
        // displays a correct sentence. Refusing to render it would HIDE a
        // notification the reader was meant to see, which is the one outcome
        // NOTIF-FR-001 and NOTIF-FR-007 both exist to prevent.
        val unknown = response("n1", category = "SOMETHING_NEW", targetType = "POST")
            .toAppNotification()

        assertEquals(NotificationCategory.OTHER, unknown.category)
        assertEquals("Sana Bashir commented on your post", unknown.text)
        assertEquals(NotificationDestination.Post("p1"), unknown.destination)
    }

    @Test
    fun `an unknown target has nowhere to go`() {
        val unknown = response("n1", targetType = "SOMETHING_NEW").toAppNotification()

        assertEquals(NotificationTargetType.UNKNOWN, unknown.targetType)
        assertEquals(NotificationDestination.None, unknown.destination)
    }

    @Test
    fun `a target type with no id has nowhere to go`() {
        assertEquals(
            NotificationDestination.None,
            response("n1", targetType = "POST", targetId = null).toAppNotification().destination,
        )
    }

    @Test
    fun `NOTIF-FR-003's BATCHED LIKES ARE ONE ROW CARRYING A COUNT`() {
        // "GIVEN a post receives 12 likes within one hour, WHEN notifications
        // are delivered, THEN the user receives a summary rather than 12
        // separate alerts." The batching is the server's; what the client owes
        // is to render the summary as one row.
        val summary = response(
            "n1",
            category = "LIKE",
            batchCount = 12,
            text = "Sana Bashir and 11 others liked your post",
        ).toAppNotification()

        assertTrue(summary.isBatched)
        assertEquals(12, summary.batchCount)
    }

    @Test
    fun `a zero or negative batch count is treated as one`() {
        // A zero would make `isBatched` false and a negative would reach a
        // plural table that has no entry for it.
        assertEquals(1, response("n1", batchCount = 0).toAppNotification().batchCount)
        assertEquals(1, response("n2", batchCount = -3).toAppNotification().batchCount)
    }

    // ------------------------------------------------------------ NOTIF-FR-007
    @Test
    fun `SEVEN SWITCHES, IN THE ORDER THE REQUIREMENT NAMES THEM`() {
        // "The user enables or disables each category independently: likes,
        // comments, follows, mentions, messages, events, announcements." Seven
        // switches for EIGHT categories — a reply answers to the Comments
        // switch, because somebody who silenced comment notifications wants
        // their thread to stop buzzing and a reply is part of that thread.
        assertEquals(
            listOf("LIKE", "COMMENT", "FOLLOW", "MENTION", "MESSAGE", "EVENT", "ANNOUNCEMENT"),
            PushCategory.entries.map { it.name },
        )
        assertEquals(8, NotificationCategory.entries.size - 1)
    }

    @Test
    fun `A SWITCH THE SERVER DID NOT MENTION IS ON, NOT OFF`() = runTest(dispatcher) {
        // ENABLED is the server's own default for a preference nobody has
        // touched. Rendering a missing key as OFF would show somebody that
        // likes are silenced when the next like will buzz — and showing a
        // switch in the wrong position is worse than showing none, because the
        // reader acts on it.
        val script = Script(
            preferences = ApiResult.Ok(mapOf(PushCategory.LIKE to false)),
        )
        val vm = NotificationPreferencesViewModel(script)
        advanceUntilIdle()

        assertFalse(vm.state.value.isEnabled(PushCategory.LIKE))
        PushCategory.entries.filter { it != PushCategory.LIKE }.forEach {
            assertTrue("$it defaults to on", vm.state.value.isEnabled(it))
        }
    }

    @Test
    fun `A TOGGLE MOVES AT ONCE AND MOVES BACK IF THE SERVER REFUSED`() =
        runTest(dispatcher) {
            // A switch that waits for a round trip feels broken on a slow
            // connection; one that stays moved after a failure is a lie about
            // the account's state — and this is a setting the reader will not
            // check again.
            val script = Script(setResult = ApiResult.Err(ApiFailure.Offline))
            val vm = NotificationPreferencesViewModel(script)
            advanceUntilIdle()

            vm.toggle(PushCategory.MESSAGE)

            // Immediately, before the request has run.
            assertFalse(vm.state.value.isEnabled(PushCategory.MESSAGE))

            advanceUntilIdle()

            assertTrue("back where it was", vm.state.value.isEnabled(PushCategory.MESSAGE))
            assertTrue("and said so", vm.state.value.saveFailed)
            assertEquals(listOf(PushCategory.MESSAGE to false), script.written)
        }

    @Test
    fun `a successful toggle stays put`() = runTest(dispatcher) {
        val script = Script()
        val vm = NotificationPreferencesViewModel(script)
        advanceUntilIdle()

        vm.toggle(PushCategory.LIKE)
        advanceUntilIdle()

        assertFalse(vm.state.value.isEnabled(PushCategory.LIKE))
        assertFalse(vm.state.value.saveFailed)
        assertTrue(vm.state.value.saving.isEmpty())
    }

    @Test
    fun `one switch cannot be sent twice while its own write is in flight`() =
        runTest(dispatcher) {
            val script = Script()
            val vm = NotificationPreferencesViewModel(script)
            advanceUntilIdle()

            vm.toggle(PushCategory.EVENT)
            vm.toggle(PushCategory.EVENT)
            advanceUntilIdle()

            assertEquals(listOf(PushCategory.EVENT to false), script.written)
        }

    @Test
    fun `A FAILED READ SHOWS NO SWITCHES AT ALL`() = runTest(dispatcher) {
        // A settings screen showing seven switches in their default position
        // after a failed read is stating something about the account it never
        // learned, and the reader would take it as fact.
        val script = Script(preferences = ApiResult.Err(ApiFailure.Offline))
        val vm = NotificationPreferencesViewModel(script)
        advanceUntilIdle()

        assertFalse(vm.state.value.loaded)
        assertTrue(vm.state.value.preferences.isEmpty())
        assertEquals(ApiFailure.Offline, vm.state.value.failure)
    }
}
