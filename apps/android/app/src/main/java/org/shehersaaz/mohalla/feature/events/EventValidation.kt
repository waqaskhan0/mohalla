package org.shehersaaz.mohalla.feature.events

import org.shehersaaz.mohalla.core.network.EventType
import org.shehersaaz.mohalla.feature.setup.graphemeLength

/**
 * Event field rules, client side (EVENT-FR-001/002 · SRS §12).
 *
 * THESE MIRROR THE SERVER AND DO NOT REPLACE IT. Every rule here exists on the
 * backend too, and the backend's answer is the one that counts — this copy is
 * here so a creator on a slow connection learns that a title is too short
 * before spending a round trip on it, and so the Publish control can be
 * disabled rather than enabled-then-refused.
 *
 * COUNTED IN GRAPHEME CLUSTERS, matching `event-fields.ts` and BR-012's
 * reasoning. Counting UTF-16 units would give an event announced in Urdu a
 * fraction of the title an English one gets, on a platform whose Urdu users are
 * first-class by requirement (O4).
 *
 * THE LIMITS ARE DUPLICATED CONSTANTS AND THAT IS A KNOWN COST. There is no
 * shared schema between a Kotlin app and a TypeScript API, so the alternative
 * is fetching the limits at runtime — which means a character counter that does
 * not work offline and a form that cannot validate before its first request.
 * The names match the server's exactly so a divergence is greppable.
 */

/** `EVENT_TITLE_MIN` / `EVENT_TITLE_MAX` in `event-fields.ts`. */
const val EVENT_TITLE_MIN = 3
const val EVENT_TITLE_MAX = 120

const val EVENT_DESCRIPTION_MIN = 10
const val EVENT_DESCRIPTION_MAX = 2000

const val EVENT_LOCATION_MIN = 3
const val EVENT_LOCATION_MAX = 200

const val EVENT_MEETING_URL_MAX = 500

/** EVENT-FR-001 E4: "a maximum of 5 events per user per day". */
const val MAX_EVENTS_PER_DAY = 5

/** EVENT-FR-003: "only from 30 minutes before the start time". */
const val JOIN_WINDOW_MINUTES = 30

/**
 * What is wrong with a field, as a case rather than a message.
 *
 * A `String` here would mean composing copy in a ViewModel, which puts English
 * in a file with no Urdu counterpart. Each case maps to a string resource at
 * the screen, so both languages are catalogued and the parity test covers them.
 */
enum class EventFieldProblem {
    EMPTY,
    TOO_SHORT,
    TOO_LONG,
    NOT_IN_THE_FUTURE,
    NOT_A_WEB_LINK,
    MISSING_FOR_ONLINE,
    MISSING_FOR_PHYSICAL,
    /** EVENT-FR-001 A1 — both a link and a location were given. */
    BOTH_LINK_AND_LOCATION,
}

fun checkEventTitle(title: String): EventFieldProblem? {
    val trimmed = title.trim()
    if (trimmed.isEmpty()) return EventFieldProblem.EMPTY
    val n = graphemeLength(trimmed)
    if (n < EVENT_TITLE_MIN) return EventFieldProblem.TOO_SHORT
    if (n > EVENT_TITLE_MAX) return EventFieldProblem.TOO_LONG
    return null
}

fun checkEventDescription(description: String): EventFieldProblem? {
    val trimmed = description.trim()
    if (trimmed.isEmpty()) return EventFieldProblem.EMPTY
    val n = graphemeLength(trimmed)
    if (n < EVENT_DESCRIPTION_MIN) return EventFieldProblem.TOO_SHORT
    if (n > EVENT_DESCRIPTION_MAX) return EventFieldProblem.TOO_LONG
    return null
}

fun checkEventLocation(location: String): EventFieldProblem? {
    val trimmed = location.trim()
    if (trimmed.isEmpty()) return EventFieldProblem.MISSING_FOR_PHYSICAL
    val n = graphemeLength(trimmed)
    if (n < EVENT_LOCATION_MIN) return EventFieldProblem.TOO_SHORT
    if (n > EVENT_LOCATION_MAX) return EventFieldProblem.TOO_LONG
    return null
}

/**
 * The meeting link — http or https, and nothing else.
 *
 * THE SCHEME CHECK IS THE POINT, not a formality. `javascript:` and `data:`
 * URLs are the classic stored-XSS vector, and SEC-016 names the Admin Portal as
 * the highest-value target for exactly that: a moderator reviewing a reported
 * event is the person most likely to have this string rendered at them. The
 * server refuses the same set at its boundary; refusing here as well means a
 * creator who pasted the wrong thing is told immediately.
 *
 * THE URL IS NEVER NORMALISED OR REWRITTEN. Whatever the creator typed is what
 * attendees get. A meeting link often carries a passcode in its query string,
 * and "tidying" it is how a room becomes unjoinable.
 */
fun checkMeetingUrl(url: String): EventFieldProblem? {
    val trimmed = url.trim()
    if (trimmed.isEmpty()) return EventFieldProblem.MISSING_FOR_ONLINE
    if (trimmed.length > EVENT_MEETING_URL_MAX) return EventFieldProblem.TOO_LONG

    // Case-insensitive, because `HTTPS://` is a valid scheme and a creator
    // pasting from a document may well have it capitalised. Matching only
    // lowercase would refuse a working link.
    val lower = trimmed.lowercase()
    if (!lower.startsWith("http://") && !lower.startsWith("https://")) {
        return EventFieldProblem.NOT_A_WEB_LINK
    }
    // A scheme and nothing after it is not a link.
    if (trimmed.substringAfter("//").isBlank()) return EventFieldProblem.NOT_A_WEB_LINK
    // No whitespace anywhere: a pasted line that wrapped is the common case,
    // and sending it would produce a link that opens nothing.
    if (trimmed.any { it.isWhitespace() }) return EventFieldProblem.NOT_A_WEB_LINK

    return null
}

/**
 * The start time must be in the FUTURE (EVENT-FR-001 E1).
 *
 * Takes `nowMillis` rather than reading the clock, for the same reason the
 * server's `checkStartsAt` takes a `now`: "two seconds from now" and "two
 * seconds ago" are both testable without waiting.
 *
 * A CLIENT CLOCK IS NOT AUTHORITATIVE and this check is not the gate. A device
 * whose clock is a day slow would let a past event through here — the server
 * refuses it, and the composer surfaces that refusal. What this catches is the
 * ordinary case: somebody picking yesterday from a date picker.
 */
fun checkStartsAt(startsAtMillis: Long?, nowMillis: Long): EventFieldProblem? {
    if (startsAtMillis == null) return EventFieldProblem.EMPTY
    if (startsAtMillis <= nowMillis) return EventFieldProblem.NOT_IN_THE_FUTURE
    return null
}

/**
 * The whole form, as one answer.
 *
 * Returns a map keyed by the SERVER'S FIELD PATHS (`title`, `description`,
 * `startsAt`, `meetingUrl`, `locationText`), so a client-side problem and a
 * server-side `details[].path` land in the same place on the same screen and
 * the form needs one rendering path rather than two.
 */
fun checkEventDraft(
    title: String,
    description: String,
    startsAtMillis: Long?,
    nowMillis: Long,
    type: EventType?,
    meetingUrl: String,
    locationText: String,
): Map<String, EventFieldProblem> = buildMap {
    checkEventTitle(title)?.let { put("title", it) }
    checkEventDescription(description)?.let { put("description", it) }
    checkStartsAt(startsAtMillis, nowMillis)?.let { put("startsAt", it) }

    val hasUrl = meetingUrl.isNotBlank()
    val hasLocation = locationText.isNotBlank()

    when (type) {
        // EVENT-FR-001 A1. Refused rather than silently dropping one, because
        // dropping the link from an online-and-physical event is how attendees
        // arrive at a park expecting a video call.
        EventType.ONLINE -> if (hasLocation) {
            put("locationText", EventFieldProblem.BOTH_LINK_AND_LOCATION)
        } else {
            checkMeetingUrl(meetingUrl)?.let { put("meetingUrl", it) }
        }

        EventType.PHYSICAL -> if (hasUrl) {
            put("meetingUrl", EventFieldProblem.BOTH_LINK_AND_LOCATION)
        } else {
            checkEventLocation(locationText)?.let { put("locationText", it) }
        }

        // No type chosen yet. Neither field can be judged, so neither is
        // marked — an error under a field the user has not been asked to fill
        // reads as the form being broken.
        null -> put("eventType", EventFieldProblem.EMPTY)
    }
}
