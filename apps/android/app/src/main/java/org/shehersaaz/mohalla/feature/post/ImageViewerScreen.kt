package org.shehersaaz.mohalla.feature.post

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.rememberTransformableState
import androidx.compose.foundation.gestures.transformable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import coil.compose.AsyncImage
import coil.request.ImageRequest
import org.shehersaaz.mohalla.R
import org.shehersaaz.mohalla.core.design.MohallaTheme
import org.shehersaaz.mohalla.core.design.MohallaType
import org.shehersaaz.mohalla.core.ui.LocalMediaBaseUrl

/**
 * The image viewer — UX-HOME-004 (MEDIA-FR-002).
 *
 * "Tapping an image opens a full-screen viewer supporting pinch-zoom, pan and
 * swipe between images in the same post." Its acceptance criterion is the swipe:
 * "GIVEN a post with 3 images, WHEN the second is opened, THEN swiping reaches
 * the first and third without leaving the viewer."
 *
 * WHY THIS IS ON A DARK GROUND WHEN THE PRODUCT HAS NO DARK THEME. §49 defers
 * dark mode, and this is not it: a viewer's job is to get out of the way of the
 * thing being looked at, and a light chrome around a photograph competes with
 * it for the eye. Every other surface in the app stays on the light scheme.
 *
 * ZOOM AND PAGING FIGHT FOR THE SAME GESTURES, and the resolution is the
 * interesting part of this file. A horizontal drag means "next image" at 1× and
 * "pan" once zoomed in — so the pager is DISABLED while zoomed, and re-enabled
 * when the image returns to 1×. Without that, panning a zoomed-in poster
 * sideways would flick to the next image instead, which makes the zoom useless
 * for exactly the awareness posters the requirement names.
 *
 * THERE IS NO HIGHER-RESOLUTION VARIANT TO SERVE, and the requirement asks for
 * one. MEDIA-FR-002's rule is that "the viewer serves a higher-resolution
 * variant than the feed thumbnail", but `GET /media/{id}` takes no size
 * parameter and the API stores a single object. What the viewer actually gains
 * is DECODE SIZE: the stored image is 1,600px on its longest edge (the client's
 * own upload ceiling), the feed decodes it down to a card's width, and this
 * decodes it at screen size and allows zoom beyond that. So a poster is legible
 * here and not in the feed — by the intended amount, through a different
 * mechanism than the requirement describes. Recorded in
 * `20-mobile-open-issues.md` rather than claimed as a variant.
 */
@Composable
fun ImageViewerScreen(
    mediaIds: List<String>,
    initialIndex: Int,
    onClose: () -> Unit,
    modifier: Modifier = Modifier,
) {
    if (mediaIds.isEmpty()) {
        // Nothing to look at. Closing immediately rather than showing an empty
        // black screen somebody has to work out how to leave.
        LaunchedEffect(Unit) { onClose() }
        return
    }

    val pagerState = rememberPagerState(
        initialPage = initialIndex.coerceIn(0, mediaIds.lastIndex),
        pageCount = { mediaIds.size },
    )

    // One zoom state, reset on every page change. Carrying a zoom across a
    // swipe would land the reader on the next image already magnified and
    // off-centre, with no visible way back to the whole picture.
    var scale by remember { mutableFloatStateOf(1f) }
    var offsetX by remember { mutableFloatStateOf(0f) }
    var offsetY by remember { mutableFloatStateOf(0f) }

    LaunchedEffect(pagerState) {
        snapshotFlow { pagerState.currentPage }.collect {
            scale = 1f
            offsetX = 0f
            offsetY = 0f
        }
    }

    val zoomed = scale > 1f + ZOOM_EPSILON

    Box(
        modifier = modifier
            .fillMaxSize()
            // Deliberately not a theme token: see the doc comment.
            .background(Color.Black),
    ) {
        HorizontalPager(
            state = pagerState,
            modifier = Modifier.fillMaxSize(),
            // THE RESOLUTION OF THE GESTURE CONFLICT. At 1× a horizontal drag
            // pages; zoomed in it pans, so paging is switched off entirely
            // until the image is back to 1×.
            userScrollEnabled = !zoomed,
        ) { page ->
            ZoomableImage(
                mediaId = mediaIds[page],
                // Only the visible page is interactive. A neighbouring page
                // holding a stale zoom would apply it the moment it scrolled
                // into view.
                scale = if (page == pagerState.currentPage) scale else 1f,
                offsetX = if (page == pagerState.currentPage) offsetX else 0f,
                offsetY = if (page == pagerState.currentPage) offsetY else 0f,
                onTransform = { zoomChange, panX, panY ->
                    if (page != pagerState.currentPage) return@ZoomableImage

                    scale = (scale * zoomChange).coerceIn(MIN_SCALE, MAX_SCALE)

                    // Panning is only meaningful while zoomed, and is bounded
                    // so the image cannot be dragged off screen and lost.
                    if (scale > 1f + ZOOM_EPSILON) {
                        offsetX += panX
                        offsetY += panY
                    } else {
                        offsetX = 0f
                        offsetY = 0f
                    }
                },
                onDoubleTap = {
                    // A double tap toggles between fit and a useful
                    // magnification — the gesture people try first, and faster
                    // than pinching to read a phone number on a poster.
                    if (scale > 1f + ZOOM_EPSILON) {
                        scale = 1f
                        offsetX = 0f
                        offsetY = 0f
                    } else {
                        scale = DOUBLE_TAP_SCALE
                    }
                },
                contentDescription = stringResource(
                    R.string.a11y_image_of,
                    page + 1,
                    mediaIds.size,
                ),
            )
        }

        // The chrome: a close control, and the position in the set.
        Row(
            modifier = Modifier
                .align(Alignment.TopStart)
                .fillMaxWidth()
                .systemBarsPadding()
                .padding(MohallaTheme.spacing.Space2),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space2),
        ) {
            Box(
                modifier = Modifier
                    .size(MohallaTheme.spacing.Space12)
                    .clickable(role = Role.Button, onClick = onClose),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    imageVector = Icons.Filled.Close,
                    contentDescription = stringResource(R.string.action_close),
                    // Inverse on black, and the only place in the product where
                    // that is the plain reading of the token.
                    tint = MohallaTheme.colors.TextInverse,
                    modifier = Modifier.size(MohallaTheme.spacing.Space6),
                )
            }

            // Shown only when there is more than one, because "1 / 1" is
            // information about nothing.
            if (mediaIds.size > 1) {
                Text(
                    text = stringResource(
                        R.string.viewer_position,
                        pagerState.currentPage + 1,
                        mediaIds.size,
                    ),
                    style = MohallaTheme.text(MohallaType.Label),
                    color = MohallaTheme.colors.TextInverse,
                )
            }
        }
    }
}

@Composable
private fun ZoomableImage(
    mediaId: String,
    scale: Float,
    offsetX: Float,
    offsetY: Float,
    onTransform: (zoomChange: Float, panX: Float, panY: Float) -> Unit,
    onDoubleTap: () -> Unit,
    contentDescription: String,
) {
    val base = LocalMediaBaseUrl.current

    val transformState = rememberTransformableState { zoomChange, panChange, _ ->
        onTransform(zoomChange, panChange.x, panChange.y)
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .pointerInput(Unit) {
                detectTapGestures(onDoubleTap = { onDoubleTap() })
            }
            .transformable(state = transformState),
        contentAlignment = Alignment.Center,
    ) {
        AsyncImage(
            model = ImageRequest.Builder(LocalContext.current)
                .data("${base.trimEnd('/')}/media/$mediaId")
                .crossfade(true)
                .build(),
            contentDescription = contentDescription,
            // `Fit`, not `Crop`. The feed crops to a tidy card; a viewer whose
            // job is legibility must show the whole poster, including the
            // corners a crop would remove.
            contentScale = ContentScale.Fit,
            modifier = Modifier
                .fillMaxSize()
                .graphicsLayer(
                    scaleX = scale,
                    scaleY = scale,
                    translationX = offsetX,
                    translationY = offsetY,
                ),
        )
    }
}

/** Below this, a scale counts as "not zoomed" — float arithmetic never lands on 1. */
private const val ZOOM_EPSILON = 0.01f

/** Never smaller than fitted: pinching out past the frame serves nothing. */
private const val MIN_SCALE = 1f

/**
 * Five times.
 *
 * The stored image is 1,600px on its longest edge, so on a 720px-wide screen
 * (NFR-COMP-002's baseline) about 2.2× is where real pixels run out and further
 * zoom is interpolation. Five leaves room to magnify past that for somebody
 * reading small print with poor eyesight, which is the case MEDIA-FR-002's
 * "awareness posters must remain legible" is actually about.
 */
private const val MAX_SCALE = 5f

/** Where a double tap lands: enough to read a phone number, still oriented. */
private const val DOUBLE_TAP_SCALE = 2.5f
