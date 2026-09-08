package org.shehersaaz.mohalla.feature.notifications

import org.shehersaaz.mohalla.core.network.ApiResult
import org.shehersaaz.mohalla.core.network.MarkNotificationsReadBody
import org.shehersaaz.mohalla.core.network.MohallaApi
import org.shehersaaz.mohalla.core.network.PushPreferenceBody
import org.shehersaaz.mohalla.core.network.apiCall
import org.shehersaaz.mohalla.core.network.map
import org.shehersaaz.mohalla.feature.home.FeedCursor

/**
 * The notification centre and its preferences (NOTIF-FR-002/007).
 *
 * ONE RULE GOVERNS THIS WHOLE MODULE: THE CENTRE ALWAYS HAS EVERYTHING.
 * NOTIF-FR-001's acceptance criterion is that a user who DENIED the push
 * permission still finds the notification here. NOTIF-FR-007's is that
 * disabling a category stops the push and leaves the entry. Both say the same
 * thing from opposite ends — a preference and a permission cost the BUZZ, never
 * the RECORD — and neither this file nor the server filters the list by either.
 *
 * WHICH MAKES THE PREFERENCES SCREEN'S COPY LOAD-BEARING. A switch labelled
 * "Likes" that silently also stopped recording likes would be a different
 * feature; the screen says so in a sentence, because a reader cannot see the
 * difference between a switch that stops a buzz and one that stops a record.
 *
 * PUSH ITSELF IS NOT IMPLEMENTED. NOTIF-FR-001 depends on DEP-003, a push
 * service that has not been provisioned, so there is no token to register and
 * the device routes are deliberately absent rather than present and uncallable.
 * The requirement's own fallback is what ships: "a declined permission degrades
 * to in-app notifications only", which is this screen, working. See GAP-M-010.
 */
interface NotificationSource {
    suspend fun list(locale: String, cursor: FeedCursor? = null): ApiResult<NotificationPage>

    suspend fun unreadCount(): ApiResult<Int>

    suspend fun markRead(ids: List<String>): ApiResult<Int>

    /**
     * DECLARED, IMPLEMENTED, AND CALLED BY NOTHING — deliberately.
     *
     * NOTIF-FR-002 asks for "an in-app list … newest-first with an unread
     * count" where "opening one navigates to the item that caused it". It does
     * not ask for a bulk control, and §49 forbids adding functionality outside
     * scope, so the server's `read-all` capability stays unused rather than
     * becoming a feature nobody specified. GAP-M-018, pinned by
     * `IntegrationWiringTest`.
     */
    suspend fun markAllRead(): ApiResult<Int>

    suspend fun preferences(): ApiResult<Map<PushCategory, Boolean>>

    suspend fun setPreference(category: PushCategory, pushEnabled: Boolean): ApiResult<Unit>
}

class NotificationRepository(
    private val api: MohallaApi,
) : NotificationSource {

    /**
     * The centre (NOTIF-FR-002).
     *
     * THE LOCALE RIDES EVERY REQUEST. The server renders each sentence at read
     * time in the language the caller names, and the caller is the only party
     * that knows what the interface is displaying RIGHT NOW — a stored
     * preference can be a sync behind, and LOCALE-FR-002 promises the switch
     * takes effect immediately rather than eventually.
     */
    override suspend fun list(
        locale: String,
        cursor: FeedCursor?,
    ): ApiResult<NotificationPage> = apiCall {
        api.notifications(
            limit = PAGE_SIZE,
            cursorCreatedAt = cursor?.createdAt,
            cursorId = cursor?.id,
            locale = locale,
        )
    }.map { response ->
        NotificationPage(
            notifications = response.notifications.map { it.toAppNotification() },
            nextCursor = response.nextCursor?.let { FeedCursor(it.cursorCreatedAt, it.cursorId) },
        )
    }

    override suspend fun unreadCount(): ApiResult<Int> =
        apiCall { api.notificationUnreadCount() }.map { it.unread }

    /**
     * Mark some read.
     *
     * CHUNKED AT THE SERVER'S OWN CEILING of 200 ids. This path carries what
     * one screenful marked, which is far below the limit — but sending 201 ids
     * would be a 400 for the whole batch, and losing every read marker because
     * one page was long is not a trade worth taking.
     *
     * THIS SENTENCE USED TO SAY that a reader who scrolls a long way "and then
     * taps 'Mark all read'" is served by [markAllRead]. **There is no such
     * control on any screen** — no button, no menu item, not even a string to
     * label one. The comment described a feature by describing a caller that
     * does not exist, which is precisely how [markAllRead] went nineteen
     * groups looking like live code. See GAP-M-018.
     */
    override suspend fun markRead(ids: List<String>): ApiResult<Int> {
        if (ids.isEmpty()) return ApiResult.Ok(0)

        var marked = 0
        ids.distinct().chunked(MARK_READ_BATCH).forEach { batch ->
            when (val result = apiCall { api.markNotificationsRead(MarkNotificationsReadBody(batch)) }) {
                is ApiResult.Ok -> marked += result.value.marked
                is ApiResult.Err -> return result
            }
        }
        return ApiResult.Ok(marked)
    }

    override suspend fun markAllRead(): ApiResult<Int> =
        apiCall { api.markAllNotificationsRead() }.map { it.marked }

    /**
     * The seven switches (NOTIF-FR-007).
     *
     * ANY SWITCH THE SERVER DID NOT MENTION IS ON. That is the server's own
     * default for a preference the user has never touched, and repeating it here
     * matters for the case where the two disagree: a missing key rendered as OFF
     * would show somebody that likes are silenced when the next like will buzz.
     * Showing a switch in the wrong position is worse than showing none, because
     * the reader acts on it.
     *
     * A key this client does not know is DROPPED rather than kept as a string:
     * a toggle with no label is worse than a toggle that is not shown.
     */
    override suspend fun preferences(): ApiResult<Map<PushCategory, Boolean>> =
        apiCall { api.notificationPreferences() }.map { response ->
            PushCategory.entries.associateWith { response.preferences[it.wire] ?: true }
        }

    override suspend fun setPreference(
        category: PushCategory,
        pushEnabled: Boolean,
    ): ApiResult<Unit> = apiCall {
        api.setNotificationPreference(category.wire, PushPreferenceBody(pushEnabled))
    }.map { }

    companion object {
        /**
         * Twenty a page, as everywhere else that lists cards.
         *
         * The server's own default and its ceiling is 50; twenty fills the
         * 720x1280 baseline screen with room to scroll, and a notification row
         * is taller than a message line because it carries an avatar and up to
         * three lines of text.
         */
        const val PAGE_SIZE = 20

        /** The server refuses more than 200 ids in one request. */
        const val MARK_READ_BATCH = 200
    }
}

data class NotificationPage(
    val notifications: List<AppNotification>,
    /** `null` means the end. NOT the same as an empty page. */
    val nextCursor: FeedCursor?,
)
