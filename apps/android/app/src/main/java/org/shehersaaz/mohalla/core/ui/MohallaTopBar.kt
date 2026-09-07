package org.shehersaaz.mohalla.core.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import org.shehersaaz.mohalla.R
import org.shehersaaz.mohalla.core.design.MohallaTheme
import org.shehersaaz.mohalla.core.design.MohallaType

/**
 * The top app bar (UI/UX §18.5).
 *
 * The spec is exact and unusually restrictive: "56dp tall, hairline bottom
 * border, no elevation — it sits on the ground, not above it", title at the
 * logical start, "up to two actions". So this is a plain `Row` with a hairline
 * rather than Material's `TopAppBar`, which brings a scroll-elevation behaviour
 * the spec explicitly does not want and a title slot that centres on some
 * variants.
 *
 * TWO ACTIONS IS A LIMIT, NOT A SUGGESTION — asserted below. A third action on a
 * 360dp screen in Urdu, where the title is typically wider than its English
 * equivalent, either truncates the title to nothing or pushes an action off the
 * edge, and neither failure is visible on a developer's 411dp device.
 *
 * NOTHING HERE IS ALIGNED WITH AN EXPLICIT `Start`/`End`. Laying the row out in
 * logical order is what mirrors it in Urdu; `Alignment.Start` would too, but
 * writing `Absolute.Left` anywhere — or right-aligning the title to "look
 * right" in Urdu — is the mistake §8 warns against, because it double-mirrors.
 */
@Composable
fun MohallaTopBar(
    title: String,
    modifier: Modifier = Modifier,
    actions: List<TopBarAction> = emptyList(),
) {
    require(actions.size <= MAX_ACTIONS) {
        "The top app bar takes at most $MAX_ACTIONS actions (UI/UX §18.5)"
    }

    Column(modifier = modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(MohallaTheme.colors.SurfacePrimary)
                // `defaultMinSize`, not `height`: the spec's 56dp is a minimum,
                // and a fixed height clips the title at a 130% font scale —
                // the case REL-002 tests (NFR-ACC-001).
                .defaultMinSize(minHeight = TOP_BAR_HEIGHT)
                .padding(horizontal = MohallaTheme.screenMargin),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space2),
        ) {
            Text(
                text = title,
                style = MohallaTheme.text(MohallaType.H3),
                color = MohallaTheme.colors.TextPrimary,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier
                    .weight(1f)
                    .semantics { heading() },
            )

            actions.forEach { action -> TopBarActionButton(action) }
        }

        // The hairline. `BorderDefault` at 1dp, and no shadow anywhere — the
        // bar is on the ground, so an elevation token here would be wrong even
        // though it would look conventional.
        Box(
            Modifier
                .fillMaxWidth()
                .height(1.dp)
                .background(MohallaTheme.colors.BorderDefault),
        )
    }
}

/**
 * A back header (UI/UX §18.5) — "back chevron plus contextual title".
 *
 * THE CHEVRON MIRRORS AND IS THE ONE ICON THAT MUST. `AutoMirrored` does it at
 * the framework level, which is right: in Urdu, back is to the right, and a
 * left-pointing arrow there means forward. This is the single most noticeable
 * RTL defect in any app, and it is a one-word fix that has to be made
 * deliberately every time.
 */
@Composable
fun MohallaBackHeader(
    title: String,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
    actions: List<TopBarAction> = emptyList(),
) {
    require(actions.size <= MAX_ACTIONS) {
        "A back header takes at most $MAX_ACTIONS actions (UI/UX §18.5)"
    }

    Column(modifier = modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(MohallaTheme.colors.SurfacePrimary)
                .defaultMinSize(minHeight = TOP_BAR_HEIGHT)
                .padding(horizontal = MohallaTheme.spacing.Space2),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space1),
        ) {
            TopBarActionButton(
                TopBarAction(
                    icon = Icons.AutoMirrored.Filled.ArrowBack,
                    descriptionRes = R.string.action_back,
                    onClick = onBack,
                ),
            )

            Text(
                text = title,
                style = MohallaTheme.text(MohallaType.Title),
                color = MohallaTheme.colors.TextPrimary,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier
                    .weight(1f)
                    .semantics { heading() },
            )

            actions.forEach { action -> TopBarActionButton(action) }
        }

        Box(
            Modifier
                .fillMaxWidth()
                .height(1.dp)
                .background(MohallaTheme.colors.BorderDefault),
        )
    }
}

/**
 * One top-bar action.
 *
 * `descriptionRes` rather than a resolved string, so an action can be declared
 * outside composition without losing its localisation — and so an icon-only
 * control can never be constructed without a description (NFR-ACC-003).
 */
data class TopBarAction(
    val icon: ImageVector,
    val descriptionRes: Int,
    val onClick: () -> Unit,
    /** Drawn as a dot; the count reaches a screen reader through the label. */
    val badgeCount: Int = 0,
)

@Composable
private fun TopBarActionButton(action: TopBarAction) {
    val base = stringResource(action.descriptionRes)
    val description = if (action.badgeCount > 0) {
        "$base, " + stringResource(R.string.a11y_unread_count, action.badgeCount)
    } else {
        base
    }

    Box(
        modifier = Modifier
            .size(MohallaTheme.spacing.Space12)
            .clickable(role = Role.Button, onClick = action.onClick),
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            imageVector = action.icon,
            contentDescription = description,
            tint = MohallaTheme.colors.TextSecondary,
            modifier = Modifier.size(MohallaTheme.spacing.Space6),
        )

        if (action.badgeCount > 0) {
            // `TopEnd` inside the 48dp target, so the dot lands on the icon's
            // top-left in Urdu with no second layout.
            Box(
                Modifier
                    .align(Alignment.TopEnd)
                    .padding(MohallaTheme.spacing.Space2)
                    .size(MohallaTheme.spacing.Space2)
                    .background(MohallaTheme.colors.Error, CircleShape),
            )
        }
    }
}

/** Home's two actions (§14: "Home carries Search and Notifications"). */
@Composable
fun homeActions(
    onSearch: () -> Unit,
    onNotifications: () -> Unit,
    unreadNotifications: Int,
): List<TopBarAction> = listOf(
    TopBarAction(
        icon = Icons.Filled.Search,
        descriptionRes = R.string.action_search,
        onClick = onSearch,
    ),
    TopBarAction(
        icon = Icons.Filled.Notifications,
        descriptionRes = R.string.action_notifications,
        onClick = onNotifications,
        badgeCount = unreadNotifications,
    ),
)

/**
 * 56dp — a platform constant, not a spacing decision.
 *
 * The one number in this file that is not from the 4dp scale, and it is declared
 * here rather than added to `MohallaSpacing` for that reason: §26 fixes the bar
 * at 56dp because that is Android's own app-bar height, while the scale governs
 * space BETWEEN things rather than the size of platform chrome. Reaching for
 * `Space12` (48dp) to stay on-scale would make every Mohalla screen's bar
 * shorter than every other Android app's.
 *
 * A minimum, never a fixed height — see the `defaultMinSize` above.
 */
private val TOP_BAR_HEIGHT = 56.dp

/** §18.5: "screen title left (right in RTL), plus up to two actions". */
private const val MAX_ACTIONS = 2
