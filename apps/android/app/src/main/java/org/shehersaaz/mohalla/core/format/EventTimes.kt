package org.shehersaaz.mohalla.core.format

import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.TextStyle
import java.util.Locale

/**
 * Dates and times as a reader sees them.
 *
 * EVERY FUNCTION TAKES A LOCALE AND A ZONE, and neither has a default. That is
 * the whole design: `DateTimeFormatter.ofPattern("d MMMM")` with no locale
 * silently uses the JVM default, which on a device set to Urdu is *usually*
 * right and on a JVM test is English — so the bug ships and the test passes. An
 * Urdu date needs Urdu month and weekday names, and O4 makes Urdu speakers
 * first-class rather than an afterthought.
 *
 * THE ZONE IS THE DEVICE'S, NOT UTC. The server stores and sends UTC; an event
 * at 09:00 Pakistan Standard Time arrives as `04:00Z`, and rendering that
 * literally would tell somebody to turn up five hours early. `ZoneId` is passed
 * in rather than read here so the conversion is testable without changing the
 * machine's timezone.
 *
 * NOTHING HERE THROWS. An unparseable timestamp returns `null` and the caller
 * omits the line, because a screen showing `2026-09-14T04:00:00Z` in the middle
 * of a sentence is worse than one showing nothing.
 *
 * WHAT THE LOCALE ACTUALLY CHANGES, measured rather than assumed: month and
 * weekday names become Urdu (`ستمبر`, `پیر`), and the digits stay Latin for
 * `ur-PK` because that is Pakistan's convention. So the visible proof that the
 * locale was honoured is the month name — which is exactly what the tests assert,
 * rather than pinning CLDR strings that differ between the desktop JDK and
 * Android's ICU.
 *
 * `java.time` is available unconditionally on minSdk 26, so there is no
 * desugaring dependency and no `ThreeTenABP`.
 */
object EventTimes {

    /** "Saturday 14 September" — the detail screen's date line. */
    fun dateLine(iso: String, locale: Locale, zone: ZoneId): String? = format(iso, zone) { local ->
        DateTimeFormatter.ofPattern("EEEE d MMMM", locale).format(local)
    }

    /** "9:00 AM" — separated from the date so the two can wrap independently. */
    fun timeLine(iso: String, locale: Locale, zone: ZoneId): String? = format(iso, zone) { local ->
        DateTimeFormatter.ofPattern("h:mm a", locale).format(local)
    }

    /** "Sat" — the date block's top line. */
    fun blockWeekday(iso: String, locale: Locale, zone: ZoneId): String? =
        format(iso, zone) { local ->
            local.dayOfWeek.getDisplayName(TextStyle.SHORT, locale)
        }

    /**
     * "14" — the date block's numeral.
     *
     * FORMATTED RATHER THAN `dayOfMonth.toString()`, and the reason is not the
     * one it looks like. For `ur-PK` the digits come out Latin, because that is
     * what CLDR says Pakistan uses — Eastern Arabic-Indic numerals are the
     * Indian Urdu convention, not the Pakistani one, and forcing them here would
     * be wrong rather than thorough (verified against the JDK's own `ur-PK`
     * data, which renders `14` alongside the Urdu month name `ستمبر`).
     *
     * What going through the formatter buys is that the numbering system stays a
     * LOCALE DECISION. `Int.toString()` is unconditionally Latin whatever the
     * locale says, so if the product ever ships a locale whose convention
     * differs, every date would silently keep Latin digits. The two agree today
     * and only one of them will still be right if that changes.
     */
    fun blockDay(iso: String, locale: Locale, zone: ZoneId): String? = format(iso, zone) { local ->
        DateTimeFormatter.ofPattern("d", locale).format(local)
    }

    /** "September" — the date block's month. */
    fun blockMonth(iso: String, locale: Locale, zone: ZoneId): String? =
        format(iso, zone) { local ->
            local.month.getDisplayName(TextStyle.FULL, locale)
        }

    /**
     * "14 September, 8:30 AM" — when the join link opens (EVENT-FR-003).
     *
     * The requirement's acceptance criterion asks that "the availability time is
     * stated", so this is one string with both parts: a time with no date is
     * ambiguous for an event two days away, which is exactly when somebody
     * checks early.
     */
    fun joinAvailableFrom(iso: String, locale: Locale, zone: ZoneId): String? =
        format(iso, zone) { local ->
            DateTimeFormatter.ofPattern("d MMMM, h:mm a", locale).format(local)
        }

    /** Milliseconds since the epoch, or `null` if unparseable. */
    fun toEpochMillis(iso: String): Long? =
        runCatching { Instant.parse(iso).toEpochMilli() }.getOrNull()

    /** ISO-8601 UTC with a `Z`, which is what every request body expects. */
    fun toIso(epochMillis: Long): String =
        DateTimeFormatter.ISO_INSTANT.format(Instant.ofEpochMilli(epochMillis))

    /**
     * `true` when the start time has passed.
     *
     * Used only to decide what to SHOW. The server refuses an RSVP to a started
     * event and excludes past events from the upcoming list; a device clock is
     * not something to enforce with, since a phone that is an hour fast would
     * otherwise hide an event that has not begun.
     */
    fun hasStarted(iso: String, nowMillis: Long): Boolean {
        val millis = toEpochMillis(iso) ?: return false
        return millis <= nowMillis
    }

    private inline fun format(
        iso: String,
        zone: ZoneId,
        transform: (java.time.LocalDateTime) -> String,
    ): String? = runCatching {
        transform(Instant.parse(iso).atZone(zone).toLocalDateTime())
    }.getOrNull()
}
