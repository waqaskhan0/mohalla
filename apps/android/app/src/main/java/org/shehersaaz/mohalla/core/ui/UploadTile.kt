package org.shehersaaz.mohalla.core.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import coil.request.ImageRequest
import org.shehersaaz.mohalla.R
import org.shehersaaz.mohalla.core.design.MohallaTheme
import org.shehersaaz.mohalla.core.design.MohallaType

/**
 * One attachment tile, in each of the states an attachment can be in
 * (UI/UX §19 · §34 · EDGE-013).
 *
 * §34 specifies the busy state exactly: "a thumbnail with a percentage overlay
 * and a 3px progress bar along the bottom edge. Cancellable."
 *
 * THE THUMBNAIL IS DRAWN FROM THE DEVICE'S OWN COPY, by URI, and never from the
 * server. A just-picked image has no media id yet, and one that failed never
 * will — so a tile that fetched a preview would show nothing during the only
 * period the preview matters. It also means the preview costs no data at all,
 * which on Pakistani mobile pricing is worth more than the code it saves.
 *
 * REMOVE IS OFFERED IN EVERY STATE, INCLUDING MID-UPLOAD. §34 says
 * "cancellable", and an attachment somebody has decided against should not have
 * to finish uploading first — the media row is left in quarantine and the
 * server's sweep collects it, which is what quarantine is for.
 *
 * RETRY IS OFFERED ONLY WHERE IT CAN WORK. A rejected file gets no retry
 * control: the server inspected those bytes and refused them, so the same bytes
 * will be refused again. A retry button that can never succeed is worse than
 * none, because people keep pressing it.
 */
@Composable
fun UploadTile(
    thumbnailUri: Any?,
    state: UploadTileState,
    onRemove: () -> Unit,
    modifier: Modifier = Modifier,
    onRetry: (() -> Unit)? = null,
) {
    Box(
        modifier = modifier
            .size(UPLOAD_TILE)
            .background(MohallaTheme.colors.SurfaceSunken, MohallaTheme.radius.ShapeMd),
    ) {
        if (thumbnailUri != null) {
            AsyncImage(
                model = ImageRequest.Builder(LocalContext.current)
                    .data(thumbnailUri)
                    .crossfade(true)
                    .build(),
                // The tile's own controls carry the meaning; describing the
                // picture too would make a screen reader announce a photo the
                // user just chose and already knows about.
                contentDescription = null,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize(),
            )
        }

        when (state) {
            UploadTileState.Pending, is UploadTileState.Uploading -> {
                val percent = (state as? UploadTileState.Uploading)?.percent

                // A dim scrim, so the percentage reads over a bright photo.
                // Colour alone would fail §35; the numeral is the real signal.
                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .background(MohallaTheme.colors.Shell.copy(alpha = SCRIM_ALPHA)),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        // Only shown once there is something true to say. A bar
                        // at 0% for a second on a slow connection reads as a
                        // stall, so an unknown percentage renders as an ellipsis
                        // rather than a fabricated number.
                        text = percent?.let { stringResource(R.string.upload_percent, it) }
                            ?: stringResource(R.string.upload_working),
                        style = MohallaTheme.text(MohallaType.Label),
                        color = MohallaTheme.colors.TextInverse,
                    )
                }

                // §34's 3px bar along the bottom edge. Not on the 4dp spacing
                // scale, and correctly so: this is the thickness of a drawn
                // rule rather than a gap between things, the same category as
                // the top bar's 1dp hairline.
                Box(
                    modifier = Modifier
                        .align(Alignment.BottomStart)
                        .fillMaxWidth(percent?.let { it / 100f } ?: 0f)
                        .height(PROGRESS_BAR_THICKNESS)
                        .background(MohallaTheme.colors.BrandPrimary),
                )
            }

            UploadTileState.Ready -> Unit

            UploadTileState.Failed -> TileOverlay(
                icon = Icons.Filled.Refresh,
                label = stringResource(R.string.upload_retry),
                tone = MohallaTheme.colors.Warning,
                onClick = onRetry,
            )

            is UploadTileState.Rejected -> TileOverlay(
                icon = Icons.Filled.Warning,
                // The server's own message where it sent one — it is the
                // caller's own file, so the media route returns the reason
                // deliberately. Otherwise the generic refusal.
                label = state.reason ?: stringResource(R.string.upload_rejected),
                tone = MohallaTheme.colors.Error,
                // No retry. See the doc comment.
                onClick = null,
            )
        }

        // Remove, in every state. `TopEnd` so it lands on the tile's top-left
        // in Urdu with no second layout.
        Box(
            modifier = Modifier
                .align(Alignment.TopEnd)
                .size(MohallaTheme.spacing.Space6)
                .background(MohallaTheme.colors.Shell, MohallaTheme.radius.ShapeFull)
                .clickable(role = Role.Button, onClick = onRemove),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                imageVector = Icons.Filled.Close,
                contentDescription = stringResource(R.string.upload_remove),
                tint = MohallaTheme.colors.TextInverse,
                modifier = Modifier.size(MohallaTheme.spacing.Space4),
            )
        }
    }
}

/**
 * The "add an image" tile.
 *
 * The same size as a real tile so the row does not reflow when an image is
 * added, and it disappears at four rather than rendering disabled — BR-013's
 * limit is better expressed by the absence of an offer than by a greyed control
 * the user taps to be told no.
 */
@Composable
fun AddAttachmentTile(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .size(UPLOAD_TILE)
            .background(MohallaTheme.colors.SurfaceSunken, MohallaTheme.radius.ShapeMd)
            .clickable(role = Role.Button, onClick = onClick),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Icon(
            imageVector = Icons.Filled.Add,
            contentDescription = stringResource(R.string.upload_add),
            tint = MohallaTheme.colors.TextSecondary,
            modifier = Modifier.size(MohallaTheme.spacing.Space6),
        )
    }
}

@Composable
private fun TileOverlay(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    label: String,
    tone: androidx.compose.ui.graphics.Color,
    onClick: (() -> Unit)?,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(MohallaTheme.colors.Shell.copy(alpha = SCRIM_ALPHA))
            .then(
                if (onClick == null) {
                    Modifier
                } else {
                    Modifier.clickable(role = Role.Button, onClick = onClick)
                },
            )
            .padding(MohallaTheme.spacing.Space1),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Icon(
            imageVector = icon,
            contentDescription = null,
            tint = tone,
            modifier = Modifier.size(MohallaTheme.spacing.Space5),
        )
        Text(
            text = label,
            style = MohallaTheme.text(MohallaType.Label),
            color = MohallaTheme.colors.TextInverse,
            textAlign = TextAlign.Center,
            maxLines = 2,
        )
    }
}

/** What a tile is showing. Mirrors the composer's attachment states. */
sealed interface UploadTileState {
    data object Pending : UploadTileState
    data class Uploading(val percent: Int?) : UploadTileState
    data object Ready : UploadTileState
    data object Failed : UploadTileState
    data class Rejected(val reason: String?) : UploadTileState
}

/**
 * 80dp, where §19 says 82.
 *
 * A component dimension rather than a spacing token, like the 56dp app bar and
 * the 44px avatar §03 specifies. §19 gives "thumbnails 82 with 10 gap"; both
 * numbers are off the 4dp grid that §17 calls a defect ("no 6px, no 10px, no
 * 14px, no 18px anywhere in the product"), so the two sections disagree.
 *
 * Resolved toward the grid: 80dp instead of 82, and `Space2` (8dp) instead of a
 * 10dp gap. A 2dp difference in a thumbnail is invisible, an off-grid value is
 * a rule broken, and four 80dp tiles with three 8dp gaps come to 344dp — which
 * fits inside a 360dp screen's 16dp margins with nothing to spare, so the row
 * scrolls rather than wrapping.
 */
val UPLOAD_TILE: Dp = 80.dp

/** §34's "3px progress bar along the bottom edge". A rule, not a gap. */
private val PROGRESS_BAR_THICKNESS: Dp = 3.dp

/** Enough to hold white text over a bright photograph. */
private const val SCRIM_ALPHA = 0.55f
