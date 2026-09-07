package org.shehersaaz.mohalla.core.network

/**
 * The event enumerations, as translations of wire values.
 *
 * THEY LIVE BESIDE [EventResponse] RATHER THAN IN THE EVENTS FEATURE, and the
 * reason is a layering one. The event card is a SHARED component: §19 places it
 * on the Events tab, inline in the Home feed, and in search results. If these
 * enums sat in `feature/events`, `core/ui` would have to import a feature
 * package to render a card — an inversion that works right up until a second
 * feature needs the same type.
 *
 * EVERY `fromWire` IS TOTAL. None throws on an unrecognised string, because the
 * server can add an enum member in a compatible release and an app in the field
 * has to survive it. What each returns for the unknown case is a separate
 * judgement, documented where it differs.
 */

/** Exactly one type per event (EVENT-FR-002), and V1 models no hybrid. */
enum class EventType {
    ONLINE,
    PHYSICAL,
    ;

    val wire: String get() = name

    companion object {
        /**
         * `null` for anything unrecognised.
         *
         * Nullable rather than defaulted, because there is no safe default: an
         * unknown type could need either a location or a join control, and
         * guessing would put the wrong one on screen. The card renders the
         * neutral wording instead.
         */
        fun fromWire(value: String?): EventType? = when (value) {
            "ONLINE" -> ONLINE
            "PHYSICAL" -> PHYSICAL
            else -> null
        }
    }
}

/** `SCHEDULED` or `CANCELLED`. A cancelled event stays visible, marked. */
enum class EventStatus {
    SCHEDULED,
    CANCELLED,
    ;

    companion object {
        /**
         * Anything unrecognised is SCHEDULED.
         *
         * The permissive direction on purpose, because the two mistakes are not
         * symmetric. An event wrongly shown as going ahead is corrected the
         * moment somebody opens it; an event wrongly shown as cancelled is one
         * nobody opens again — and a new status string from the server would
         * otherwise mark every event in the list cancelled at once, telling a
         * neighbourhood that nothing is happening.
         */
        fun fromWire(value: String?): EventStatus =
            if (value == "CANCELLED") CANCELLED else SCHEDULED
    }
}

/** One response per person per event (EVENT-FR-004). */
enum class RsvpResponse {
    GOING,
    INTERESTED,
    ;

    val wire: String get() = name

    companion object {
        /** `null` means no response — which is a real state, not a missing one. */
        fun fromWire(value: String?): RsvpResponse? = when (value) {
            "GOING" -> GOING
            "INTERESTED" -> INTERESTED
            else -> null
        }
    }
}
