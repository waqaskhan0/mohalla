package org.shehersaaz.mohalla.core.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.DateRange
import androidx.compose.material.icons.filled.Info
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.style.TextOverflow
import org.shehersaaz.mohalla.R
import org.shehersaaz.mohalla.core.design.MohallaTheme
import org.shehersaaz.mohalla.core.design.MohallaType

/**
 * One notification (§18 — "notification row · day grouping · unread dot").
 *
 * THE SENTENCE ARRIVES WHOLE AND THIS COMPONENT DOES NOT BUILD ONE. `text` was
 * rendered by the server in the reader's language; there is no actor name
 * parameter, no template, and no place to concatenate. That is what makes
 * LOCALE-FR-002 hold on this screen — a centre of client-assembled sentences
 * would need thirteen more string tables and would drift from the server's the
 * first time either was reworded.
 *
 * THE UNREAD DOT IS A DOT, NOT A COLOURED ROW. The wireframe says so explicitly,
 * and §35 is why it also carries a label: colour is never the only carrier of
 * state, so a screen reader hears "unread" where a sighted reader sees the mark.
 *
 * A ROW WITH NOWHERE TO GO IS NOT CLICKABLE. `onClick` is nullable and a null
 * one leaves the row inert with no ripple and no button role — a reply
 * notification cannot be opened today (the centre's body carries a comment id
 * and no route resolves it to a post), and inviting a tap that does nothing is
 * worse than a row that plainly does not offer one.
 */
@Composable
fun NotificationRow(
    text: String,
    timeLabel: String?,
    mark: NotificationMark,
    unread: Boolean,
    onClick: (() -> Unit)?,
    modifier: Modifier = Modifier,
    actorPhotoMediaId: String? = null,
) {
    val unreadLabel = stringResource(R.string.notification_unread)

    Row(
        modifier = modifier
            .fillMaxWidth()
            .defaultMinSize(minHeight = MohallaTheme.spacing.Space16)
            .then(
                if (onClick == null) {
                    Modifier
                } else {
                    Modifier.clickable(role = Role.Button, onClick = onClick)
                },
            )
            .padding(
                horizontal = MohallaTheme.screenMargin,
                vertical = MohallaTheme.spacing.Space3,
            )
            // ONE ANNOUNCEMENT PER ROW, in reading order: the sentence, then
            // when, then whether it is new. Three separate nodes would make a
            // screen reader stop three times on what is one piece of news.
            .clearAndSetSemantics {
                contentDescription = listOfNotNull(
                    text,
                    timeLabel,
                    unreadLabel.takeIf { unread },
                ).joinToString(", ")
            },
        verticalAlignment = Alignment.Top,
        horizontalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space3),
    ) {
        NotificationMarkAvatar(mark = mark, actorPhotoMediaId = actorPhotoMediaId)

        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space1),
        ) {
            Text(
                text = text,
                style = MohallaTheme.text(MohallaType.Body),
                color = MohallaTheme.colors.TextPrimary,
                // THREE LINES, NOT ONE. A message notification carries a
                // preview inside the sentence, and Urdu runs longer than its
                // English equivalent — a single line would truncate the half
                // that says what happened.
                maxLines = 3,
                overflow = TextOverflow.Ellipsis,
            )

            if (timeLabel != null) {
                Text(
                    text = timeLabel,
                    style = MohallaTheme.text(MohallaType.Caption),
                    color = MohallaTheme.colors.TextTertiary,
                )
            }
        }

        if (unread) {
            // Aligned to the first line of text rather than centred on the row,
            // so a three-line notification does not put the dot halfway down.
            Box(
                Modifier
                    .padding(top = MohallaTheme.spacing.Space2)
                    .size(MohallaTheme.spacing.Space2)
                    .background(MohallaTheme.colors.BrandPrimary, CircleShape),
            )
        }
    }
}

/**
 * The 40dp circle at the logical start of the row.
 *
 * WHAT GOES IN IT DEPENDS ON WHETHER A PERSON DID THIS. A like, a comment, a
 * follow or a mention has an actor and shows their photo. An event that changed
 * or was cancelled has none — the server is explicit that this "is the EVENT
 * changing, not a person acting on the recipient" — and neither does a platform
 * announcement. Those get a mark, which is also the wireframe's own treatment.
 */
@Composable
private fun NotificationMarkAvatar(mark: NotificationMark, actorPhotoMediaId: String?) {
    when (mark) {
        NotificationMark.ACTOR -> MohallaAvatar(
            mediaId = actorPhotoMediaId,
            // The sentence beside it already names the person, so a second
            // announcement of their name would be noise — and the row's own
            // semantics carry the whole thing anyway.
            contentDescription = null,
            // §18's "actor avatar, 40px" — Space10 on the 4dp scale, not a
            // literal. §17: "any value not on this scale is a defect."
            size = MohallaTheme.spacing.Space10,
        )

        // `Info` and `DateRange` rather than a megaphone and a calendar:
        // material-icons-core carries a deliberately small set, and pulling in
        // the extended pack for two glyphs would add several megabytes of
        // vectors to an APK that NFR-PERF-003 caps.
        NotificationMark.PLATFORM -> MarkCircle(Icons.Filled.Info)
        NotificationMark.EVENT -> MarkCircle(Icons.Filled.DateRange)
    }
}

@Composable
private fun MarkCircle(icon: ImageVector) {
    Box(
        modifier = Modifier
            .size(MohallaTheme.spacing.Space10)
            .background(MohallaTheme.colors.BrandPrimarySubtle, CircleShape),
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            imageVector = icon,
            // Decorative: the row's own semantics say what happened.
            contentDescription = null,
            tint = MohallaTheme.colors.BrandPrimary,
            modifier = Modifier
                .fillMaxSize()
                .padding(MohallaTheme.spacing.Space2),
        )
    }
}

/**
 * Which of three things fills the circle.
 *
 * AN ENUM IN `core/ui` RATHER THAN THE FEATURE'S OWN CATEGORY, so this component
 * stays independent of `feature/notifications` — the same reason
 * [MessageBubble]'s `BubbleState` mirrors rather than imports `MessageState`.
 * The mapping from a category to one of these lives with the screen that knows
 * about categories.
 */
enum class NotificationMark {
    /** A person did this. Their photo, or the empty circle if it has not loaded. */
    ACTOR,

    /** An announcement from the platform (NOTIF-FR-005). */
    PLATFORM,

    /** An event changed, was cancelled, or is about to start (NOTIF-FR-006). */
    EVENT,
}
