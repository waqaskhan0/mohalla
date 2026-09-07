package org.shehersaaz.mohalla.feature.events

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import java.time.ZoneId
import java.util.Locale
import org.shehersaaz.mohalla.R
import org.shehersaaz.mohalla.core.design.MohallaTheme
import org.shehersaaz.mohalla.core.design.MohallaType
import org.shehersaaz.mohalla.core.format.EventTimes
import org.shehersaaz.mohalla.core.network.ApiFailure
import org.shehersaaz.mohalla.core.network.EventType
import org.shehersaaz.mohalla.core.ui.LoadingState
import org.shehersaaz.mohalla.core.ui.MohallaBackHeader
import org.shehersaaz.mohalla.core.ui.MohallaButton
import org.shehersaaz.mohalla.core.ui.MohallaSecondaryButton
import org.shehersaaz.mohalla.core.ui.MohallaTextField

/**
 * Create and edit an event — UX-EVENT-004 · UX-EVENT-005
 * (EVENT-FR-001/002/007 · BR-043).
 *
 * ONE SCREEN FOR BOTH. The fields are identical and the differences are two:
 * the header's title, and whether Cancel-this-event is offered.
 *
 * NO ACCOUNT-TYPE GATE ANYWHERE. BR-043: "any active user may create events."
 * A suspended account never arrives here at all — the Create control opens the
 * suspension explainer instead (§6.2) — so there is nothing to check on this
 * screen and adding a check would imply the mobilization layer belongs to
 * badge-holders.
 *
 * THE TYPE SELECTOR COMES BEFORE THE LINK AND LOCATION FIELDS, because it
 * decides which of them is even shown. Rendering both and validating one is how
 * a creator fills in a location for an online event and loses it on submit.
 */
@Composable
fun EventComposerScreen(
    state: EventComposerUiState,
    locale: Locale,
    zone: ZoneId,
    onTitleChanged: (String) -> Unit,
    onDescriptionChanged: (String) -> Unit,
    onPickStartsAt: () -> Unit,
    onTypeChanged: (EventType) -> Unit,
    onMeetingUrlChanged: (String) -> Unit,
    onLocationChanged: (String) -> Unit,
    onSubmit: () -> Unit,
    onCancelEvent: () -> Unit,
    onBack: () -> Unit,
    onSaved: () -> Unit,
    onCancelled: (CancelOutcome) -> Unit,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(state.saved) { if (state.saved != null) onSaved() }
    LaunchedEffect(state.cancelled) { state.cancelled?.let(onCancelled) }

    Column(modifier = modifier.fillMaxSize().background(MohallaTheme.colors.BgPrimary)) {
        MohallaBackHeader(
            title = stringResource(
                when (state.mode) {
                    ComposerMode.CREATE -> R.string.events_create
                    ComposerMode.EDIT -> R.string.event_edit
                },
            ),
            onBack = onBack,
        )

        if (state.loading) {
            LoadingState()
            return@Column
        }

        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = MohallaTheme.screenMargin)
                .padding(vertical = MohallaTheme.spacing.Space4),
            verticalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space4),
        ) {
            // A refusal that is not about one field. Every typed value is still
            // on screen — §13: "preserve entered fields on transient errors",
            // and an event description is several minutes of work.
            state.failure?.let { FormNotice(it, state) }

            MohallaTextField(
                value = state.title,
                onValueChange = onTitleChanged,
                label = stringResource(R.string.event_field_title),
                error = state.fieldErrors["title"]?.let { stringResource(it.messageRes()) },
                helper = counter(state.title, EVENT_TITLE_MAX),
            )

            MohallaTextField(
                value = state.description,
                onValueChange = onDescriptionChanged,
                label = stringResource(R.string.event_field_description),
                error = state.fieldErrors["description"]?.let { stringResource(it.messageRes()) },
                helper = counter(state.description, EVENT_DESCRIPTION_MAX),
                singleLine = false,
            )

            StartsAtField(
                startsAtMillis = state.startsAtMillis,
                locale = locale,
                zone = zone,
                error = state.fieldErrors["startsAt"]?.let { stringResource(it.messageRes()) },
                onPick = onPickStartsAt,
            )

            TypeSelector(
                selected = state.type,
                frozen = state.typeFrozen,
                frozenAttempted = state.typeFrozenAttempted,
                error = state.fieldErrors["eventType"]?.let { stringResource(it.messageRes()) },
                onSelect = onTypeChanged,
            )

            // Exactly one of these, decided by the type (EVENT-FR-002). Neither
            // is shown until a type is chosen, because until then neither is
            // the right question.
            when (state.type) {
                EventType.ONLINE -> MohallaTextField(
                    value = state.meetingUrl,
                    onValueChange = onMeetingUrlChanged,
                    label = stringResource(R.string.event_field_meeting_url),
                    error = state.fieldErrors["meetingUrl"]
                        ?.let { stringResource(it.messageRes()) },
                    // On an edit the field starts empty and blank means "keep
                    // the existing link" — no response body carries the current
                    // one (EVENT-FR-003), so it cannot be prefilled and the
                    // creator has to be told what empty means.
                    helper = if (state.mode == ComposerMode.EDIT) {
                        stringResource(R.string.event_meeting_url_keep_existing)
                    } else {
                        stringResource(R.string.event_meeting_url_hint)
                    },
                    keyboardType = KeyboardType.Uri,
                    // A URL is LTR even in an Urdu interface. Forcing the
                    // direction stops `https://` being rendered with the scheme
                    // on the wrong side, which makes a correct link look broken.
                    forceLtrContent = true,
                )

                EventType.PHYSICAL -> MohallaTextField(
                    value = state.locationText,
                    onValueChange = onLocationChanged,
                    label = stringResource(R.string.event_field_location),
                    error = state.fieldErrors["locationText"]
                        ?.let { stringResource(it.messageRes()) },
                    helper = stringResource(R.string.event_location_hint),
                )

                null -> Unit
            }

            MohallaButton(
                text = stringResource(
                    when (state.mode) {
                        ComposerMode.CREATE -> R.string.event_publish
                        ComposerMode.EDIT -> R.string.event_save_changes
                    },
                ),
                onClick = onSubmit,
                enabled = state.canSubmit,
                loading = state.submitting,
                modifier = Modifier.fillMaxWidth(),
            )

            // EVENT-FR-007. Offered only on an edit, and the label does not
            // promise deletion: the server decides between deleting an event
            // nobody committed to and marking one somebody did, so a button
            // saying "Delete" would be a promise the requirement forbids
            // keeping.
            if (state.mode == ComposerMode.EDIT) {
                MohallaSecondaryButton(
                    text = stringResource(R.string.event_cancel_event),
                    onClick = onCancelEvent,
                    enabled = !state.cancelling && !state.submitting,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }
    }
}

/**
 * The start time.
 *
 * A BUTTON, NOT A TEXT FIELD. §18's input list has a date picker as its own
 * control, and a typed date has to be parsed against a locale — in Urdu, with
 * Eastern Arabic-Indic numerals, that is a guessing game. The platform picker
 * is already localised and already handles the calendar.
 *
 * The chosen value is displayed through [EventTimes], so it reads back in the
 * same locale and zone the event will be shown in — a creator in Karachi sees
 * the time attendees will see, not a UTC translation of it.
 */
@Composable
private fun StartsAtField(
    startsAtMillis: Long?,
    locale: Locale,
    zone: ZoneId,
    error: String?,
    onPick: () -> Unit,
) {
    val iso = startsAtMillis?.let { EventTimes.toIso(it) }
    val date = iso?.let { EventTimes.dateLine(it, locale, zone) }
    val time = iso?.let { EventTimes.timeLine(it, locale, zone) }

    Column(verticalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space1)) {
        Text(
            text = stringResource(R.string.event_field_starts_at),
            style = MohallaTheme.text(MohallaType.Label),
            color = MohallaTheme.colors.TextSecondary,
        )

        Box(
            modifier = Modifier
                .fillMaxWidth()
                .defaultMinSize(minHeight = MohallaTheme.spacing.Space12)
                .background(
                    MohallaTheme.colors.SurfacePrimary,
                    MohallaTheme.radius.ShapeMd,
                )
                .selectable(selected = false, role = Role.Button, onClick = onPick)
                .padding(MohallaTheme.spacing.Space3),
            contentAlignment = Alignment.CenterStart,
        ) {
            Text(
                text = listOfNotNull(date, time).takeIf { it.isNotEmpty() }?.joinToString(" · ")
                    ?: stringResource(R.string.event_pick_date_time),
                style = MohallaTheme.text(MohallaType.Body),
                color = if (startsAtMillis == null) {
                    MohallaTheme.colors.TextTertiary
                } else {
                    MohallaTheme.colors.TextPrimary
                },
            )
        }

        if (error != null) {
            Text(
                text = error,
                style = MohallaTheme.text(MohallaType.Caption),
                color = MohallaTheme.colors.Error,
                modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
            )
        }
    }
}

/**
 * Online or physical (EVENT-FR-002).
 *
 * TWO OPTIONS, NO DEFAULT. Neither is pre-selected: defaulting to Physical
 * would make an online event's creator notice the link field only after they
 * had filled in a location, and defaulting to Online is worse in a product whose
 * events are mostly gatherings. The same reasoning as BR-040's language choice —
 * a pre-selected answer is an answer the product gave itself.
 *
 * DISABLED ONCE ANYBODY HAS RESPONDED, with the reason stated. EVENT-FR-002's
 * acceptance criterion asks for a refusal "with the reason stated", and a
 * silently dead control is not that.
 */
@Composable
private fun TypeSelector(
    selected: EventType?,
    frozen: Boolean,
    frozenAttempted: Boolean,
    error: String?,
    onSelect: (EventType) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space2)) {
        Text(
            text = stringResource(R.string.event_field_type),
            style = MohallaTheme.text(MohallaType.Label),
            color = MohallaTheme.colors.TextSecondary,
            modifier = Modifier.semantics { heading() },
        )

        Row(horizontalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space2)) {
            EventType.entries.forEach { type ->
                val isSelected = type == selected
                Box(
                    modifier = Modifier
                        .weight(1f)
                        .defaultMinSize(minHeight = MohallaTheme.spacing.Space12)
                        .background(
                            color = when {
                                isSelected -> MohallaTheme.colors.BrandPrimary
                                frozen -> MohallaTheme.colors.BgSecondary
                                else -> MohallaTheme.colors.SurfacePrimary
                            },
                            shape = MohallaTheme.radius.ShapeMd,
                        )
                        .selectable(
                            selected = isSelected,
                            // Still enabled when frozen, so a tap can EXPLAIN
                            // rather than do nothing — the same reasoning as
                            // the locked Create tab in the bottom bar.
                            enabled = true,
                            role = Role.RadioButton,
                            onClick = { onSelect(type) },
                        ),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        text = stringResource(
                            when (type) {
                                EventType.ONLINE -> R.string.event_type_online
                                EventType.PHYSICAL -> R.string.event_type_physical
                            },
                        ),
                        style = MohallaTheme.text(MohallaType.Button),
                        color = when {
                            isSelected -> MohallaTheme.colors.TextInverse
                            frozen -> MohallaTheme.colors.TextTertiary
                            else -> MohallaTheme.colors.TextPrimary
                        },
                    )
                }
            }
        }

        if (frozenAttempted) {
            Text(
                text = stringResource(R.string.event_type_frozen),
                style = MohallaTheme.text(MohallaType.Caption),
                color = MohallaTheme.colors.Warning,
                modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
            )
        }

        if (error != null) {
            Text(
                text = error,
                style = MohallaTheme.text(MohallaType.Caption),
                color = MohallaTheme.colors.Error,
            )
        }
    }
}

/**
 * A refusal that is not about one field.
 *
 * `EVENT_TYPE_FROZEN` is deliberately NOT shown here — it belongs next to the
 * control it refused, so the type selector renders it instead. A banner at the
 * top of a scrolling form is the wrong place for a message about a control
 * halfway down it.
 */
@Composable
private fun FormNotice(failure: ApiFailure, state: EventComposerUiState) {
    val validationCode = (failure as? ApiFailure.Validation)?.code
    if (validationCode == "EVENT_TYPE_FROZEN") return
    // A validation failure that named its fields is already rendered under
    // those fields; repeating it in a banner says the same thing twice.
    if (failure is ApiFailure.Validation && state.fieldErrors.isNotEmpty()) return

    val text = when (failure) {
        ApiFailure.Offline -> stringResource(R.string.state_offline_banner)
        // EVENT-FR-001 E4 — five events per user per day. The server's message
        // names the number, so it is shown rather than re-composed here.
        is ApiFailure.RateLimited -> failure.message
            ?: stringResource(R.string.event_rate_limited, MAX_EVENTS_PER_DAY)
        // BR-034. A suspended account should never have reached this screen, so
        // this is the belt to §6.2's braces.
        is ApiFailure.Restricted -> failure.message
            ?: stringResource(R.string.state_restricted_body)
        is ApiFailure.Unavailable -> stringResource(R.string.state_unavailable_body)
        else -> failure.message ?: stringResource(R.string.state_error_body)
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

/**
 * "1,880 characters left".
 *
 * Shown only in the last stretch, not from the first keystroke: a counter on an
 * empty field is a warning about nothing, and on a 2000-character description it
 * would be visible for the entire time somebody is writing.
 */
@Composable
private fun counter(value: String, limit: Int): String? {
    val used = org.shehersaaz.mohalla.feature.setup.graphemeLength(value)
    val left = limit - used
    val threshold = limit / 10
    return if (left <= threshold) stringResource(R.string.field_characters_left, left) else null
}

/** One string resource per problem, so both catalogues carry the copy. */
fun EventFieldProblem.messageRes(): Int = when (this) {
    EventFieldProblem.EMPTY -> R.string.event_problem_empty
    EventFieldProblem.TOO_SHORT -> R.string.event_problem_too_short
    EventFieldProblem.TOO_LONG -> R.string.field_too_long
    EventFieldProblem.NOT_IN_THE_FUTURE -> R.string.event_problem_past
    EventFieldProblem.NOT_A_WEB_LINK -> R.string.event_problem_not_a_link
    EventFieldProblem.MISSING_FOR_ONLINE -> R.string.event_problem_link_required
    EventFieldProblem.MISSING_FOR_PHYSICAL -> R.string.event_problem_location_required
    EventFieldProblem.BOTH_LINK_AND_LOCATION -> R.string.event_problem_both
}
