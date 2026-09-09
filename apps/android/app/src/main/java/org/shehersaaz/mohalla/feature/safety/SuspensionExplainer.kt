package org.shehersaaz.mohalla.feature.safety

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Info
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import org.shehersaaz.mohalla.R
import org.shehersaaz.mohalla.core.design.MohallaTheme
import org.shehersaaz.mohalla.core.design.MohallaType
import org.shehersaaz.mohalla.core.ui.MohallaSecondaryButton

/**
 * The suspension banner and its explainer (UX-SAFE-004 · BR-034 · ADMIN-FR-006).
 *
 * WHAT THE SPEC ASKS FOR, VERBATIM: "read everything · persistent banner · every
 * write action opens an explainer sheet instead of failing". Three separate
 * requirements, and the third is the one that is easy to get wrong — a suspended
 * account that reaches a composer and is refused on submit has been told the
 * truth too late, after composing a post that cannot be published.
 *
 * READING IS NEVER RESTRICTED. BR-034 limits writing only. A suspension that
 * locked the feed would be a ban by another name, and the product does not have
 * one of those short of the real thing.
 *
 * THE BANNER IS NOT DISMISSIBLE. It is the answer to "why did nothing happen
 * when I tapped that", and a banner the user can close is a banner they will
 * close and then need. It costs one row of a screen they can otherwise read
 * entirely.
 */
@Composable
fun SuspensionBanner(
    /** Pre-formatted for the reader's locale, or `null` when indefinite. */
    untilLabel: String?,
    onLearnMore: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .background(MohallaTheme.colors.WarningSubtle)
            .defaultMinSize(minHeight = MohallaTheme.spacing.Space12)
            .clickable(role = Role.Button, onClick = onLearnMore)
            .padding(
                horizontal = MohallaTheme.screenMargin,
                vertical = MohallaTheme.spacing.Space2,
            ),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space2),
    ) {
        Icon(
            imageVector = Icons.Filled.Info,
            contentDescription = null,
            tint = MohallaTheme.colors.Warning,
            modifier = Modifier.size(MohallaTheme.spacing.Space5),
        )

        Text(
            // "Your account is limited until 14 September", or the indefinite
            // wording when there is no end date. NOT "you are suspended": the
            // spec's copy names the CONSEQUENCE, which is what the reader needs,
            // and the word for the sanction belongs in the explainer with the
            // reason next to it.
            text = if (untilLabel != null) {
                stringResource(R.string.suspension_banner_until, untilLabel)
            } else {
                stringResource(R.string.suspension_banner_indefinite)
            },
            style = MohallaTheme.text(MohallaType.BodySm),
            color = MohallaTheme.colors.TextPrimary,
            modifier = Modifier
                .weight(1f)
                // Announced when it appears — a suspension arriving mid-session
                // is exactly the change a screen-reader user must not miss.
                .semantics { liveRegion = LiveRegionMode.Polite },
        )

        Text(
            text = stringResource(R.string.action_learn_more),
            style = MohallaTheme.text(MohallaType.Button),
            color = MohallaTheme.colors.BrandPrimary,
        )
    }
}

/**
 * The explainer sheet — "what was breached, how long it lasts, how to appeal".
 *
 * THE APPEAL ROUTE IS NOT A FORM. OD-020 leaves the platform with no named
 * technical owner and therefore no provisioned administrator, so there is
 * nobody to receive an in-app appeal, and a form that filed one into a queue
 * nobody reads would be worse than saying where to write. The copy points at
 * the support address instead. When an owner is named and the queue has a
 * reader, this becomes an in-app route — and not before.
 *
 * WHAT WAS BREACHED IS QUOTED FROM THE SERVER, not composed here. The client
 * does not know the guidelines' numbering, and inventing a summary would risk
 * telling a user they breached something they did not.
 *
 * `ModalBottomSheet` is still `ExperimentalMaterial3Api` in the pinned Compose
 * BOM, so it is opted into HERE and nowhere else — on the one composable that
 * needs it, rather than module-wide in the build file, because a project-level
 * opt-in silently covers every future experimental API too. §6.7 requires a
 * bottom sheet for a T2 explainer and Material3 offers no stable alternative.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SuspensionExplainerSheet(
    untilLabel: String?,
    reason: String?,
    onDismiss: () -> Unit,
    onContactSupport: () -> Unit,
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
                .fillMaxWidth()
                .padding(horizontal = MohallaTheme.screenMargin)
                .padding(bottom = MohallaTheme.spacing.Space8),
            verticalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space3),
        ) {
            Text(
                text = stringResource(R.string.suspension_title),
                style = MohallaTheme.text(MohallaType.H3),
                color = MohallaTheme.colors.TextPrimary,
                modifier = Modifier.semantics { heading() },
            )

            Text(
                text = if (untilLabel != null) {
                    stringResource(R.string.suspension_duration_until, untilLabel)
                } else {
                    stringResource(R.string.suspension_duration_indefinite)
                },
                style = MohallaTheme.text(MohallaType.Body),
                color = MohallaTheme.colors.TextPrimary,
            )

            // Omitted entirely when the server sent none, rather than filled
            // with "a guideline was breached" — a placeholder reason reads as an
            // accusation without a subject.
            if (!reason.isNullOrBlank()) {
                Text(
                    text = reason,
                    style = MohallaTheme.text(MohallaType.Body),
                    color = MohallaTheme.colors.TextSecondary,
                )
            }

            // BR-034 stated plainly, because it is the thing a suspended user
            // most needs to know and least expects.
            Text(
                text = stringResource(R.string.suspension_what_still_works),
                style = MohallaTheme.text(MohallaType.BodySm),
                color = MohallaTheme.colors.TextSecondary,
            )

            MohallaSecondaryButton(
                text = stringResource(R.string.suspension_contact_support),
                onClick = onContactSupport,
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}
