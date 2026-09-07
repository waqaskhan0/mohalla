package org.shehersaaz.mohalla.core.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.Dp
import coil.compose.SubcomposeAsyncImage
import coil.request.ImageRequest
import org.shehersaaz.mohalla.R
import org.shehersaaz.mohalla.core.design.MohallaTheme
import org.shehersaaz.mohalla.core.design.MohallaType

/**
 * A media object, by id (MEDIA-FR-001 · UI/UX §34).
 *
 * THE URL IS BUILT HERE AND NOWHERE ELSE. A media id is not a URL, and the
 * route that serves one is authenticated — so every call site that composed its
 * own `"$base/media/$id"` would be a call site that could get the base wrong,
 * forget the token, or leak an id into a log. One function, one shape.
 *
 * NO LAYOUT JUMP, EVER. The box is reserved at a ratio before the bytes arrive
 * (§34: "a surface-sunken block at the correct aspect ratio so no layout shift
 * occurs, then a 180ms fade-in"), and the loading, error and success states all
 * occupy exactly the same space. A card that grows when its image decodes
 * shifts everything below it mid-scroll, and on a slow connection the reader
 * loses their place repeatedly.
 *
 * A FAILED IMAGE IS NOT AN ERROR SCREEN. It stays as the reserved block with a
 * quiet label. The post's text is the content; an image that could not be
 * fetched must not turn a readable post into a failure, and `GET /media/{id}`
 * returns the same neutral 404 for a quarantined, rejected, restricted or
 * missing object (BR-025) — so there is nothing the client could truthfully say
 * about why.
 */
@Composable
fun MohallaImage(
    mediaId: String,
    contentDescription: String?,
    modifier: Modifier = Modifier,
    aspectRatio: Float = MEDIA_DEFAULT_RATIO,
    shape: Shape = MohallaTheme.radius.ShapeMd,
    contentScale: ContentScale = ContentScale.Crop,
    onClick: (() -> Unit)? = null,
) {
    val base = LocalMediaBaseUrl.current

    Box(
        modifier = modifier
            .fillMaxWidth()
            .aspectRatio(aspectRatio)
            .background(MohallaTheme.colors.SurfaceSunken, shape)
            .then(
                if (onClick == null) {
                    Modifier
                } else {
                    Modifier.clickable(role = Role.Button, onClick = onClick)
                },
            ),
    ) {
        SubcomposeAsyncImage(
            model = ImageRequest.Builder(LocalContext.current)
                .data(mediaUrl(base, mediaId))
                .crossfade(true)
                .build(),
            contentDescription = contentDescription,
            contentScale = contentScale,
            modifier = Modifier.fillMaxSize(),
            // The reserved block IS the loading state. No spinner: a spinner
            // inside a box that is already the right size adds motion without
            // adding information.
            loading = {},
            error = {
                Box(
                    modifier = Modifier.fillMaxSize(),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        text = stringResource(R.string.media_unavailable),
                        style = MohallaTheme.text(MohallaType.Caption),
                        color = MohallaTheme.colors.TextTertiary,
                    )
                }
            },
        )
    }
}

/**
 * A circular avatar.
 *
 * A separate composable rather than a `shape` argument on [MohallaImage],
 * because an avatar differs in more than its shape: it is square by definition,
 * sized from the spacing scale rather than filling its parent, and it has a
 * meaningful EMPTY state — a profile with no photo is ordinary, not a failure,
 * so the fallback is a plain tinted circle and never a "broken image" label.
 */
@Composable
fun MohallaAvatar(
    mediaId: String?,
    contentDescription: String?,
    size: Dp,
    modifier: Modifier = Modifier,
    onClick: (() -> Unit)? = null,
) {
    val base = LocalMediaBaseUrl.current

    Box(
        modifier = modifier
            .size(size)
            .background(MohallaTheme.colors.SurfaceSunken, CircleShape)
            .then(
                if (onClick == null) {
                    Modifier
                } else {
                    Modifier.clickable(role = Role.Button, onClick = onClick)
                },
            ),
    ) {
        // No photo is a normal state. Rendering nothing leaves the tinted
        // circle, which is the design's own placeholder.
        if (mediaId != null) {
            SubcomposeAsyncImage(
                model = ImageRequest.Builder(LocalContext.current)
                    .data(mediaUrl(base, mediaId))
                    .crossfade(true)
                    .build(),
                contentDescription = contentDescription,
                contentScale = ContentScale.Crop,
                modifier = Modifier
                    .fillMaxSize()
                    .background(MohallaTheme.colors.SurfaceSunken, CircleShape),
                loading = {},
                // Silent. A missing avatar is not worth a label — the name
                // beside it already identifies the person.
                error = {},
            )
        }
    }
}

/**
 * How many images a post has, as a strip.
 *
 * ORDER IS PRESERVED, which POST-FR-003 requires by name: "the order chosen is
 * preserved". So the first id is drawn large and the rest follow it — never
 * sorted, never de-duplicated, never re-arranged to fill a grid neatly.
 *
 * ONLY THE FIRST IMAGE IS DRAWN IN THE FEED, with a count over the remainder.
 * Four images inline would make one post own a whole 720×1280 screen, and
 * MEDIA-FR-002 puts the full set in the viewer where it can be swiped.
 */
@Composable
fun MohallaImageStrip(
    mediaIds: List<String>,
    modifier: Modifier = Modifier,
    onOpen: ((index: Int) -> Unit)? = null,
) {
    val first = mediaIds.firstOrNull() ?: return
    val remaining = mediaIds.size - 1

    Box(modifier = modifier.fillMaxWidth()) {
        MohallaImage(
            mediaId = first,
            contentDescription = if (mediaIds.size > 1) {
                pluralStringResource(R.plurals.a11y_post_images, mediaIds.size, mediaIds.size)
            } else {
                stringResource(R.string.a11y_post_image)
            },
            onClick = onOpen?.let { { it(0) } },
        )

        if (remaining > 0) {
            Text(
                text = stringResource(R.string.media_more_count, remaining),
                style = MohallaTheme.text(MohallaType.Label),
                color = MohallaTheme.colors.TextInverse,
                modifier = Modifier
                    .align(Alignment.BottomEnd)
                    .padding(MohallaTheme.spacing.Space2)
                    .background(MohallaTheme.colors.Shell, MohallaTheme.radius.ShapeFull)
                    .padding(
                        horizontal = MohallaTheme.spacing.Space2,
                        vertical = MohallaTheme.spacing.Space1,
                    ),
            )
        }
    }
}

/**
 * The API base URL, provided once at the theme root.
 *
 * A COMPOSITION LOCAL RATHER THAN A PARAMETER, because otherwise every
 * composable between the NavHost and an avatar buried in a comment row would
 * have to thread it through — and the one that forgot would render a broken
 * image. It defaults to empty rather than to a plausible host: an unset base
 * produces a request that fails, which is visible, while a default host would
 * silently point a build at the wrong server.
 */
val LocalMediaBaseUrl = androidx.compose.runtime.staticCompositionLocalOf { "" }

/**
 * `{base}/media/{id}`.
 *
 * Built from the API base rather than from a hardcoded host, so a debug build
 * pointed at the emulator loopback and a release build pointed at a real host
 * both work without a second configuration.
 */
private fun mediaUrl(base: String, mediaId: String): String {
    val trimmed = base.trimEnd('/')
    return "$trimmed/media/$mediaId"
}

/**
 * The default ratio for a reserved media block.
 *
 * 4:3 because it is what a phone camera produces by default, so for most posts
 * the reserved box is close to the right shape and the fade-in barely moves the
 * card. A fallback, not a crop: nothing is letterboxed to this, and once media
 * metadata carries real dimensions each image holds its own ratio.
 */
const val MEDIA_DEFAULT_RATIO = 4f / 3f
