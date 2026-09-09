package org.shehersaaz.mohalla.feature.notifications

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import java.time.ZoneId
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import org.shehersaaz.mohalla.core.format.NotificationDay
import org.shehersaaz.mohalla.core.format.RelativeTime
import org.shehersaaz.mohalla.core.network.ApiFailure
import org.shehersaaz.mohalla.core.network.ApiResult
import org.shehersaaz.mohalla.core.network.PublicProfileResponse
import org.shehersaaz.mohalla.feature.home.FeedCursor

/**
 * The notification centre — UX-HOME-007 (NOTIF-FR-002/003).
 *
 * WHEN A NOTIFICATION BECOMES READ IS THE ONE REAL DESIGN DECISION HERE, and the
 * wireframe settles it by what it does NOT contain: every row carries an unread
 * dot, and the screen's secondary action is "None" — no "Mark all read" control.
 * Those two facts rule out the obvious implementations. Marking everything read
 * on open would blank every dot before the reader had looked at one, which makes
 * the dot decoration. Marking only on tap would leave the badge lit for somebody
 * who read the list and opened nothing, which makes the badge a nag.
 *
 * So: THE DOTS SURVIVE THE VISIT, AND THE VISIT MARKS THEM. Rows keep their
 * dots for as long as the centre is open, and [onLeave] marks everything that
 * was actually shown. A tap marks that one immediately, because a row that was
 * opened is read beyond argument.
 *
 * NOTHING IS FILTERED HERE. NOTIF-FR-001 and NOTIF-FR-007 both turn on the
 * centre holding what was never pushed — a declined permission and a disabled
 * category cost the buzz, not the record — so there is deliberately no notion of
 * "pushed" anywhere in this file to filter on.
 *
 * MESSAGE REQUESTS ARE ABSENT AND THAT IS THE SERVER'S DOING. BR-027 means no
 * notification is generated for one at all, so there is no row to suppress here.
 * A client-side filter would be the wrong place for it and would silently stop
 * working the day the category was renamed.
 */
class NotificationsViewModel(
    private val notifications: NotificationSource,
    private val locale: () -> String,
    private val profiles: suspend (String) -> ApiResult<PublicProfileResponse>,
    /** Injected so day grouping is testable at the boundary that matters. */
    private val now: () -> Long = { System.currentTimeMillis() },
    private val zone: () -> ZoneId = { ZoneId.systemDefault() },
) : ViewModel() {

    private val _state = MutableStateFlow(NotificationsUiState())
    val state: StateFlow<NotificationsUiState> = _state.asStateFlow()

    /**
     * Everything that was on screen and unread.
     *
     * Accumulated across pages rather than recomputed from the list, because the
     * list's own `readAt` is deliberately NOT flipped while the centre is open —
     * that is what keeps the dots visible for the visit.
     */
    private val shownUnread = linkedSetOf<String>()

    init {
        refresh()
        loadUnreadCount()
    }

    fun refresh() {
        _state.update {
            it.copy(
                refreshing = it.notifications.isNotEmpty(),
                loadingFirst = it.notifications.isEmpty(),
                firstPageFailure = null,
            )
        }

        viewModelScope.launch {
            when (val result = notifications.list(locale(), cursor = null)) {
                is ApiResult.Ok -> {
                    shownUnread.clear()
                    shownUnread += result.value.notifications.filter { it.isUnread }.map { it.id }

                    _state.update {
                        it.copy(
                            notifications = result.value.notifications,
                            nextCursor = result.value.nextCursor,
                            loaded = true,
                            loadingFirst = false,
                            refreshing = false,
                        )
                    }
                    resolveActors(result.value.notifications)
                }

                is ApiResult.Err -> _state.update {
                    it.copy(
                        loadingFirst = false,
                        refreshing = false,
                        // Kept apart from emptiness, as in every other list.
                        // "Nothing yet — when people interact with your posts,
                        // you'll see it here" after a timeout tells somebody
                        // nobody has engaged with them, which on this screen is
                        // a discouraging thing to say untruthfully.
                        firstPageFailure = result.failure,
                    )
                }
            }
        }
    }

    fun loadMore() {
        val current = _state.value
        val cursor = current.nextCursor ?: return
        if (current.loadingMore) return

        _state.update { it.copy(loadingMore = true) }

        viewModelScope.launch {
            when (val result = notifications.list(locale(), cursor)) {
                is ApiResult.Ok -> {
                    shownUnread += result.value.notifications.filter { it.isUnread }.map { it.id }

                    _state.update { s ->
                        s.copy(
                            // De-duplicated by id: a notification arriving
                            // between two page reads shifts the keyset, and the
                            // same row can legitimately come back on both.
                            notifications = s.notifications + result.value.notifications
                                .filterNot { incoming ->
                                    s.notifications.any { it.id == incoming.id }
                                },
                            nextCursor = result.value.nextCursor,
                            loadingMore = false,
                        )
                    }
                    resolveActors(result.value.notifications)
                }

                is ApiResult.Err -> _state.update {
                    it.copy(loadingMore = false, pageFailure = result.failure)
                }
            }
        }
    }

    /**
     * The badge (NOTIF-FR-002).
     *
     * FETCHED SEPARATELY FROM THE LIST, because the shell needs it before the
     * centre has ever been opened. A failure is SILENT: a missing badge is a
     * cosmetic loss, and an error banner on every screen because a count did not
     * load would be a worse outcome than a badge that is briefly absent.
     */
    fun loadUnreadCount() {
        viewModelScope.launch {
            when (val result = notifications.unreadCount()) {
                is ApiResult.Ok -> _state.update { it.copy(unread = result.value) }
                is ApiResult.Err -> Unit
            }
        }
    }

    /**
     * A row was opened.
     *
     * Marked read IMMEDIATELY and locally, then on the server. A row the reader
     * opened is read beyond argument, and waiting for the round trip to update
     * the dot would leave it lit while the post it points at is already on
     * screen.
     */
    fun open(notification: AppNotification): NotificationDestination {
        if (notification.isUnread) {
            shownUnread -= notification.id
            markLocallyRead(setOf(notification.id))
            viewModelScope.launch { notifications.markRead(listOf(notification.id)) }
        }
        return notification.destination
    }

    /**
     * The centre is being left.
     *
     * ONE REQUEST FOR THE WHOLE VISIT, carrying the ids that were actually
     * shown — never `read-all`, which would also clear notifications further
     * down a list the reader never scrolled to. Somebody who opens the centre,
     * sees three new things and leaves has read three things, not ninety.
     *
     * A failure is silent and NOT retried: the badge stays lit, which is the
     * truthful outcome, and the next visit marks them again.
     */
    fun onLeave() {
        val ids = shownUnread.toList()
        if (ids.isEmpty()) return
        shownUnread.clear()

        viewModelScope.launch {
            when (notifications.markRead(ids)) {
                is ApiResult.Ok -> markLocallyRead(ids.toSet())
                is ApiResult.Err -> Unit
            }
        }
    }

    private fun markLocallyRead(ids: Set<String>) {
        val stamp = java.time.format.DateTimeFormatter.ISO_INSTANT
            .format(java.time.Instant.ofEpochMilli(now()))

        _state.update { s ->
            s.copy(
                notifications = s.notifications.map {
                    if (it.id in ids && it.isUnread) it.copy(readAt = stamp) else it
                },
                unread = (s.unread - ids.size).coerceAtLeast(0),
            )
        }
    }

    /**
     * The actor's photo, and only the photo.
     *
     * THE ROW IS COMPLETE WITHOUT IT. `text` already names the actor, so a row
     * whose avatar has not arrived is fully readable — which is why these are
     * fetched after the list renders rather than before it, and why a failure is
     * silent per person.
     *
     * ONE REQUEST PER DISTINCT ACTOR, because no batch route exists. A page of
     * twenty notifications from twelve people costs twelve requests, which is
     * the most expensive thing this screen does — and is why they are fetched
     * last and never blocked on. Already-known people are skipped, so paging
     * does not re-fetch the ones already on screen.
     */
    private fun resolveActors(page: List<AppNotification>) {
        val unknown = page
            .mapNotNull { it.actorId }
            .distinct()
            .filterNot { it in _state.value.actors }

        unknown.forEach { userId ->
            viewModelScope.launch {
                when (val result = profiles(userId)) {
                    is ApiResult.Ok -> _state.update {
                        it.copy(actors = it.actors + (userId to result.value))
                    }
                    // BR-025's neutral 404 covers a deleted, banned or blocking
                    // account. The sentence still reads; the circle stays empty.
                    is ApiResult.Err -> Unit
                }
            }
        }
    }

    /**
     * The rows, grouped under Today / Yesterday / Earlier.
     *
     * DERIVED HERE RATHER THAN IN THE SCREEN, so the boundary is testable: a
     * notification stamped 23:58 and read at 00:02 belongs under YESTERDAY, and
     * that is the only interesting thing about day grouping. Computing it during
     * composition would also re-derive it on every recomposition against a clock
     * that had moved.
     */
    fun sections(): List<NotificationSection> {
        val nowMillis = now()
        val z = zone()

        return _state.value.notifications
            // The list is already newest-first from the server, and `groupBy`
            // preserves encounter order — so the sections come out Today,
            // Yesterday, Earlier without being sorted into it.
            .groupBy { RelativeTime.day(it.createdAt, nowMillis, z) ?: NotificationDay.EARLIER }
            .map { (day, rows) -> NotificationSection(day, rows) }
    }

    class Factory(
        private val notifications: NotificationSource,
        private val locale: () -> String,
        private val profiles: suspend (String) -> ApiResult<PublicProfileResponse>,
    ) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T =
            NotificationsViewModel(notifications, locale, profiles) as T
    }
}

data class NotificationSection(
    val day: NotificationDay,
    val notifications: List<AppNotification>,
)

data class NotificationsUiState(
    val notifications: List<AppNotification> = emptyList(),

    /** Resolved separately; a row without one is still readable. */
    val actors: Map<String, PublicProfileResponse> = emptyMap(),

    val unread: Int = 0,

    val nextCursor: FeedCursor? = null,

    val loaded: Boolean = false,
    val loadingFirst: Boolean = true,
    val loadingMore: Boolean = false,
    val refreshing: Boolean = false,

    val firstPageFailure: ApiFailure? = null,
    val pageFailure: ApiFailure? = null,
) {
    val atEnd: Boolean get() = loaded && nextCursor == null

    /**
     * Genuinely nothing — an invitation, not a failure.
     *
     * §21's copy is "Nothing yet — when people interact with your posts, you'll
     * see it here", with a route into Discover. The action is the point: an
     * empty notification centre on a new account is not a problem to report but
     * a consequence of having posted nothing yet, and the next step is to go and
     * find people.
     */
    val isEmpty: Boolean get() = loaded && notifications.isEmpty() && firstPageFailure == null
}
