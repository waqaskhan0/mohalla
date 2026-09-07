package org.shehersaaz.mohalla.core.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextOverflow
import org.shehersaaz.mohalla.R
import org.shehersaaz.mohalla.core.design.MohallaTheme
import org.shehersaaz.mohalla.core.design.MohallaType
import org.shehersaaz.mohalla.core.network.PublicProfileResponse

/**
 * One person, as a row (UI/UX §18 — "user row", Identity group).
 *
 * SHARED, because the same four facts appear in five places: search results,
 * suggested accounts, followers, following, and the people a conversation is
 * with. §18 lists it once as a component for that reason, and
 * SEARCH-FR-001 names exactly what it carries — "photo, display name, username,
 * badge and city".
 *
 * NO FOLLOWER COUNT. It would fit, and it is deliberately absent: a count turns
 * a neighbourhood list into a popularity ranking, which is the wrong frame for a
 * product whose feed is chronological on purpose. The same reasoning kept counts
 * off the suggested-accounts screen in group 04.
 *
 * THE TRAILING SLOT IS A LAMBDA rather than a `showFollowButton` flag. Followers
 * needs Follow, search needs nothing, and a conversation list needs a timestamp;
 * a boolean for each would be four flags on a component that draws one row.
 */
@Composable
fun UserRow(
    user: PublicProfileResponse,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    trailing: @Composable (() -> Unit)? = null,
) {
    // BR-009 — a departed account's row, if one is ever rendered. The server
    // sends the localisation key rather than text, because both languages must
    // be able to say it.
    val isDeleted = user.displayName == DELETED_USER_KEY

    Row(
        modifier = modifier
            .fillMaxWidth()
            .defaultMinSize(minHeight = MohallaTheme.spacing.Space16)
            .then(
                if (isDeleted) {
                    Modifier
                } else {
                    Modifier.clickable(role = Role.Button, onClick = onClick)
                },
            )
            .padding(vertical = MohallaTheme.spacing.Space2),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space3),
    ) {
        MohallaAvatar(
            // PRIV-007 — what remains of a departed account carries no link
            // back, so no photo either.
            mediaId = user.photoMediaId?.takeIf { !isDeleted },
            contentDescription = null,
            size = MohallaTheme.spacing.Space12,
        )

        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space1),
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space1),
            ) {
                Text(
                    text = if (isDeleted) {
                        stringResource(R.string.profile_deleted_user)
                    } else {
                        user.displayName.orEmpty()
                    },
                    style = MohallaTheme.text(MohallaType.Title),
                    color = if (isDeleted) {
                        MohallaTheme.colors.TextTertiary
                    } else {
                        MohallaTheme.colors.TextPrimary
                    },
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )

                // ADMIN-FR-010 — granted by an administrator, never implied by
                // account type. Text as well as colour, so it survives a
                // colour-blind reader (§35).
                if (user.verifiedBadge && !isDeleted) {
                    Text(
                        text = stringResource(R.string.badge_verified),
                        style = MohallaTheme.text(MohallaType.Label),
                        color = MohallaTheme.colors.BrandPrimary,
                    )
                }
            }

            // Handle and city, in one line. The handle is FORCED LTR: a username
            // is ASCII by rule (BR-005), and rendering "@sana_bashir" in an
            // otherwise right-to-left line puts the @ on the wrong side and
            // makes a correct handle look mistyped.
            val meta = listOfNotNull(
                user.username?.takeIf { !isDeleted }?.let { "@$it" },
                user.city?.takeIf { !isDeleted },
            )

            if (meta.isNotEmpty()) {
                Text(
                    text = meta.joinToString(" · "),
                    style = MohallaTheme.text(MohallaType.Caption),
                    color = MohallaTheme.colors.TextTertiary,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }

        trailing?.invoke()
    }
}
