package org.shehersaaz.mohalla.feature.safety

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import org.shehersaaz.mohalla.R
import org.shehersaaz.mohalla.core.design.MohallaTheme
import org.shehersaaz.mohalla.core.design.MohallaType
import org.shehersaaz.mohalla.core.network.ApiFailure
import org.shehersaaz.mohalla.core.ui.MohallaButton
import org.shehersaaz.mohalla.core.ui.MohallaSecondaryButton
import org.shehersaaz.mohalla.core.ui.MohallaTextField

/**
 * The report sheet — UX-SAFE-001 · UX-SAFE-002 ("Used under stress").
 *
 * PURPOSE, VERBATIM: "make something stop, in two taps." Everything below is
 * that sentence applied.
 *
 * IT IS ALWAYS DISMISSIBLE. "Dismissible by tapping outside or dragging down.
 * Reporting is never a trap." So there is no confirmation on leaving, no
 * are-you-sure, and no state that traps somebody who opened it by accident or
 * changed their mind.
 *
 * EIGHT REASONS, ONE TAP EACH, IN PLAIN SENTENCES. The spec is explicit that
 * they are "plain sentences — not policy language, and translated". A reporter
 * choosing between "Harassment or bullying" and "Hate speech" is deciding
 * something about their own situation, not classifying it against a rulebook
 * they have not read.
 *
 * AND ONE ACKNOWLEDGEMENT, WHATEVER HAPPENED. "Already reported → the SAME
 * acknowledgement, count NOT incremented, tally NEVER revealed." There is
 * exactly one success branch in this file and nothing in the state it renders
 * from that could vary.
 *
 * `ModalBottomSheet` is still `ExperimentalMaterial3Api` in the pinned Compose
 * BOM, opted into HERE rather than module-wide — a project-level opt-in silently
 * covers every future experimental API too.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ReportSheet(
    state: ReportUiState,
    onDismiss: () -> Unit,
    onChooseReason: (ReportReason) -> Unit,
    onClearReason: () -> Unit,
    onNoteChanged: (String) -> Unit,
    onSubmit: () -> Unit,
    onBlock: () -> Unit,
) {
    val sheetState = rememberModalBottomSheetState()

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = MohallaTheme.colors.SurfacePrimary,
        shape = MohallaTheme.radius.ShapeSheet,
    ) {
        Column(
            modifier = Modifier
                .padding(horizontal = MohallaTheme.screenMargin)
                .padding(bottom = MohallaTheme.spacing.Space6)
                .navigationBarsPadding()
                .imePadding(),
            verticalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space3),
        ) {
            when {
                // THE ONE SUCCESS STATE. See the file comment.
                state.acknowledged -> Acknowledgement(
                    state = state,
                    onBlock = onBlock,
                    onDone = onDismiss,
                )

                state.reason == null -> ReasonList(
                    target = state.target,
                    onChoose = onChooseReason,
                )

                else -> NoteStep(
                    state = state,
                    onClearReason = onClearReason,
                    onNoteChanged = onNoteChanged,
                    onSubmit = onSubmit,
                )
            }
        }
    }
}

@Composable
private fun ReasonList(target: ReportTarget, onChoose: (ReportReason) -> Unit) {
    Text(
        text = stringResource(target.titleRes),
        style = MohallaTheme.text(MohallaType.H3),
        color = MohallaTheme.colors.TextPrimary,
        modifier = Modifier.semantics { heading() },
    )
    Text(
        text = stringResource(R.string.report_why),
        style = MohallaTheme.text(MohallaType.Body),
        color = MohallaTheme.colors.TextSecondary,
    )

    Spacer(Modifier.height(MohallaTheme.spacing.Space1))

    // ENUMERATED FROM THE ENUM, so the eight the requirement names are the eight
    // offered, in its order — and a ninth added to the enum cannot be forgotten
    // here, because `labelRes` is an exhaustive `when`.
    ReportReason.entries.forEach { reason ->
        ReasonRow(reason = reason, onClick = { onChoose(reason) })
    }
}

@Composable
private fun ReasonRow(reason: ReportReason, onClick: () -> Unit) {
    Column {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clickable(role = Role.Button, onClick = onClick)
                .defaultMinSize(minHeight = MohallaTheme.spacing.Space12)
                .padding(vertical = MohallaTheme.spacing.Space3),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space2),
        ) {
            Text(
                text = stringResource(reason.labelRes),
                style = MohallaTheme.text(MohallaType.Body),
                color = MohallaTheme.colors.TextPrimary,
                modifier = Modifier.weight(1f),
            )
            // The one directional icon on this sheet, and it MUST mirror: a
            // chevron pointing right in Urdu points backwards.
            Icon(
                imageVector = Icons.AutoMirrored.Filled.KeyboardArrowRight,
                contentDescription = null,
                tint = MohallaTheme.colors.TextTertiary,
                modifier = Modifier.size(MohallaTheme.spacing.Space5),
            )
        }

        Box(
            Modifier
                .fillMaxWidth()
                .height(HAIRLINE)
                .background(MohallaTheme.colors.BorderDefault),
        )
    }
}

@Composable
private fun NoteStep(
    state: ReportUiState,
    onClearReason: () -> Unit,
    onNoteChanged: (String) -> Unit,
    onSubmit: () -> Unit,
) {
    Text(
        text = stringResource(state.target.titleRes),
        style = MohallaTheme.text(MohallaType.H3),
        color = MohallaTheme.colors.TextPrimary,
        modifier = Modifier.semantics { heading() },
    )

    // The chosen reason, and a way back to the list. Reporting is never a trap,
    // and that includes being stuck on the wrong reason.
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(role = Role.Button, onClick = onClearReason)
            .defaultMinSize(minHeight = MohallaTheme.spacing.Space12),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space2),
    ) {
        Text(
            text = state.reason?.let { stringResource(it.labelRes) }.orEmpty(),
            style = MohallaTheme.text(MohallaType.Body),
            color = MohallaTheme.colors.TextPrimary,
            modifier = Modifier.weight(1f),
        )
        Text(
            text = stringResource(R.string.report_change_reason),
            style = MohallaTheme.text(MohallaType.Button),
            color = MohallaTheme.colors.BrandPrimary,
        )
    }

    MohallaTextField(
        value = state.note,
        onValueChange = onNoteChanged,
        // OPTIONAL, and the label says so. Requiring a note would make the
        // fastest path through this sheet the one that asks a distressed person
        // to write about it.
        label = stringResource(R.string.report_note_optional),
        singleLine = false,
        helper = stringResource(
            R.string.field_characters_left,
            REPORT_NOTE_MAX_GRAPHEMES - state.noteLength,
        ),
        error = stringResource(R.string.field_too_long).takeIf { state.noteTooLong },
    )

    state.failure?.let { failure ->
        Text(
            text = when (failure) {
                // The report was NOT queued, and the copy does not pretend it
                // was — see GAP-M-014. What it does say is that nothing was
                // lost, which is true: the reason and the note are still here.
                ApiFailure.Offline -> stringResource(R.string.report_offline)
                is ApiFailure.RateLimited ->
                    failure.message ?: stringResource(R.string.state_rate_limited_body)
                // SAFETY-FR-001 refuses a report of your own content, and the
                // server says so plainly — it discloses nothing.
                is ApiFailure.Validation ->
                    failure.message ?: stringResource(R.string.report_failed)
                else -> stringResource(R.string.report_failed)
            },
            style = MohallaTheme.text(MohallaType.BodySm),
            color = MohallaTheme.colors.Error,
        )
    }

    MohallaButton(
        text = stringResource(R.string.report_submit),
        onClick = onSubmit,
        enabled = state.canSubmit,
        loading = state.submitting,
        modifier = Modifier.fillMaxWidth(),
    )
}

/**
 * "Thank you. Our team will review this." — then the block.
 *
 * OFFERED IMMEDIATELY, "because in practice the two go together". Somebody who
 * has just reported harassment usually also wants that person gone from their
 * feed and unable to message them, and making them find Block separately is
 * making them do the second half of a decision they have already taken.
 *
 * IT IS AN OFFER AND NOT A DEFAULT. Blocking removes follows in both directions
 * and cannot be undone by cancelling — SAFETY-FR-006 restores visibility and
 * never the follows — so it stays a deliberate second tap.
 */
@Composable
private fun Acknowledgement(
    state: ReportUiState,
    onBlock: () -> Unit,
    onDone: () -> Unit,
) {
    Text(
        text = stringResource(R.string.report_thanks_title),
        style = MohallaTheme.text(MohallaType.H3),
        color = MohallaTheme.colors.TextPrimary,
        modifier = Modifier.semantics { heading() },
    )
    Text(
        // Says nothing about what happens next, because nothing about what
        // happens next is the reporter's to see. No count, no "this is now
        // hidden", no "you have already reported this".
        text = stringResource(R.string.report_thanks_body),
        style = MohallaTheme.text(MohallaType.Body),
        color = MohallaTheme.colors.TextSecondary,
    )

    if (state.blockFailed) {
        Text(
            text = stringResource(R.string.block_failed),
            style = MohallaTheme.text(MohallaType.BodySm),
            color = MohallaTheme.colors.Error,
        )
    }

    Spacer(Modifier.height(MohallaTheme.spacing.Space1))

    if (state.canBlockAfterwards && !state.blocked) {
        Text(
            text = stringResource(R.string.report_also_block),
            style = MohallaTheme.text(MohallaType.Body),
            color = MohallaTheme.colors.TextPrimary,
        )
        MohallaSecondaryButton(
            text = stringResource(R.string.block_action),
            onClick = onBlock,
            enabled = !state.blocking,
            modifier = Modifier.fillMaxWidth(),
        )
    }

    MohallaButton(
        text = stringResource(R.string.action_done),
        onClick = onDone,
        modifier = Modifier.fillMaxWidth(),
    )
}

/**
 * "Title naming the target type" — so the reporter can see what they are about
 * to report before they choose why.
 *
 * An exhaustive `when`, so a sixth target is a compile error here rather than a
 * sheet titled after whichever case came last.
 */
private val ReportTarget.titleRes: Int
    get() = when (this) {
        ReportTarget.POST -> R.string.report_title_post
        ReportTarget.COMMENT -> R.string.report_title_comment
        ReportTarget.EVENT -> R.string.report_title_event
        ReportTarget.PROFILE -> R.string.report_title_profile
        ReportTarget.CONVERSATION -> R.string.report_title_conversation
    }

/**
 * The eight, in plain sentences (SAFETY-FR-003 · OD-016).
 *
 * Exhaustive, so a reason added to the enum without copy is a compile error
 * rather than a blank row on a safety sheet.
 */
private val ReportReason.labelRes: Int
    get() = when (this) {
        ReportReason.SPAM_OR_MISLEADING -> R.string.report_reason_spam
        ReportReason.HARASSMENT_OR_BULLYING -> R.string.report_reason_harassment
        ReportReason.HATE_SPEECH -> R.string.report_reason_hate
        ReportReason.VIOLENCE_OR_THREATS -> R.string.report_reason_violence
        ReportReason.SEXUAL_OR_INAPPROPRIATE -> R.string.report_reason_sexual
        ReportReason.FALSE_INFORMATION -> R.string.report_reason_false
        ReportReason.IMPERSONATION -> R.string.report_reason_impersonation
        ReportReason.SOMETHING_ELSE -> R.string.report_reason_other
    }

private val HAIRLINE = 1.dp
