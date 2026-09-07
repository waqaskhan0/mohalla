package org.shehersaaz.mohalla.core.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
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
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
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
            MediaPlaceholder(count = post.mediaIds.size)
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
        Box(
            modifier = Modifier
                .size(MohallaTheme.spacing.Space12)
                .background(MohallaTheme.colors.SurfaceSunken, CircleShape),
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

                // ADMIN-FR-010 — granted by an administrator, never implied by
                // account type. Text as well as colour, so it survives a
                // colour-blind reader (§35).
                if (post.author.verifiedBadge) {
                    Text(
                        text = stringResource(R.string.badge_verified),
                        style = MohallaTheme.text(MohallaType.Label),
                        color = MohallaTheme.colors.BrandPrimary,
                    )
                }
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
 * The reserved box for attached images.
 *
 * A RATIO, NOT A HEIGHT. UI/UX §34 asks for "a surface-sunken block at the
 * correct aspect ratio so no layout shift occurs", and §26 lists media height
 * under what GROWS with the viewport with "ratio held" — so a fixed dp height
 * would be wrong twice: it would be a number off the 4dp spacing scale (§17:
 * "any value not on this scale is a defect"), and it would keep the box the same
 * height on a 360dp phone and a 600dp tablet while the image inside it did not.
 *
 * Reserving the box before the bytes arrive is the point. A card that grows when
 * its image decodes shifts everything below it mid-scroll, and on a slow
 * connection the reader loses their place repeatedly.
 *
 * TODO(EPIC-06): render through Coil, fading in over `base` (180ms) per §34, and
 * hold each image's OWN ratio once the media metadata carries its dimensions.
 * Until then every placeholder uses [MEDIA_DEFAULT_RATIO].
 */
@Composable
private fun MediaPlaceholder(count: Int) {
    val mediaDescription = pluralStringResource(R.plurals.a11y_post_images, count, count)

    Box(
        modifier = Modifier
            .fillMaxWidth()
            .aspectRatio(MEDIA_DEFAULT_RATIO)
            .background(MohallaTheme.colors.SurfaceSunken, MohallaTheme.radius.ShapeMd)
            .semantics {
                contentDescription = mediaDescription
            },
        contentAlignment = Alignment.Center,
    ) {
        // The visible count appears only when there is more than one — a "1"
        // over a single image is noise. A screen reader needs to know either
        // way, so the description sits on the box and uses a PLURAL resource
        // rather than "%d images": Urdu and English agree on having a singular
        // and a plural here, but concatenating a number to a noun is the bug
        // that produces "1 تصاویر", and only a plurals table avoids it.
        Text(
            text = if (count > 1) count.toString() else "",
            style = MohallaTheme.text(MohallaType.Label),
            color = MohallaTheme.colors.TextTertiary,
        )
    }
}

/**
 * The ratio a placeholder holds before the real image's dimensions are known.
 *
 * 4:3 rather than 1:1 or 16:9 because it is what a phone camera produces by
 * default, so for most posts the reserved box is close to the right shape and
 * the fade-in barely moves the card. It is a fallback, not a crop: nothing is
 * ever letterboxed to this.
 */
private const val MEDIA_DEFAULT_RATIO = 4f / 3f

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
