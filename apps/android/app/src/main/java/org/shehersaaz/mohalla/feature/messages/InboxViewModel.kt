package org.shehersaaz.mohalla.feature.messages

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import org.shehersaaz.mohalla.core.network.ApiFailure
import org.shehersaaz.mohalla.core.network.ApiResult
import org.shehersaaz.mohalla.core.network.ConversationResponse
import org.shehersaaz.mohalla.core.network.PublicProfileResponse

/**
 * The inbox and the request list — UX-MSG-001 · UX-MSG-002
 * (MSG-FR-003/005 · BR-027).
 *
 * TWO SECTIONS, TWO QUERIES, TWO COUNTS — and never one list filtered on the
 * device. BR-027 makes a first message from a non-follower a request, and
 * MSG-FR-003 makes requests "a separate section with its own count". Filtering
 * one list locally would show a request in the main inbox for as long as a page
 * took to load, which on a slow connection is exactly long enough for the thing
 * this requirement exists to prevent.
 *
 * THE REQUEST COUNT NEVER REACHES THE TAB BADGE. BR-027: "Message Requests
 * never generate a push notification", and §14 adds that requests "are counted
 * separately inside the screen and never contribute to this badge — a stranger
 * must not be able to make the user's navigation demand attention." So the
 * shell's badge is fed from `conversations` alone, and the request count lives
 * on the segmented tab where the reader chooses to look at it. The SRS calls
 * this "the platform's principal defence against unsolicited contact", and
 * notes it "matters most for women users".
 *
 * THE OTHER PARTICIPANT'S NAME NEEDS A SECOND CALL. A conversation row carries
 * `otherUserId` and nothing else about them, so the display name, photo and
 * badge are resolved through `GET /users/{id}` — batched by distinct id, so a
 * list of twenty threads with the same three people costs three requests rather
 * than twenty.
 */
class InboxViewModel(
    private val messaging: MessagingSource,
    private val profiles: suspend (String) -> ApiResult<PublicProfileResponse>,
) : ViewModel() {

    private val _state = MutableStateFlow(InboxUiState())
    val state: StateFlow<InboxUiState> = _state.asStateFlow()

    init {
        refresh()
        loadCounts()
    }

    fun selectTab(section: InboxSection) {
        if (_state.value.section == section) return
        _state.update {
            it.copy(
                section = section,
                loadingFirst = it.listFor(section).conversations.isEmpty(),
                firstPageFailure = null,
            )
        }
        if (_state.value.listFor(section).conversations.isEmpty()) refresh()
    }

    fun refresh() {
        val section = _state.value.section

        _state.update {
            it.copy(
                refreshing = it.listFor(section).conversations.isNotEmpty(),
                loadingFirst = it.listFor(section).conversations.isEmpty(),
                firstPageFailure = null,
            )
        }

        viewModelScope.launch {
            when (val result = messaging.inbox(section, before = null)) {
                is ApiResult.Ok -> {
                    _state.update {
                        it.withList(
                            section,
                            InboxList(
                                conversations = result.value.conversations,
                                nextBefore = result.value.nextBefore,
                                loaded = true,
                            ),
                        ).copy(refreshing = false, loadingFirst = false)
                    }
                    resolveParticipants(result.value.conversations)
                }

                is ApiResult.Err -> _state.update {
                    it.copy(
                        refreshing = false,
                        loadingFirst = false,
                        // Kept apart from an empty inbox, exactly as everywhere
                        // else: "no messages yet" after a timeout tells
                        // somebody nobody has written to them.
                        firstPageFailure = result.failure,
                    )
                }
            }
        }
    }

    fun loadMore() {
        val current = _state.value
        val section = current.section
        val list = current.listFor(section)
        val before = list.nextBefore ?: return
        if (list.loadingMore) return

        _state.update { it.withList(section, list.copy(loadingMore = true)) }

        viewModelScope.launch {
            when (val result = messaging.inbox(section, before = before)) {
                is ApiResult.Ok -> {
                    _state.update { s ->
                        val existing = s.listFor(section)
                        s.withList(
                            section,
                            existing.copy(
                                // De-duplicated by conversation id: a thread
                                // whose last message arrived between pages can
                                // legitimately appear twice in a list ordered
                                // by activity.
                                conversations = existing.conversations +
                                    result.value.conversations.filterNot { incoming ->
                                        existing.conversations.any {
                                            it.conversationId == incoming.conversationId
                                        }
                                    },
                                nextBefore = result.value.nextBefore,
                                loadingMore = false,
                            ),
                        )
                    }
                    resolveParticipants(result.value.conversations)
                }

                is ApiResult.Err -> _state.update { s ->
                    s.withList(
                        section,
                        s.listFor(section).copy(loadingMore = false, pageFailure = result.failure),
                    )
                }
            }
        }
    }

    /**
     * The two badges (MSG-FR-003).
     *
     * Fetched separately from the lists, because the shell's tab badge needs
     * the conversation count before the inbox screen has ever been opened.
     * A failure is SILENT: a missing badge is a cosmetic loss, and an error on
     * the shell because a count did not load would be an error on every screen
     * in the app.
     */
    fun loadCounts() {
        viewModelScope.launch {
            when (val result = messaging.unreadCounts()) {
                is ApiResult.Ok -> _state.update {
                    it.copy(
                        unreadConversations = result.value.conversations,
                        unreadRequests = result.value.requests,
                    )
                }
                is ApiResult.Err -> Unit
            }
        }
    }

    /**
     * MSG-FR-005 — accept a request.
     *
     * The thread moves to the main inbox, so it is removed from the request
     * list locally rather than by re-fetching both: the server has already
     * done it, and re-reading two lists to learn one row moved would cost two
     * round trips and reset the reader's scroll position.
     */
    fun accept(conversationId: String) {
        if (conversationId in _state.value.acting) return
        _state.update { it.copy(acting = it.acting + conversationId) }

        viewModelScope.launch {
            when (messaging.accept(conversationId)) {
                is ApiResult.Ok -> {
                    _state.update { s ->
                        s.copy(
                            requests = s.requests.copy(
                                conversations = s.requests.conversations
                                    .filterNot { it.conversationId == conversationId },
                            ),
                            // The main inbox now holds it, and is stale.
                            conversations = InboxList(),
                            acting = s.acting - conversationId,
                            unreadRequests = (s.unreadRequests - 1).coerceAtLeast(0),
                        )
                    }
                    if (_state.value.section == InboxSection.CONVERSATIONS) refresh()
                }

                is ApiResult.Err -> _state.update {
                    // Nothing moved. A row that vanished and came back would be
                    // worse than one that took a moment.
                    it.copy(acting = it.acting - conversationId, actionFailed = true)
                }
            }
        }
    }

    /**
     * BR-028 — decline, and tell the sender nothing.
     *
     * "A declined message request produces no signal to the sender, because
     * informing them invites retaliation." There is nothing in this method that
     * could notify them, and nothing that could be added to it later without
     * breaking that rule — the server sends a 204 and produces no event.
     *
     * The thread is removed from the reader's request list and NOT deleted:
     * later messages from that sender land in the same suppressed thread rather
     * than raising a new request, so they remain available if the reader reports
     * or changes their mind.
     */
    fun decline(conversationId: String) {
        if (conversationId in _state.value.acting) return
        _state.update { it.copy(acting = it.acting + conversationId) }

        viewModelScope.launch {
            when (messaging.decline(conversationId)) {
                is ApiResult.Ok -> _state.update { s ->
                    s.copy(
                        requests = s.requests.copy(
                            conversations = s.requests.conversations
                                .filterNot { it.conversationId == conversationId },
                        ),
                        acting = s.acting - conversationId,
                        unreadRequests = (s.unreadRequests - 1).coerceAtLeast(0),
                    )
                }

                is ApiResult.Err -> _state.update {
                    it.copy(acting = it.acting - conversationId, actionFailed = true)
                }
            }
        }
    }

    fun onActionFailureAcknowledged() = _state.update { it.copy(actionFailed = false) }

    /**
     * Resolve the other participant of each row.
     *
     * BATCHED BY DISTINCT ID, so a list of twenty threads among three people
     * costs three requests. Already-known people are skipped, so paginating
     * does not re-fetch the ones on screen.
     *
     * A failure is silent per person: BR-025's neutral 404 covers a deleted,
     * banned or blocking account, and a row with no name is still a row the
     * reader can open and read.
     */
    private fun resolveParticipants(conversations: List<ConversationResponse>) {
        val unknown = conversations
            .map { it.otherUserId }
            .distinct()
            .filterNot { it in _state.value.participants }

        if (unknown.isEmpty()) return

        unknown.forEach { userId ->
            viewModelScope.launch {
                when (val result = profiles(userId)) {
                    is ApiResult.Ok -> _state.update {
                        it.copy(participants = it.participants + (userId to result.value))
                    }
                    is ApiResult.Err -> Unit
                }
            }
        }
    }

    class Factory(
        private val messaging: MessagingSource,
        private val profiles: suspend (String) -> ApiResult<PublicProfileResponse>,
    ) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T =
            InboxViewModel(messaging, profiles) as T
    }
}

data class InboxList(
    val conversations: List<ConversationResponse> = emptyList(),
    /** A TIMESTAMP. `null` means the end. */
    val nextBefore: String? = null,
    val loaded: Boolean = false,
    val loadingMore: Boolean = false,
    val pageFailure: ApiFailure? = null,
) {
    val atEnd: Boolean get() = loaded && nextBefore == null
}

data class InboxUiState(
    val section: InboxSection = InboxSection.CONVERSATIONS,

    val conversations: InboxList = InboxList(),
    val requests: InboxList = InboxList(),

    /** Resolved separately; a row without one is still readable. */
    val participants: Map<String, PublicProfileResponse> = emptyMap(),

    /** Feeds the shell's tab badge. */
    val unreadConversations: Int = 0,

    /**
     * BR-027 — shown on the segmented tab and NEVER on the bottom bar.
     *
     * "A stranger must not be able to make the user's navigation demand
     * attention" (§14).
     */
    val unreadRequests: Int = 0,

    val loadingFirst: Boolean = true,
    val refreshing: Boolean = false,
    val firstPageFailure: ApiFailure? = null,

    val acting: Set<String> = emptySet(),
    val actionFailed: Boolean = false,
) {
    fun listFor(section: InboxSection) = when (section) {
        InboxSection.CONVERSATIONS -> conversations
        InboxSection.REQUESTS -> requests
    }

    fun withList(section: InboxSection, list: InboxList) = when (section) {
        InboxSection.CONVERSATIONS -> copy(conversations = list)
        InboxSection.REQUESTS -> copy(requests = list)
    }

    val current: InboxList get() = listFor(section)

    /**
     * Genuinely nothing here — an invitation, not a failure.
     *
     * §21's copy for the inbox states the privacy benefit rather than the
     * absence: "You can message anyone here without sharing your phone number."
     * That IS the feature, and the empty screen is the one place every new user
     * reads it.
     *
     * The request list's empty state offers NO action, because §21 notes "this
     * is a good state to be in — offering an action would imply something is
     * wrong."
     */
    val isEmpty: Boolean
        get() = current.loaded && current.conversations.isEmpty() && firstPageFailure == null
}
