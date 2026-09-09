package org.shehersaaz.mohalla.feature.events

import org.shehersaaz.mohalla.core.network.ApiFailure
import org.shehersaaz.mohalla.core.network.ApiResult
import org.shehersaaz.mohalla.core.network.CreateEventBody
import org.shehersaaz.mohalla.core.network.EventCursorResponse
import org.shehersaaz.mohalla.core.network.EventListResponse
import org.shehersaaz.mohalla.core.network.EventResponse
import org.shehersaaz.mohalla.core.network.EventType
import org.shehersaaz.mohalla.core.network.RsvpResponse
import org.shehersaaz.mohalla.core.network.MohallaApi
import org.shehersaaz.mohalla.core.network.Patch
import org.shehersaaz.mohalla.core.network.PublicProfileResponse
import org.shehersaaz.mohalla.core.network.field
import org.shehersaaz.mohalla.core.network.patch
import org.shehersaaz.mohalla.core.network.RsvpBody
import org.shehersaaz.mohalla.core.network.apiCall
import org.shehersaaz.mohalla.core.network.map

/**
 * What the event screens need from the network (EVENT-FR-001…007).
 *
 * An interface for the same reason [org.shehersaaz.mohalla.feature.home.FeedSource]
 * is one: the defects worth catching here are SEQUENCES — an RSVP that changes
 * from Interested to Going and must still count the person once, a join refused
 * for one of four different reasons, a cancel whose outcome the server chooses.
 * None is visible in a single call.
 */
interface EventSource {
    suspend fun upcoming(cursor: EventCursor? = null): ApiResult<EventPage>
    suspend fun byCreator(userId: String, cursor: EventCursor? = null): ApiResult<EventPage>
    suspend fun detail(eventId: String): ApiResult<EventResponse>
    suspend fun creator(userId: String): ApiResult<PublicProfileResponse>
    suspend fun rsvp(eventId: String, response: RsvpResponse): ApiResult<EventResponse>
    suspend fun withdrawRsvp(eventId: String): ApiResult<EventResponse>
    suspend fun join(eventId: String): ApiResult<String>
    suspend fun create(draft: EventDraft): ApiResult<EventResponse>
    suspend fun update(eventId: String, changes: EventChanges): ApiResult<EventResponse>
    suspend fun cancel(eventId: String): ApiResult<CancelOutcome>
}

class EventRepository(
    private val api: MohallaApi,
) : EventSource {

    /**
     * EVENT-FR-005 — soonest first, twenty at a time.
     *
     * THE ONLY ASCENDING LIST IN THE PRODUCT, and the cursor walks forward in
     * time rather than back. The feed's `FeedCursor` is deliberately not reused:
     * the two have the same shape and opposite meanings, and a cursor that is
     * interpreted in the wrong direction pages away from the data rather than
     * through it — which looks like an empty feed, not like a bug.
     */
    override suspend fun upcoming(cursor: EventCursor?): ApiResult<EventPage> = apiCall {
        api.eventsUpcoming(
            limit = PAGE_SIZE,
            cursorStartsAt = cursor?.startsAt,
            cursorId = cursor?.id,
        )
    }.map { it.toPage() }

    override suspend fun byCreator(
        userId: String,
        cursor: EventCursor?,
    ): ApiResult<EventPage> = apiCall {
        api.eventsByCreator(
            userId = userId,
            limit = PAGE_SIZE,
            cursorStartsAt = cursor?.startsAt,
            cursorId = cursor?.id,
        )
    }.map { it.toPage() }

    override suspend fun detail(eventId: String): ApiResult<EventResponse> =
        apiCall { api.event(eventId) }

    /**
     * The creator's profile, for EVENT-FR-006's "creator with badge".
     *
     * A SEPARATE CALL because the event body carries only `creatorId`. Made once
     * per detail screen and never per list row — twenty extra round trips to
     * render twenty names would cost more than the list itself on the 3G
     * connection NFR-PERF-001 budgets for.
     */
    override suspend fun creator(userId: String): ApiResult<PublicProfileResponse> =
        apiCall { api.user(userId) }

    /**
     * EVENT-FR-004 — Going or Interested, one response per person.
     *
     * `PUT`, not `POST`: changing from Interested to Going is an update against
     * the same composite key, so the person is counted once. That is the
     * requirement's acceptance criterion, and it is the server's guarantee — the
     * client does not add and subtract counts to simulate it.
     */
    override suspend fun rsvp(
        eventId: String,
        response: RsvpResponse,
    ): ApiResult<EventResponse> = apiCall {
        api.rsvp(eventId, RsvpBody(response = response.wire))
    }

    /** "The user may change or withdraw the response at any time." Idempotent. */
    override suspend fun withdrawRsvp(eventId: String): ApiResult<EventResponse> =
        apiCall { api.withdrawRsvp(eventId) }

    /** EVENT-FR-003. The only call in the app that can return a meeting link. */
    override suspend fun join(eventId: String): ApiResult<String> =
        apiCall { api.joinEvent(eventId) }.map { it.meetingUrl }

    override suspend fun create(draft: EventDraft): ApiResult<EventResponse> = apiCall {
        api.createEvent(
            CreateEventBody(
                title = draft.title.trim(),
                description = draft.description.trim(),
                startsAt = draft.startsAtIso,
                eventType = draft.type.wire,
                // Exactly one is sent, decided by the type. Sending both is
                // refused by the server (EVENT-FR-001 A1), and sending a blank
                // string rather than null would fail the URL check on a
                // physical event.
                meetingUrl = draft.meetingUrl?.trim()?.takeIf { it.isNotEmpty() },
                locationText = draft.locationText?.trim()?.takeIf { it.isNotEmpty() },
                categorySlug = draft.categorySlug,
            ),
        )
    }

    /**
     * EVENT-FR-007 — only what changed, and sometimes what was CLEARED.
     *
     * The server notifies every attendee for a TIME, LOCATION or LINK change and
     * for nothing else, because "fixing a typo at midnight must not wake fifty
     * neighbours". Sending the whole object back would make every save look like
     * a reschedule, so untouched fields are absent from the body.
     *
     * THE LINK AND THE LOCATION NEED A THIRD STATE, and not having one made
     * changing an event's type impossible. Absent means "leave it alone", so an
     * ONLINE event switched to PHYSICAL kept its old meeting link, the server
     * merged it back, and the edit was refused for supplying both a link and a
     * location — with the error naming the field the creator had just emptied.
     * Exactly the failure the backend's own comment predicts. `Patch` carries
     * the difference between untouched and emptied; see `PatchBody.kt`.
     */
    override suspend fun update(
        eventId: String,
        changes: EventChanges,
    ): ApiResult<EventResponse> = apiCall {
        api.updateEvent(
            eventId,
            patch {
                changes.title?.trim()?.let { field("title", it) }
                changes.description?.trim()?.let { field("description", it) }
                changes.startsAtIso?.let { field("startsAt", it) }
                changes.type?.let { field("eventType", it.wire) }
                field("meetingUrl", changes.meetingUrl)
                field("locationText", changes.locationText)
                changes.categorySlug?.let { field("categorySlug", it) }
            },
        )
    }

    override suspend fun cancel(eventId: String): ApiResult<CancelOutcome> =
        apiCall { api.cancelEvent(eventId) }.map {
            CancelOutcome(
                deleted = it.outcome == "DELETED",
                notifiedAttendees = it.notifiedAttendees,
            )
        }

    companion object {
        /** EVENT-FR-005: "paginated at 20". */
        const val PAGE_SIZE = 20
    }
}

/** A position in the ordering. For events that ordering runs FORWARD in time. */
data class EventCursor(val startsAt: String, val id: String)

data class EventPage(
    val events: List<EventResponse>,
    /** `null` means the end. Not the same as an empty page. */
    val nextCursor: EventCursor?,
)

private fun EventListResponse.toPage() = EventPage(
    events = events,
    nextCursor = nextCursor?.toCursor(),
)

private fun EventCursorResponse.toCursor() = EventCursor(cursorStartsAt, cursorId)

/** A complete, validated event ready to publish. */
data class EventDraft(
    val title: String,
    val description: String,
    val startsAtIso: String,
    val type: EventType,
    val meetingUrl: String?,
    val locationText: String?,
    val categorySlug: String?,
)

/**
 * Only the fields the creator touched.
 *
 * `null` means "leave it alone" for the fields that cannot be emptied — a title
 * and a description are required, so there is no third state to express. The
 * LINK and the LOCATION are different: an event that changes type must clear one
 * of them, and [Patch] is what carries "the creator emptied this" separately
 * from "the creator did not touch it".
 */
data class EventChanges(
    val title: String? = null,
    val description: String? = null,
    val startsAtIso: String? = null,
    val type: EventType? = null,
    val meetingUrl: Patch<String> = Patch.Unchanged,
    val locationText: Patch<String> = Patch.Unchanged,
    val categorySlug: String? = null,
) {
    val isEmpty: Boolean
        get() = title == null && description == null && startsAtIso == null &&
            type == null && meetingUrl == Patch.Unchanged &&
            locationText == Patch.Unchanged && categorySlug == null
}

/**
 * What cancelling actually did.
 *
 * The creator asked for one thing — "this is not happening" — and the server
 * decided between deleting and marking. Reported back so the screen can say
 * which, because the two leave the creator in different places: a deleted event
 * is gone from their list, a cancelled one is still there with a label.
 */
data class CancelOutcome(
    val deleted: Boolean,
    val notifiedAttendees: Int,
)

/**
 * Why a join was refused (EVENT-FR-003).
 *
 * FOUR DISTINCT CASES, which is the opposite of the rule everywhere else in
 * this app — and it is the requirement's own instruction. The event is already
 * public: its title, time and attendee count are visible to anybody, so
 * refusing the link discloses nothing that was hidden. The acceptance criterion
 * asks outright that "the join control is not yet active AND the availability
 * time is stated", which one anonymous refusal cannot do.
 *
 * `Unavailable` is the exception and stays neutral, because that one IS about
 * existence.
 */
sealed interface JoinRefusal {
    /** Respond to the event first. */
    data object RsvpRequired : JoinRefusal

    /** The 30-minute window has not opened. `availableFromIso` when the server said. */
    data class TooEarly(val availableFromIso: String?) : JoinRefusal

    data object NotOnline : JoinRefusal

    data object Cancelled : JoinRefusal

    /** The neutral one. Deleted, hidden, blocked or never there. */
    data object Unavailable : JoinRefusal

    /** Anything else — offline, a 500, an unrecognised code. */
    data class Other(val failure: ApiFailure) : JoinRefusal
}

/**
 * Read the server's refusal.
 *
 * MATCHES ON THE CODE, NEVER ON THE MESSAGE. The message is already localised
 * for the caller and will differ between English and Urdu; a client that
 * branched on its text would work in one language and silently fall through to
 * the generic case in the other.
 */
fun ApiFailure.toJoinRefusal(): JoinRefusal = when (this) {
    is ApiFailure.Restricted -> when (code) {
        "RSVP_REQUIRED" -> JoinRefusal.RsvpRequired
        "JOIN_LINK_NOT_YET_AVAILABLE" -> JoinRefusal.TooEarly(details["availableFrom"])
        // A 403 with no recognised code is still a refusal to act on, and a
        // suspension is the likeliest cause (BR-034).
        else -> JoinRefusal.Other(this)
    }

    is ApiFailure.Validation -> when (code) {
        "NOT_AN_ONLINE_EVENT" -> JoinRefusal.NotOnline
        "EVENT_CANCELLED" -> JoinRefusal.Cancelled
        else -> JoinRefusal.Other(this)
    }

    is ApiFailure.Unavailable -> JoinRefusal.Unavailable

    else -> JoinRefusal.Other(this)
}

/** Why an RSVP was refused. Told apart because they lead to different actions. */
sealed interface RsvpRefusal {
    data object AlreadyStarted : RsvpRefusal
    data object Cancelled : RsvpRefusal
    data object Unavailable : RsvpRefusal
    data class Other(val failure: ApiFailure) : RsvpRefusal
}

fun ApiFailure.toRsvpRefusal(): RsvpRefusal = when (this) {
    is ApiFailure.Validation -> when (code) {
        "EVENT_HAS_STARTED" -> RsvpRefusal.AlreadyStarted
        "EVENT_CANCELLED" -> RsvpRefusal.Cancelled
        else -> RsvpRefusal.Other(this)
    }

    is ApiFailure.Unavailable -> RsvpRefusal.Unavailable

    else -> RsvpRefusal.Other(this)
}
