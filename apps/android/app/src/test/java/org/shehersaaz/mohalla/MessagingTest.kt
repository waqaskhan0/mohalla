package org.shehersaaz.mohalla

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runCurrent
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
import org.shehersaaz.mohalla.core.network.ConversationPreview
import org.shehersaaz.mohalla.core.network.ConversationResponse
import org.shehersaaz.mohalla.core.network.CursorCreatedAtResponse
import org.shehersaaz.mohalla.core.network.MessageResponse
import org.shehersaaz.mohalla.core.network.PublicProfileResponse
import org.shehersaaz.mohalla.core.network.UnreadCountsResponse
import org.shehersaaz.mohalla.feature.home.FeedCursor
import org.shehersaaz.mohalla.feature.messages.ChatMessage
import org.shehersaaz.mohalla.feature.messages.ConversationViewModel
import org.shehersaaz.mohalla.feature.messages.HistoryPage
import org.shehersaaz.mohalla.feature.messages.InboxPage
import org.shehersaaz.mohalla.feature.messages.InboxSection
import org.shehersaaz.mohalla.feature.messages.InboxViewModel
import org.shehersaaz.mohalla.feature.messages.MAX_NEW_REQUESTS_PER_DAY
import org.shehersaaz.mohalla.feature.messages.MESSAGE_BODY_MAX_GRAPHEMES
import org.shehersaaz.mohalla.feature.messages.MessageState
import org.shehersaaz.mohalla.feature.messages.MessagingSource
import org.shehersaaz.mohalla.feature.messages.RequestState
import org.shehersaaz.mohalla.feature.messages.SendRefusal
import org.shehersaaz.mohalla.feature.messages.mergedWith
import org.shehersaaz.mohalla.feature.messages.toChatMessage
import org.shehersaaz.mohalla.feature.messages.toSendRefusal

/**
 * Messaging (MSG-FR-001…009 · BR-024/025/027/028 · EDGE-020/021/022 · PRIV-003).
 *
 * THE TWO ASSERTIONS THAT MATTER MOST ARE BOTH REQUIREMENT TEXT.
 *
 *   MSG-FR-002 — "GIVEN a message that fails and is retried twice, WHEN the
 *   network recovers, THEN exactly one message is delivered." The client id is
 *   minted once and reused, so the server returns the original rather than
 *   creating a second. Asserted on the ids SENT, because asserting the final
 *   list would pass on a client that sent three distinct messages and rendered
 *   only the last.
 *
 *   MSG-FR-004 — "GIVEN a message delivered twice by the transport, WHEN the
 *   conversation renders, THEN it appears exactly once."
 *
 * AND ONE OF THEM IS ABOUT AN ABSENCE. BR-028 means declining produces no
 * signal to the sender, so there is nothing to observe on their side; what is
 * asserted instead is that the decline path makes exactly one call and touches
 * nothing else.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class MessagingTest {

    private val dispatcher = StandardTestDispatcher()

    @Before fun setUp() = Dispatchers.setMain(dispatcher)

    @After fun tearDown() = Dispatchers.resetMain()

    private fun serverMessage(
        id: String,
        clientId: String? = null,
        sender: String = "them",
        body: String? = "Hello",
        at: String = "2026-09-01T10:00:00Z",
        readAt: String? = null,
        mediaId: String? = null,
    ) = MessageResponse(
        id = id,
        clientMessageId = clientId,
        conversationId = "c1",
        senderId = sender,
        body = body,
        mediaId = mediaId,
        createdAt = at,
        readAt = readAt,
    )

    private fun conversation(
        id: String,
        other: String = "them",
        requestState: String? = null,
    ) = ConversationResponse(
        conversationId = id,
        otherUserId = other,
        requestState = requestState,
        lastMessageAt = "2026-09-01T10:00:00Z",
    )

    /** A scripted [MessagingSource]. Every send is recorded, in order. */
    private class Script(
        val historyPages: MutableList<ApiResult<HistoryPage>> = mutableListOf(),
        val sincePages: MutableList<ApiResult<List<MessageResponse>>> = mutableListOf(),
        val sendResults: MutableList<ApiResult<MessageResponse>> = mutableListOf(),
        val inboxPages: MutableList<ApiResult<InboxPage>> = mutableListOf(),
        val requestPages: MutableList<ApiResult<InboxPage>> = mutableListOf(),
        var counts: ApiResult<UnreadCountsResponse> = ApiResult.Ok(UnreadCountsResponse()),
        var declineResult: ApiResult<Unit> = ApiResult.Ok(Unit),
    ) : MessagingSource {
        /** THE CLIENT IDS ARE THE POINT of the retry test. */
        val sentClientIds = mutableListOf<String>()
        val sentBodies = mutableListOf<String?>()
        var markReadCalls = 0
        var declineCalls = 0
        var acceptCalls = 0
        val sinceAnchors = mutableListOf<String>()
        val inboxSections = mutableListOf<InboxSection>()

        override suspend fun open(userId: String): ApiResult<ConversationResponse> =
            ApiResult.Ok(ConversationResponse(conversationId = "c1", otherUserId = userId))

        override suspend fun inbox(
            section: InboxSection,
            before: String?,
        ): ApiResult<InboxPage> {
            inboxSections += section
            val queue = if (section == InboxSection.REQUESTS) requestPages else inboxPages
            return queue.removeFirstOrNull() ?: ApiResult.Ok(InboxPage(emptyList(), null))
        }

        override suspend fun unreadCounts() = counts

        override suspend fun history(
            conversationId: String,
            cursor: FeedCursor?,
        ): ApiResult<HistoryPage> =
            historyPages.removeFirstOrNull() ?: ApiResult.Ok(HistoryPage(emptyList(), null))

        override suspend fun since(
            conversationId: String,
            since: String,
        ): ApiResult<List<MessageResponse>> {
            sinceAnchors += since
            return sincePages.removeFirstOrNull() ?: ApiResult.Ok(emptyList())
        }

        override suspend fun send(
            conversationId: String,
            clientMessageId: String,
            body: String?,
            mediaId: String?,
        ): ApiResult<MessageResponse> {
            sentClientIds += clientMessageId
            sentBodies += body
            return sendResults.removeFirstOrNull() ?: ApiResult.Ok(
                MessageResponse(
                    id = "server-${sentClientIds.size}",
                    clientMessageId = clientMessageId,
                    conversationId = conversationId,
                    senderId = "me",
                    body = body,
                    createdAt = "2026-09-01T10:00:0${sentClientIds.size}Z",
                ),
            )
        }

        override suspend fun markRead(conversationId: String): ApiResult<Unit> {
            markReadCalls++
            return ApiResult.Ok(Unit)
        }

        override suspend fun accept(conversationId: String): ApiResult<Unit> {
            acceptCalls++
            return ApiResult.Ok(Unit)
        }

        override suspend fun decline(conversationId: String): ApiResult<Unit> {
            declineCalls++
            return declineResult
        }
    }

    private fun conversationVm(
        script: Script,
        requestState: RequestState = RequestState.NONE,
        readOnly: Boolean = false,
    ): ConversationViewModel {
        var next = 0
        return ConversationViewModel(
            messaging = script,
            conversationId = "c1",
            viewerId = { "me" },
            profiles = { ApiResult.Ok(PublicProfileResponse(userId = it, displayName = "Them")) },
            otherUserId = "them",
            requestState = requestState,
            readOnly = readOnly,
            newClientId = { "cid-${++next}" },
        )
    }

    private fun inboxVm(script: Script) = InboxViewModel(script) {
        ApiResult.Ok(PublicProfileResponse(userId = it, displayName = "Them"))
    }

    // ------------------------------------------------------------ MSG-FR-002
    @Test
    fun `A SENT MESSAGE APPEARS IMMEDIATELY IN A SENDING STATE`() = runTest(dispatcher) {
        // "It appears immediately in a sending state and resolves to sent on
        // server acknowledgement." IMMEDIATELY means before any coroutine has
        // run — so this asserts without advancing the scheduler at all.
        val vm = conversationVm(Script())
        advanceUntilIdle()

        vm.onDraftChanged("The drain is blocked again.")
        vm.send()

        val optimistic = vm.state.value.messages.single()
        assertEquals(MessageState.Sending, optimistic.state)
        assertEquals("The drain is blocked again.", optimistic.body)
        assertEquals("cid-1", optimistic.clientMessageId)
        assertTrue(optimistic.isMine)
        assertNull("not yet acknowledged", optimistic.serverId)
        // And the field is clear: the bubble is where the message lives now.
        assertEquals("", vm.state.value.draft)
    }

    @Test
    fun `THE SERVER'S COPY REPLACES THE OPTIMISTIC BUBBLE RATHER THAN JOINING IT`() =
        runTest(dispatcher) {
            // Without reconciliation the sender sees their own message twice —
            // once as they typed it and once as it came back.
            val script = Script()
            val vm = conversationVm(script)
            advanceUntilIdle()

            vm.onDraftChanged("Hello")
            vm.send()
            advanceUntilIdle()

            val message = vm.state.value.messages.single()
            assertEquals(MessageState.Sent, message.state)
            assertEquals("server-1", message.serverId)
            assertEquals("cid-1", message.clientMessageId)
        }

    @Test
    fun `A FAILED MESSAGE IS MARKED AND NEVER DROPPED`() = runTest(dispatcher) {
        // MSG-FR-002: "the message is marked failed with a retry control and is
        // never silently dropped". Somebody who typed three sentences on a bus
        // must not lose them to a tunnel.
        val script = Script(sendResults = mutableListOf(ApiResult.Err(ApiFailure.Offline)))
        val vm = conversationVm(script)
        advanceUntilIdle()

        vm.onDraftChanged("Three of us reported this.")
        vm.send()
        advanceUntilIdle()

        val message = vm.state.value.messages.single()
        assertEquals(MessageState.Failed, message.state)
        assertEquals("Three of us reported this.", message.body)
        assertTrue(message.canRetry)
        assertEquals(SendRefusal.Retryable, vm.state.value.sendRefusal)
    }

    @Test
    fun `RETRYING TWICE DELIVERS EXACTLY ONE MESSAGE`() = runTest(dispatcher) {
        // THE ACCEPTANCE CRITERION, verbatim: "GIVEN a message that fails and is
        // retried twice, WHEN the network recovers, THEN exactly one message is
        // delivered."
        //
        // The mechanism is the CLIENT ID: minted once at compose time and
        // reused on every attempt, so the server returns the original rather
        // than creating a second.
        val script = Script(
            sendResults = mutableListOf(
                ApiResult.Err(ApiFailure.Offline),
                ApiResult.Err(ApiFailure.Offline),
                // The network recovers.
                ApiResult.Ok(
                    serverMessage(id = "m1", clientId = "cid-1", sender = "me", body = "Retried"),
                ),
            ),
        )
        val vm = conversationVm(script)
        advanceUntilIdle()

        vm.onDraftChanged("Retried")
        vm.send()
        advanceUntilIdle()

        vm.retry("cid-1")
        advanceUntilIdle()

        vm.retry("cid-1")
        advanceUntilIdle()

        // THREE attempts, ONE client id. The server deduplicates on it.
        assertEquals(listOf("cid-1", "cid-1", "cid-1"), script.sentClientIds)
        // And exactly one message on screen.
        assertEquals(1, vm.state.value.messages.size)
        assertEquals(MessageState.Sent, vm.state.value.messages.single().state)
    }

    @Test
    fun `a retry reuses the body, so the reader does not retype it`() = runTest(dispatcher) {
        val script = Script(sendResults = mutableListOf(ApiResult.Err(ApiFailure.Offline)))
        val vm = conversationVm(script)
        advanceUntilIdle()

        vm.onDraftChanged("Kept")
        vm.send()
        advanceUntilIdle()

        vm.retry("cid-1")
        advanceUntilIdle()

        assertEquals(listOf("Kept", "Kept"), script.sentBodies)
    }

    @Test
    fun `only a failed message can be retried`() = runTest(dispatcher) {
        val script = Script()
        val vm = conversationVm(script)
        advanceUntilIdle()

        vm.onDraftChanged("Sent fine")
        vm.send()
        advanceUntilIdle()

        // It succeeded, so a retry must not send it a second time.
        vm.retry("cid-1")
        advanceUntilIdle()

        assertEquals(listOf("cid-1"), script.sentClientIds)
    }

    @Test
    fun `AN EMPTY OR WHITESPACE MESSAGE CANNOT BE SENT`() = runTest(dispatcher) {
        // "Empty and whitespace-only messages are refused" — enforced in the
        // state, so the send control is disabled rather than tapped and refused.
        val script = Script()
        val vm = conversationVm(script)
        advanceUntilIdle()

        vm.onDraftChanged("   \n ")
        assertFalse(vm.state.value.canSend)
        vm.send()
        advanceUntilIdle()

        assertTrue(script.sentClientIds.isEmpty())
    }

    @Test
    fun `THE LIMIT IS 2000 GRAPHEMES, SO URDU IS NOT PENALISED`() = runTest(dispatcher) {
        assertEquals(2000, MESSAGE_BODY_MAX_GRAPHEMES)

        val vm = conversationVm(Script())
        advanceUntilIdle()

        // Kaf with a kasra: ONE cluster the reader sees, TWO UTF-16 units.
        val urdu = "کِ".repeat(MESSAGE_BODY_MAX_GRAPHEMES)
        vm.onDraftChanged(urdu)

        assertTrue("the raw string is longer in UTF-16", urdu.length > MESSAGE_BODY_MAX_GRAPHEMES)
        assertEquals(MESSAGE_BODY_MAX_GRAPHEMES, vm.state.value.draftLength)
        assertFalse(vm.state.value.draftOverLimit)
        assertTrue(vm.state.value.canSend)
    }

    // ------------------------------------------------------------ MSG-FR-004
    @Test
    fun `A MESSAGE DELIVERED TWICE RENDERS ONCE`() {
        // THE ACCEPTANCE CRITERION: "GIVEN a message delivered twice by the
        // transport, WHEN the conversation renders, THEN it appears exactly
        // once." Reconciled on the server id — what a second poll, or a poll
        // landing after a send response, collides on.
        val existing = listOf(serverMessage(id = "m1").toChatMessage("me"))

        val merged = existing.mergedWith(listOf(serverMessage(id = "m1").toChatMessage("me")))

        assertEquals(1, merged.size)
        assertEquals("m1", merged.single().serverId)
    }

    @Test
    fun `AN OPTIMISTIC BUBBLE IS RECONCILED BY CLIENT ID, NOT DUPLICATED`() {
        val optimistic = ChatMessage(
            clientMessageId = "cid-1",
            serverId = null,
            senderId = "me",
            body = "Hello",
            mediaId = null,
            createdAt = "2026-09-01T09:59:59Z",
            readAt = null,
            isMine = true,
            state = MessageState.Sending,
        )

        val merged = listOf(optimistic).mergedWith(
            listOf(
                serverMessage(id = "m1", clientId = "cid-1", sender = "me").toChatMessage("me"),
            ),
        )

        assertEquals(1, merged.size)
        assertEquals("m1", merged.single().serverId)
        assertEquals(MessageState.Sent, merged.single().state)
    }

    @Test
    fun `MESSAGES ARE ORDERED BY SERVER TIMESTAMP, SO BOTH SIDES SEE ONE ORDER`() {
        // MSG-FR-004 requires it by name: "messages are ordered by server
        // timestamp so that both participants see the same order".
        val merged = emptyList<ChatMessage>().mergedWith(
            listOf(
                serverMessage(id = "later", at = "2026-09-01T12:00:00Z").toChatMessage("me"),
                serverMessage(id = "earlier", at = "2026-09-01T10:00:00Z").toChatMessage("me"),
            ),
        )

        assertEquals(listOf("earlier", "later"), merged.map { it.serverId })
    }

    @Test
    fun `THE POLL ANCHORS ON THE NEWEST SERVER TIMESTAMP, NOT ON A SENDING MESSAGE`() =
        runTest(dispatcher) {
            // A message still sending carries only the DEVICE's clock.
            // Anchoring on it would ask the server for everything after a time
            // it never stamped, skipping whatever arrived in between.
            val script = Script(
                historyPages = mutableListOf(
                    ApiResult.Ok(
                        HistoryPage(
                            listOf(serverMessage(id = "m1", at = "2026-09-01T10:00:00Z")),
                            null,
                        ),
                    ),
                ),
                // Never resolves, so the optimistic bubble stays in the list.
                sendResults = mutableListOf(ApiResult.Err(ApiFailure.Offline)),
            )
            val vm = conversationVm(script)
            advanceUntilIdle()

            vm.onDraftChanged("Still sending")
            vm.send()
            advanceUntilIdle()

            vm.startPolling()
            advanceTimeBy(ConversationViewModel.POLL_INTERVAL_MS + 1)
            runCurrent()
            vm.stopPolling()
            advanceUntilIdle()

            assertEquals(
                "the anchor must be the server's newest, not the device's clock",
                listOf("2026-09-01T10:00:00Z"),
                script.sinceAnchors,
            )
        }

    @Test
    fun `THE POLL DELIVERS WITHIN THE REQUIREMENT'S THREE SECONDS`() = runTest(dispatcher) {
        // MSG-FR-004 asks for delivery "within 3 seconds without manual
        // refresh". Two leaves headroom for the request itself.
        assertTrue(
            "the poll interval must sit under the 3s the requirement allows",
            ConversationViewModel.POLL_INTERVAL_MS < 3_000L,
        )

        val script = Script(
            historyPages = mutableListOf(
                ApiResult.Ok(HistoryPage(listOf(serverMessage(id = "m1")), null)),
            ),
            sincePages = mutableListOf(
                ApiResult.Ok(listOf(serverMessage(id = "m2", at = "2026-09-01T10:00:05Z"))),
            ),
        )
        val vm = conversationVm(script)
        advanceUntilIdle()

        vm.startPolling()
        advanceTimeBy(ConversationViewModel.POLL_INTERVAL_MS + 1)
        runCurrent()
        vm.stopPolling()
        advanceUntilIdle()

        assertEquals(listOf("m1", "m2"), vm.state.value.messages.map { it.serverId })
    }

    @Test
    fun `A STOPPED POLL MAKES NO REQUESTS`() = runTest(dispatcher) {
        // Bounded to the open, foregrounded screen: a phone in a pocket costs
        // nothing, which matters because the poll is not free on mobile data
        // (NFR-PERF-001).
        val script = Script(
            historyPages = mutableListOf(
                ApiResult.Ok(HistoryPage(listOf(serverMessage(id = "m1")), null)),
            ),
        )
        val vm = conversationVm(script)
        advanceUntilIdle()

        vm.startPolling()
        vm.stopPolling()
        advanceTimeBy(ConversationViewModel.POLL_INTERVAL_MS * 5)
        runCurrent()

        assertTrue(script.sinceAnchors.isEmpty())
    }

    @Test
    fun `a failed poll is silent`() = runTest(dispatcher) {
        // The next poll is two seconds away. An error banner appearing and
        // vanishing every two seconds on a weak connection is worse than none.
        val script = Script(
            historyPages = mutableListOf(
                ApiResult.Ok(HistoryPage(listOf(serverMessage(id = "m1")), null)),
            ),
            sincePages = mutableListOf(ApiResult.Err(ApiFailure.Offline)),
        )
        val vm = conversationVm(script)
        advanceUntilIdle()

        vm.startPolling()
        advanceTimeBy(ConversationViewModel.POLL_INTERVAL_MS + 1)
        runCurrent()
        vm.stopPolling()
        advanceUntilIdle()

        assertNull(vm.state.value.failure)
        assertNull(vm.state.value.sendRefusal)
    }

    // ------------------------------------------------------------ MSG-FR-009
    @Test
    fun `A BUBBLE'S SIDE IS DECIDED BY THE SENDER, NOT BY A CLIENT ID`() {
        // A message the viewer sent from ANOTHER DEVICE comes back with no
        // client id — that install minted it, not this one. Deriving ownership
        // from the id's presence would render the reader's own message as
        // somebody else's, which is visibly wrong to the one person who knows
        // better.
        val fromOtherDevice = serverMessage(id = "m1", clientId = null, sender = "me")
            .toChatMessage("me")
        assertTrue(fromOtherDevice.isMine)

        assertFalse(serverMessage(id = "m2", sender = "them").toChatMessage("me").isMine)
    }

    @Test
    fun `SOMEBODY ELSE'S CLIENT ID IS NOT KEPT`() {
        // The server echoes the sender's client id to BOTH participants. Kept
        // here it would be a key in the wrong person's list, and could
        // reconcile against an optimistic bubble that never existed.
        val theirs = serverMessage(id = "m1", clientId = "their-cid", sender = "them")
            .toChatMessage("me")

        assertNull(theirs.clientMessageId)
        assertEquals("m1", theirs.key)
    }

    @Test
    fun `A RECEIPT COMES ONLY FROM readAt, AND ONLY ON THE VIEWER'S OWN MESSAGE`() {
        // MSG-FR-009's receipts run one way. In a Message Request the server
        // withholds `readAt` entirely, so a request thread cannot produce a
        // receipt even by accident: "reading a request does not signal anything
        // to a stranger."
        val unread = serverMessage(id = "m1", sender = "me", readAt = null).toChatMessage("me")
        assertEquals(MessageState.Sent, unread.state)

        val read = serverMessage(id = "m2", sender = "me", readAt = "2026-09-01T11:00:00Z")
            .toChatMessage("me")
        assertEquals(MessageState.Read, read.state)

        // A receipt against a message the viewer RECEIVED is meaningless — this
        // device reporting on the reader to the reader — so a `readAt` arriving
        // on one is dropped rather than rendered.
        val theirs = serverMessage(id = "m3", sender = "them", readAt = "2026-09-01T11:00:00Z")
            .toChatMessage("me")
        assertEquals(MessageState.Sent, theirs.state)
        assertNull(theirs.readAt)
    }

    @Test
    fun `MARK-READ IS CALLED ON A REQUEST TOO, BECAUSE IT SIGNALS NOTHING`() =
        runTest(dispatcher) {
            // The server moves the read marker but derives no receipt from it
            // while the thread is a request. Suppressing the call would leave
            // the reader's OWN unread badge stuck on a thread they have read.
            val script = Script()
            conversationVm(script, requestState = RequestState.PENDING)
            advanceUntilIdle()

            assertTrue(script.markReadCalls > 0)
        }

    // ----------------------------------------------------- MSG-FR-006 · BR-025
    @Test
    fun `A BLOCK IS NEVER DISCLOSED, SO THE REFUSAL IS THE NEUTRAL ONE`() {
        // MSG-FR-006: a send after a block "is refused without disclosing the
        // block". The only reliable way not to disclose it is for the refusal
        // to be indistinguishable from every other one — so the client must not
        // try to tell them apart either.
        assertEquals(
            SendRefusal.Unavailable,
            ApiFailure.Unavailable("This content is no longer available.").toSendRefusal(),
        )
    }

    @Test
    fun `EDGE-022's READ-ONLY REFUSAL EXPLAINS ITSELF, UNLIKE THE NEUTRAL ONE`() {
        // Told plainly because it is about the CONVERSATION rather than the
        // other person's account: a neutral refusal would make a thread the
        // reader can still scroll look like one that vanished.
        assertEquals(
            SendRefusal.ReadOnly,
            ApiFailure.Validation(message = null, code = "CONVERSATION_READ_ONLY").toSendRefusal(),
        )
    }

    @Test
    fun `a read-only refusal closes the compose box and keeps the words`() = runTest(dispatcher) {
        val script = Script(
            sendResults = mutableListOf(
                ApiResult.Err(
                    ApiFailure.Validation(message = null, code = "CONVERSATION_READ_ONLY"),
                ),
            ),
        )
        val vm = conversationVm(script)
        advanceUntilIdle()

        vm.onDraftChanged("Too late")
        vm.send()
        advanceUntilIdle()

        assertTrue(vm.state.value.readOnly)
        assertFalse(vm.state.value.canSend)
        assertEquals(MessageState.Failed, vm.state.value.messages.single().state)
    }

    @Test
    fun `the new-conversation limit is stated rather than silent`() {
        // MSG-FR-005 E3 — not a disclosure about any person, but a statement
        // about the caller's own recent behaviour.
        assertEquals(10, MAX_NEW_REQUESTS_PER_DAY)

        val refusal = ApiFailure
            .RateLimited("You can start up to 10 new conversations a day.")
            .toSendRefusal()

        assertTrue(refusal is SendRefusal.RateLimited)
        assertEquals(
            "You can start up to 10 new conversations a day.",
            (refusal as SendRefusal.RateLimited).message,
        )
    }

    // ----------------------------------------------------- BR-027 · MSG-FR-005
    @Test
    fun `THE INBOX AND THE REQUESTS ARE TWO QUERIES, NEVER ONE LIST FILTERED`() =
        runTest(dispatcher) {
            // BR-027 makes them separate sections with separate counts. A
            // client-side filter would show a request in the main inbox for as
            // long as a page took to load — on a slow connection, exactly long
            // enough for the thing this requirement exists to prevent.
            val script = Script(
                inboxPages = mutableListOf(
                    ApiResult.Ok(InboxPage(listOf(conversation("accepted")), null)),
                ),
                requestPages = mutableListOf(
                    ApiResult.Ok(
                        InboxPage(listOf(conversation("pending", requestState = "PENDING")), null),
                    ),
                ),
            )
            val vm = inboxVm(script)
            advanceUntilIdle()

            assertEquals(listOf(InboxSection.CONVERSATIONS), script.inboxSections)

            vm.selectTab(InboxSection.REQUESTS)
            advanceUntilIdle()

            assertEquals(
                listOf(InboxSection.CONVERSATIONS, InboxSection.REQUESTS),
                script.inboxSections,
            )
            assertEquals(
                listOf("accepted"),
                vm.state.value.conversations.conversations.map { it.conversationId },
            )
            assertEquals(
                listOf("pending"),
                vm.state.value.requests.conversations.map { it.conversationId },
            )
        }

    @Test
    fun `THE REQUEST COUNT IS SEPARATE FROM THE ONE THAT FEEDS THE TAB BADGE`() =
        runTest(dispatcher) {
            // §14: requests "are counted separately inside the screen and never
            // contribute to this badge — a stranger must not be able to make
            // the user's navigation demand attention."
            val script = Script(
                counts = ApiResult.Ok(UnreadCountsResponse(conversations = 2, requests = 7)),
            )
            val vm = inboxVm(script)
            advanceUntilIdle()

            assertEquals(2, vm.state.value.unreadConversations)
            assertEquals(7, vm.state.value.unreadRequests)
        }

    @Test
    fun `DECLINING TELLS THE SENDER NOTHING, AND REMOVES THE ROW`() = runTest(dispatcher) {
        // BR-028: "a declined message request produces no signal to the sender,
        // because informing them invites retaliation." What can be asserted
        // from this side is that the decline path makes exactly ONE call — the
        // 204 — and does nothing else that could reach the other party.
        val script = Script(
            requestPages = mutableListOf(
                ApiResult.Ok(
                    InboxPage(listOf(conversation("pending", requestState = "PENDING")), null),
                ),
            ),
        )
        val vm = inboxVm(script)
        advanceUntilIdle()
        vm.selectTab(InboxSection.REQUESTS)
        advanceUntilIdle()

        vm.decline("pending")
        advanceUntilIdle()

        assertEquals(1, script.declineCalls)
        assertTrue(vm.state.value.requests.conversations.isEmpty())
        // NOTHING was sent, NOTHING was accepted.
        assertTrue(script.sentClientIds.isEmpty())
        assertEquals(0, script.acceptCalls)
    }

    @Test
    fun `ACCEPTING MOVES THE THREAD AND MAKES THE MAIN INBOX STALE`() = runTest(dispatcher) {
        // MSG-FR-005's acceptance criterion is that a previously pending
        // conversation is present in the main inbox afterwards.
        val script = Script(
            requestPages = mutableListOf(
                ApiResult.Ok(
                    InboxPage(listOf(conversation("pending", requestState = "PENDING")), null),
                ),
            ),
        )
        val vm = inboxVm(script)
        advanceUntilIdle()
        vm.selectTab(InboxSection.REQUESTS)
        advanceUntilIdle()

        vm.accept("pending")
        advanceUntilIdle()

        assertEquals(1, script.acceptCalls)
        assertTrue(vm.state.value.requests.conversations.isEmpty())
        // The main inbox was cleared, so opening it re-reads rather than
        // showing a list that predates the move.
        assertFalse(vm.state.value.conversations.loaded)
    }

    @Test
    fun `A FAILED DECLINE LEAVES THE ROW WHERE IT WAS`() = runTest(dispatcher) {
        // A row that vanished and came back would be worse than one that took
        // a moment.
        val script = Script(
            requestPages = mutableListOf(
                ApiResult.Ok(
                    InboxPage(listOf(conversation("pending", requestState = "PENDING")), null),
                ),
            ),
            declineResult = ApiResult.Err(ApiFailure.Offline),
        )
        val vm = inboxVm(script)
        advanceUntilIdle()
        vm.selectTab(InboxSection.REQUESTS)
        advanceUntilIdle()

        vm.decline("pending")
        advanceUntilIdle()

        assertEquals(
            listOf("pending"),
            vm.state.value.requests.conversations.map { it.conversationId },
        )
        assertTrue(vm.state.value.actionFailed)
    }

    @Test
    fun `A PENDING REQUEST OFFERS A DECISION INSTEAD OF A COMPOSE FIELD`() =
        runTest(dispatcher) {
            // Replying IS accepting, so typing a reply and only then being told
            // the thread is a request would be the wrong order.
            val vm = conversationVm(Script(), requestState = RequestState.PENDING)
            advanceUntilIdle()

            assertTrue(vm.state.value.isPendingRequest)
        }

    @Test
    fun `AN UNRECOGNISED REQUEST STATE IS TREATED AS AN ORDINARY CONVERSATION`() {
        // The permissive direction, and the safe one: an unknown state treated
        // as a request would HIDE a conversation the reader is having, while
        // one treated as normal shows a thread that is genuinely theirs.
        assertEquals(RequestState.NONE, RequestState.fromWire(null))
        assertEquals(RequestState.NONE, RequestState.fromWire("SOMETHING_NEW"))
        assertEquals(RequestState.PENDING, RequestState.fromWire("PENDING"))
        assertEquals(RequestState.DECLINED, RequestState.fromWire("DECLINED"))
    }

    // ----------------------------------------------------- empty versus failed
    @Test
    fun `A FAILED INBOX IS NEVER RENDERED AS AN EMPTY ONE`() = runTest(dispatcher) {
        // "No messages yet" after a timeout tells somebody nobody has written
        // to them.
        val vm = inboxVm(Script(inboxPages = mutableListOf(ApiResult.Err(ApiFailure.Offline))))
        advanceUntilIdle()

        assertFalse(vm.state.value.isEmpty)
        assertEquals(ApiFailure.Offline, vm.state.value.firstPageFailure)
    }

    @Test
    fun `a genuinely empty inbox is empty`() = runTest(dispatcher) {
        val vm = inboxVm(
            Script(inboxPages = mutableListOf(ApiResult.Ok(InboxPage(emptyList(), null)))),
        )
        advanceUntilIdle()

        assertTrue(vm.state.value.isEmpty)
        assertNull(vm.state.value.firstPageFailure)
    }

    @Test
    fun `THE OTHER PARTICIPANT IS RESOLVED ONCE PER DISTINCT PERSON`() = runTest(dispatcher) {
        // A list of threads among a few people should not cost one request per
        // row.
        var calls = 0
        val script = Script(
            inboxPages = mutableListOf(
                ApiResult.Ok(
                    InboxPage(
                        listOf(
                            conversation("c1", other = "alice"),
                            conversation("c2", other = "bob"),
                            conversation("c3", other = "alice"),
                        ),
                        null,
                    ),
                ),
            ),
        )
        InboxViewModel(script) { userId ->
            calls++
            ApiResult.Ok(PublicProfileResponse(userId = userId, displayName = userId))
        }
        advanceUntilIdle()

        assertEquals("three threads, two people, two requests", 2, calls)
    }

    @Test
    fun `A THREAD THAT MOVES BETWEEN PAGES IS NOT LISTED TWICE`() = runTest(dispatcher) {
        // The inbox is ordered by activity, so a thread whose last message
        // arrives between two page reads legitimately appears on both.
        val script = Script(
            inboxPages = mutableListOf(
                ApiResult.Ok(
                    InboxPage(
                        listOf(conversation("c1"), conversation("c2")),
                        "2026-09-01T09:00:00Z",
                    ),
                ),
                ApiResult.Ok(InboxPage(listOf(conversation("c2"), conversation("c3")), null)),
            ),
        )
        val vm = inboxVm(script)
        advanceUntilIdle()

        vm.loadMore()
        advanceUntilIdle()

        assertEquals(
            listOf("c1", "c2", "c3"),
            vm.state.value.conversations.conversations.map { it.conversationId },
        )
    }

    // -------------------------------------------------------------- PRIV-003
    @Test
    fun `NOTHING IN THIS MODULE CARRIES A PHONE NUMBER`() {
        // PRIV-003 is why this feature exists at all: "mobile numbers, email
        // addresses and dates of birth are never visible to another user, in
        // any surface, at any time. This is the platform's single most
        // important privacy improvement over the WhatsApp-group status quo it
        // replaces." Two neighbours organise about a blocked drain without
        // either of them handing over a number — so the types they exchange
        // have nowhere to put one, and a field added under ANY name fails here.
        assertExactFields(
            ConversationResponse::class.java,
            setOf(
                "conversationId", "otherUserId", "requestState", "unreadCount",
                "lastMessageAt", "preview", "readOnly", "createdAt",
            ),
            "PRIV-003 — a conversation row identifies the other participant by ID alone; " +
                "their name is resolved through the public profile, which carries no contact " +
                "detail either",
        )

        assertExactFields(
            ConversationPreview::class.java,
            setOf("body", "hasMedia", "senderId"),
            "PRIV-003 — the inbox preview is the message's own text and nothing about the " +
                "person who sent it",
        )

        assertExactFields(
            MessageResponse::class.java,
            setOf(
                "id", "clientMessageId", "conversationId", "senderId", "body",
                "mediaId", "createdAt", "readAt",
            ),
            "PRIV-003 — a message carries a sender ID, never a sender's contact details. " +
                "MSG-FR-009 — `readAt` is the ONLY receipt: there is deliberately no " +
                "`deliveredAt`, because no such signal exists and inventing one would be a " +
                "client fabricating a claim about the other person's device",
        )

        assertExactFields(
            UnreadCountsResponse::class.java,
            setOf("conversations", "requests"),
            "BR-027 — two counts kept apart, so the request count can never reach the bottom " +
                "bar: §14, 'a stranger must not be able to make the user's navigation demand " +
                "attention'",
        )
    }

    @Test
    fun `THE HISTORY CURSOR IS NAMED FOR ITS SPELLING, BECAUSE THE ROUTES DIFFER`() {
        // Keyset routes spell one idea three ways: the feed and the comment
        // thread return `{createdAt, id}`, the events list `{cursorStartsAt,
        // cursorId}`, and message history `{cursorCreatedAt, cursorId}`.
        // Borrowing a neighbouring type looks harmless and is not — the field
        // simply never deserialises, and the first read PAST the newest thirty
        // messages fails, on long threads only.
        assertExactFields(
            CursorCreatedAtResponse::class.java,
            setOf("cursorCreatedAt", "cursorId"),
            "the keyset cursor as the server spells it on this route",
        )
    }
}
