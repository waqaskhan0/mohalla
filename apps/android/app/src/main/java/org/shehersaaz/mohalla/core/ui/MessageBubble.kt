package org.shehersaaz.mohalla.core.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
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
import androidx.compose.ui.unit.dp
import coil.compose.SubcomposeAsyncImage
import coil.request.ImageRequest
import org.shehersaaz.mohalla.R
import org.shehersaaz.mohalla.core.design.MohallaTheme
import org.shehersaaz.mohalla.core.design.MohallaType

/**
 * One message bubble (§18 — "message bubble: own · theirs · sending · failed").
 *
 * MIRRORING IS THE WHOLE LAYOUT PROBLEM HERE, and it is the one place in this
 * product where getting it wrong is invisible in English. Own messages sit at
 * the layout END and received ones at the START — which in English puts mine on
 * the right and theirs on the left, and in Urdu the opposite. That is CORRECT:
 * a chat mirrors with the script, and a WhatsApp user reading Urdu expects their
 * own messages on the left. Achieved by `Arrangement.End`/`Start`, which are
 * logical; `Absolute.Right` would pin mine to the right in both languages and
 * look wrong to every Urdu reader.
 *
 * THE ASYMMETRIC CORNER FOLLOWS THE SAME RULE. The bubble's "tail" corner —
 * the square one nearest its sender — is set with `topStart`/`topEnd` rather
 * than left and right, so it swaps sides with the layout direction.
 *
 * A MESSAGE IMAGE IS FETCHED FROM `conversations/media/{id}` AND NEVER FROM
 * `media/{id}`, which refuses RESTRICTED objects outright because it has no way
 * to know who a participant is. MSG-FR-008's criterion is that an image is "not
 * retrievable by anyone outside that conversation", and the conversation route
 * is what checks that. Using [MohallaImage] here would 404 every message image —
 * which is why this file builds its own URL rather than reusing that component.
 */
@Composable
fun MessageBubble(
    body: String?,
    mediaId: String?,
    isMine: Boolean,
    state: BubbleState,
    timeLabel: String?,
    onRetry: (() -> Unit)?,
    modifier: Modifier = Modifier,
    isUrdu: Boolean = false,
) {
    Row(
        modifier = modifier.fillMaxWidth(),
        // LOGICAL, not absolute. This is what mirrors the conversation in Urdu.
        horizontalArrangement = if (isMine) Arrangement.End else Arrangement.Start,
    ) {
        Column(
            modifier = Modifier
                // Never the full width: a bubble that reached both margins
                // would stop reading as a bubble, and the gap on the far side
                // is what tells the eye whose message it is at a glance.
                .fillMaxWidth(BUBBLE_MAX_WIDTH_FRACTION)
                .background(
                    color = when {
                        state == BubbleState.Failed -> MohallaTheme.colors.ErrorSubtle
                        isMine -> MohallaTheme.colors.BrandPrimarySubtle
                        else -> MohallaTheme.colors.SurfacePrimary
                    },
                    shape = bubbleShape(isMine),
                )
                .padding(MohallaTheme.spacing.Space3),
            verticalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space1),
        ) {
            if (mediaId != null) {
                MessageImage(mediaId = mediaId)
            }

            if (!body.isNullOrBlank()) {
                Text(
                    text = body,
                    // `display = isUrdu` so a long Urdu message gets the Naskh
                    // face and the taller line height it needs; a chat is the
                    // densest text in the product.
                    style = MohallaTheme.text(MohallaType.Body, display = isUrdu),
                    color = if (state == BubbleState.Failed) {
                        MohallaTheme.colors.TextSecondary
                    } else {
                        MohallaTheme.colors.TextPrimary
                    },
                )
            }

            BubbleFooter(
                state = state,
                isMine = isMine,
                timeLabel = timeLabel,
                onRetry = onRetry,
            )
        }
    }
}

/**
 * Time, and the receipt (MSG-FR-009).
 *
 * A RECEIPT APPEARS ONLY ON THE VIEWER'S OWN MESSAGES, and only because the
 * server sent a `readAt` — the client never derives one from anything else. In
 * a Message Request the server withholds that field entirely, so a request
 * thread cannot show a receipt even by accident: "reading a request does not
 * signal anything to a stranger."
 *
 * THE STATE IS CARRIED IN TEXT AND SHAPE, not colour alone (§35). "Sending",
 * "Sent" and "Read" are words; the failed state adds an icon and a retry
 * control. A tick glyph alone would fail a colour-blind reader and would be
 * unreadable to a screen reader.
 */
@Composable
private fun BubbleFooter(
    state: BubbleState,
    isMine: Boolean,
    timeLabel: String?,
    onRetry: (() -> Unit)?,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space1),
    ) {
        if (timeLabel != null) {
            Text(
                text = timeLabel,
                style = MohallaTheme.text(MohallaType.Caption),
                color = MohallaTheme.colors.TextSecondary,
            )
        }

        Box(Modifier.weight(1f))

        // Only ever on the viewer's own message.
        if (isMine) {
            when (state) {
                BubbleState.Sending -> Text(
                    text = stringResource(R.string.message_sending),
                    style = MohallaTheme.text(MohallaType.Caption),
                    color = MohallaTheme.colors.TextSecondary,
                )

                BubbleState.Sent -> Text(
                    text = stringResource(R.string.message_sent),
                    style = MohallaTheme.text(MohallaType.Caption),
                    color = MohallaTheme.colors.TextSecondary,
                )

                BubbleState.Read -> Text(
                    text = stringResource(R.string.message_read),
                    style = MohallaTheme.text(MohallaType.Caption),
                    color = MohallaTheme.colors.BrandPrimary,
                )

                BubbleState.Failed -> Row(
                    modifier = Modifier
                        .then(
                            if (onRetry == null) {
                                Modifier
                            } else {
                                Modifier.clickable(role = Role.Button, onClick = onRetry)
                            },
                        )
                        .padding(vertical = MohallaTheme.spacing.Space1),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space1),
                ) {
                    Icon(
                        imageVector = Icons.Filled.Warning,
                        contentDescription = null,
                        tint = MohallaTheme.colors.Error,
                        modifier = Modifier.size(MohallaTheme.spacing.Space4),
                    )
                    Text(
                        // MSG-FR-002 — never silently dropped. The words are
                        // still on screen and the retry is beside them.
                        text = stringResource(R.string.message_retry),
                        style = MohallaTheme.text(MohallaType.Label),
                        color = MohallaTheme.colors.Error,
                    )
                    Icon(
                        imageVector = Icons.Filled.Refresh,
                        contentDescription = null,
                        tint = MohallaTheme.colors.Error,
                        modifier = Modifier.size(MohallaTheme.spacing.Space4),
                    )
                }
            }
        }
    }
}

/**
 * An image sent in a message (MSG-FR-008).
 *
 * THE URL IS THE CONVERSATION ROUTE. `GET /media/{id}` refuses a RESTRICTED
 * object, so a message image fetched that way returns the same neutral 404 as a
 * missing one — and would render as a broken box for every participant,
 * including the person who sent it.
 *
 * The box is reserved at a ratio before the bytes arrive, exactly as post media
 * is (§34), so a slow image does not push the conversation around while
 * somebody is reading it.
 */
@Composable
private fun MessageImage(mediaId: String) {
    val base = LocalMediaBaseUrl.current

    Box(
        modifier = Modifier
            .fillMaxWidth()
            .aspectRatio(MEDIA_DEFAULT_RATIO)
            .background(MohallaTheme.colors.SurfaceSunken, MohallaTheme.radius.ShapeSm),
    ) {
        SubcomposeAsyncImage(
            model = ImageRequest.Builder(LocalContext.current)
                // NOT `/media/{id}` — see the doc comment.
                .data("${base.trimEnd('/')}/conversations/media/$mediaId")
                .crossfade(true)
                .build(),
            contentDescription = stringResource(R.string.message_image),
            contentScale = ContentScale.Crop,
            modifier = Modifier.fillMaxSize(),
            loading = {},
            error = {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Text(
                        text = stringResource(R.string.media_unavailable),
                        style = MohallaTheme.text(MohallaType.Caption),
                        color = MohallaTheme.colors.TextSecondary,
                    )
                }
            },
        )
    }
}

/**
 * The bubble's shape, with its square corner nearest its sender.
 *
 * `topStart` and `topEnd` rather than left and right, so the tail swaps sides
 * under mirroring along with the bubble itself.
 */
private fun bubbleShape(isMine: Boolean) = if (isMine) {
    RoundedCornerShape(
        topStart = BUBBLE_RADIUS,
        topEnd = BUBBLE_TAIL,
        bottomEnd = BUBBLE_RADIUS,
        bottomStart = BUBBLE_RADIUS,
    )
} else {
    RoundedCornerShape(
        topStart = BUBBLE_TAIL,
        topEnd = BUBBLE_RADIUS,
        bottomEnd = BUBBLE_RADIUS,
        bottomStart = BUBBLE_RADIUS,
    )
}

/** Mirrors `MessageState`, without the feature package leaking into `core/ui`. */
enum class BubbleState { Sending, Sent, Read, Failed }

/**
 * Four fifths of the width.
 *
 * A fraction rather than a dp cap, so it holds on a 360dp phone and a 600dp
 * tablet alike — and the remaining fifth is the gap that tells the eye whose
 * message it is before any of the text is read.
 */
private const val BUBBLE_MAX_WIDTH_FRACTION = 0.8f

/** `radius-lg`, which §17 assigns to "cards, message bubbles". */
private val BUBBLE_RADIUS = 16.dp

/** The tail corner. Small rather than square, so it reads as a bubble. */
private val BUBBLE_TAIL = 4.dp
