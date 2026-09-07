package org.shehersaaz.mohalla.core.format

import java.time.Instant
import java.time.ZoneId
import java.time.temporal.ChronoUnit

/**
 * "2h", "Yesterday", "2 days ago" — and the day a row belongs under.
 *
 * NO STRINGS IN THIS FILE, AND THAT IS THE DESIGN. Every function returns a
 * COUNT and a UNIT, and the screen turns that into words through Android's
 * plural tables. Urdu and English do not share pluralisation rules, and a
 * hand-rolled `"$hours hours ago"` is correct in neither — it produces "1 hours
 * ago" in English and, in Urdu, a form that a native reader hears as wrong
 * without being able to point at which word. `plurals.xml` is the mechanism the
 * platform provides for exactly this, and it only works if the formatting layer
 * hands it a number instead of a sentence.
 *
 * THE NOW IS PASSED IN. A function that reads the clock cannot be tested for the
 * boundary that matters — a notification at 23:58 read at 00:02 is YESTERDAY,
 * not two hours ago and not today — and that boundary is the only interesting
 * thing about day grouping.
 *
 * THE ZONE IS THE DEVICE'S, as everywhere else: the server stamps UTC, and
 * grouping by UTC dates would put an evening notification in Karachi under
 * "Today" for five hours after midnight had passed for the reader.
 *
 * Nothing here throws. An unparseable timestamp returns `null` and the caller
 * omits the line — see [EventTimes], which takes the same position for the same
 * reason.
 */
object RelativeTime {

    /**
     * Which heading a row sits under (§ UX-HOME-007: "Today, Yesterday,
     * Earlier. Grouping without clutter.").
     *
     * CALENDAR DAYS, NOT A ROLLING 24 HOURS. "Yesterday" means the day before
     * the reader's today, so something from 23:00 last night is yesterday at
     * 08:00 this morning even though it is nine hours old — which is how a
     * person reads their own day, and the whole purpose of the grouping.
     */
    fun day(iso: String, nowMillis: Long, zone: ZoneId): NotificationDay? {
        val then = parse(iso, zone) ?: return null
        val today = Instant.ofEpochMilli(nowMillis).atZone(zone).toLocalDate()
        val days = ChronoUnit.DAYS.between(then.toLocalDate(), today)

        return when {
            // A timestamp in the future — a clock skew of a few seconds between
            // the device and the server is ordinary, and reading it as "in -1
            // days" would put the newest row under EARLIER, at the bottom.
            days <= 0L -> NotificationDay.TODAY
            days == 1L -> NotificationDay.YESTERDAY
            else -> NotificationDay.EARLIER
        }
    }

    /**
     * How long ago, as a unit and a count.
     *
     * COARSE ON PURPOSE, and the thresholds follow the wireframe's own labels:
     * "2h", "6h", "Yesterday", "2 days ago". Nothing here counts seconds — a row
     * that says "3 seconds ago" is stale the moment it is drawn, and this list
     * does not re-render on a timer.
     */
    fun ago(iso: String, nowMillis: Long, zone: ZoneId): Ago? {
        val then = parse(iso, zone) ?: return null
        val nowLocal = Instant.ofEpochMilli(nowMillis).atZone(zone)

        val minutes = ChronoUnit.MINUTES.between(then, nowLocal)
        // Clock skew again: a row stamped a moment in the future is "now",
        // never a negative count.
        if (minutes < 1L) return Ago.JustNow
        if (minutes < 60L) return Ago.Minutes(minutes.toInt())

        val hours = ChronoUnit.HOURS.between(then, nowLocal)
        if (hours < 24L) return Ago.Hours(hours.toInt())

        // Calendar days from here, so this agrees with [day] rather than
        // telling the reader "1 day ago" under a heading that says YESTERDAY on
        // one row and TODAY on the next.
        val days = ChronoUnit.DAYS.between(then.toLocalDate(), nowLocal.toLocalDate())
        return Ago.Days(days.coerceAtLeast(1L).toInt())
    }

    private fun parse(iso: String, zone: ZoneId) =
        runCatching { Instant.parse(iso).atZone(zone) }.getOrNull()
}

/** The three headings UX-HOME-007 groups by. */
enum class NotificationDay {
    TODAY,
    YESTERDAY,
    EARLIER,
}

/**
 * An age, as a number and a unit.
 *
 * A SEALED TYPE RATHER THAN A FORMATTED STRING, so the screen's `when` is
 * exhaustive and adding a unit is a compile error at every call site instead of
 * a case that silently falls through to the previous one's wording.
 */
sealed interface Ago {
    /** Under a minute. No number, because "0 minutes ago" is not a thing anyone says. */
    data object JustNow : Ago

    data class Minutes(val count: Int) : Ago
    data class Hours(val count: Int) : Ago
    data class Days(val count: Int) : Ago
}
