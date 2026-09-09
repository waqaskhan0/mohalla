package org.shehersaaz.mohalla

import java.time.ZoneId
import java.util.Locale
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.shehersaaz.mohalla.core.format.EventTimes

/**
 * Date and time rendering for events.
 *
 * TWO DEFECT CLASSES ARE UNDER TEST HERE, and both are invisible on a
 * developer's machine.
 *
 * 1. A DROPPED LOCALE. `DateTimeFormatter.ofPattern("d MMMM")` with no locale
 *    uses the JVM default — which on an English machine produces English and
 *    passes every test, and on a device set to Urdu produces Urdu, so the bug
 *    only appears where nobody is looking. The assertion that catches it is that
 *    the same instant renders DIFFERENTLY under two locales.
 *
 * 2. A DROPPED ZONE. The server sends UTC; an event at 09:00 Pakistan Standard
 *    Time arrives as `04:00Z`. Rendering that literally tells somebody to turn
 *    up five hours early — the worst possible bug in an events feature, and one
 *    that looks fine to anybody testing in UTC.
 *
 * The exact Urdu strings are NOT pinned. CLDR data differs between the desktop
 * JDK and Android's ICU, so asserting `ستمبر` would be testing the JDK's
 * tables rather than the app's behaviour.
 */
class EventTimesTest {

    private val karachi = ZoneId.of("Asia/Karachi")
    private val utc = ZoneId.of("UTC")
    private val english = Locale.forLanguageTag("en")
    private val urdu = Locale.forLanguageTag("ur-PK")

    /** 2026-09-14 09:00 Pakistan Standard Time, as the server sends it. */
    private val nineAmKarachi = "2026-09-14T04:00:00Z"

    // ------------------------------------------------------------------- zone
    @Test
    fun `THE DEVICE ZONE IS APPLIED, NOT UTC`() {
        // Pakistan is UTC+5 and has no daylight saving, so 04:00Z is 09:00
        // local. A screen showing 4:00 AM would send everybody five hours early.
        assertEquals("9:00 AM", EventTimes.timeLine(nineAmKarachi, english, karachi))
        assertEquals("4:00 AM", EventTimes.timeLine(nineAmKarachi, english, utc))
    }

    @Test
    fun `a zone shift can move the DATE, not only the time`() {
        // 20:00Z on the 14th is 01:00 on the 15th in Karachi. An events list
        // grouped by a UTC date would file this under the wrong day.
        val lateEvening = "2026-09-14T20:00:00Z"
        assertEquals("14", EventTimes.blockDay(lateEvening, english, utc))
        assertEquals("15", EventTimes.blockDay(lateEvening, english, karachi))
    }

    // ----------------------------------------------------------------- locale
    @Test
    fun `THE SAME INSTANT RENDERS DIFFERENTLY IN URDU AND ENGLISH`() {
        // The assertion that catches a dropped locale. If the parameter were
        // ignored these would be identical, and every other test would still
        // pass on an English machine.
        val en = EventTimes.dateLine(nineAmKarachi, english, karachi)
        val ur = EventTimes.dateLine(nineAmKarachi, urdu, karachi)

        assertNotEquals("the locale must reach the formatter", en, ur)
        assertTrue(en!!.contains("September"))
        assertFalse("an Urdu date must not carry an English month name", ur!!.contains("September"))
    }

    @Test
    fun `month and weekday names are localised`() {
        assertNotEquals(
            EventTimes.blockMonth(nineAmKarachi, english, karachi),
            EventTimes.blockMonth(nineAmKarachi, urdu, karachi),
        )
        assertNotEquals(
            EventTimes.blockWeekday(nineAmKarachi, english, karachi),
            EventTimes.blockWeekday(nineAmKarachi, urdu, karachi),
        )
    }

    @Test
    fun `THE DIGITS STAY LATIN FOR ur-PK, WHICH IS CORRECT AND NOT A BUG`() {
        // Measured, not assumed. Eastern Arabic-Indic numerals are the Indian
        // Urdu convention; CLDR's default for Pakistan is Latin, so forcing ۱۴
        // here would be wrong rather than thorough. The value of formatting
        // instead of `Int.toString()` is that this stays a locale decision.
        assertEquals("14", EventTimes.blockDay(nineAmKarachi, urdu, karachi))
        assertEquals("14", EventTimes.blockDay(nineAmKarachi, english, karachi))
    }

    // ----------------------------------------------------------- malformed in
    @Test
    fun `AN UNPARSEABLE TIMESTAMP RETURNS NULL RATHER THAN THROWING`() {
        // The caller omits the line. A screen printing the raw ISO string in the
        // middle of a sentence is worse than one printing nothing — and a
        // formatter that threw would take a whole list down over one bad row.
        for (bad in listOf("", "not a date", "2026-09-14", "2026-13-45T99:00:00Z")) {
            assertNull(bad, EventTimes.dateLine(bad, english, karachi))
            assertNull(bad, EventTimes.timeLine(bad, english, karachi))
            assertNull(bad, EventTimes.blockDay(bad, english, karachi))
            assertNull(bad, EventTimes.blockMonth(bad, english, karachi))
            assertNull(bad, EventTimes.blockWeekday(bad, english, karachi))
            assertNull(bad, EventTimes.joinAvailableFrom(bad, english, karachi))
            assertNull(bad, EventTimes.toEpochMillis(bad))
        }
    }

    // ------------------------------------------------------------- round trip
    @Test
    fun `an instant survives the round trip through millis and back`() {
        // The composer holds a picked time as millis and sends ISO. A round trip
        // that lost the zone or the seconds would move somebody's event.
        val millis = EventTimes.toEpochMillis(nineAmKarachi)!!
        assertEquals(nineAmKarachi, EventTimes.toIso(millis))
    }

    @Test
    fun `toIso always emits UTC with a Z, whatever the device zone`() {
        // Every request body expects UTC. Emitting a local offset would be
        // accepted by the server's `datetime()` check and then stored as a
        // different moment than the creator picked.
        val iso = EventTimes.toIso(1_789_000_000_000L)
        assertTrue(iso, iso.endsWith("Z"))
    }

    // ---------------------------------------------------------- hasStarted
    @Test
    fun `hasStarted uses the supplied clock and never the real one`() {
        val start = EventTimes.toEpochMillis(nineAmKarachi)!!

        assertFalse(EventTimes.hasStarted(nineAmKarachi, start - 1))
        // Exactly at the start counts as started, matching the server's `<=`.
        assertTrue(EventTimes.hasStarted(nineAmKarachi, start))
        assertTrue(EventTimes.hasStarted(nineAmKarachi, start + 1))
    }

    @Test
    fun `AN UNPARSEABLE START TIME HAS NOT STARTED`() {
        // The permissive direction. Treating an unreadable timestamp as started
        // would hide the RSVP controls on an event that is perfectly open, and
        // the server refuses a genuinely late RSVP anyway.
        assertFalse(EventTimes.hasStarted("nonsense", Long.MAX_VALUE))
    }

    @Test
    fun `the join availability line carries a DATE as well as a time`() {
        // EVENT-FR-003 asks for "the availability time" to be stated. A bare
        // time is ambiguous for an event two days out — which is exactly when
        // somebody checks early and finds the link locked.
        val line = EventTimes.joinAvailableFrom("2026-09-14T03:30:00Z", english, karachi)!!
        assertTrue(line, line.contains("September"))
        assertTrue(line, line.contains("8:30"))
    }
}
