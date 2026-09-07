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
import androidx.compose.material.icons.filled.Lock
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
    /**
     * BR-034 · UX-SAFE-004 — a suspended account.
     *
     * Create renders LOCKED rather than absent or silently broken. §14: "visibly
     * disabled with a lock affordance when the account is suspended", and §6.2:
     * "tapping it opens the explanation rather than failing silently" — so the
     * item stays tappable and the caller decides what the tap does. Removing it
     * would renumber the row and move Create off centre, which is the one thing
     * the RTL rule in [MohallaTab] depends on.
     */
    createLocked: Boolean = false,
    /**
     * §14 — "a small dot appears when the account is suspended or has content
     * under review, so the user notices without an alarming badge".
     *
     * Deliberately not the red count badge Messages uses: this is information,
     * not a demand.
     */
    profileAttention: Boolean = false,
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
                locked = createLocked && tab == MohallaTab.CREATE,
                attention = profileAttention && tab == MohallaTab.PROFILE,
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
    locked: Boolean,
    attention: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val label = stringResource(tab.labelRes)

    // The count reaches a screen reader through the icon's description rather
    // than as visible text: the visual badge is a dot, and a dot has no
    // reading. A locked Create says so for the same reason — the padlock is the
    // only visual cue, so it must also be the spoken one.
    val iconDescription = when {
        locked -> stringResource(R.string.a11y_create_locked)
        badgeCount > 0 -> stringResource(R.string.a11y_unread_count, badgeCount)
        attention -> stringResource(R.string.a11y_profile_attention)
        // Otherwise silent: the label below already carries the meaning and the
        // row announces its own selection through `Role.Tab`, so describing the
        // icon too would make a screen reader say everything twice.
        else -> null
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
                imageVector = if (locked) Icons.Filled.Lock else tab.vector(),
                contentDescription = iconDescription,
                tint = when {
                    // Locked reads as unavailable in COLOUR AND SHAPE. §35
                    // forbids colour as the only carrier, and a greyed plus
                    // alone would be exactly that.
                    locked -> MohallaTheme.colors.TextTertiary
                    selected -> MohallaTheme.colors.BrandPrimary
                    else -> MohallaTheme.colors.TextTertiary
                },
                modifier = Modifier.size(MohallaTheme.spacing.Space6),
            )

            if (attention) {
                // Neutral, not alarming: brand colour, and the same 8dp dot the
                // badge uses so the bar's rhythm does not change.
                Box(
                    Modifier
                        .size(MohallaTheme.spacing.Space2)
                        .background(MohallaTheme.colors.BrandPrimary, CircleShape),
                )
            }

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
