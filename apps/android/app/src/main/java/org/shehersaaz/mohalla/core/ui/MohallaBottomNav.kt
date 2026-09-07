package org.shehersaaz.mohalla.core.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.DateRange
import androidx.compose.material.icons.filled.Email
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Person
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import org.shehersaaz.mohalla.R
import org.shehersaaz.mohalla.core.design.MohallaTheme
import org.shehersaaz.mohalla.core.design.MohallaType
import org.shehersaaz.mohalla.navigation.MohallaTab

/**
 * The five-item bottom navigation (UI/UX §14 · §8 of the Stage 7 brief).
 *
 * THE RTL BEHAVIOUR IS THE WHOLE DESIGN OF THIS FILE.
 *
 * The row is laid out with `Arrangement.SpaceBetween` over
 * [MohallaTab.ordered], which is in **logical** order and is never reversed
 * here. Compose reverses a `Row` automatically when `LayoutDirection` is `Rtl`,
 * which the theme provides once at the root. So in Urdu the visual order
 * becomes Profile · Messages · **Create** · Events · Home — mirrored, with
 * **Create still third of five**, because the middle of an odd row is the same
 * position counted from either end.
 *
 * Two things this file deliberately does NOT do:
 *
 *   - It does not call `.reversed()`. That would double-mirror in Urdu, putting
 *     the order back to LTR while everything around it mirrored.
 *   - It does not right-align the labels and call it RTL, which is the specific
 *     mistake §8 names. Alignment is not mirroring.
 *
 * LABELS ARE ALWAYS VISIBLE. UI/UX §04 calls for "always-visible labels"
 * because the audience includes a cautious 55-year-old, and §35 requires that
 * icons not be the only carrier of meaning. Material's `NavigationBar` hides
 * labels for unselected items by default; that is why this is a plain `Row`
 * rather than a wrapped `NavigationBar`.
 */
@Composable
fun MohallaBottomNav(
    selected: MohallaTab,
    onSelect: (MohallaTab) -> Unit,
    modifier: Modifier = Modifier,
    /** Unread ACCEPTED conversations only — requests never inflate it (BR-027). */
    messagesBadgeCount: Int = 0,
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .background(MohallaTheme.colors.SurfacePrimary)
            .padding(
                horizontal = MohallaTheme.spacing.Space2,
                vertical = MohallaTheme.spacing.Space1,
            ),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        MohallaTab.ordered.forEach { tab ->
            NavItem(
                tab = tab,
                selected = tab == selected,
                badgeCount = if (tab == MohallaTab.MESSAGES) messagesBadgeCount else 0,
                onClick = { onSelect(tab) },
                modifier = Modifier.weight(1f),
            )
        }
    }
}

@Composable
private fun NavItem(
    tab: MohallaTab,
    selected: Boolean,
    badgeCount: Int,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val label = stringResource(tab.labelRes)
    val unreadLabel = if (badgeCount > 0) {
        stringResource(R.string.a11y_unread_count, badgeCount)
    } else {
        null
    }

    Column(
        modifier = modifier
            // 48dp minimum, and `defaultMinSize` so it grows rather than clips
            // when the system font is enlarged (§35, NFR-ACC-001).
            .defaultMinSize(minHeight = MohallaTheme.spacing.Space12)
            .selectable(
                selected = selected,
                role = Role.Tab,
                onClick = onClick,
            )
            .padding(vertical = MohallaTheme.spacing.Space1),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Box(contentAlignment = Alignment.TopEnd) {
            Icon(
                imageVector = tab.vector(),
                // The label below carries the meaning and the row announces
                // its own selection through `Role.Tab`, so describing the icon
                // again would make a screen reader say everything twice.
                contentDescription = null,
                tint = if (selected) {
                    MohallaTheme.colors.BrandPrimary
                } else {
                    MohallaTheme.colors.TextTertiary
                },
                modifier = Modifier.size(MohallaTheme.spacing.Space6),
            )

            if (badgeCount > 0) {
                // Positioned with `TopEnd`, so the badge moves to the icon's
                // top-LEFT in Urdu without a second layout.
                Box(
                    Modifier
                        .size(MohallaTheme.spacing.Space2)
                        .background(MohallaTheme.colors.Error, CircleShape),
                )
            }
        }

        Text(
            text = label,
            style = MohallaTheme.text(MohallaType.Caption),
            color = if (selected) {
                MohallaTheme.colors.BrandPrimary
            } else {
                MohallaTheme.colors.TextSecondary
            },
            textAlign = TextAlign.Center,
            // One line, ellipsised rather than wrapped: five wrapping labels
            // would change the bar's height between languages, and "پیغامات"
            // is wider than "Messages" at the same size.
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )

        // Announced but not drawn — the visual badge is a dot, and a dot has no
        // reading. Keeps count out of the visual design and in the semantics.
        if (unreadLabel != null) {
            Text(
                text = unreadLabel,
                style = MohallaTheme.text(MohallaType.Label),
                color = MohallaTheme.colors.TextTertiary,
                maxLines = 1,
            )
        }
    }
}

/**
 * Material's built-in icons stand in until the approved icon set is available.
 *
 * None of the five is directional, so none is `autoMirrored` — a house, a
 * calendar, a plus, an envelope and a person read identically in both
 * directions (`04-mobile-architecture.md` §3 rule 3). Back arrows and chevrons
 * are directional and are handled where they appear, not here.
 *
 * TODO(UI/UX §18): replace with the approved Mohalla icon set when supplied.
 */
private fun MohallaTab.vector(): ImageVector = when (this) {
    MohallaTab.HOME -> Icons.Filled.Home
    MohallaTab.EVENTS -> Icons.Filled.DateRange
    MohallaTab.CREATE -> Icons.Filled.Add
    MohallaTab.MESSAGES -> Icons.Filled.Email
    MohallaTab.PROFILE -> Icons.Filled.Person
}
