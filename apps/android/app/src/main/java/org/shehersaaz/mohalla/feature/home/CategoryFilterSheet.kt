package org.shehersaaz.mohalla.feature.home

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
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
import org.shehersaaz.mohalla.R
import org.shehersaaz.mohalla.core.design.MohallaTheme
import org.shehersaaz.mohalla.core.design.MohallaType
import org.shehersaaz.mohalla.core.network.CategoryResponse
import org.shehersaaz.mohalla.core.network.displayName

/**
 * UX-HOME-005 — filter both Home tabs to one category (FEED-FR-006).
 *
 * WHY THIS NEEDED BUILDING, AND WHAT WAS ALREADY THERE. Everything except the
 * control: `FeedViewModel.selectCategory` exists, `FeedUiState.category` exists,
 * and both `following()` and `discover()` already pass it to the API. The
 * open-issues register recorded it exactly: *"`selectCategory` exists in the
 * ViewModel and the filter reaches the API; there is no picker to drive it."*
 * This is the picker.
 *
 * A SHEET RATHER THAN A SCREEN, because the UI/UX inventory calls its entry a
 * "filter control" on Home and the result is a change to the list behind it.
 * Pushing a destination would put the feed on a back stack behind its own
 * filter, so dismissing the filter would feel like leaving Home.
 *
 * "ALL" IS A REAL OPTION, NOT A CLEAR BUTTON. The filter's off state is a
 * choice with a name, listed first and selected by default, because a reader who
 * has filtered to one category needs an obvious way back that does not look like
 * discarding something.
 *
 * THE LIST COMES FROM THE SERVER. BR-017 fixes eleven seeded categories and
 * they are not user-extensible, but they are also not the client's to hardcode —
 * the composer's own picker reads `GET /categories` and so does this, so the two
 * can never disagree about what exists or what it is called in Urdu.
 *
 * IT SCROLLS. Eleven rows at 48dp each is 528dp before the header, which
 * overflows a sheet on a small screen at any font scale and certainly at the
 * 130% §26 asks about. RUNTIME-006 was this mistake one screen over.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CategoryFilterSheet(
    categories: List<CategoryResponse>,
    selected: String?,
    onSelect: (String?) -> Unit,
    onDismiss: () -> Unit,
) {
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = MohallaTheme.colors.SurfacePrimary,
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = MohallaTheme.screenMargin)
                .padding(bottom = MohallaTheme.spacing.Space10),
            verticalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space1),
        ) {
            Text(
                text = stringResource(R.string.feed_filter_title),
                style = MohallaTheme.text(MohallaType.H3),
                color = MohallaTheme.colors.TextPrimary,
                modifier = Modifier
                    .padding(vertical = MohallaTheme.spacing.Space3)
                    .semantics { heading() },
            )

            CategoryRow(
                label = stringResource(R.string.feed_filter_all),
                isSelected = selected == null,
                onClick = { onSelect(null) },
            )

            // ONE DEFINITION OF THE LABEL, shared with the composer's own
            // picker: "both names arrive in one response, so either language
            // renders (BR-017)". Duplicating the fallback chain here is how the
            // two pickers would eventually disagree about a category's name.
            val isUrdu = MohallaTheme.isUrdu
            categories.forEach { category ->
                CategoryRow(
                    label = category.displayName(isUrdu),
                    isSelected = selected == category.slug,
                    onClick = { onSelect(category.slug) },
                )
            }
        }
    }
}

/**
 * One choice.
 *
 * SELECTION IS A FILL, NOT A TICK ALONE. §35 keeps meaning out of shape and
 * colour alone, so the selected row changes its background AND announces itself
 * through `Role.RadioButton` — a screen reader says "selected" without needing
 * to describe a glyph.
 *
 * 48dp MINIMUM, from the spacing scale rather than a number typed here.
 */
@Composable
private fun CategoryRow(
    label: String,
    isSelected: Boolean,
    onClick: () -> Unit,
) {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .defaultMinSize(minHeight = MohallaTheme.spacing.Space12)
            .background(
                color = if (isSelected) {
                    MohallaTheme.colors.BrandPrimary
                } else {
                    MohallaTheme.colors.SurfacePrimary
                },
                shape = MohallaTheme.radius.ShapeMd,
            )
            .selectable(
                selected = isSelected,
                role = Role.RadioButton,
                onClick = onClick,
            )
            .padding(horizontal = MohallaTheme.spacing.Space3),
        contentAlignment = Alignment.CenterStart,
    ) {
        Text(
            text = label,
            style = MohallaTheme.text(MohallaType.Body),
            color = if (isSelected) {
                MohallaTheme.colors.TextInverse
            } else {
                MohallaTheme.colors.TextPrimary
            },
        )
    }
}
