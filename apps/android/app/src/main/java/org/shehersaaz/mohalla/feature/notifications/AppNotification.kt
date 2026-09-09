package org.shehersaaz.mohalla.feature.notifications

import org.shehersaaz.mohalla.core.network.NotificationResponse

/**
 * One notification, as a row (NOTIF-FR-002/003).
 *
 * THE SENTENCE IS THE SERVER'S AND THE CLIENT NEVER WRITES ONE. `text` arrives
 * rendered in the language the request named — "Sana Bashir commented on your
 * post", "‫سنا بشیر نے آپ کی پوسٹ پر تبصرہ کیا‬". LOCALE-FR-002 requires a
 * language switch to update "the entire interface without reinstall", and the
 * server renders at READ time for exactly that reason. A client-side template
 * would be a second copy of thirteen strings, and the copies would disagree the
 * first time one was reworded.
 *
 * SO THE ACTOR'S NAME IS ALREADY IN THE TEXT, and this type does not resolve it.
 * What it does not have is the actor's PHOTO, which §18's row wants and which no
 * field here carries — see [NotificationsViewModel] for how that is fetched, and
 * `20-mobile-open-issues.md` for what it costs.
 */
data class AppNotification(
    val id: String,
    val category: NotificationCategory,

    /**
     * Null when nobody acted on the reader.
     *
     * An event that CHANGED or was CANCELLED has no actor — the server is
     * explicit that this "is the EVENT changing, not a person acting on the
     * recipient" — and neither does an announcement. So the row shows a
     * category mark rather than an avatar, which is also the wireframe's own
     * treatment of the platform announcement (`◈ Shehersaaz ✓`).
     */
    val actorId: String?,

    val targetType: NotificationTargetType,
    val targetId: String?,

    /** Already a sentence, already localised. Rendered as-is. */
    val text: String,

    /** NOTIF-FR-003 — how many likes one summary row stands for. 1 when not batched. */
    val batchCount: Int,

    val readAt: String?,
    val createdAt: String,
) {
    val isUnread: Boolean get() = readAt == null

    /** NOTIF-FR-003 — "likes on the same post are batched above 5 within an hour". */
    val isBatched: Boolean get() = batchCount > 1

    /**
     * Where tapping goes (NOTIF-FR-002 — "opening one navigates to the item
     * that caused it").
     *
     * DERIVED FROM THE TARGET, NOT FROM THE CATEGORY. A LIKE and a batched LIKE
     * both point at a post; an EVENT notification points at an event whether it
     * was an RSVP, a change, a cancellation or a reminder. Branching on the
     * category instead would mean four cases that all do the same thing and one
     * that would be missed when a ninth category is added.
     */
    val destination: NotificationDestination
        get() = when (targetType) {
            NotificationTargetType.POST ->
                targetId?.let { NotificationDestination.Post(it) } ?: NotificationDestination.None

            NotificationTargetType.EVENT ->
                targetId?.let { NotificationDestination.Event(it) } ?: NotificationDestination.None

            NotificationTargetType.CONVERSATION ->
                targetId?.let { NotificationDestination.Conversation(it) }
                    ?: NotificationDestination.None

            NotificationTargetType.PROFILE ->
                targetId?.let { NotificationDestination.Profile(it) }
                    ?: NotificationDestination.None

            // A REPLY carries the COMMENT's id, and there is no route in the API
            // that turns a comment id into the post it belongs to — the deep
            // link the server builds for the PUSH has both halves
            // (`/posts/{postId}#{commentId}`), but the centre's body carries
            // only the comment. So this row is readable and inert rather than
            // opening a post chosen by guesswork. GAP-M-009.
            NotificationTargetType.COMMENT -> NotificationDestination.None

            // UX-HOME-006 is not built. Recorded rather than pointed somewhere
            // plausible: an announcement row that opened the feed would look
            // like a bug to whoever tapped it.
            NotificationTargetType.ANNOUNCEMENT -> NotificationDestination.None

            NotificationTargetType.UNKNOWN -> NotificationDestination.None
        }

    /** Whether the row invites a tap. A row with nowhere to go must not. */
    val isActionable: Boolean get() = destination != NotificationDestination.None
}

/**
 * The eight kinds NOTIF-FR-003 lists, plus one for anything else.
 *
 * [OTHER] EXISTS SO A NEW SERVER CATEGORY IS A ROW RATHER THAN A CRASH. The text
 * is rendered server-side, so a category this client has never heard of still
 * displays a correct sentence — it simply gets the neutral mark instead of a
 * specific one. Refusing to render it would hide a notification the reader was
 * meant to see, which is the one outcome NOTIF-FR-001 and NOTIF-FR-007 both
 * exist to prevent.
 */
enum class NotificationCategory {
    LIKE,
    COMMENT,
    REPLY,
    FOLLOW,
    MENTION,
    MESSAGE,
    EVENT,
    ANNOUNCEMENT,
    OTHER,
    ;

    companion object {
        fun fromWire(value: String?): NotificationCategory =
            entries.firstOrNull { it.name == value && it != OTHER } ?: OTHER
    }
}

/** What the notification points at. */
enum class NotificationTargetType {
    POST,
    COMMENT,
    EVENT,
    CONVERSATION,
    PROFILE,
    ANNOUNCEMENT,
    UNKNOWN,
    ;

    companion object {
        fun fromWire(value: String?): NotificationTargetType =
            entries.firstOrNull { it.name == value && it != UNKNOWN } ?: UNKNOWN
    }
}

/**
 * Where a row goes.
 *
 * A SEALED TYPE RATHER THAN A ROUTE STRING, so the feature does not import the
 * navigation graph and the navigation graph's `when` is exhaustive. Adding a
 * destination is then a compile error in the one place that knows about routes,
 * rather than a string that silently matches nothing.
 */
sealed interface NotificationDestination {
    data class Post(val postId: String) : NotificationDestination
    data class Event(val eventId: String) : NotificationDestination
    data class Conversation(val conversationId: String) : NotificationDestination
    data class Profile(val userId: String) : NotificationDestination

    /** Nowhere to go. The row still renders — it is still information. */
    data object None : NotificationDestination
}

fun NotificationResponse.toAppNotification() = AppNotification(
    id = id,
    category = NotificationCategory.fromWire(category),
    actorId = actorId,
    targetType = NotificationTargetType.fromWire(targetType),
    targetId = targetId,
    text = text,
    // Defensive: a zero would make `isBatched` false and a negative would reach
    // a plural table that has no entry for it.
    batchCount = batchCount.coerceAtLeast(1),
    readAt = readAt,
    createdAt = createdAt,
)

/** NOTIF-FR-002 — "notifications are retained 90 days". */
const val NOTIFICATION_RETENTION_DAYS = 90

/**
 * The seven switches NOTIF-FR-007 names: "likes, comments, follows, mentions,
 * messages, events, announcements".
 *
 * SEVEN SWITCHES FOR EIGHT CATEGORIES, and the mismatch is deliberate on both
 * sides. NOTIF-FR-003 counts a comment on your post and a reply to your comment
 * as different events; NOTIF-FR-007 offers one switch for both. Somebody who
 * turned off comment notifications wants their thread to stop buzzing, and a
 * reply is part of that thread — honouring the letter of the setting while still
 * sending replies would be technically defensible and obviously wrong.
 *
 * The ORDER here is the order they are shown, and it is the requirement's own.
 */
enum class PushCategory {
    LIKE,
    COMMENT,
    FOLLOW,
    MENTION,
    MESSAGE,
    EVENT,
    ANNOUNCEMENT,
    ;

    val wire: String get() = name
}
