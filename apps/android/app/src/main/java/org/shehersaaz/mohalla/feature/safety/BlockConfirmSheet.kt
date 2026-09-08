package org.shehersaaz.mohalla.feature.safety

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import org.shehersaaz.mohalla.R
import org.shehersaaz.mohalla.core.design.MohallaTheme
import org.shehersaaz.mohalla.core.design.MohallaType
import org.shehersaaz.mohalla.core.ui.MohallaButton
import org.shehersaaz.mohalla.core.ui.MohallaSecondaryButton

/**
 * Block confirmation — UX-SAFE-003 (SAFETY-FR-005 · BR-025).
 *
 * "STATES WHAT CHANGES FOR BOTH PARTIES", and that is the whole job. Blocking is
 * unilateral, mutual in effect, and permanent until undone: neither person can
 * see the other's profile, posts or comments; neither can follow, message, like,
 * comment on or mention the other; and existing follows in BOTH directions are
 * removed. That last one is what people do not expect, so it is said explicitly.
 *
 * AND THE ONE SENTENCE THAT MATTERS MOST: the blocked person is never told.
 * BR-025 makes the block undisclosable, and somebody deciding whether to block a
 * neighbour they will see at the shops tomorrow is deciding on exactly that
 * question. Leaving it unsaid means the safest option looks like the most
 * confrontational one.
 *
 * UNBLOCKING DOES NOT PUT THE FOLLOWS BACK — SAFETY-FR-006 restores visibility
 * and nothing else — so the sheet says the removal is permanent rather than
 * letting somebody discover it later.
 *
 * A TIER-2 DESTRUCTIVE ACTION, so §6.7 gives it a sheet with the safe choice
 * first: Cancel reads as the primary path and Block is the outlined one beside
 * it, never a filled red button under the reader's thumb.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BlockConfirmSheet(
    displayName: String?,
    blocking: Boolean,
    failed: Boolean,
    onDismiss: () -> Unit,
    onConfirm: () -> Unit,
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
                .navigationBarsPadding(),
            verticalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space3),
        ) {
            Text(
                // Named where a name is known, because "Block this person" and
                // "Block Ayesha Khan" are different decisions to be sure about.
                text = if (displayName.isNullOrBlank()) {
                    stringResource(R.string.block_title_generic)
                } else {
                    stringResource(R.string.block_title, displayName)
                },
                style = MohallaTheme.text(MohallaType.H3),
                color = MohallaTheme.colors.TextPrimary,
                modifier = Modifier.semantics { heading() },
            )

            Consequence(stringResource(R.string.block_effect_visibility))
            Consequence(stringResource(R.string.block_effect_contact))
            // The one people do not expect.
            Consequence(stringResource(R.string.block_effect_follows))
            // The one that decides it.
            Consequence(stringResource(R.string.block_effect_silent))

            if (failed) {
                Text(
                    text = stringResource(R.string.block_failed),
                    style = MohallaTheme.text(MohallaType.BodySm),
                    color = MohallaTheme.colors.Error,
                )
            }

            Spacer(Modifier.height(MohallaTheme.spacing.Space1))

            // §6.7 — the safe choice is the primary one, and it is ABOVE the
            // destructive one so a thumb reaching for the bottom of a sheet
            // finds Cancel.
            MohallaButton(
                text = stringResource(R.string.action_cancel),
                onClick = onDismiss,
                modifier = Modifier.fillMaxWidth(),
            )
            MohallaSecondaryButton(
                text = stringResource(R.string.block_action),
                onClick = onConfirm,
                enabled = !blocking,
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

/**
 * One line of what changes.
 *
 * A BULLET AND A SENTENCE, not an icon — §35 keeps meaning out of colour and
 * shape alone, and these four lines are the entire basis on which somebody makes
 * this decision.
 */
@Composable
private fun Consequence(text: String) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.Top,
        horizontalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space2),
    ) {
        Text(
            text = "•",
            style = MohallaTheme.text(MohallaType.Body),
            color = MohallaTheme.colors.TextTertiary,
        )
        Text(
            text = text,
            style = MohallaTheme.text(MohallaType.Body),
            color = MohallaTheme.colors.TextSecondary,
        )
    }
}
