package org.shehersaaz.mohalla

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.shehersaaz.mohalla.core.network.EventStatus
import org.shehersaaz.mohalla.core.network.EventType
import org.shehersaaz.mohalla.core.network.RsvpResponse
import org.shehersaaz.mohalla.feature.events.EVENT_DESCRIPTION_MAX
import org.shehersaaz.mohalla.feature.events.EVENT_DESCRIPTION_MIN
import org.shehersaaz.mohalla.feature.events.EVENT_TITLE_MAX
import org.shehersaaz.mohalla.feature.events.EVENT_TITLE_MIN
import org.shehersaaz.mohalla.feature.events.EventFieldProblem
import org.shehersaaz.mohalla.feature.events.JOIN_WINDOW_MINUTES
import org.shehersaaz.mohalla.feature.events.MAX_EVENTS_PER_DAY
import org.shehersaaz.mohalla.feature.events.checkEventDescription
import org.shehersaaz.mohalla.feature.events.checkEventDraft
import org.shehersaaz.mohalla.feature.events.checkEventTitle
import org.shehersaaz.mohalla.feature.events.checkMeetingUrl
import org.shehersaaz.mohalla.feature.events.checkStartsAt

/**
 * Event field rules (EVENT-FR-001/002 · SRS §12).
 *
 * The client's copy of the server's rules. These tests are as much about the
 * COPY being faithful as about the rules working — the constants are duplicated
 * across a Kotlin app and a TypeScript API with no shared schema, so a
 * divergence is a class of bug nothing else would catch.
 */
class EventValidationTest {

    private val now = 1_800_000_000_000L // a fixed instant; never the real clock

    // ------------------------------------------------------------- constants
    @Test
    fun `THE LIMITS MATCH THE BACKEND'S event-fields dot ts`() {
        // If one of these ever fails, the app and the API disagree about what a
        // valid event is — and the visible symptom is a form that passes its own
        // check and is then refused, which reads as the server being broken.
        assertEquals(3, EVENT_TITLE_MIN)
        assertEquals(120, EVENT_TITLE_MAX)
        assertEquals(10, EVENT_DESCRIPTION_MIN)
        assertEquals(2000, EVENT_DESCRIPTION_MAX)
        assertEquals(5, MAX_EVENTS_PER_DAY)
        // EVENT-FR-003's window, and the number the copy states to the user.
        assertEquals(30, JOIN_WINDOW_MINUTES)
    }

    // ------------------------------------------------------------------ title
    @Test
    fun `a title is checked at both ends of the range`() {
        assertEquals(EventFieldProblem.EMPTY, checkEventTitle(""))
        assertEquals(EventFieldProblem.EMPTY, checkEventTitle("   "))
        assertEquals(EventFieldProblem.TOO_SHORT, checkEventTitle("ab"))
        assertNull(checkEventTitle("abc"))
        assertNull(checkEventTitle("a".repeat(EVENT_TITLE_MAX)))
        assertEquals(
            EventFieldProblem.TOO_LONG,
            checkEventTitle("a".repeat(EVENT_TITLE_MAX + 1)),
        )
    }

    @Test
    fun `URDU IS COUNTED IN GRAPHEMES, NOT UTF-16 UNITS`() {
        // BR-012's reasoning applied to an event title. "تقریب" is 6 Urdu
        // letters; counting UTF-16 units happens to agree here, but a string
        // with combining marks does not — and O4 makes Urdu speakers
        // first-class, so a title limit that charges them for diacritics a
        // reader never sees is a real inequity, not a rounding error.
        assertNull(checkEventTitle("تقریب"))

        // A string of 120 graphemes each built from a base plus a combining
        // mark: 240 UTF-16 units, 120 graphemes. A UTF-16 count would refuse it.
        val withMarks = "کِ".repeat(EVENT_TITLE_MAX)
        assertTrue(withMarks.length > EVENT_TITLE_MAX)
        assertNull("120 graphemes must pass whatever their UTF-16 length", checkEventTitle(withMarks))
    }

    @Test
    fun `a description has a MINIMUM, unlike most fields`() {
        // Ten characters, because "meeting" is not an event announcement.
        // EVENT-FR-001 asks the creator to say what is happening; a one-word
        // description wastes the travel of everybody who turns up.
        assertEquals(EventFieldProblem.TOO_SHORT, checkEventDescription("Meeting"))
        assertNull(checkEventDescription("Tree planting at the park"))
    }

    // ------------------------------------------------------------- start time
    @Test
    fun `the start time must be in the future`() {
        assertEquals(EventFieldProblem.EMPTY, checkStartsAt(null, now))
        assertEquals(EventFieldProblem.NOT_IN_THE_FUTURE, checkStartsAt(now - 1, now))
        // Exactly now is not the future either: an event that has just begun
        // cannot be published, and the server applies the same `<=`.
        assertEquals(EventFieldProblem.NOT_IN_THE_FUTURE, checkStartsAt(now, now))
        assertNull(checkStartsAt(now + 1, now))
    }

    // ------------------------------------------------------- the meeting link
    @Test
    fun `ONLY http AND https ARE ACCEPTED`() {
        // The scheme allow-list is a security control, not a formality:
        // `javascript:` and `data:` URLs are the classic stored-XSS vector, and
        // SEC-016 names the Admin Portal as the highest-value target — a
        // moderator reviewing a reported event is the person most likely to be
        // shown this string.
        assertNull(checkMeetingUrl("https://meet.example.org/abc-defg-hij"))
        assertNull(checkMeetingUrl("http://meet.example.org/room"))

        assertEquals(
            EventFieldProblem.NOT_A_WEB_LINK,
            checkMeetingUrl("javascript:alert(document.cookie)"),
        )
        assertEquals(
            EventFieldProblem.NOT_A_WEB_LINK,
            checkMeetingUrl("data:text/html;base64,PHNjcmlwdD4="),
        )
        assertEquals(EventFieldProblem.NOT_A_WEB_LINK, checkMeetingUrl("meet.example.org"))
        assertEquals(EventFieldProblem.NOT_A_WEB_LINK, checkMeetingUrl("ftp://example.org/x"))
    }

    @Test
    fun `an uppercase scheme is a working link and is accepted`() {
        // A creator pasting from a document may well have `HTTPS://`. Refusing
        // it would reject a link that works.
        assertNull(checkMeetingUrl("HTTPS://meet.example.org/room"))
        assertNull(checkMeetingUrl("Http://meet.example.org/room"))
    }

    @Test
    fun `a scheme with nothing after it is not a link`() {
        assertEquals(EventFieldProblem.NOT_A_WEB_LINK, checkMeetingUrl("https://"))
        assertEquals(EventFieldProblem.NOT_A_WEB_LINK, checkMeetingUrl("https://   "))
    }

    @Test
    fun `a link that wrapped when pasted is refused rather than sent`() {
        // The common real failure: a URL copied out of an email arrives with a
        // newline or a space in the middle. Sending it produces a link that
        // opens nothing, and the creator finds out from an attendee.
        assertEquals(
            EventFieldProblem.NOT_A_WEB_LINK,
            checkMeetingUrl("https://meet.example.org/abc defg"),
        )
        assertEquals(
            EventFieldProblem.NOT_A_WEB_LINK,
            checkMeetingUrl("https://meet.example.org/\nabc"),
        )
    }

    @Test
    fun `a query string is preserved, because it usually carries the passcode`() {
        // The URL is never normalised or rewritten — "tidying" a meeting link is
        // how a room becomes unjoinable.
        assertNull(checkMeetingUrl("https://meet.example.org/j/123?pwd=aXNzYQ"))
    }

    // ---------------------------------------------------------- the whole form
    @Test
    fun `AN ONLINE EVENT NEEDS A LINK AND A PHYSICAL ONE NEEDS A LOCATION`() {
        val online = checkEventDraft(
            title = "Budget meeting",
            description = "A discussion of the union council budget.",
            startsAtMillis = now + 86_400_000,
            nowMillis = now,
            type = EventType.ONLINE,
            meetingUrl = "",
            locationText = "",
        )
        assertEquals(EventFieldProblem.MISSING_FOR_ONLINE, online["meetingUrl"])

        val physical = checkEventDraft(
            title = "Budget meeting",
            description = "A discussion of the union council budget.",
            startsAtMillis = now + 86_400_000,
            nowMillis = now,
            type = EventType.PHYSICAL,
            meetingUrl = "",
            locationText = "",
        )
        assertEquals(EventFieldProblem.MISSING_FOR_PHYSICAL, physical["locationText"])
    }

    @Test
    fun `SUPPLYING BOTH A LINK AND A LOCATION IS REFUSED, NOT SILENTLY TRIMMED`() {
        // EVENT-FR-001 A1: V1 models no hybrid, and the requirement says what to
        // do instead — choose Physical and put the link in the description.
        // Dropping one silently is how attendees arrive at a park expecting a
        // video call.
        val problems = checkEventDraft(
            title = "Cleanup drive",
            description = "Meeting at the park and streaming for those away.",
            startsAtMillis = now + 86_400_000,
            nowMillis = now,
            type = EventType.PHYSICAL,
            meetingUrl = "https://meet.example.org/room",
            locationText = "Model Town Park",
        )
        assertEquals(EventFieldProblem.BOTH_LINK_AND_LOCATION, problems["meetingUrl"])
    }

    @Test
    fun `NO TYPE MEANS NEITHER FIELD IS MARKED`() {
        // An error under a field the user has not been asked to fill in reads as
        // the form being broken. Only the type itself is flagged.
        val problems = checkEventDraft(
            title = "Cleanup drive",
            description = "Bring gloves if you have them, please.",
            startsAtMillis = now + 86_400_000,
            nowMillis = now,
            type = null,
            meetingUrl = "",
            locationText = "",
        )
        assertEquals(setOf("eventType"), problems.keys)
    }

    @Test
    fun `a complete draft has no problems`() {
        val problems = checkEventDraft(
            title = "Tree planting drive",
            description = "We are planting 200 native trees. Bring gloves.",
            startsAtMillis = now + 86_400_000,
            nowMillis = now,
            type = EventType.PHYSICAL,
            meetingUrl = "",
            locationText = "Model Town Park, Block C",
        )
        assertTrue(problems.toString(), problems.isEmpty())
    }

    @Test
    fun `THE PROBLEM KEYS ARE THE SERVER'S FIELD PATHS`() {
        // So a client-side problem and a server `details[].path` land in the
        // same place on the same screen, and the form needs one render path
        // rather than two that can disagree.
        val problems = checkEventDraft(
            title = "",
            description = "",
            startsAtMillis = null,
            nowMillis = now,
            type = EventType.ONLINE,
            meetingUrl = "",
            locationText = "",
        )
        assertEquals(
            setOf("title", "description", "startsAt", "meetingUrl"),
            problems.keys,
        )
    }

    // ---------------------------------------------------------------- enums
    @Test
    fun `AN UNKNOWN STATUS IS SCHEDULED, WHICH IS THE PERMISSIVE DIRECTION`() {
        // Deliberate, because the two mistakes are not symmetric. An event
        // wrongly shown as going ahead is corrected the moment somebody opens
        // it; an event wrongly shown as cancelled is one nobody opens again —
        // and a new status string from the server would otherwise mark a whole
        // list cancelled at once.
        assertEquals(EventStatus.SCHEDULED, EventStatus.fromWire(null))
        assertEquals(EventStatus.SCHEDULED, EventStatus.fromWire("POSTPONED"))
        assertEquals(EventStatus.SCHEDULED, EventStatus.fromWire("cancelled"))
        assertEquals(EventStatus.CANCELLED, EventStatus.fromWire("CANCELLED"))
    }

    @Test
    fun `AN UNKNOWN TYPE IS NULL, WHICH IS NOT A DEFAULT`() {
        // There is no safe default: an unknown type could need a location or a
        // join control, and guessing puts the wrong one on screen.
        assertNull(EventType.fromWire("HYBRID"))
        assertNull(EventType.fromWire(null))
        assertEquals(EventType.ONLINE, EventType.fromWire("ONLINE"))
        assertEquals(EventType.PHYSICAL, EventType.fromWire("PHYSICAL"))
    }

    @Test
    fun `no response is a real state rather than a missing one`() {
        assertNull(RsvpResponse.fromWire(null))
        assertNull(RsvpResponse.fromWire("MAYBE"))
        assertEquals(RsvpResponse.GOING, RsvpResponse.fromWire("GOING"))
        assertEquals(RsvpResponse.INTERESTED, RsvpResponse.fromWire("INTERESTED"))
    }

    @Test
    fun `the wire values round-trip exactly`() {
        // These strings go into a request body. A rename that looked harmless
        // would be a 400 on every RSVP.
        assertEquals("GOING", RsvpResponse.GOING.wire)
        assertEquals("INTERESTED", RsvpResponse.INTERESTED.wire)
        assertEquals("ONLINE", EventType.ONLINE.wire)
        assertEquals("PHYSICAL", EventType.PHYSICAL.wire)
    }
}
