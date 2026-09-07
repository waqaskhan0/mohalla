package org.shehersaaz.mohalla.core.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.selection.selectable
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ExitToApp
import androidx.compose.material.icons.filled.LocationOn
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import java.time.ZoneId
import java.util.Locale
import org.shehersaaz.mohalla.R
import org.shehersaaz.mohalla.core.design.MohallaTheme
import org.shehersaaz.mohalla.core.design.MohallaType
import org.shehersaaz.mohalla.core.format.EventTimes
import org.shehersaaz.mohalla.core.network.EventResponse
import org.shehersaaz.mohalla.core.network.EventStatus
import org.shehersaaz.mohalla.core.network.EventType
import org.shehersaaz.mohalla.core.network.RsvpResponse

/**
 * The event card (UI/UX §18 · UX-EVENT-001).
 *
 * WHAT THIS CARD DOES NOT HAVE IS THE MOST IMPORTANT THING ABOUT IT.
 *
 * NO ATTENDEE AVATAR STACK. The prototype draws one — three faces and a "+15"
 * next to "18 people going" — and it is a privacy defect carried over from a
 * mock-up. EVENT-FR-004 permits a public COUNT and states the attendee list is
 * not shown in V1 (ARCH-CONFLICT-006 / D-17). Who attends which gathering is
 * precisely the inference a civic platform must not publish: an attendee list
 * for a meeting about a contested local issue is a list of people to lean on.
 * The backend has no route that would serve one and no response field carrying
 * an attendee identity, so there is nothing here to build a stack from — and if
 * there were, this comment is why it must not be built.
 *
 * NO MEETING LINK, EVER. Not even hidden behind a condition. The link arrives
 * only from `POST /events/{id}/join` (EVENT-FR-003) and no list body carries it.
 *
 * THE COUNT IS STILL SHOWN, and deliberately: EVENT-FR-006 calls the attendee
 * count "social proof" that "drives turnout", and it is the aggregate that is
 * public rather than the membership.
 */
@Composable
fun EventCard(
    event: EventResponse,
    onOpen: () -> Unit,
    locale: Locale,
    zone: ZoneId,
    modifier: Modifier = Modifier,
    /** Rendered under the card when the viewer may respond from the list. */
    rsvpRow: @Composable (() -> Unit)? = null,
) {
    val status = EventStatus.fromWire(event.status)
    val isCancelled = status == EventStatus.CANCELLED

    Column(
        modifier = modifier
            .fillMaxWidth()
            .background(MohallaTheme.colors.SurfacePrimary, MohallaTheme.radius.ShapeLg)
            .clickable(role = Role.Button, onClick = onOpen)
            .padding(MohallaTheme.spacing.Space4),
        verticalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space3),
    ) {
        // EVENT-FR-007 — "a cancelled event remains visible, marked cancelled,
        // until its original date passes, so attendees who do not open the
        // notification still learn of it". Marked at the TOP, above the title:
        // somebody scanning the list must not read the title, decide to go, and
        // find the label underneath.
        if (isCancelled) {
            Text(
                text = stringResource(R.string.event_cancelled_label),
                style = MohallaTheme.text(MohallaType.Label),
                color = MohallaTheme.colors.Error,
                modifier = Modifier
                    .fillMaxWidth()
                    .background(MohallaTheme.colors.ErrorSubtle, MohallaTheme.radius.ShapeSm)
                    .padding(MohallaTheme.spacing.Space2),
            )
        }

        // BR-032 — the CREATOR's own view of an auto-hidden event. Nobody else
        // is served it at all, so this only ever renders for its owner. Events
        // auto-hide at TWO reports rather than three (BR-044), "because a fake
        // gathering wastes real travel and time".
        if (event.underReview) {
            Text(
                text = stringResource(R.string.event_under_review),
                style = MohallaTheme.text(MohallaType.Caption),
                color = MohallaTheme.colors.Warning,
                modifier = Modifier
                    .fillMaxWidth()
                    .background(MohallaTheme.colors.WarningSubtle, MohallaTheme.radius.ShapeSm)
                    .padding(MohallaTheme.spacing.Space2),
            )
        }

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space3),
        ) {
            DateBlock(startsAtIso = event.startsAt, locale = locale, zone = zone)

            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space1),
            ) {
                Text(
                    text = event.title,
                    style = MohallaTheme.text(MohallaType.Title),
                    color = if (isCancelled) {
                        MohallaTheme.colors.TextTertiary
                    } else {
                        MohallaTheme.colors.TextPrimary
                    },
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )

                EventWhere(event = event, locale = locale, zone = zone)

                AttendeeCount(goingCount = event.goingCount)
            }
        }

        rsvpRow?.invoke()
    }
}

/**
 * The date block (UI/UX §18 — "date block, jacaranda-tinted").
 *
 * A FIXED WIDTH so every card's title starts at the same offset down a scrolling
 * list; a block that sized to its content would leave the titles ragged, and a
 * ragged left edge is what makes a list of twenty events hard to scan. The width
 * comes from the spacing scale rather than from measuring text.
 *
 * The month is a separate line from the day for the same reason it is on a
 * calendar: the numeral is what the eye needs first.
 */
@Composable
private fun DateBlock(startsAtIso: String, locale: Locale, zone: ZoneId) {
    val weekday = EventTimes.blockWeekday(startsAtIso, locale, zone)
    val day = EventTimes.blockDay(startsAtIso, locale, zone)
    val month = EventTimes.blockMonth(startsAtIso, locale, zone)

    // An unparseable timestamp gets no block at all rather than an empty one:
    // a blank tinted rectangle beside a title reads as a failed image.
    if (day == null) return

    Column(
        modifier = Modifier
            .width(MohallaTheme.spacing.Space16)
            .background(MohallaTheme.colors.BrandSecondarySubtle, MohallaTheme.radius.ShapeMd)
            .padding(vertical = MohallaTheme.spacing.Space2),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space1),
    ) {
        if (weekday != null) {
            Text(
                text = weekday,
                style = MohallaTheme.text(MohallaType.Label),
                color = MohallaTheme.colors.BrandSecondary,
                maxLines = 1,
            )
        }
        Text(
            text = day,
            style = MohallaTheme.text(MohallaType.H2),
            color = MohallaTheme.colors.BrandSecondary,
            maxLines = 1,
        )
        if (month != null) {
            Text(
                text = month,
                style = MohallaTheme.text(MohallaType.Caption),
                color = MohallaTheme.colors.BrandSecondary,
                textAlign = TextAlign.Center,
                // Two lines, because "September" does not fit a 64dp block on
                // one and truncating a month name to "Septem…" is worse than
                // wrapping it.
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

/**
 * Time, and then either the location or the fact that it is online.
 *
 * ONE ROW FOR BOTH TYPES, because exactly one applies (EVENT-FR-002) and a card
 * with a blank location line for every online event would waste the row that
 * matters most on a 360dp screen.
 */
@Composable
private fun EventWhere(event: EventResponse, locale: Locale, zone: ZoneId) {
    val type = EventType.fromWire(event.eventType)
    val time = EventTimes.timeLine(event.startsAt, locale, zone)

    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space1),
    ) {
        // AN "OPENS ELSEWHERE" ICON FOR AN ONLINE EVENT, NOT A CAMERA.
        // material-icons-core carries no video glyph, and that turned out to be
        // the better answer: BR-045 is that the platform hosts no video of any
        // kind and an online event always links OUT, so a camera would promise
        // playback the product deliberately does not have. This icon is
        // directional, which is why it is the auto-mirrored variant — it points
        // out of the app, and out of the app is the other way in Urdu.
        //
        // The location pin is not directional and is not mirrored.
        Icon(
            imageVector = when (type) {
                EventType.ONLINE -> Icons.AutoMirrored.Filled.ExitToApp
                else -> Icons.Filled.LocationOn
            },
            contentDescription = null,
            tint = MohallaTheme.colors.TextTertiary,
            modifier = Modifier.size(MohallaTheme.spacing.Space4),
        )

        val where = when (type) {
            EventType.ONLINE ->
                stringResource(R.string.event_type_online)
            // A physical event with no location is a server-side impossibility,
            // but rendering "null" if it ever happened is not.
            else -> event.locationText?.takeIf { it.isNotBlank() }
                ?: stringResource(R.string.event_type_physical)
        }

        Text(
            text = listOfNotNull(time, where).joinToString(" · "),
            style = MohallaTheme.text(MohallaType.BodySm),
            color = MohallaTheme.colors.TextSecondary,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

/**
 * "18 people going" — an aggregate, and never a membership.
 *
 * A PLURAL RESOURCE rather than "%d people going", because gluing a number to a
 * noun produces "1 people going" in English and the equivalent error in Urdu.
 *
 * Hidden entirely at zero. "0 people going" on a newly created event is
 * discouraging to the creator and useless to everybody else; EVENT-FR-006 calls
 * this social proof, and there is none yet.
 */
@Composable
private fun AttendeeCount(goingCount: Int) {
    if (goingCount <= 0) return

    Text(
        text = pluralStringResource(R.plurals.event_going_count, goingCount, goingCount),
        style = MohallaTheme.text(MohallaType.Caption),
        color = MohallaTheme.colors.TextSecondary,
    )
}

/**
 * The two RSVP controls (EVENT-FR-004).
 *
 * TWO BUTTONS AND NO THIRD, because tapping the response already held withdraws
 * it — "the user may change or withdraw the response at any time", and a
 * dedicated Withdraw control would be a third target on a row that has to fit
 * inside 360dp in Urdu as well as English.
 *
 * The state is carried in the FILL as well as the colour (§35): a selected
 * response is a filled button, an unselected one an outline, so the choice
 * survives a colour-blind reader and a greyscale screenshot.
 */
@Composable
fun EventRsvpRow(
    myResponse: String?,
    onGoing: () -> Unit,
    onInterested: () -> Unit,
    enabled: Boolean,
    modifier: Modifier = Modifier,
) {
    val current = RsvpResponse.fromWire(myResponse)

    Row(
        modifier = modifier
            .fillMaxWidth()
            .defaultMinSize(minHeight = MohallaTheme.spacing.Space12),
        horizontalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space2),
    ) {
        RsvpButton(
            label = stringResource(R.string.event_going),
            selected = current == RsvpResponse.GOING,
            enabled = enabled,
            onClick = onGoing,
            modifier = Modifier.weight(1f),
        )
        RsvpButton(
            label = stringResource(R.string.event_interested),
            selected = current == RsvpResponse.INTERESTED,
            enabled = enabled,
            onClick = onInterested,
            modifier = Modifier.weight(1f),
        )
    }
}

@Composable
private fun RsvpButton(
    label: String,
    selected: Boolean,
    enabled: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Box(
        modifier = modifier
            .defaultMinSize(minHeight = MohallaTheme.spacing.Space12)
            .background(
                color = if (selected) {
                    MohallaTheme.colors.BrandPrimary
                } else {
                    MohallaTheme.colors.SurfaceSunken
                },
                shape = MohallaTheme.radius.ShapeMd,
            )
            // `selectable` with the toggleable role, so a screen reader
            // announces "selected" — the only cue a reader who cannot see the
            // fill would otherwise have.
            .selectable(
                selected = selected,
                enabled = enabled,
                onClick = onClick,
            ),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = label,
            style = MohallaTheme.text(MohallaType.Button),
            color = if (selected) {
                MohallaTheme.colors.TextInverse
            } else {
                MohallaTheme.colors.TextPrimary
            },
            maxLines = 1,
        )
    }
}
