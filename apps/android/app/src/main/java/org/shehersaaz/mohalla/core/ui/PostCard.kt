package org.shehersaaz.mohalla.core.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.FavoriteBorder
import androidx.compose.material.icons.filled.Share
import androidx.compose.material.icons.outlined.MailOutline
import androidx.compose.material3.Icon
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
import org.shehersaaz.mohalla.core.network.FeedItemResponse

/**
 * The post card (UI/UX §18 · §15).
 *
 * IDENTITY IS VISUALLY PROMINENT, which §15 asks for and which is a product
 * decision rather than a style one: Mohalla's premise is that neighbours speak
 * to neighbours under their own names, so the author is not a byline in small
 * grey text under the content.
 *
 * BR-009 — "DELETED USER" IS RESOLVED HERE, NOT PRINTED.
 * The server sends a departed author's `displayName` as the localisation KEY
 * `profile.deletedUser`, because both languages must say it and the server does
 * not know which the reader wants. So this card checks for that key and
 * resolves it. A card that printed the key would show `profile.deletedUser` on
 * a real screen — which is the failure mode of sending keys, and the reason it
 * is handled in ONE component rather than at every call site.
 *
 * A DEPARTED AUTHOR IS NOT A MISSING POST. The content stays and is attributed;
 * only a BAN removes content with its author. That distinction was a defect
 * found and fixed during Stage 6 (see the EPIC-14 record), and this is where it
 * becomes visible.
 */
@Composable
fun PostCard(
    post: FeedItemResponse,
    onOpen: () -> Unit,
    onToggleLike: () -> Unit,
    onOpenAuthor: () -> Unit,
    onShare: () -> Unit,
    modifier: Modifier = Modifier,
    likePending: Boolean = false,
    /** MEDIA-FR-002 - the full-screen viewer, which arrives with group 09. */
    onOpenMedia: ((index: Int) -> Unit)? = null,
) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .background(MohallaTheme.colors.SurfacePrimary, MohallaTheme.radius.ShapeLg)
            .clickable(onClick = onOpen)
            .padding(MohallaTheme.spacing.Space4),
        verticalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space3),
    ) {
        AuthorRow(post = post, onOpenAuthor = onOpenAuthor)

        // BR-032 / PROFILE-FR-004 — the author's own view of an auto-hidden
        // post, marked. Nobody else sees the post at all, so this banner only
        // ever renders for its owner.
        if (post.underReview) {
            Text(
                text = stringResource(R.string.post_under_review),
                style = MohallaTheme.text(MohallaType.Caption),
                color = MohallaTheme.colors.Warning,
                modifier = Modifier
                    .fillMaxWidth()
                    .background(MohallaTheme.colors.WarningSubtle, MohallaTheme.radius.ShapeSm)
                    .padding(MohallaTheme.spacing.Space2),
            )
        }

        Text(
            text = post.body,
            style = MohallaTheme.text(MohallaType.Body),
            color = MohallaTheme.colors.TextPrimary,
            // Truncated in the feed, full on the detail screen. Six lines is
            // enough to judge whether to open it and short enough that a long
            // post does not own the whole screen.
            maxLines = 6,
            overflow = TextOverflow.Ellipsis,
        )

        if (post.mediaIds.isNotEmpty()) {
            // The first image, with a count over the rest. Four inline would
            // make one post own a whole 720x1280 screen, and MEDIA-FR-002 puts
            // the full set in the viewer where it can be swiped.
            MohallaImageStrip(
                mediaIds = post.mediaIds,
                onOpen = onOpenMedia?.let { open -> { index -> open(index) } },
            )
        }

        EngagementRow(
            post = post,
            onToggleLike = onToggleLike,
            onOpenComments = onOpen,
            onShare = onShare,
            likePending = likePending,
        )
    }
}

@Composable
private fun AuthorRow(post: FeedItemResponse, onOpenAuthor: () -> Unit) {
    // BR-009. The key is resolved to real text in the reader's language; a
    // departed author has no profile to open, so the row is not clickable.
    val isDeletedAuthor = post.author.displayName == DELETED_USER_KEY
    val authorName = if (isDeletedAuthor) {
        stringResource(R.string.profile_deleted_user)
    } else {
        post.author.displayName.orEmpty()
    }

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .then(
                if (isDeletedAuthor) {
                    Modifier
                } else {
                    Modifier.clickable(role = Role.Button, onClick = onOpenAuthor)
                },
            ),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space2),
    ) {
        MohallaAvatar(
            mediaId = post.author.photoMediaId,
            // The name beside it already identifies the person; describing the
            // photo too would make a screen reader say it twice.
            contentDescription = null,
            size = MohallaTheme.spacing.Space12,
        )

        Column(modifier = Modifier.weight(1f)) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space1),
            ) {
                Text(
                    text = authorName,
                    style = MohallaTheme.text(MohallaType.Title),
                    color = if (isDeletedAuthor) {
                        MohallaTheme.colors.TextTertiary
                    } else {
                        MohallaTheme.colors.TextPrimary
                    },
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )

                // PROFILE-FR-007 · ADMIN-FR-010 — one component, because the
                // requirement is about the badge looking the same on every
                // surface and disappearing from all of them at once.
                if (post.author.verifiedBadge) VerifiedBadge()
            }

            // City and time. A departed author has neither — the placeholder
            // carries no city and no handle, because PRIV-007 requires what
            // remains to carry no link back.
            val meta = listOfNotNull(
                post.author.city?.takeIf { !isDeletedAuthor },
                relativeTime(post.createdAt),
                post.categorySlug,
                post.editedAt?.let { stringResource(R.string.post_edited) },
            ).joinToString(" · ")

            Text(
                text = meta,
                style = MohallaTheme.text(MohallaType.Caption),
                color = MohallaTheme.colors.TextTertiary,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

@Composable
private fun EngagementRow(
    post: FeedItemResponse,
    onToggleLike: () -> Unit,
    onOpenComments: () -> Unit,
    onShare: () -> Unit,
    likePending: Boolean,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space5),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        EngagementAction(
            icon = if (post.viewerHasLiked) Icons.Filled.Favorite else Icons.Filled.FavoriteBorder,
            label = post.likeCount.toString(),
            contentDescription = stringResource(
                if (post.viewerHasLiked) R.string.a11y_unlike else R.string.a11y_like,
            ),
            tint = if (post.viewerHasLiked) {
                MohallaTheme.colors.Error
            } else {
                MohallaTheme.colors.TextSecondary
            },
            enabled = !likePending,
            onClick = onToggleLike,
        )

        EngagementAction(
            icon = Icons.Outlined.MailOutline,
            label = post.commentCount.toString(),
            contentDescription = stringResource(R.string.a11y_comments),
            tint = MohallaTheme.colors.TextSecondary,
            enabled = true,
            onClick = onOpenComments,
        )

        Box(modifier = Modifier.weight(1f))

        EngagementAction(
            icon = Icons.Filled.Share,
            label = null,
            contentDescription = stringResource(R.string.a11y_share),
            tint = MohallaTheme.colors.TextSecondary,
            enabled = true,
            onClick = onShare,
        )
    }
}

@Composable
private fun EngagementAction(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    label: String?,
    contentDescription: String,
    tint: androidx.compose.ui.graphics.Color,
    enabled: Boolean,
    onClick: () -> Unit,
) {
    Row(
        modifier = Modifier
            // 48dp even though the glyph is 24dp (§35). A count next to an icon
            // is a small target otherwise, and this is the most-tapped control
            // in the product.
            .defaultMinSize(
                minWidth = MohallaTheme.spacing.Space12,
                minHeight = MohallaTheme.spacing.Space12,
            )
            .clickable(enabled = enabled, role = Role.Button, onClick = onClick),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space1),
    ) {
        Icon(
            imageVector = icon,
            contentDescription = contentDescription,
            tint = tint,
            modifier = Modifier.size(MohallaTheme.spacing.Space6),
        )
        if (label != null) {
            Text(
                text = label,
                style = MohallaTheme.text(MohallaType.Caption),
                color = MohallaTheme.colors.TextSecondary,
            )
        }
    }
}

/**
 * The localisation key the server sends for a departed author (BR-009).
 *
 * Matches `DELETED_USER_NAME_KEY` in the backend's `public-profile.ts`. It is a
 * key rather than a string precisely so the client can render it in the
 * reader's language.
 */
const val DELETED_USER_KEY = "profile.deletedUser"

/**
 * A coarse relative time.
 *
 * TODO(EPIC-07): localised relative formatting. Right now this returns the
 * ISO date's day part, which is correct but blunt — and deliberately not a
 * hand-rolled "2 hours ago", because that needs pluralisation rules Urdu and
 * English do not share and belongs in a localised formatter rather than in a
 * card.
 */
private fun relativeTime(isoCreatedAt: String): String = isoCreatedAt.take(10)
