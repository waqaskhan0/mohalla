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
import org.shehersaaz.mohalla.core.network.EventStatus
import org.shehersaaz.mohalla.core.network.EventType
import org.shehersaaz.mohalla.core.network.PublicProfileResponse
import org.shehersaaz.mohalla.core.network.RsvpResponse

/**
 * Event detail — UX-EVENT-003 (EVENT-FR-003/004/006).
 *
 * THREE THINGS HERE ARE UNUSUAL, AND ALL THREE ARE THE REQUIREMENT.
 *
 * 1. THE JOIN LINK IS NEVER HELD IN STATE. [join] returns it through a
 *    one-shot [JoinOutcome] that the screen consumes and clears. A meeting link
 *    is a credential; parking it in a `StateFlow` would keep it in memory for
 *    the life of the screen, survive rotation, and appear in any state dump — and
 *    EVENT-FR-003 gates it behind a 30-minute window precisely to keep it from
 *    lying around.
 *
 * 2. THE FOUR JOIN REFUSALS ARE TOLD APART, which is the opposite of the rule
 *    everywhere else in this app. The event is already public — anybody can see
 *    its title, time and attendee count — so a refusal discloses nothing, and
 *    the acceptance criterion demands that "the join control is not yet active
 *    AND the availability time is stated". A neutral refusal here would leave
 *    somebody tapping a button that never explains itself.
 *
 * 3. `joinLinkAvailable` IS THE SERVER'S ANSWER AND IS NOT RECOMPUTED. The
 *    client could compare `startsAt` to the clock and decide for itself; it must
 *    not. A device thirty-one minutes fast would show an active Join button that
 *    the server then refuses, and a device slow would hide one that works.
 */
class EventDetailViewModel(
    private val events: EventSource,
    private val eventId: String,
    private val viewerId: () -> String?,
) : ViewModel() {

    private val _state = MutableStateFlow(EventDetailUiState())
    val state: StateFlow<EventDetailUiState> = _state.asStateFlow()

    init {
        load()
    }

    fun load() {
        _state.update { it.copy(loading = it.event == null, failure = null) }

        viewModelScope.launch {
            when (val result = events.detail(eventId)) {
                is ApiResult.Ok -> {
                    _state.update {
                        it.copy(
                            loading = false,
                            event = result.value,
                            isMine = result.value.creatorId == viewerId(),
                        )
                    }
                    // EVENT-FR-006's "creator with badge". Fetched AFTER the
                    // event and never blocking it: the name is one line of a
                    // screen whose date, title and RSVP are all already
                    // readable, so waiting on a second round trip to draw any
                    // of it would be the wrong trade on 3G.
                    loadCreator(result.value.creatorId)
                }

                is ApiResult.Err -> _state.update {
                    it.copy(loading = false, failure = result.failure)
                }
            }
        }
    }

    private fun loadCreator(creatorId: String) {
        viewModelScope.launch {
            when (val result = events.creator(creatorId)) {
                is ApiResult.Ok -> _state.update { it.copy(creator = result.value) }
                // Silent. A creator profile can legitimately be unavailable —
                // BR-025's neutral 404 covers a deleted, banned or blocking
                // account — and the event itself is still perfectly readable.
                // The screen falls back to showing no name rather than an error.
                is ApiResult.Err -> _state.update { it.copy(creatorUnavailable = true) }
            }
        }
    }

    /** EVENT-FR-004. Tapping the response already held withdraws it. */
    fun respond(response: RsvpResponse) {
        val event = _state.value.event ?: return
        if (_state.value.rsvpInFlight) return

        val previous = RsvpResponse.fromWire(event.myResponse)
        val withdrawing = previous == response

        _state.update {
            it.copy(
                rsvpInFlight = true,
                refusal = null,
                // Optimistic on the button only. The counts stay as they are
                // until the server's own numbers arrive, because moving a
                // person between Going and Interested is not something to
                // simulate with arithmetic.
                event = event.copy(myResponse = if (withdrawing) null else response.wire),
            )
        }

        viewModelScope.launch {
            val result = if (withdrawing) {
                events.withdrawRsvp(eventId)
            } else {
                events.rsvp(eventId, response)
            }

            _state.update { s ->
                when (result) {
                    // Replaced wholesale: counts, `joinLinkAvailable` and
                    // `myResponse` all come from the server in one object, so
                    // there is no combination of them the client can get wrong.
                    is ApiResult.Ok -> s.copy(rsvpInFlight = false, event = result.value)

                    is ApiResult.Err -> s.copy(
                        rsvpInFlight = false,
                        event = event.copy(myResponse = previous?.wire),
                        refusal = result.failure.toRsvpRefusal(),
                    )
                }
            }
        }
    }

    /**
     * Ask for the meeting link (EVENT-FR-003 · BR-045).
     *
     * The link is delivered as a one-shot outcome and NOT stored. BR-045: the
     * platform hosts no video, so the only thing to do with it is hand it to
     * the system and let another app open it.
     */
    fun join() {
        if (_state.value.joinInFlight) return
        _state.update { it.copy(joinInFlight = true, joinOutcome = null) }

        viewModelScope.launch {
            when (val result = events.join(eventId)) {
                is ApiResult.Ok -> _state.update {
                    it.copy(joinInFlight = false, joinOutcome = JoinOutcome.Open(result.value))
                }

                is ApiResult.Err -> _state.update {
                    it.copy(
                        joinInFlight = false,
                        joinOutcome = JoinOutcome.Refused(result.failure.toJoinRefusal()),
                    )
                }
            }
        }
    }

    /**
     * Clear the outcome once the screen has acted on it.
     *
     * The screen MUST call this after launching the intent, and that is not
     * housekeeping: leaving an `Open` outcome in state would relaunch the
     * browser on the next recomposition, and would keep the URL alive in memory
     * long after it was used.
     */
    fun onJoinHandled() = _state.update { it.copy(joinOutcome = null) }

    fun onRefusalAcknowledged() = _state.update { it.copy(refusal = null) }

    /**
     * EVENT-FR-003's error case: "no browser or meeting app installed".
     *
     * Reported by the screen, because only the screen knows whether the intent
     * resolved. The user is told the link could not be opened and is offered the
     * link to copy — the requirement's own fallback, and the only useful one when
     * the device has nothing that handles http.
     */
    fun onNoAppToOpenLink(url: String) =
        _state.update { it.copy(joinOutcome = JoinOutcome.NoAppAvailable(url)) }

    class Factory(
        private val events: EventSource,
        private val eventId: String,
        private val viewerId: () -> String?,
    ) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T =
            EventDetailViewModel(events, eventId, viewerId) as T
    }
}

/**
 * The result of asking to join. A ONE-SHOT, not a piece of screen state.
 *
 * `Open` carries the credential and exists only between the server's answer and
 * the intent being fired.
 */
sealed interface JoinOutcome {
    data class Open(val meetingUrl: String) : JoinOutcome
    data class Refused(val refusal: JoinRefusal) : JoinOutcome

    /** Nothing on the device handles an http link (EVENT-FR-003 error case). */
    data class NoAppAvailable(val meetingUrl: String) : JoinOutcome
}

data class EventDetailUiState(
    val loading: Boolean = true,
    val event: EventResponse? = null,

    /** EVENT-FR-006's "creator with badge". Null until the second call lands. */
    val creator: PublicProfileResponse? = null,

    /**
     * The creator's profile could not be fetched.
     *
     * NOT an error state for the screen. A creator can be deleted, banned or
     * blocking the viewer, all of which return the same neutral 404 (BR-025) —
     * and none of which makes the event unreadable.
     */
    val creatorUnavailable: Boolean = false,

    /** The viewer created this one, so the edit and cancel actions are theirs. */
    val isMine: Boolean = false,

    val rsvpInFlight: Boolean = false,
    val joinInFlight: Boolean = false,

    val failure: ApiFailure? = null,
    val refusal: RsvpRefusal? = null,
    val joinOutcome: JoinOutcome? = null,
) {
    val isCancelled: Boolean
        get() = event != null && EventStatus.fromWire(event.status) == EventStatus.CANCELLED

    /**
     * Whether the RSVP controls are offered at all.
     *
     * A cancelled event takes no responses, and the server refuses them — so
     * offering the buttons would be an invitation to be refused. Somebody who
     * already responded keeps seeing what they chose, greyed, because that is
     * the information they came back for.
     */
    val canRespond: Boolean
        get() = event != null && !isCancelled && !rsvpInFlight

    /**
     * Whether the join control is offered.
     *
     * THE SERVER'S ANSWER, not a clock comparison here. `joinLinkAvailable` is
     * false both because the window has not opened and because the caller has
     * not responded, and the control is shown in the not-yet state either way —
     * hiding it entirely would leave an online event with no visible way in, and
     * EVENT-FR-003 asks for the availability time to be stated rather than for
     * the control to disappear.
     */
    val showsJoinControl: Boolean
        get() = event != null &&
            EventType.fromWire(event.eventType) == EventType.ONLINE &&
            !isCancelled
}
