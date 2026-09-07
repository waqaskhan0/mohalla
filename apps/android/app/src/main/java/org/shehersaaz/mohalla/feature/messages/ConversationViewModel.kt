package org.shehersaaz.mohalla.feature.messages

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import java.util.UUID
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import org.shehersaaz.mohalla.core.network.ApiFailure
import org.shehersaaz.mohalla.core.network.ApiResult
import org.shehersaaz.mohalla.core.network.PublicProfileResponse
import org.shehersaaz.mohalla.feature.home.FeedCursor
import org.shehersaaz.mohalla.feature.setup.graphemeLength

/**
 * One conversation — UX-MSG-003 (MSG-FR-002/004/006/008/009 · EDGE-020/021/022).
 *
 * FIVE RULES SHAPE THIS FILE.
 *
 * 1. A SENT MESSAGE APPEARS IMMEDIATELY AND IS NEVER SILENTLY DROPPED.
 *    MSG-FR-002: it "appears immediately in a sending state and resolves to
 *    sent on server acknowledgement", and a failure is "marked failed with a
 *    retry control". Somebody who typed three sentences on a bus must not lose
 *    them to a tunnel.
 *
 * 2. A RETRY MUST NOT DUPLICATE. The client id is generated once, at compose
 *    time, and REUSED on every retry — so the server returns the original
 *    message rather than creating a second. The acceptance criterion is exact:
 *    "a message that fails and is retried twice… exactly one message is
 *    delivered."
 *
 * 3. DELIVERY IS WITHIN THREE SECONDS, WITHOUT MANUAL REFRESH (MSG-FR-004).
 *    Achieved by POLLING `/messages/since` while the conversation is open,
 *    which the API names as the sanctioned fallback and which every route is
 *    built to work with. See [POLL_INTERVAL_MS].
 *
 * 4. A DUPLICATE RENDERS ONCE. Reconciliation is by client id then server id,
 *    in `mergedWith` — so a message arriving by poll after the send response
 *    already merged it replaces rather than appends.
 *
 * 5. A BLOCK IS NEVER DISCLOSED. MSG-FR-006: a send after a block "is refused
 *    without disclosing the block". The refusal arrives as the same neutral 404
 *    as every other, and this file does not try to tell them apart — from the
 *    blocked side "the conversation simply receives no replies".
 */
class ConversationViewModel(
    private val messaging: MessagingSource,
    private val conversationId: String,
    private val viewerId: () -> String?,
    private val profiles: suspend (String) -> ApiResult<PublicProfileResponse>,
    /** The other participant, when the caller already knows who it is. */
    otherUserId: String?,
    private val requestState: RequestState,
    private val readOnly: Boolean,
    /** Injected so the poll is testable without waiting in real time. */
    private val newClientId: () -> String = { UUID.randomUUID().toString() },
) : ViewModel() {

    private val _state = MutableStateFlow(
        ConversationUiState(
            otherUserId = otherUserId,
            requestState = requestState,
            readOnly = readOnly,
        ),
    )
    val state: StateFlow<ConversationUiState> = _state.asStateFlow()

    private var pollJob: Job? = null

    init {
        loadHistory()
        otherUserId?.let { loadParticipant(it) }
        markRead()
    }

    fun loadHistory() {
        _state.update { it.copy(loading = it.messages.isEmpty(), failure = null) }

        viewModelScope.launch {
            when (val result = messaging.history(conversationId, cursor = null)) {
                is ApiResult.Ok -> _state.update {
                    it.copy(
                        messages = result.value.messages.map { m -> m.toChatMessage(viewerId()) },
                        olderCursor = result.value.nextCursor,
                        loaded = true,
                        loading = false,
                    )
                }

                is ApiResult.Err -> _state.update {
                    it.copy(
                        loading = false,
                        // Neutral. A conversation hidden by a block, one whose
                        // other participant was banned, and one that never
                        // existed are one answer (MSG-FR-006, BR-025).
                        failure = result.failure,
                    )
                }
            }
        }
    }

    /** Older messages. The thread is read from the bottom, so this prepends. */
    fun loadOlder() {
        val current = _state.value
        val cursor = current.olderCursor ?: return
        if (current.loadingOlder) return

        _state.update { it.copy(loadingOlder = true) }

        viewModelScope.launch {
            when (val result = messaging.history(conversationId, cursor)) {
                is ApiResult.Ok -> _state.update { s ->
                    s.copy(
                        messages = result.value.messages
                            .map { it.toChatMessage(viewerId()) }
                            .let { older -> s.messages.mergedWith(older) },
                        olderCursor = result.value.nextCursor,
                        loadingOlder = false,
                    )
                }

                is ApiResult.Err -> _state.update {
                    it.copy(loadingOlder = false, olderFailure = result.failure)
                }
            }
        }
    }

    /**
     * MSG-FR-004 — near-real-time delivery, by polling.
     *
     * WHY POLLING RATHER THAN THE SOCKET. The API is explicit that "REST is the
     * source of truth; realtime is an accelerator… every route has to work with
     * the socket switched off", and it names `/messages/since` as the polling
     * fallback ADR-009 sanctions. The requirement asks for three seconds, not
     * instantaneity, and the SRS's own risk note says "polling is an acceptable
     * fallback at this scale".
     *
     * What a socket would add is a dependency, an auth handshake, a
     * reconnection and backoff policy, and a lifecycle to get wrong — for a
     * latency improvement below the threshold the requirement sets. The
     * deferral is recorded in `20-mobile-open-issues.md` rather than hidden.
     *
     * BOUNDED TO THE OPEN SCREEN. Started when the conversation is resumed and
     * cancelled when it is not, so a phone in a pocket makes no requests at all.
     */
    fun startPolling() {
        if (pollJob?.isActive == true) return

        pollJob = viewModelScope.launch {
            while (isActive) {
                delay(POLL_INTERVAL_MS)
                reconcile()
            }
        }
    }

    fun stopPolling() {
        pollJob?.cancel()
        pollJob = null
    }

    /**
     * Fetch everything after the newest message we hold (MSG-FR-004 E1).
     *
     * ANCHORED ON THE NEWEST SERVER TIMESTAMP, not on the device clock and not
     * on an optimistic message's timestamp — a message still sending has only
     * the local clock, and anchoring on it would skip anything the server
     * stamped in between.
     *
     * Does nothing until history has loaded, because without an anchor the only
     * honest request is for the whole thread, which `loadHistory` already made.
     */
    private suspend fun reconcile() {
        val anchor = _state.value.newestServerTimestamp ?: return

        when (val result = messaging.since(conversationId, anchor)) {
            is ApiResult.Ok -> {
                if (result.value.isEmpty()) return
                _state.update { s ->
                    s.copy(
                        messages = s.messages.mergedWith(
                            result.value.map { it.toChatMessage(viewerId()) },
                        ),
                    )
                }
                // Anything that arrived while the reader is looking at the
                // thread is read by definition.
                markRead()
            }

            // Silent. A poll that fails is a poll; the next one is two seconds
            // away, and an error banner appearing and vanishing every two
            // seconds on a weak connection is worse than nothing.
            is ApiResult.Err -> Unit
        }
    }

    fun onDraftChanged(value: String) {
        _state.update { it.copy(draft = value) }
    }

    /**
     * Send (MSG-FR-002).
     *
     * THE CLIENT ID IS MINTED HERE, ONCE. It goes into the optimistic message
     * and into the request, and a retry reuses the one already on the message —
     * which is what makes the retry idempotent rather than merely hopeful.
     */
    fun send() {
        val current = _state.value
        if (!current.canSend) return

        val body = current.draft.trim()
        val clientId = newClientId()

        val optimistic = ChatMessage(
            clientMessageId = clientId,
            serverId = null,
            senderId = viewerId().orEmpty(),
            body = body,
            mediaId = null,
            // The device's clock, so it sorts to the bottom where the person
            // who just typed it expects it. Replaced by the server's on
            // acknowledgement, which is what MSG-FR-004's shared ordering needs.
            createdAt = nowIso(),
            readAt = null,
            // Beyond doubt: the reader typed it a moment ago.
            isMine = true,
            state = MessageState.Sending,
        )

        _state.update {
            it.copy(
                messages = it.messages + optimistic,
                // Cleared IMMEDIATELY, unlike the comment composer's draft. A
                // message is expected to leave the field the moment it is sent —
                // the bubble is where it lives now, and a failed one is
                // retryable from there rather than from the field.
                draft = "",
                sendRefusal = null,
            )
        }

        deliver(clientId, body, mediaId = null)
    }

    /** MSG-FR-002 — retry ONE message, with the id it already has. */
    fun retry(clientMessageId: String) {
        val message = _state.value.messages.find { it.clientMessageId == clientMessageId }
            ?: return
        if (!message.canRetry) return

        _state.update { s ->
            s.copy(
                messages = s.messages.map {
                    if (it.clientMessageId == clientMessageId) {
                        it.copy(state = MessageState.Sending)
                    } else {
                        it
                    }
                },
                sendRefusal = null,
            )
        }

        deliver(clientMessageId, message.body, message.mediaId)
    }

    private fun deliver(clientMessageId: String, body: String?, mediaId: String?) {
        viewModelScope.launch {
            when (val result = messaging.send(conversationId, clientMessageId, body, mediaId)) {
                is ApiResult.Ok -> _state.update { s ->
                    // Merged rather than appended: the server's copy carries the
                    // same client id, so it REPLACES the optimistic bubble and
                    // takes over its position and identity.
                    s.copy(messages = s.messages.mergedWith(
                        listOf(result.value.toChatMessage(viewerId())),
                    ))
                }

                is ApiResult.Err -> {
                    val refusal = result.failure.toSendRefusal()

                    _state.update { s ->
                        s.copy(
                            messages = s.messages.map {
                                if (it.clientMessageId == clientMessageId) {
                                    // MARKED FAILED, NOT REMOVED. The words stay
                                    // on screen with a retry beside them.
                                    it.copy(state = MessageState.Failed)
                                } else {
                                    it
                                }
                            },
                            sendRefusal = refusal,
                            // EDGE-022 — the thread became read-only. The
                            // compose box closes and the reason is stated,
                            // because this is about the CONVERSATION rather than
                            // about the other person's account.
                            readOnly = s.readOnly || refusal == SendRefusal.ReadOnly,
                        )
                    }
                }
            }
        }
    }

    fun onSendRefusalAcknowledged() = _state.update { it.copy(sendRefusal = null) }

    /**
     * MSG-FR-009 — mark read.
     *
     * SAFE ON A REQUEST, and deliberately still called there. The server moves
     * the read marker but derives no receipt from it while the thread is a
     * request, so the sender learns nothing — "reading a request does not signal
     * anything to a stranger". Suppressing the call here instead would leave the
     * reader's own unread badge stuck on a thread they have read.
     */
    fun markRead() {
        viewModelScope.launch { messaging.markRead(conversationId) }
    }

    /** MSG-FR-005 — accept, and normal messaging resumes. */
    fun accept() {
        if (_state.value.acting) return
        _state.update { it.copy(acting = true) }

        viewModelScope.launch {
            when (messaging.accept(conversationId)) {
                is ApiResult.Ok -> _state.update {
                    it.copy(acting = false, requestState = RequestState.ACCEPTED)
                }
                is ApiResult.Err -> _state.update { it.copy(acting = false) }
            }
        }
    }

    /** BR-028 — decline. Nothing observable happens to the sender. */
    fun decline(onDeclined: () -> Unit) {
        if (_state.value.acting) return
        _state.update { it.copy(acting = true) }

        viewModelScope.launch {
            when (messaging.decline(conversationId)) {
                is ApiResult.Ok -> {
                    _state.update { it.copy(acting = false, declined = true) }
                    onDeclined()
                }
                is ApiResult.Err -> _state.update { it.copy(acting = false) }
            }
        }
    }

    private fun loadParticipant(userId: String) {
        viewModelScope.launch {
            when (val result = profiles(userId)) {
                is ApiResult.Ok -> _state.update { it.copy(otherUser = result.value) }
                // BR-025's neutral 404 covers deleted, banned and blocking. The
                // thread is still readable, so the header simply carries no name.
                is ApiResult.Err -> Unit
            }
        }
    }

    override fun onCleared() {
        stopPolling()
        super.onCleared()
    }

    class Factory(
        private val messaging: MessagingSource,
        private val conversationId: String,
        private val viewerId: () -> String?,
        private val profiles: suspend (String) -> ApiResult<PublicProfileResponse>,
        private val otherUserId: String?,
        private val requestState: RequestState,
        private val readOnly: Boolean,
    ) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T = ConversationViewModel(
            messaging, conversationId, viewerId, profiles, otherUserId, requestState, readOnly,
        ) as T
    }

    companion object {
        /**
         * Two seconds.
         *
         * MSG-FR-004 asks for delivery "within 3 seconds without manual
         * refresh". Two leaves headroom for the request itself on a 3G
         * connection and still meets the requirement; three would meet it only
         * when the network was instant.
         *
         * THE COST IS REAL AND IS BOUNDED DELIBERATELY. One small request every
         * two seconds is not free on Pakistani mobile data (NFR-PERF-001), so
         * the poll runs ONLY while a conversation is open and foregrounded —
         * a phone in a pocket makes none. A socket would remove even that, and
         * is the recorded next step rather than a pretence that this is free.
         */
        const val POLL_INTERVAL_MS = 2_000L
    }
}

data class ConversationUiState(
    val messages: List<ChatMessage> = emptyList(),

    val otherUserId: String? = null,
    val otherUser: PublicProfileResponse? = null,

    val requestState: RequestState = RequestState.NONE,

    /** EDGE-022 — the other account is banned or deleted. Readable, marked. */
    val readOnly: Boolean = false,

    val draft: String = "",

    val loaded: Boolean = false,
    val loading: Boolean = false,
    val loadingOlder: Boolean = false,
    val olderCursor: FeedCursor? = null,

    val failure: ApiFailure? = null,
    val olderFailure: ApiFailure? = null,
    val sendRefusal: SendRefusal? = null,

    val acting: Boolean = false,
    val declined: Boolean = false,
) {
    /** MSG-FR-002 — 2,000 grapheme clusters, so Urdu is not penalised. */
    val draftLength: Int get() = graphemeLength(draft.trim())

    val draftOverLimit: Boolean get() = draftLength > MESSAGE_BODY_MAX_GRAPHEMES

    /**
     * Whether the compose control is offered.
     *
     * EDGE-022 closes it on a read-only thread rather than leaving a field that
     * will be refused; "empty and whitespace-only messages are refused" is
     * enforced here so the send control is disabled rather than tapped.
     */
    val canSend: Boolean
        get() = draft.isNotBlank() && !draftOverLimit && !readOnly

    /**
     * The anchor for the next reconcile.
     *
     * THE NEWEST SERVER TIMESTAMP, which is not the same as the newest message:
     * a message still sending carries the device's clock, and anchoring on it
     * would ask the server for everything after a time it never stamped —
     * skipping anything that arrived in between.
     */
    val newestServerTimestamp: String?
        get() = messages
            .filter { it.serverId != null && it.state != MessageState.Sending }
            .maxByOrNull { it.createdAt }
            ?.createdAt

    /** BR-027 — a pending request offers Accept and Decline instead of a field. */
    val isPendingRequest: Boolean get() = requestState == RequestState.PENDING

    val isEmptyThread: Boolean get() = loaded && messages.isEmpty() && failure == null
}

/** ISO-8601 UTC, matching what every request body expects. */
private fun nowIso(): String = java.time.format.DateTimeFormatter.ISO_INSTANT
    .format(java.time.Instant.now())
