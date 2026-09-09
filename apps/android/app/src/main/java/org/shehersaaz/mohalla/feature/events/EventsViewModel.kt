package org.shehersaaz.mohalla.feature.events

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
import org.shehersaaz.mohalla.core.network.EventResponse
import org.shehersaaz.mohalla.core.network.EventType
import org.shehersaaz.mohalla.core.network.RsvpResponse

/**
 * The Events tab — UX-EVENT-001 (Upcoming) and UX-EVENT-002 (Mine).
 *
 * TWO TABS, AND THE SECOND ONE IS INCOMPLETE BY THE API'S SHAPE RATHER THAN BY
 * CHOICE. UX-EVENT-002 asks for events the user "created OR responded to". The
 * backend offers `GET /users/{id}/events`, which is created-by only, and
 * `GET /events` takes a strict query with no `mine` parameter — so the
 * responded-to half cannot be requested.
 *
 * The screen therefore shows what exists and SAYS what is missing, rather than
 * either of the two tempting workarounds: filtering a page of twenty upcoming
 * events on the device (wrong for anybody who responded to an event on page
 * three) or keeping a local list of RSVPs (a second source of truth that would
 * not survive a reinstall and would drift the moment an event was cancelled).
 * `20-mobile-open-issues.md` records the endpoint that would close it.
 *
 * PAGINATION RUNS FORWARD IN TIME. Upcoming is the only ascending list in the
 * product (EVENT-FR-005, "soonest first"), so the cursor advances toward later
 * events. Mine runs the other way — newest start first, because a creator's own
 * list is a history as much as a schedule.
 */
class EventsViewModel(
    private val events: EventSource,
    /** The signed-in user, for the created-by list. */
    private val viewerId: () -> String?,
) : ViewModel() {

    private val _state = MutableStateFlow(EventsUiState())
    val state: StateFlow<EventsUiState> = _state.asStateFlow()

    init {
        refresh()
    }

    fun selectTab(tab: EventsTab) {
        if (_state.value.tab == tab) return
        _state.update {
            it.copy(
                tab = tab,
                loadingFirstPage = it.pageFor(tab).events.isEmpty(),
                firstPageFailure = null,
            )
        }
        if (_state.value.pageFor(tab).events.isEmpty()) refresh()
    }

    fun refresh() {
        val tab = _state.value.tab

        // "Mine" cannot be requested without knowing who is asking. A missing
        // viewer id means the session went away between screens, which is
        // `apiCall`'s 401 path — not something to render an error for here.
        if (tab == EventsTab.MINE && viewerId() == null) {
            _state.update { it.copy(loadingFirstPage = false) }
            return
        }

        _state.update {
            it.copy(
                refreshing = it.pageFor(tab).events.isNotEmpty(),
                loadingFirstPage = it.pageFor(tab).events.isEmpty(),
                firstPageFailure = null,
            )
        }

        viewModelScope.launch {
            when (val result = fetch(tab, cursor = null)) {
                is ApiResult.Ok -> _state.update {
                    it.withPage(
                        tab,
                        EventList(
                            events = result.value.events,
                            nextCursor = result.value.nextCursor,
                            loaded = true,
                        ),
                    ).copy(refreshing = false, loadingFirstPage = false)
                }

                is ApiResult.Err -> _state.update {
                    it.copy(
                        refreshing = false,
                        loadingFirstPage = false,
                        // Kept separate from an empty list, for the same reason
                        // as the feed: "nobody has planned anything yet" after a
                        // timeout is a lie about the neighbourhood.
                        firstPageFailure = result.failure,
                    )
                }
            }
        }
    }

    fun loadMore() {
        val current = _state.value
        val page = current.pageFor(current.tab)
        val cursor = page.nextCursor ?: return
        if (page.loadingMore || current.refreshing) return

        _state.update { it.withPage(it.tab, page.copy(loadingMore = true, pageFailure = null)) }

        viewModelScope.launch {
            val tab = current.tab
            when (val result = fetch(tab, cursor)) {
                is ApiResult.Ok -> _state.update { s ->
                    val existing = s.pageFor(tab)
                    s.withPage(
                        tab,
                        existing.copy(
                            // De-duplicated by id. An event edited between pages
                            // can shift position in a list ordered by start
                            // time, and a duplicate key crashes a LazyColumn.
                            events = existing.events + result.value.events.filterNot { incoming ->
                                existing.events.any { it.id == incoming.id }
                            },
                            nextCursor = result.value.nextCursor,
                            loadingMore = false,
                        ),
                    )
                }

                is ApiResult.Err -> _state.update { s ->
                    s.withPage(
                        tab,
                        s.pageFor(tab).copy(loadingMore = false, pageFailure = result.failure),
                    )
                }
            }
        }
    }

    private suspend fun fetch(tab: EventsTab, cursor: EventCursor?) = when (tab) {
        EventsTab.UPCOMING -> events.upcoming(cursor)
        EventsTab.MINE -> events.byCreator(viewerId().orEmpty(), cursor)
    }

    /**
     * RSVP from a list row (EVENT-FR-004).
     *
     * OPTIMISTIC ON THE BUTTON, AUTHORITATIVE ON THE COUNT. The response the
     * viewer chose flips immediately, because that is their own action and they
     * should see it register. The COUNTS are replaced with the server's, not
     * incremented locally: changing Interested to Going moves one person between
     * two counts, and simulating that on the device would double-count anyone
     * whose previous response the list held stale. The server's numbers arrive
     * in the same response, so there is nothing to guess.
     */
    fun respond(event: EventResponse, response: RsvpResponse) {
        val id = event.id
        if (id in _state.value.pendingRsvps) return

        val previous = RsvpResponse.fromWire(event.myResponse)
        // Tapping the response you already hold withdraws it — one control,
        // both directions, which is how "the user may change or withdraw the
        // response at any time" reads on a list row with no room for a third
        // button.
        val withdrawing = previous == response

        _state.update { s ->
            s.mapEvent(id) {
                it.copy(myResponse = if (withdrawing) null else response.wire)
            }.copy(pendingRsvps = s.pendingRsvps + id)
        }

        viewModelScope.launch {
            val result = if (withdrawing) {
                events.withdrawRsvp(id)
            } else {
                events.rsvp(id, response)
            }

            _state.update { s ->
                val cleared = s.copy(pendingRsvps = s.pendingRsvps - id)
                when (result) {
                    // The whole event is replaced, so the counts and
                    // `joinLinkAvailable` come from the server rather than from
                    // arithmetic here.
                    is ApiResult.Ok -> cleared.mapEvent(id) { result.value }

                    is ApiResult.Err -> cleared
                        .mapEvent(id) { it.copy(myResponse = previous?.wire) }
                        .copy(rsvpRefusal = result.failure.toRsvpRefusal())
                }
            }
        }
    }

    fun onRefusalAcknowledged() = _state.update { it.copy(rsvpRefusal = null) }

    /** After creating, editing or cancelling, the list is stale. */
    fun invalidate() {
        _state.update {
            it.copy(
                upcoming = EventList(),
                mine = EventList(),
                loadingFirstPage = true,
            )
        }
        refresh()
    }

    class Factory(
        private val events: EventSource,
        private val viewerId: () -> String?,
    ) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T =
            EventsViewModel(events, viewerId) as T
    }
}

enum class EventsTab { UPCOMING, MINE }

data class EventList(
    val events: List<EventResponse> = emptyList(),
    val nextCursor: EventCursor? = null,
    val loaded: Boolean = false,
    val loadingMore: Boolean = false,
    val pageFailure: ApiFailure? = null,
) {
    val atEnd: Boolean get() = loaded && nextCursor == null
}

data class EventsUiState(
    val tab: EventsTab = EventsTab.UPCOMING,
    val upcoming: EventList = EventList(),
    val mine: EventList = EventList(),

    val loadingFirstPage: Boolean = true,
    val refreshing: Boolean = false,
    val firstPageFailure: ApiFailure? = null,

    val pendingRsvps: Set<String> = emptySet(),
    val rsvpRefusal: RsvpRefusal? = null,
) {
    fun pageFor(tab: EventsTab) = when (tab) {
        EventsTab.UPCOMING -> upcoming
        EventsTab.MINE -> mine
    }

    fun withPage(tab: EventsTab, page: EventList) = when (tab) {
        EventsTab.UPCOMING -> copy(upcoming = page)
        EventsTab.MINE -> copy(mine = page)
    }

    val current: EventList get() = pageFor(tab)

    /** Applies to BOTH lists — the same event can sit in either. */
    fun mapEvent(id: String, transform: (EventResponse) -> EventResponse) = copy(
        upcoming = upcoming.copy(
            events = upcoming.events.map { if (it.id == id) transform(it) else it },
        ),
        mine = mine.copy(
            events = mine.events.map { if (it.id == id) transform(it) else it },
        ),
    )

    /**
     * Genuinely nothing coming up — an invitation, not an error.
     *
     * UX-EVENT-001's empty copy is "Nobody has planned anything yet. Community
     * events start with one person." with a Create action. Requires `loaded` and
     * no failure for the same reason the feed does: a timeout rendered as "no
     * events" tells somebody their area is inactive when the app could not ask.
     */
    val isEmpty: Boolean
        get() = current.loaded && current.events.isEmpty() && firstPageFailure == null
}
