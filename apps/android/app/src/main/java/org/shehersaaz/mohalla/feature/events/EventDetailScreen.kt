package org.shehersaaz.mohalla.feature.events

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ExitToApp
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.LocationOn
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import java.time.ZoneId
import java.util.Locale
import org.shehersaaz.mohalla.R
import org.shehersaaz.mohalla.core.design.MohallaTheme
import org.shehersaaz.mohalla.core.design.MohallaType
import org.shehersaaz.mohalla.core.format.EventTimes
import org.shehersaaz.mohalla.core.network.ApiFailure
import org.shehersaaz.mohalla.core.network.EventResponse
import org.shehersaaz.mohalla.core.network.EventType
import org.shehersaaz.mohalla.core.network.PublicProfileResponse
import org.shehersaaz.mohalla.core.network.RsvpResponse
import org.shehersaaz.mohalla.core.ui.ContentUnavailable
import org.shehersaaz.mohalla.core.ui.EventRsvpRow
import org.shehersaaz.mohalla.core.ui.LoadingState
import org.shehersaaz.mohalla.core.ui.MohallaBackHeader
import org.shehersaaz.mohalla.core.ui.MohallaButton
import org.shehersaaz.mohalla.core.ui.MohallaSecondaryButton
import org.shehersaaz.mohalla.core.ui.OfflineState
import org.shehersaaz.mohalla.core.ui.ServerErrorState
import org.shehersaaz.mohalla.core.ui.TopBarAction

/**
 * Event detail — UX-EVENT-003 (EVENT-FR-003/004/006).
 *
 * §19's content order, which is a decision about persuasion rather than layout:
 * date block, title, creator with badge, type, location or join control,
 * description, attendee count, RSVP row. The date comes FIRST because the first
 * question anybody asks about an event is whether they are free.
 *
 * THE ATTENDEE COUNT IS AN AGGREGATE AND THE ONLY THING SHOWN ABOUT WHO IS
 * COMING. The prototype's avatar stack is not built here — EVENT-FR-004 states
 * the attendee list is not shown in V1, and the API carries no attendee
 * identity to build one from. See the note in `EventCard`.
 *
 * THE JOIN CONTROL IS ALWAYS VISIBLE ON AN ONLINE EVENT, in one of three
 * states: available, not-yet-with-a-time, or respond-first. EVENT-FR-003's
 * acceptance criterion asks for the availability time to be STATED rather than
 * for the control to vanish, and a hidden control leaves an online event with no
 * visible way in.
 */
@Composable
fun EventDetailScreen(
    state: EventDetailUiState,
    locale: Locale,
    zone: ZoneId,
    onBack: () -> Unit,
    onRetry: () -> Unit,
    onRespond: (RsvpResponse) -> Unit,
    onJoin: () -> Unit,
    onOpenCreator: (String) -> Unit,
    onEdit: () -> Unit,
    onReport: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier.fillMaxSize().background(MohallaTheme.colors.BgPrimary)) {
        MohallaBackHeader(
            title = stringResource(R.string.event_detail_title),
            onBack = onBack,
            actions = buildList {
                // The creator edits; everybody else reports. Never both, and
                // never a menu with one disabled item — §14 rejects anchored
                // dropdowns, so the overflow is an action rather than a menu.
                if (state.isMine) {
                    add(
                        TopBarAction(
                            icon = Icons.Filled.Edit,
                            descriptionRes = R.string.event_edit,
                            onClick = onEdit,
                        ),
                    )
                } else if (state.event != null) {
                    add(
                        TopBarAction(
                            icon = Icons.Filled.Warning,
                            descriptionRes = R.string.action_report,
                            onClick = onReport,
                        ),
                    )
                }
            },
        )

        when {
            state.loading && state.event == null -> LoadingState()

            // UX-STATE-001. Deleted, auto-hidden past two reports (BR-044),
            // blocked creator, or never there — one neutral state, and the
            // screen does not say which.
            state.failure is ApiFailure.Unavailable -> ContentUnavailable()

            state.event == null -> DetailFailure(failure = state.failure, onRetry = onRetry)

            else -> EventBody(
                event = state.event,
                state = state,
                locale = locale,
                zone = zone,
                onRespond = onRespond,
                onJoin = onJoin,
                onOpenCreator = onOpenCreator,
            )
        }
    }
}

@Composable
private fun EventBody(
    event: EventResponse,
    state: EventDetailUiState,
    locale: Locale,
    zone: ZoneId,
    onRespond: (RsvpResponse) -> Unit,
    onJoin: () -> Unit,
    onOpenCreator: (String) -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = MohallaTheme.screenMargin)
            .padding(vertical = MohallaTheme.spacing.Space4),
        verticalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space4),
    ) {
        // EVENT-FR-007 — a cancelled event stays visible and marked, so
        // somebody who never opened the notification still finds out. First
        // thing on the screen, and a live region so a screen reader says it
        // before reading a title that sounds like an invitation.
        if (state.isCancelled) {
            Text(
                text = stringResource(R.string.event_cancelled_notice),
                style = MohallaTheme.text(MohallaType.Body),
                color = MohallaTheme.colors.Error,
                modifier = Modifier
                    .fillMaxWidth()
                    .background(MohallaTheme.colors.ErrorSubtle, MohallaTheme.radius.ShapeMd)
                    .padding(MohallaTheme.spacing.Space3)
                    .semantics { liveRegion = LiveRegionMode.Polite },
            )
        }

        if (event.underReview) {
            Text(
                text = stringResource(R.string.event_under_review),
                style = MohallaTheme.text(MohallaType.BodySm),
                color = MohallaTheme.colors.Warning,
                modifier = Modifier
                    .fillMaxWidth()
                    .background(MohallaTheme.colors.WarningSubtle, MohallaTheme.radius.ShapeSm)
                    .padding(MohallaTheme.spacing.Space3),
            )
        }

        // 1 — the date, and the first question anybody asks.
        val dateLine = EventTimes.dateLine(event.startsAt, locale, zone)
        val timeLine = EventTimes.timeLine(event.startsAt, locale, zone)
        if (dateLine != null) {
            Column(verticalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space1)) {
                Text(
                    text = dateLine,
                    style = MohallaTheme.text(MohallaType.Title),
                    color = MohallaTheme.colors.BrandSecondary,
                )
                if (timeLine != null) {
                    Text(
                        text = timeLine,
                        style = MohallaTheme.text(MohallaType.BodyLg),
                        color = MohallaTheme.colors.BrandSecondary,
                    )
                }
            }
        }

        // 2 — the title.
        Text(
            text = event.title,
            style = MohallaTheme.text(MohallaType.H2),
            color = MohallaTheme.colors.TextPrimary,
            modifier = Modifier.semantics { heading() },
        )

        // 3 — the creator, with the badge (EVENT-FR-006).
        CreatorRow(
            creator = state.creator,
            unavailable = state.creatorUnavailable,
            onOpen = { onOpenCreator(event.creatorId) },
        )

        // 4 and 5 — type, and location or join control.
        WhereRow(event = event, locale = locale, zone = zone)

        if (state.showsJoinControl) {
            JoinControl(
                event = event,
                locale = locale,
                zone = zone,
                inFlight = state.joinInFlight,
                onJoin = onJoin,
            )
        }

        // 6 — the description, in full. This is the detail screen; nothing is
        // truncated here.
        Text(
            text = event.description,
            style = MohallaTheme.text(MohallaType.Body),
            color = MohallaTheme.colors.TextPrimary,
        )

        if (event.categorySlug != null) {
            Text(
                text = event.categorySlug,
                style = MohallaTheme.text(MohallaType.Label),
                color = MohallaTheme.colors.TextTertiary,
                modifier = Modifier
                    .background(MohallaTheme.colors.SurfaceSunken, MohallaTheme.radius.ShapeFull)
                    .padding(
                        horizontal = MohallaTheme.spacing.Space3,
                        vertical = MohallaTheme.spacing.Space1,
                    ),
            )
        }

        // 7 — the counts. AGGREGATES ONLY.
        AttendeeCounts(going = event.goingCount, interested = event.interestedCount)

        // 8 — the RSVP row, or the reason there isn't one.
        if (state.isCancelled) {
            Text(
                text = stringResource(R.string.event_cancelled_no_rsvp),
                style = MohallaTheme.text(MohallaType.BodySm),
                color = MohallaTheme.colors.TextSecondary,
            )
        } else if (EventTimes.hasStarted(event.startsAt, System.currentTimeMillis())) {
            // EVENT-FR-004: "RSVP to a past event is refused". Said rather than
            // offered — a button that exists only to be refused is worse than
            // no button.
            Text(
                text = stringResource(R.string.event_already_started),
                style = MohallaTheme.text(MohallaType.BodySm),
                color = MohallaTheme.colors.TextSecondary,
            )
        } else {
            EventRsvpRow(
                myResponse = event.myResponse,
                onGoing = { onRespond(RsvpResponse.GOING) },
                onInterested = { onRespond(RsvpResponse.INTERESTED) },
                enabled = state.canRespond,
            )
        }

        // A refused RSVP, explained. The three cases lead to different next
        // actions, which is why they are told apart.
        state.refusal?.let { RsvpRefusalNotice(it) }
    }
}

/**
 * The creator (EVENT-FR-006 — "creator with badge").
 *
 * RENDERS IN THREE STATES: resolved, still loading, and unavailable. The last
 * one is not an error: BR-025's neutral 404 covers a deleted, banned or
 * blocking account, and none of those makes the event unreadable. The row
 * simply carries no name — and is not tappable, because there is no profile
 * behind it.
 */
@Composable
private fun CreatorRow(
    creator: PublicProfileResponse?,
    unavailable: Boolean,
    onOpen: () -> Unit,
) {
    if (unavailable && creator == null) return

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .defaultMinSize(minHeight = MohallaTheme.spacing.Space12)
            .then(
                if (creator == null) {
                    Modifier
                } else {
                    Modifier.clickable(role = Role.Button, onClick = onOpen)
                },
            ),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space2),
    ) {
        Box(
            Modifier
                .size(MohallaTheme.spacing.Space12)
                .background(MohallaTheme.colors.SurfaceSunken, CircleShape),
        )

        Column(modifier = Modifier.weight(1f)) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space1),
            ) {
                Text(
                    // Blank while the second call is in flight rather than a
                    // placeholder name: an empty line that fills in is less
                    // jarring than "Loading…" replaced by a person's name.
                    text = creator?.displayName.orEmpty(),
                    style = MohallaTheme.text(MohallaType.Title),
                    color = MohallaTheme.colors.TextPrimary,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )

                // ADMIN-FR-010 — granted by an administrator, never implied by
                // account type. Text as well as colour (§35).
                if (creator?.verifiedBadge == true) {
                    Text(
                        text = stringResource(R.string.badge_verified),
                        style = MohallaTheme.text(MohallaType.Label),
                        color = MohallaTheme.colors.BrandPrimary,
                    )
                }
            }

            Text(
                text = stringResource(R.string.event_organiser),
                style = MohallaTheme.text(MohallaType.Caption),
                color = MohallaTheme.colors.TextTertiary,
            )
        }
    }
}

@Composable
private fun WhereRow(event: EventResponse, locale: Locale, zone: ZoneId) {
    val type = EventType.fromWire(event.eventType)

    Row(
        verticalAlignment = Alignment.Top,
        horizontalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space2),
    ) {
        Icon(
            imageVector = if (type == EventType.ONLINE) {
                Icons.AutoMirrored.Filled.ExitToApp
            } else {
                Icons.Filled.LocationOn
            },
            contentDescription = null,
            tint = MohallaTheme.colors.TextTertiary,
            modifier = Modifier.size(MohallaTheme.spacing.Space5),
        )

        Text(
            text = when (type) {
                EventType.ONLINE -> stringResource(R.string.event_type_online)
                EventType.PHYSICAL -> event.locationText?.takeIf { it.isNotBlank() }
                    ?: stringResource(R.string.event_type_physical)
                // An unrecognised type: neither field can be trusted to be the
                // right one, so neither is claimed.
                null -> stringResource(R.string.event_type_unknown)
            },
            style = MohallaTheme.text(MohallaType.Body),
            color = MohallaTheme.colors.TextPrimary,
            modifier = Modifier.weight(1f),
        )
    }
}

/**
 * The join control (EVENT-FR-003 · BR-045).
 *
 * THREE STATES, AND ALL THREE ARE VISIBLE RATHER THAN HIDDEN:
 *
 *   - `joinLinkAvailable` — an enabled button. Tapping it asks the server for
 *     the link and hands it to another app, because BR-045 means the platform
 *     hosts no video and there is nothing to open in-app.
 *   - not yet, with a time — the availability time STATED, which the
 *     acceptance criterion requires by name.
 *   - not yet, with no time — the caller has not responded, so responding is
 *     what unlocks it.
 *
 * THE SERVER DECIDES WHICH. `joinLinkAvailable` is not recomputed from
 * `startsAt` here: a device half an hour fast would show a button the server
 * refuses, and one behind would hide a link that works.
 */
@Composable
private fun JoinControl(
    event: EventResponse,
    locale: Locale,
    zone: ZoneId,
    inFlight: Boolean,
    onJoin: () -> Unit,
) {
    if (event.joinLinkAvailable) {
        MohallaButton(
            text = stringResource(R.string.event_join),
            onClick = onJoin,
            loading = inFlight,
            modifier = Modifier.fillMaxWidth(),
        )
        return
    }

    val from = event.joinLinkAvailableFrom
        ?.let { EventTimes.joinAvailableFrom(it, locale, zone) }

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(MohallaTheme.colors.SurfaceSunken, MohallaTheme.radius.ShapeMd)
            .padding(MohallaTheme.spacing.Space3),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space2),
    ) {
        Icon(
            imageVector = Icons.Filled.Lock,
            contentDescription = null,
            tint = MohallaTheme.colors.TextTertiary,
            modifier = Modifier.size(MohallaTheme.spacing.Space5),
        )
        Text(
            text = when {
                // The window is known but not open. State the time.
                from != null -> stringResource(R.string.event_join_opens_at, from)
                // No response yet, so no time was given: responding is what
                // unlocks it, and saying so is more useful than a clock.
                event.myResponse == null -> stringResource(R.string.event_join_needs_rsvp)
                else -> stringResource(
                    R.string.event_join_opens_minutes_before,
                    JOIN_WINDOW_MINUTES,
                )
            },
            style = MohallaTheme.text(MohallaType.BodySm),
            color = MohallaTheme.colors.TextSecondary,
            modifier = Modifier.weight(1f),
        )
    }
}

/**
 * "18 people going · 4 interested" — counts, and nothing about who.
 *
 * Both are plural resources. Interested is omitted at zero; Going is shown even
 * at zero on the DETAIL screen, unlike on the card, because somebody deciding
 * whether to attend is served by knowing that nobody has committed yet.
 */
@Composable
private fun AttendeeCounts(going: Int, interested: Int) {
    val parts = buildList {
        add(pluralStringResource(R.plurals.event_going_count, going, going))
        if (interested > 0) {
            add(pluralStringResource(R.plurals.event_interested_count, interested, interested))
        }
    }

    Text(
        text = parts.joinToString(" · "),
        style = MohallaTheme.text(MohallaType.BodySm),
        color = MohallaTheme.colors.TextSecondary,
    )
}

@Composable
private fun RsvpRefusalNotice(refusal: RsvpRefusal) {
    val text = when (refusal) {
        RsvpRefusal.AlreadyStarted -> stringResource(R.string.event_already_started)
        RsvpRefusal.Cancelled -> stringResource(R.string.event_cancelled_no_rsvp)
        // The neutral one. The event went away while it was open; nothing is
        // said about why (UX-STATE-001).
        RsvpRefusal.Unavailable -> stringResource(R.string.state_unavailable_body)
        is RsvpRefusal.Other -> refusal.failure.message
            ?: stringResource(R.string.state_error_body)
    }

    Text(
        text = text,
        style = MohallaTheme.text(MohallaType.BodySm),
        color = MohallaTheme.colors.Error,
        modifier = Modifier
            .fillMaxWidth()
            .background(MohallaTheme.colors.ErrorSubtle, MohallaTheme.radius.ShapeSm)
            .padding(MohallaTheme.spacing.Space3)
            .semantics { liveRegion = LiveRegionMode.Assertive },
    )
}

@Composable
private fun DetailFailure(failure: ApiFailure?, onRetry: () -> Unit) {
    when (failure) {
        ApiFailure.Offline -> OfflineState(onRetry = onRetry)
        is ApiFailure.Server -> ServerErrorState(
            correlationId = failure.correlationId,
            onRetry = onRetry,
        )
        else -> ServerErrorState(onRetry = onRetry)
    }
}

/**
 * What to do with a refused join (EVENT-FR-003).
 *
 * Returned as a string resource id rather than rendered here, so the screen can
 * put it wherever it belongs — a snackbar on the detail screen, a sheet if it is
 * ever reached from elsewhere.
 */
fun JoinRefusal.messageRes(): Int = when (this) {
    JoinRefusal.RsvpRequired -> R.string.event_join_needs_rsvp
    is JoinRefusal.TooEarly -> R.string.event_join_too_early
    JoinRefusal.NotOnline -> R.string.event_join_not_online
    JoinRefusal.Cancelled -> R.string.event_cancelled_no_rsvp
    JoinRefusal.Unavailable -> R.string.state_unavailable_body
    is JoinRefusal.Other -> R.string.state_error_body
}
