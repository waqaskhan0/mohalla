package org.shehersaaz.mohalla.feature.messages

import org.shehersaaz.mohalla.core.network.MessageResponse

/**
 * One message as the conversation renders it (MSG-FR-002/004/009).
 *
 * THE CLIENT MESSAGE ID IS THE IDENTITY, not the server id, and that inversion
 * is the whole reason this type exists rather than the screen rendering
 * `MessageResponse` directly.
 *
 * A message the reader has just sent exists on the device BEFORE the server
 * knows about it. It needs a stable identity from that instant — for a
 * `LazyColumn` key, for a retry to find it, and for the server's eventual copy
 * to be recognised as the SAME message rather than appended as a second one.
 * The server id cannot do that job: it does not exist yet. So the client id
 * generated at compose time is the key, and the server id is a field that
 * arrives later.
 *
 * That is also what makes MSG-FR-004's rule cheap to honour — "duplicate
 * delivery must be idempotent, so a message that arrives twice renders once".
 * A message arriving by poll after the send response already reconciled it
 * matches on the client id and replaces rather than duplicates.
 */
data class ChatMessage(
    /**
     * Generated on the device (ADR-009), and stable for the life of the message.
     *
     * Present on everything the VIEWER sent. Null for a message received from
     * the other participant — their client generated it, and the server does not
     * echo somebody else's id — so [key] falls back to the server id there.
     */
    val clientMessageId: String?,

    /** Null until the server has acknowledged a message the viewer sent. */
    val serverId: String?,

    val senderId: String,
    val body: String?,

    /**
     * MSG-FR-008 — fetched from `conversations/media/{id}` and NEVER from
     * `media/{id}`, which refuses RESTRICTED objects outright.
     */
    val mediaId: String?,

    /** The SERVER's timestamp once known; the device's while sending. */
    val createdAt: String,

    /**
     * MSG-FR-009 — present only on the viewer's own messages, and never in a
     * Message Request.
     */
    val readAt: String?,

    /**
     * Whether the VIEWER sent this, decided by comparing senders.
     *
     * STORED RATHER THAN DERIVED FROM [clientMessageId], and the difference is
     * not academic. The server echoes whatever client id a message was sent
     * with to BOTH participants, and a message the viewer sent from another
     * device carries none at all - so presence of an id answers "did THIS
     * install compose it", which is a different question and gives the wrong
     * answer to this one. Getting it wrong puts a bubble on the wrong side of
     * the screen, which is visibly wrong to the one person who knows better.
     *
     * False when the viewer is unknown: ownership cannot be claimed without
     * knowing whose it would be, and a message shown as the other person's is
     * a cosmetic error where one shown as the viewer's own would be a lie
     * about who said it.
     */
    val isMine: Boolean,

    val state: MessageState,
) {
    /**
     * The list key.
     *
     * The client id where there is one, so an optimistic bubble keeps its
     * identity through acknowledgement; the server id otherwise. Never a hash of
     * the body — two identical messages sent twice are two messages.
     */
    val key: String get() = clientMessageId ?: serverId ?: createdAt

    /** MSG-FR-002 — a failed message offers a retry and is never dropped. */
    val canRetry: Boolean get() = state == MessageState.Failed

    val hasContent: Boolean get() = !body.isNullOrBlank() || mediaId != null
}

/**
 * Where a message has got to (§18 — "message bubble: own · theirs · sending ·
 * failed").
 *
 * MSG-FR-002: it "appears immediately in a sending state and resolves to sent
 * on server acknowledgement", and a failure is "marked failed with a retry
 * control and is never silently dropped".
 *
 * SENT IS NOT THE SAME AS READ. MSG-FR-009's three steps are sent, delivered
 * and read — and only two of them are knowable here: a message with a `readAt`
 * has been read, and one without has been sent. There is no "delivered" signal
 * in the API, and inventing one from a poll landing would be a client
 * fabricating a receipt about the other person's device.
 */
enum class MessageState {
    /** On the device, not yet acknowledged. Optimistic. */
    Sending,

    /** Acknowledged by the server. This is also every received message. */
    Sent,

    /** Read by the other participant — only ever on the viewer's own message. */
    Read,

    /**
     * The send failed and the message is still here.
     *
     * Retryable with the SAME client id, which is what stops a retry
     * duplicating. Never removed from the list on failure: MSG-FR-002 says a
     * failed message "is never silently dropped", and somebody who typed three
     * sentences on a bus should not lose them to a tunnel.
     */
    Failed,
}

/**
 * The server's copy, as a rendered message.
 *
 * `readAt` decides between [MessageState.Sent] and [MessageState.Read], which
 * is the only receipt this client ever derives — and it derives it from a field
 * the SERVER chose to send. In a Message Request the server withholds `readAt`
 * entirely, so a request thread cannot produce a read receipt even by accident.
 * That is MSG-FR-009's rule made structural: "reading a request does not signal
 * anything to a stranger."
 */
fun MessageResponse.toChatMessage(viewerId: String?): ChatMessage {
    // ONE COMPARISON, AND EVERYTHING ELSE FOLLOWS FROM IT. Ownership is who
    // sent the message, not whether this install happens to hold a client id
    // for it.
    val mine = viewerId != null && senderId == viewerId

    return ChatMessage(
        // The server echoes the sender's client id to BOTH participants, so it
        // is dropped for a message the viewer did not send: it is the other
        // device's bookkeeping, it would reconcile against nothing here, and
        // keeping it would make one person's id a key in somebody else's list.
        clientMessageId = clientMessageId?.takeIf { mine },
        serverId = id,
        senderId = senderId,
        body = body,
        mediaId = mediaId,
        createdAt = createdAt,
        readAt = readAt.takeIf { mine },
        isMine = mine,
        // A RECEIPT ONLY ON THE VIEWER'S OWN MESSAGE. MSG-FR-009's receipts run
        // one way, and the server withholds `readAt` in a Message Request
        // entirely; this second guard means that even a server that sent one by
        // mistake could not make the client display "Read" against a message
        // the viewer received.
        state = if (readAt != null && mine) MessageState.Read else MessageState.Sent,
    )
}

/**
 * Merge new messages into a thread, idempotently (MSG-FR-004).
 *
 * THE ACCEPTANCE CRITERION IS THAT A MESSAGE DELIVERED TWICE RENDERS ONCE, and
 * this function is where that holds. Two identities are reconciled, in order:
 *
 *   1. THE CLIENT ID, which matches the server's copy to an optimistic bubble
 *      the viewer is already looking at. Without this the sender sees their own
 *      message twice — once as they typed it and once as it came back.
 *
 *   2. THE SERVER ID, which matches a message arriving by poll to one already
 *      merged from the send response, or by a socket to one already polled.
 *
 * ORDERED BY SERVER TIMESTAMP, which MSG-FR-004 requires by name "so that both
 * participants see the same order". A message still sending has only the
 * device's clock and sorts by that — visibly at the bottom, which is where the
 * person who just typed it expects it.
 *
 * The sort is STABLE, so two messages sharing a timestamp keep their arrival
 * order rather than swapping on every recomposition.
 */
fun List<ChatMessage>.mergedWith(incoming: List<ChatMessage>): List<ChatMessage> {
    if (incoming.isEmpty()) return this

    val byKey = LinkedHashMap<String, ChatMessage>(size + incoming.size)

    forEach { byKey[it.key] = it }

    incoming.forEach { message ->
        // 1 — reconcile against an optimistic bubble by client id.
        val existingByClientId = message.clientMessageId?.let { byKey[it] }
        if (existingByClientId != null) {
            byKey[existingByClientId.key] = message
            return@forEach
        }

        // 2 — reconcile against an already-merged server copy.
        val existingKey = byKey.values.firstOrNull {
            it.serverId != null && it.serverId == message.serverId
        }?.key
        if (existingKey != null) {
            byKey[existingKey] = message
            return@forEach
        }

        byKey[message.key] = message
    }

    return byKey.values.sortedBy { it.createdAt }
}

/** MSG-FR-002 — "up to 2,000 characters". Mirrors `message-body.ts`. */
const val MESSAGE_BODY_MAX_GRAPHEMES = 2000

/** MSG-FR-005 E3 — "up to 10 new conversations a day". */
const val MAX_NEW_REQUESTS_PER_DAY = 10
