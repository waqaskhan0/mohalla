package org.shehersaaz.mohalla.feature.messages

import org.shehersaaz.mohalla.core.network.ApiFailure
import org.shehersaaz.mohalla.core.network.ApiResult
import org.shehersaaz.mohalla.core.network.ConversationResponse
import org.shehersaaz.mohalla.core.network.MessageResponse
import org.shehersaaz.mohalla.core.network.MohallaApi
import org.shehersaaz.mohalla.core.network.OpenConversationBody
import org.shehersaaz.mohalla.core.network.SendMessageBody
import org.shehersaaz.mohalla.core.network.UnreadCountsResponse
import org.shehersaaz.mohalla.core.network.apiCall
import org.shehersaaz.mohalla.core.network.map
import org.shehersaaz.mohalla.feature.home.FeedCursor

/**
 * Conversations and messages (MSG-FR-001…009).
 *
 * PRIV-003 IS WHY THIS FEATURE EXISTS AT ALL, and it is worth saying at the top
 * of the file: "mobile numbers, email addresses and dates of birth are never
 * visible to another user, in any surface, at any time. This is the platform's
 * single most important privacy improvement over the WhatsApp-group status quo
 * it replaces." Two neighbours can organise about a broken drain without either
 * of them handing over a phone number. Nothing in this module may undo that, and
 * nothing in it carries a number.
 *
 * EVERY REFUSAL THAT COULD INVOLVE A BLOCK IS THE SAME 404. Not a participant,
 * blocked either way, hidden, or no such conversation all arrive as
 * [ApiFailure.Unavailable]. MSG-FR-006 requires a send to be "refused without
 * disclosing the block", and the only reliable way not to disclose it is for the
 * refusal to be indistinguishable from every other one — so the client must not
 * try to tell them apart either.
 */
interface MessagingSource {
    suspend fun open(userId: String): ApiResult<ConversationResponse>

    suspend fun inbox(section: InboxSection, before: String? = null): ApiResult<InboxPage>

    suspend fun unreadCounts(): ApiResult<UnreadCountsResponse>

    suspend fun history(conversationId: String, cursor: FeedCursor? = null): ApiResult<HistoryPage>

    suspend fun since(conversationId: String, since: String): ApiResult<List<MessageResponse>>

    suspend fun send(
        conversationId: String,
        clientMessageId: String,
        body: String?,
        mediaId: String?,
    ): ApiResult<MessageResponse>

    suspend fun markRead(conversationId: String): ApiResult<Unit>

    suspend fun accept(conversationId: String): ApiResult<Unit>

    suspend fun decline(conversationId: String): ApiResult<Unit>
}

class MessagingRepository(
    private val api: MohallaApi,
) : MessagingSource {

    /** BR-024 — resolves the one conversation that exists for this pair, forever. */
    override suspend fun open(userId: String): ApiResult<ConversationResponse> =
        apiCall { api.openConversation(OpenConversationBody(userId = userId)) }

    override suspend fun inbox(
        section: InboxSection,
        before: String?,
    ): ApiResult<InboxPage> = apiCall {
        api.inbox(section = section.wire, limit = INBOX_PAGE_SIZE, before = before)
    }.map { InboxPage(conversations = it.conversations, nextBefore = it.nextBefore) }

    override suspend fun unreadCounts(): ApiResult<UnreadCountsResponse> =
        apiCall { api.unreadCounts() }

    override suspend fun history(
        conversationId: String,
        cursor: FeedCursor?,
    ): ApiResult<HistoryPage> = apiCall {
        api.messages(
            conversationId = conversationId,
            limit = HISTORY_PAGE_SIZE,
            cursorCreatedAt = cursor?.createdAt,
            cursorId = cursor?.id,
        )
    }.map { response ->
        HistoryPage(
            // NEWEST first from the server, because a conversation is read from
            // the bottom. REVERSED here so the list is chronological and a
            // `LazyColumn` can render it in reading order — the alternative is
            // a reversed list whose scroll position, keyboard insets and
            // pagination all run the other way, which is three chances to get
            // one thing wrong.
            messages = response.messages.reversed(),
            nextCursor = response.nextCursor?.let {
                FeedCursor(it.cursorCreatedAt, it.cursorId)
            },
        )
    }

    /**
     * MSG-FR-004 E1 — reconcile, and poll.
     *
     * Returns everything after a server timestamp, OLDEST first, which is the
     * order the caller appends in. Used both after a dropped connection and as
     * the polling mechanism while a conversation is open.
     */
    override suspend fun since(
        conversationId: String,
        since: String,
    ): ApiResult<List<MessageResponse>> = apiCall {
        api.messagesSince(conversationId = conversationId, since = since, limit = SINCE_LIMIT)
    }.map { it.messages }

    /**
     * MSG-FR-002 — send, idempotently.
     *
     * The `clientMessageId` is the caller's and is REUSED ON EVERY RETRY. That
     * is the entire mechanism behind the acceptance criterion: "a message that
     * fails and is retried twice… exactly one message is delivered." The server
     * returns the original message for a repeated id, so the client cannot
     * duplicate even if it cannot tell whether its first attempt landed.
     */
    override suspend fun send(
        conversationId: String,
        clientMessageId: String,
        body: String?,
        mediaId: String?,
    ): ApiResult<MessageResponse> = apiCall {
        api.sendMessage(
            conversationId = conversationId,
            body = SendMessageBody(
                clientMessageId = clientMessageId,
                // Trimmed, and null rather than blank: the server refuses an
                // empty body, and an image-only message legitimately has none.
                body = body?.trim()?.takeIf { it.isNotEmpty() },
                mediaId = mediaId,
            ),
        )
    }

    override suspend fun markRead(conversationId: String): ApiResult<Unit> =
        apiCall { api.markRead(conversationId) }.map { }

    override suspend fun accept(conversationId: String): ApiResult<Unit> =
        apiCall { api.acceptRequest(conversationId) }.map { }

    /**
     * BR-028 — decline, and tell the sender nothing.
     *
     * A 204 and no side effect the other party can observe. There is
     * deliberately nothing here that could notify them: "informing them invites
     * retaliation".
     */
    override suspend fun decline(conversationId: String): ApiResult<Unit> =
        apiCall { api.declineRequest(conversationId) }.map { }

    companion object {
        const val INBOX_PAGE_SIZE = 20

        /**
         * Thirty messages a page.
         *
         * More than the feed's twenty, because a message is a line rather than
         * a card: thirty fills roughly two screens on the 720×1280 baseline,
         * and a conversation is scrolled back through in longer sweeps than a
         * feed is.
         */
        const val HISTORY_PAGE_SIZE = 30

        /**
         * The ceiling on one reconcile.
         *
         * A hundred is generous for a gap opened by a dropped connection. If
         * more arrived than that the client re-reads history instead, because a
         * partial `since` page would leave a hole in the middle of the thread —
         * and MSG-FR-004 E1 requires reconciling "without gaps or duplicates".
         */
        const val SINCE_LIMIT = 100
    }
}

/** BR-027 — two sections, two queries, two counts. Never one list filtered. */
enum class InboxSection {
    CONVERSATIONS,
    REQUESTS,
    ;

    val wire: String get() = name
}

data class InboxPage(
    val conversations: List<ConversationResponse>,
    /** A TIMESTAMP. `null` means the end. */
    val nextBefore: String?,
)

data class HistoryPage(
    /** Chronological — see the reversal in [MessagingRepository.history]. */
    val messages: List<MessageResponse>,
    val nextCursor: FeedCursor?,
)

/** MSG-FR-005 — where a conversation sits. */
enum class RequestState {
    /** A normal conversation: the recipient follows the sender, or accepted. */
    NONE,

    /** BR-027 — a first message from a non-follower. No push was sent. */
    PENDING,

    ACCEPTED,

    /**
     * BR-028 — declined, and the sender was told nothing.
     *
     * The thread still exists and later messages from that sender land in it
     * rather than raising a new request, so they remain available if the
     * recipient reports or later changes their mind.
     */
    DECLINED,
    ;

    companion object {
        /**
         * Anything unrecognised is [NONE].
         *
         * The permissive direction, and the safe one here: an unknown state
         * treated as a request would hide a conversation the reader is having,
         * while one treated as normal shows a thread that is genuinely theirs.
         */
        fun fromWire(value: String?): RequestState = when (value) {
            "PENDING" -> PENDING
            "ACCEPTED" -> ACCEPTED
            "DECLINED" -> DECLINED
            else -> NONE
        }
    }
}

/**
 * Why a send was refused.
 *
 * TWO CASES, AND ONLY ONE OF THEM EXPLAINS ITSELF.
 *
 * [ReadOnly] is EDGE-022 and is told plainly, because it is about the
 * CONVERSATION rather than about the other person's account: the client needs to
 * close the compose box and mark the thread, and a neutral refusal would instead
 * make a thread the reader can still scroll look like one that vanished.
 *
 * [Unavailable] covers everything a block could be hiding, and stays
 * indistinguishable. MSG-FR-006's acceptance criterion is that a send after a
 * block "is refused without disclosing the block" — so the client shows the
 * neutral state and says nothing, and from the blocked side "the conversation
 * simply receives no replies".
 */
sealed interface SendRefusal {
    data object ReadOnly : SendRefusal
    data object Unavailable : SendRefusal
    data class RateLimited(val message: String?) : SendRefusal
    data class Restricted(val message: String?) : SendRefusal

    /** Transient — offline or a 5xx. Retryable with the SAME client id. */
    data object Retryable : SendRefusal
}

/**
 * Read the refusal.
 *
 * MATCHED ON THE CODE, never the message, because the message is already
 * localised for the caller and a client branching on its text would work in
 * English and silently fall through in Urdu.
 */
fun ApiFailure.toSendRefusal(): SendRefusal = when (this) {
    is ApiFailure.Validation ->
        if (code == "CONVERSATION_READ_ONLY") SendRefusal.ReadOnly else SendRefusal.Retryable

    is ApiFailure.Unavailable -> SendRefusal.Unavailable

    // MSG-FR-005 E3 — the new-conversation limit, stated rather than silent.
    is ApiFailure.RateLimited -> SendRefusal.RateLimited(message)

    // BR-034 — a suspended account cannot send. The server's own copy explains.
    is ApiFailure.Restricted -> SendRefusal.Restricted(message)

    // Offline and 5xx. The bytes are kept and the same client id is reused.
    ApiFailure.Offline, is ApiFailure.Server -> SendRefusal.Retryable

    else -> SendRefusal.Retryable
}
