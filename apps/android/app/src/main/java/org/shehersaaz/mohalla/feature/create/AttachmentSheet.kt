package org.shehersaaz.mohalla.feature.create

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.selection.selectable
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.automirrored.filled.List
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import org.shehersaaz.mohalla.R
import org.shehersaaz.mohalla.core.design.MohallaTheme
import org.shehersaaz.mohalla.core.design.MohallaType
import org.shehersaaz.mohalla.core.network.CategoryResponse

/**
 * The attachment sheet — UX-CREATE-003 (POST-FR-002/004/005).
 *
 * THREE OFFERS IN THE SPEC, ONE OF WHICH WORKS TODAY, AND THE SHEET SAYS SO.
 *
 * - **Images** (MEDIA-FR-001, POST-FR-003) — built. Opens the system photo
 *   picker, capped at what remains of the four.
 * - **A link** (POST-FR-004) — nothing to build. The requirement is explicit
 *   that "the preview is fetched SERVER-SIDE, never by the device, so the
 *   user's IP is not disclosed to the linked host (SEC-014)". A URL in the post
 *   text is detected and previewed by the server; there is no client action, so
 *   an "attach a link" row would be a button that pastes nothing. The sheet
 *   explains that a link typed into the post is enough, which is the honest
 *   version of the same offer.
 * - **A document** (MEDIA-FR-003) — a *Should*, and a 10MB PDF path gated on an
 *   ADR-013 review that has not happened. Absent rather than disabled: a greyed
 *   row invites a tap that reports nothing useful, and the reduction is recorded
 *   in `20-mobile-open-issues.md`.
 *
 * A BOTTOM SHEET RATHER THAN A MENU. §14 rejects anchored dropdowns outright —
 * "anchored dropdowns land in the upper half of the screen, out of thumb reach"
 * — and the composer's attach control sits in a toolbar at the very bottom,
 * which is the worst possible anchor for one.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AttachmentSheet(
    imagesRemaining: Int,
    onPickImages: () -> Unit,
    onDismiss: () -> Unit,
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
            verticalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space2),
        ) {
            Text(
                text = stringResource(R.string.attach_title),
                style = MohallaTheme.text(MohallaType.H3),
                color = MohallaTheme.colors.TextPrimary,
                modifier = Modifier.semantics { heading() },
            )

            SheetRow(
                icon = Icons.AutoMirrored.Filled.List,
                label = stringResource(R.string.attach_images),
                // The remaining count, so somebody with three attached knows
                // they have one slot rather than discovering it in the picker.
                detail = pluralStringResource(
                    R.plurals.attach_images_remaining,
                    imagesRemaining,
                    imagesRemaining,
                ),
                enabled = imagesRemaining > 0,
                onClick = onPickImages,
            )

            // POST-FR-004, explained rather than offered. SEC-014 is the reason
            // there is no control: the device must never fetch the preview.
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = MohallaTheme.spacing.Space2),
                horizontalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space2),
            ) {
                Icon(
                    imageVector = Icons.Filled.Info,
                    contentDescription = null,
                    tint = MohallaTheme.colors.TextTertiary,
                    modifier = Modifier.size(MohallaTheme.spacing.Space5),
                )
                Text(
                    text = stringResource(R.string.attach_link_hint),
                    style = MohallaTheme.text(MohallaType.BodySm),
                    color = MohallaTheme.colors.TextSecondary,
                )
            }
        }
    }
}

/**
 * The category picker — UX-CREATE-004 (POST-FR-006 · BR-017).
 *
 * ELEVEN SEEDED CATEGORIES, NOT USER-EXTENSIBLE, and both names arrive in one
 * response so either language renders without a second call.
 *
 * NOTHING IS PRE-SELECTED. §13: "a default of General visible but unselected.
 * Choosing is one tap; skipping is free." So General appears in the list like
 * any other option and is never applied on the user's behalf — the same
 * reasoning as BR-040's language choice, and here the cost of a wrong default
 * is a drainage complaint filed under Environment.
 *
 * AN EMPTY LIST IS NOT AN ERROR. The categories request fails silently in the
 * ViewModel, because choosing one is optional and a nice-to-have list that did
 * not load must not block a post that is ready to publish. The sheet then says
 * so plainly rather than showing an empty scroll area.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CategoryPickerSheet(
    categories: List<CategoryResponse>,
    selected: String?,
    isUrdu: Boolean,
    onSelect: (String?) -> Unit,
    onDismiss: () -> Unit,
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
            verticalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space2),
        ) {
            Text(
                text = stringResource(R.string.category_title),
                style = MohallaTheme.text(MohallaType.H3),
                color = MohallaTheme.colors.TextPrimary,
                modifier = Modifier.semantics { heading() },
            )

            if (categories.isEmpty()) {
                Text(
                    text = stringResource(R.string.category_unavailable),
                    style = MohallaTheme.text(MohallaType.BodySm),
                    color = MohallaTheme.colors.TextSecondary,
                )
                return@Column
            }

            LazyColumn(
                modifier = Modifier.fillMaxWidth(),
                verticalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space1),
            ) {
                items(categories, key = { it.slug }) { category ->
                    CategoryRow(
                        label = category.displayName(isUrdu),
                        selected = category.slug == selected,
                        onClick = { onSelect(category.slug) },
                    )
                }
            }
        }
    }
}

@Composable
private fun SheetRow(
    icon: ImageVector,
    label: String,
    detail: String?,
    enabled: Boolean,
    onClick: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .defaultMinSize(minHeight = MohallaTheme.spacing.Space12)
            .clickable(enabled = enabled, role = Role.Button, onClick = onClick)
            .padding(vertical = MohallaTheme.spacing.Space2),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space3),
    ) {
        Icon(
            imageVector = icon,
            contentDescription = null,
            tint = if (enabled) {
                MohallaTheme.colors.BrandPrimary
            } else {
                MohallaTheme.colors.TextTertiary
            },
            modifier = Modifier.size(MohallaTheme.spacing.Space6),
        )

        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = label,
                style = MohallaTheme.text(MohallaType.Body),
                color = if (enabled) {
                    MohallaTheme.colors.TextPrimary
                } else {
                    MohallaTheme.colors.TextTertiary
                },
            )
            if (detail != null) {
                Text(
                    text = detail,
                    style = MohallaTheme.text(MohallaType.Caption),
                    color = MohallaTheme.colors.TextTertiary,
                )
            }
        }
    }
}

/**
 * One category.
 *
 * `selectable` with the radio role, so a screen reader announces "selected" —
 * the tick is the only visual cue, and §35 forbids a single carrier of meaning.
 */
@Composable
private fun CategoryRow(
    label: String,
    selected: Boolean,
    onClick: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .defaultMinSize(minHeight = MohallaTheme.spacing.Space12)
            .background(
                if (selected) {
                    MohallaTheme.colors.BrandPrimarySubtle
                } else {
                    MohallaTheme.colors.SurfacePrimary
                },
                MohallaTheme.radius.ShapeSm,
            )
            .selectable(selected = selected, role = Role.RadioButton, onClick = onClick)
            .padding(MohallaTheme.spacing.Space3),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space2),
    ) {
        Text(
            text = label,
            style = MohallaTheme.text(MohallaType.Body),
            color = MohallaTheme.colors.TextPrimary,
            modifier = Modifier.weight(1f),
        )

        if (selected) {
            Icon(
                imageVector = Icons.Filled.Check,
                contentDescription = null,
                tint = MohallaTheme.colors.BrandPrimary,
                modifier = Modifier.size(MohallaTheme.spacing.Space5),
            )
        }
    }
}
