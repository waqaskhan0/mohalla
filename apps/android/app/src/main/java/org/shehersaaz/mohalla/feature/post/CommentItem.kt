package org.shehersaaz.mohalla.feature.post

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Warning
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
import org.shehersaaz.mohalla.core.network.CommentResponse
import org.shehersaaz.mohalla.core.ui.DELETED_USER_KEY
import org.shehersaaz.mohalla.core.ui.MohallaAvatar

/**
 * One comment, and its replies indented one level (UX-HOME-003 · BR-033).
 *
 * §19 gives the indent as 32dp, which is `Space8` — on the scale, so it is used
 * as-is rather than adjusted like the composer's thumbnail was.
 *
 * ONE LEVEL AND NEVER TWO. The replies are drawn from [CommentThread.replies],
 * which the threading function guarantees is flat: a reply to a reply is
 * attached to the same parent, so there is no recursive case here and no depth
 * parameter to get wrong. BR-033 exists because unbounded nesting on a 360dp
 * screen collapses into a column two characters wide, and because the SRS says
 * this is "the requirement that solves WhatsApp's lack of threading" — one
 * level is enough to answer somebody, and more is a forum.
 *
 * BR-009's DEPARTED AUTHOR IS RESOLVED HERE TOO. A comment outlives its
 * author's account exactly as a post does, and the server sends the same
 * `profile.deletedUser` localisation key — so this checks for it rather than
 * printing it, and does not make the row tappable.
 */
@Composable
fun CommentThreadItem(
    thread: CommentThread,
    onReply: (CommentResponse) -> Unit,
    onDelete: (CommentResponse) -> Unit,
    canDelete: (CommentResponse) -> Boolean,
    onReport: (CommentResponse) -> Unit,
    isDeleting: (CommentResponse) -> Boolean,
    onOpenAuthor: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space3),
    ) {
        CommentRow(
            comment = thread.comment,
            onReply = { onReply(thread.comment) },
            onDelete = { onDelete(thread.comment) },
            canDelete = canDelete(thread.comment),
            onReport = { onReport(thread.comment) },
            deleting = isDeleting(thread.comment),
            onOpenAuthor = onOpenAuthor,
        )

        thread.replies.forEach { reply ->
            CommentRow(
                comment = reply,
                // Replying to a reply aims at the thread parent — the
                // ViewModel resolves that, so this passes the reply and lets
                // BR-033 be enforced in one place.
                onReply = { onReply(reply) },
                onDelete = { onDelete(reply) },
                canDelete = canDelete(reply),
                onReport = { onReport(reply) },
                deleting = isDeleting(reply),
                onOpenAuthor = onOpenAuthor,
                // §19's "comment indent 32". `padding(start = …)` rather than
                // an absolute left inset, so it mirrors in Urdu.
                modifier = Modifier.padding(start = MohallaTheme.spacing.Space8),
            )
        }
    }
}

@Composable
private fun CommentRow(
    comment: CommentResponse,
    onReply: () -> Unit,
    onDelete: () -> Unit,
    canDelete: Boolean,
    onReport: () -> Unit,
    deleting: Boolean,
    onOpenAuthor: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    // BR-009. The server sends a departed author's display name as a
    // localisation key, because both languages must be able to say it.
    val isDeletedAuthor = comment.author.displayName == DELETED_USER_KEY
    val authorName = if (isDeletedAuthor) {
        stringResource(R.string.profile_deleted_user)
    } else {
        comment.author.displayName.orEmpty()
    }

    Row(
        modifier = modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space2),
    ) {
        MohallaAvatar(
            // A departed author has no photo to show, and PRIV-007 requires
            // that what remains carries no link back.
            mediaId = comment.author.photoMediaId?.takeIf { !isDeletedAuthor },
            contentDescription = null,
            size = MohallaTheme.spacing.Space8,
            onClick = if (isDeletedAuthor) {
                null
            } else {
                { onOpenAuthor(comment.author.userId) }
            },
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
                    text = authorName,
                    style = MohallaTheme.text(MohallaType.Label),
                    color = if (isDeletedAuthor) {
                        MohallaTheme.colors.TextTertiary
                    } else {
                        MohallaTheme.colors.TextPrimary
                    },
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = if (isDeletedAuthor) {
                        Modifier
                    } else {
                        Modifier.clickable(
                            role = Role.Button,
                            onClick = { onOpenAuthor(comment.author.userId) },
                        )
                    },
                )

                if (comment.author.verifiedBadge && !isDeletedAuthor) {
                    Text(
                        text = stringResource(R.string.badge_verified),
                        style = MohallaTheme.text(MohallaType.Label),
                        color = MohallaTheme.colors.BrandPrimary,
                    )
                }

                Text(
                    text = comment.createdAt.take(RELATIVE_TIME_PREFIX),
                    style = MohallaTheme.text(MohallaType.Caption),
                    color = MohallaTheme.colors.TextTertiary,
                )
            }

            Text(
                text = comment.body,
                style = MohallaTheme.text(MohallaType.Body),
                color = if (deleting) {
                    // Dimmed while the deletion is in flight, rather than
                    // removed optimistically: a comment that vanished and came
                    // back would be worse than one that took a moment to go.
                    MohallaTheme.colors.TextTertiary
                } else {
                    MohallaTheme.colors.TextPrimary
                },
            )

            Row(
                horizontalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space3),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = stringResource(R.string.comment_reply),
                    style = MohallaTheme.text(MohallaType.Label),
                    color = MohallaTheme.colors.BrandPrimary,
                    modifier = Modifier
                        .defaultMinSize(minHeight = MohallaTheme.spacing.Space12)
                        .clickable(enabled = !deleting, role = Role.Button, onClick = onReply)
                        .padding(vertical = MohallaTheme.spacing.Space3),
                )

                // ENGAGE-FR-004/005 — the comment's author, or the POST'S
                // author (BR-020). The control is absent for anybody else
                // rather than disabled: a visible Delete on somebody else's
                // comment would suggest the product permits it.
                if (canDelete) {
                    Row(
                        modifier = Modifier
                            .defaultMinSize(minHeight = MohallaTheme.spacing.Space12)
                            .clickable(
                                enabled = !deleting,
                                role = Role.Button,
                                onClick = onDelete,
                            )
                            .padding(vertical = MohallaTheme.spacing.Space3),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space1),
                    ) {
                        Icon(
                            imageVector = Icons.Filled.Delete,
                            contentDescription = null,
                            tint = MohallaTheme.colors.TextTertiary,
                            modifier = Modifier.size(MohallaTheme.spacing.Space4),
                        )
                        Text(
                            text = stringResource(R.string.comment_delete),
                            style = MohallaTheme.text(MohallaType.Label),
                            color = MohallaTheme.colors.TextTertiary,
                        )
                    }
                } else if (!isDeletedAuthor) {
                    // SAFETY-FR-001 lists a COMMENT among the five things that
                    // can be reported, and this row is the only surface a
                    // comment has. Exclusive with Delete for the same reason the
                    // post's is: an author cannot report their own content, so
                    // one of the two is always the wrong control to show.
                    //
                    // Absent on a departed author's placeholder — PRIV-007 keeps
                    // what remains carrying no link back, and there is nobody
                    // left to action.
                    Row(
                        modifier = Modifier
                            .defaultMinSize(minHeight = MohallaTheme.spacing.Space12)
                            .clickable(role = Role.Button, onClick = onReport)
                            .padding(vertical = MohallaTheme.spacing.Space3),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space1),
                    ) {
                        Icon(
                            imageVector = Icons.Filled.Warning,
                            contentDescription = null,
                            tint = MohallaTheme.colors.TextTertiary,
                            modifier = Modifier.size(MohallaTheme.spacing.Space4),
                        )
                        Text(
                            text = stringResource(R.string.comment_report),
                            style = MohallaTheme.text(MohallaType.Label),
                            color = MohallaTheme.colors.TextTertiary,
                        )
                    }
                }
            }
        }
    }
}

/**
 * The date part of an ISO timestamp.
 *
 * TODO(group 11): localised relative formatting, shared with the post card.
 * Deliberately not hand-rolled as "3h ago" here — pluralisation differs between
 * Urdu and English, and a formatter belongs in one place rather than in two
 * card components.
 */
private const val RELATIVE_TIME_PREFIX = 10
