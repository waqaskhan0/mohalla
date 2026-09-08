package org.shehersaaz.mohalla.feature.post

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.outlined.Star
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import org.shehersaaz.mohalla.R
import org.shehersaaz.mohalla.core.design.MohallaTheme
import org.shehersaaz.mohalla.core.design.MohallaType
import org.shehersaaz.mohalla.core.state.Relation
import org.shehersaaz.mohalla.core.network.ApiFailure
import org.shehersaaz.mohalla.core.network.CommentResponse
import org.shehersaaz.mohalla.core.network.PostResponse
import org.shehersaaz.mohalla.core.ui.ContentUnavailable
import org.shehersaaz.mohalla.core.ui.DELETED_USER_KEY
import org.shehersaaz.mohalla.core.ui.LoadingState
import org.shehersaaz.mohalla.core.ui.MohallaAvatar
import org.shehersaaz.mohalla.core.ui.MohallaBackHeader
import org.shehersaaz.mohalla.core.ui.MohallaButton
import org.shehersaaz.mohalla.core.ui.MohallaImageStrip
import org.shehersaaz.mohalla.core.ui.MohallaSecondaryButton
import org.shehersaaz.mohalla.core.ui.TopBarAction

/**
 * Post detail — UX-HOME-003 (POST-FR-009 · ENGAGE-FR-001…006).
 *
 * §19's content order: full author block, complete text never truncated,
 * attachments, engagement row with counts, sticky comment composer, comments
 * oldest-first, replies indented one level.
 *
 * THE POST IS NEVER TRUNCATED HERE. The card in the feed cuts at six lines; this
 * screen is where the whole thing is read, so there is no `maxLines` on the body
 * and no "read more".
 *
 * THE COMPOSER IS STICKY AND STAYS ABOVE THE KEYBOARD. §19 asks for both. It is
 * the screen's PRIMARY action — a detail screen whose comment field is at the
 * bottom of a forty-comment thread is a screen nobody comments from.
 *
 * A POST THAT GOES AWAY WHILE OPEN BECOMES THE NEUTRAL STATE, not an error.
 * POST-FR-009 and §19 both say so, and BR-025 makes deleted, auto-hidden,
 * blocked-author and never-existed one indistinguishable answer.
 */
@Composable
fun PostDetailScreen(
    state: PostDetailUiState,
    onBack: () -> Unit,
    onRetry: () -> Unit,
    onToggleLike: () -> Unit,
    onDraftChanged: (String) -> Unit,
    onSubmitComment: () -> Unit,
    onReplyTo: (CommentResponse?) -> Unit,
    onDeleteComment: (CommentResponse) -> Unit,
    canDeleteComment: (CommentResponse) -> Boolean,
    onDeletePost: () -> Unit,
    onDeleted: () -> Unit,
    onOpenAuthor: (String) -> Unit,
    onOpenMedia: (Int) -> Unit,
    onShare: () -> Unit,
    onToggleSave: () -> Unit,
    onReportPost: () -> Unit,
    onReportComment: (CommentResponse) -> Unit,
    onLoadMoreComments: () -> Unit,
    isUrdu: Boolean,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(state.deleted) { if (state.deleted) onDeleted() }

    var confirmingPostDelete by remember { mutableStateOf(false) }
    var confirmingCommentDelete by remember { mutableStateOf<CommentResponse?>(null) }

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(MohallaTheme.colors.BgPrimary)
            .imePadding(),
    ) {
        MohallaBackHeader(
            title = stringResource(R.string.post_detail_title),
            onBack = onBack,
            actions = buildList {
                // FEED-FR-007. THE ONLY PLACE A POST CAN BE SAVED, because the
                // UX spec places a save control on no surface at all — the card
                // carries like, comment and share, and the overflow carries
                // report and block. A saved-posts screen with nothing that can
                // fill it would be a feature in name only, so the control lives
                // here, where a reader who has decided a post is worth keeping
                // already is.
                if (state.post != null) {
                    add(
                        TopBarAction(
                            // A filled and an outlined star. Not a bookmark:
                            // material-icons-core carries a deliberately small
                            // set and has none, and pulling in the extended
                            // pack for one glyph would add megabytes of vectors
                            // to an APK NFR-PERF-003 caps. The state is carried
                            // by the CONTENT DESCRIPTION as well as the shape,
                            // which is what §35 asks for.
                            icon = if (state.saveState == Relation.Yes) {
                                Icons.Filled.Star
                            } else {
                                Icons.Outlined.Star
                            },
                            descriptionRes = if (state.saveState == Relation.Yes) {
                                R.string.post_unsave
                            } else {
                                R.string.post_save
                            },
                            onClick = onToggleSave,
                        ),
                    )
                }

                // DELETE OR REPORT, NEVER BOTH — §18.5 caps this bar at two
                // actions and Save has one of them. They are mutually exclusive
                // anyway: SAFETY-FR-001 refuses a report of your own content, so
                // an author has nothing to report and everybody else has nothing
                // to delete.
                //
                // The Report control was REMOVED in group 14–15 while
                // UX-SAFE-001 did not exist, rather than left inert: somebody
                // who taps Report and sees nothing happen may reasonably believe
                // they have reported the post and stop. It is back, with the
                // sheet behind it.
                if (state.canDeletePost) {
                    add(
                        TopBarAction(
                            icon = Icons.Filled.Delete,
                            descriptionRes = R.string.post_delete,
                            onClick = { confirmingPostDelete = true },
                        ),
                    )
                } else if (state.post != null) {
                    add(
                        TopBarAction(
                            icon = Icons.Filled.Warning,
                            descriptionRes = R.string.action_report,
                            onClick = onReportPost,
                        ),
                    )
                }
            },
        )

        when {
            // UX-STATE-001, and it wins over everything else on screen.
            state.unavailable && state.post == null -> ContentUnavailable()

            // Only reached by deep link — a post opened from the feed has its
            // cached copy and never shows a spinner (§19).
            state.post == null && state.loadingPost -> LoadingState()

            state.post == null -> PostFailure(failure = state.postFailure, onRetry = onRetry)

            else -> {
                Box(modifier = Modifier.weight(1f)) {
                    Thread(
                        state = state,
                        post = state.post,
                        onToggleLike = onToggleLike,
                        onReplyTo = onReplyTo,
                        onDeleteComment = { confirmingCommentDelete = it },
                        canDeleteComment = canDeleteComment,
                        onReportComment = onReportComment,
                        onOpenAuthor = onOpenAuthor,
                        onOpenMedia = onOpenMedia,
                        onShare = onShare,
                        onLoadMoreComments = onLoadMoreComments,
                    )
                }

                CommentComposer(
                    state = state,
                    onDraftChanged = onDraftChanged,
                    onSubmit = onSubmitComment,
                    onClearReplyTarget = { onReplyTo(null) },
                    isUrdu = isUrdu,
                )
            }
        }
    }

    if (confirmingPostDelete) {
        DeleteConfirmation(
            title = stringResource(R.string.post_delete_title),
            // POST-FR-007 and BR-014, said plainly: the comments and images go
            // too, and nobody — not even an administrator — can bring it back.
            body = stringResource(R.string.post_delete_body),
            confirmLabel = stringResource(R.string.post_delete_confirm),
            onCancel = { confirmingPostDelete = false },
            onConfirm = {
                confirmingPostDelete = false
                onDeletePost()
            },
        )
    }

    confirmingCommentDelete?.let { comment ->
        DeleteConfirmation(
            title = stringResource(R.string.comment_delete_title),
            // ENGAGE-FR-004's acceptance criterion is that replies go with it,
            // so the confirmation says how many rather than surprising somebody
            // who was removing one line.
            body = if (repliesUnder(state, comment) > 0) {
                stringResource(
                    R.string.comment_delete_body_with_replies,
                    repliesUnder(state, comment),
                )
            } else {
                stringResource(R.string.comment_delete_body)
            },
            confirmLabel = stringResource(R.string.comment_delete_confirm),
            onCancel = { confirmingCommentDelete = null },
            onConfirm = {
                confirmingCommentDelete = null
                onDeleteComment(comment)
            },
        )
    }
}

@Composable
private fun Thread(
    state: PostDetailUiState,
    post: PostResponse,
    onToggleLike: () -> Unit,
    onReplyTo: (CommentResponse) -> Unit,
    onDeleteComment: (CommentResponse) -> Unit,
    canDeleteComment: (CommentResponse) -> Boolean,
    onReportComment: (CommentResponse) -> Unit,
    onOpenAuthor: (String) -> Unit,
    onOpenMedia: (Int) -> Unit,
    onShare: () -> Unit,
    onLoadMoreComments: () -> Unit,
) {
    val listState = rememberLazyListState()

    LazyColumn(
        state = listState,
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(
            horizontal = MohallaTheme.screenMargin,
            vertical = MohallaTheme.spacing.Space4,
        ),
        verticalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space4),
    ) {
        item(key = "post") {
            ExpandedPost(
                post = post,
                likeInFlight = state.likeInFlight,
                onToggleLike = onToggleLike,
                onOpenAuthor = onOpenAuthor,
                onOpenMedia = onOpenMedia,
                onShare = onShare,
            )
        }

        if (state.loadingComments && state.comments.isEmpty()) {
            item(key = "comments-loading") { CommentSkeleton() }
        }

        // §21's copy, with the field auto-focused (see `CommentComposer`).
        if (state.isEmptyThread) {
            item(key = "empty") { EmptyThread() }
        }

        if (state.commentsFailure != null && state.comments.isEmpty()) {
            item(key = "comments-failed") { CommentsFailed(onRetry = onLoadMoreComments) }
        }

        items(state.threads, key = { it.comment.id }) { thread ->
            CommentThreadItem(
                thread = thread,
                onReply = onReplyTo,
                onDelete = onDeleteComment,
                canDelete = canDeleteComment,
                onReport = onReportComment,
                isDeleting = { it.id in state.deletingComments },
                onOpenAuthor = onOpenAuthor,
            )
        }

        if (state.commentsCursor != null && state.comments.isNotEmpty()) {
            item(key = "more") {
                MohallaSecondaryButton(
                    text = stringResource(R.string.comment_load_more),
                    onClick = onLoadMoreComments,
                    enabled = !state.loadingMoreComments,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }
    }
}

/**
 * The post, expanded (§19 items 1–4).
 *
 * Not `PostCard`: the card truncates at six lines, is clickable as a whole, and
 * carries a comment control that opens this screen. Sharing the component would
 * mean four behavioural flags on it, and the two are genuinely different
 * things — a card is a summary that invites a tap, and this is the thing itself.
 */
@Composable
private fun ExpandedPost(
    post: PostResponse,
    likeInFlight: Boolean,
    onToggleLike: () -> Unit,
    onOpenAuthor: (String) -> Unit,
    onOpenMedia: (Int) -> Unit,
    onShare: () -> Unit,
) {
    val isDeletedAuthor = post.author.displayName == DELETED_USER_KEY

    Column(verticalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space3)) {
        // BR-032 — the author's own view of an auto-hidden post. Nobody else is
        // served it at all (POST-FR-009), so this only renders for its owner.
        if (post.underReview) {
            Text(
                text = stringResource(R.string.post_under_review),
                style = MohallaTheme.text(MohallaType.BodySm),
                color = MohallaTheme.colors.Warning,
                modifier = Modifier
                    .fillMaxWidth()
                    .background(MohallaTheme.colors.WarningSubtle, MohallaTheme.radius.ShapeSm)
                    .padding(MohallaTheme.spacing.Space3),
            )
        }

        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space2),
        ) {
            MohallaAvatar(
                mediaId = post.author.photoMediaId?.takeIf { !isDeletedAuthor },
                contentDescription = null,
                size = MohallaTheme.spacing.Space12,
                onClick = if (isDeletedAuthor) null else { { onOpenAuthor(post.author.userId) } },
            )

            Column(modifier = Modifier.weight(1f)) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space1),
                ) {
                    Text(
                        text = if (isDeletedAuthor) {
                            stringResource(R.string.profile_deleted_user)
                        } else {
                            post.author.displayName.orEmpty()
                        },
                        style = MohallaTheme.text(MohallaType.Title),
                        color = if (isDeletedAuthor) {
                            MohallaTheme.colors.TextTertiary
                        } else {
                            MohallaTheme.colors.TextPrimary
                        },
                    )
                    if (post.author.verifiedBadge && !isDeletedAuthor) {
                        Text(
                            text = stringResource(R.string.badge_verified),
                            style = MohallaTheme.text(MohallaType.Label),
                            color = MohallaTheme.colors.BrandPrimary,
                        )
                    }
                }

                Text(
                    text = listOfNotNull(
                        post.author.city?.takeIf { !isDeletedAuthor },
                        post.createdAt.take(10),
                        post.categorySlug,
                        post.editedAt?.let { stringResource(R.string.post_edited) },
                    ).joinToString(" · "),
                    style = MohallaTheme.text(MohallaType.Caption),
                    color = MohallaTheme.colors.TextTertiary,
                )
            }
        }

        // §19 item 2 — "complete text, never truncated".
        Text(
            text = post.body,
            style = MohallaTheme.text(MohallaType.BodyLg),
            color = MohallaTheme.colors.TextPrimary,
        )

        if (post.mediaIds.isNotEmpty()) {
            MohallaImageStrip(mediaIds = post.mediaIds, onOpen = onOpenMedia)
        }

        // §19 item 4 — the engagement row, with counts.
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space5),
        ) {
            EngagementControl(
                label = stringResource(
                    if (post.viewerHasLiked) R.string.a11y_unlike else R.string.a11y_like,
                ),
                count = post.likeCount,
                active = post.viewerHasLiked,
                enabled = !likeInFlight,
                onClick = onToggleLike,
            )

            Text(
                text = stringResource(R.string.comment_count, post.commentCount),
                style = MohallaTheme.text(MohallaType.BodySm),
                color = MohallaTheme.colors.TextSecondary,
            )

            Box(Modifier.weight(1f))

            // ENGAGE-FR-007 — the device share sheet, handled by the route.
            Text(
                text = stringResource(R.string.a11y_share),
                style = MohallaTheme.text(MohallaType.Button),
                color = MohallaTheme.colors.BrandPrimary,
                modifier = Modifier
                    .defaultMinSize(minHeight = MohallaTheme.spacing.Space12)
                    .clickable(role = Role.Button, onClick = onShare)
                    .padding(vertical = MohallaTheme.spacing.Space3),
            )
        }

        Box(
            Modifier
                .fillMaxWidth()
                .height(HAIRLINE)
                .background(MohallaTheme.colors.BorderDefault),
        )
    }
}

@Composable
private fun EngagementControl(
    label: String,
    count: Int,
    active: Boolean,
    enabled: Boolean,
    onClick: () -> Unit,
) {
    Row(
        modifier = Modifier
            .defaultMinSize(
                minWidth = MohallaTheme.spacing.Space12,
                minHeight = MohallaTheme.spacing.Space12,
            )
            .clickable(enabled = enabled, role = Role.Button, onClick = onClick),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space1),
    ) {
        Text(
            text = label,
            style = MohallaTheme.text(MohallaType.Button),
            // Active state carried in colour AND in the label, which changes
            // between "Like" and "Remove like" (§35).
            color = if (active) MohallaTheme.colors.Error else MohallaTheme.colors.TextSecondary,
        )
        Text(
            text = count.toString(),
            style = MohallaTheme.text(MohallaType.BodySm),
            color = MohallaTheme.colors.TextSecondary,
        )
    }
}

/**
 * The sticky comment composer (§19 items 5 · UX-HOME-003's PRIMARY action).
 *
 * AUTO-FOCUSED ON AN EMPTY THREAD, which §21 asks for by name: the empty state's
 * note is "comment field auto-focused". On a thread that already has comments it
 * is NOT focused — opening the keyboard over somebody else's conversation before
 * they have read it is the app deciding what they came for.
 *
 * THE COUNTER APPEARS ONLY NEAR THE LIMIT. A comment is 1,000 graphemes and most
 * are a sentence; a permanent counter on a one-line field is furniture. The post
 * composer differs deliberately — there, people write to the limit.
 */
@Composable
private fun CommentComposer(
    state: PostDetailUiState,
    onDraftChanged: (String) -> Unit,
    onSubmit: () -> Unit,
    onClearReplyTarget: () -> Unit,
    isUrdu: Boolean,
) {
    val focus = remember { FocusRequester() }

    LaunchedEffect(state.isEmptyThread) {
        if (state.isEmptyThread) focus.requestFocus()
    }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(MohallaTheme.colors.SurfacePrimary),
    ) {
        Box(
            Modifier
                .fillMaxWidth()
                .height(HAIRLINE)
                .background(MohallaTheme.colors.BorderDefault),
        )

        // ENGAGE-FR-002's error case. The text is STILL IN THE FIELD — the
        // requirement says it must be "preserved for copying", so this explains
        // and does not clear.
        state.commentFailure?.let { CommentFailureNotice(it) }

        // Who is being replied to, and a way out of it (ENGAGE-FR-003).
        state.replyTarget?.let { target ->
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(MohallaTheme.colors.BrandPrimarySubtle)
                    .padding(
                        horizontal = MohallaTheme.screenMargin,
                        vertical = MohallaTheme.spacing.Space2,
                    ),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = stringResource(
                        R.string.comment_replying_to,
                        target.author.displayName
                            ?.takeIf { it != DELETED_USER_KEY }
                            ?: stringResource(R.string.profile_deleted_user),
                    ),
                    style = MohallaTheme.text(MohallaType.Caption),
                    color = MohallaTheme.colors.BrandPrimary,
                    modifier = Modifier.weight(1f),
                )
                Box(
                    modifier = Modifier
                        .size(MohallaTheme.spacing.Space12)
                        .clickable(role = Role.Button, onClick = onClearReplyTarget),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        imageVector = Icons.Filled.Close,
                        contentDescription = stringResource(R.string.comment_cancel_reply),
                        tint = MohallaTheme.colors.BrandPrimary,
                        modifier = Modifier.size(MohallaTheme.spacing.Space4),
                    )
                }
            }
        }

        Row(
            modifier = Modifier
                .fillMaxWidth()
                .defaultMinSize(minHeight = COMPOSER_HEIGHT)
                .padding(
                    horizontal = MohallaTheme.screenMargin,
                    vertical = MohallaTheme.spacing.Space2,
                ),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space2),
        ) {
            Box(modifier = Modifier.weight(1f)) {
                if (state.draft.isEmpty()) {
                    Text(
                        text = stringResource(R.string.comment_placeholder),
                        style = MohallaTheme.text(MohallaType.Body, display = isUrdu),
                        color = MohallaTheme.colors.TextTertiary,
                    )
                }
                BasicTextField(
                    value = state.draft,
                    onValueChange = onDraftChanged,
                    textStyle = MohallaTheme.text(MohallaType.Body, display = isUrdu)
                        .copy(color = MohallaTheme.colors.TextPrimary),
                    cursorBrush = SolidColor(MohallaTheme.colors.BrandPrimary),
                    modifier = Modifier
                        .fillMaxWidth()
                        .focusRequester(focus),
                )
            }

            if (state.draftLength > COMMENT_MAX_GRAPHEMES - COUNTER_THRESHOLD) {
                Text(
                    text = (COMMENT_MAX_GRAPHEMES - state.draftLength).toString(),
                    style = MohallaTheme.text(MohallaType.Caption),
                    color = if (state.draftOverLimit) {
                        MohallaTheme.colors.Error
                    } else {
                        MohallaTheme.colors.TextTertiary
                    },
                )
            }

            Box(
                modifier = Modifier
                    .size(MohallaTheme.spacing.Space12)
                    .clickable(
                        enabled = state.canComment,
                        role = Role.Button,
                        onClick = onSubmit,
                    ),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    // Send IS directional, so the auto-mirrored variant: an
                    // arrow pointing right means "forward" in English and
                    // "backward" in Urdu.
                    imageVector = Icons.AutoMirrored.Filled.Send,
                    contentDescription = stringResource(R.string.comment_send),
                    tint = if (state.canComment) {
                        MohallaTheme.colors.BrandPrimary
                    } else {
                        MohallaTheme.colors.TextTertiary
                    },
                    modifier = Modifier.size(MohallaTheme.spacing.Space6),
                )
            }
        }
    }
}

@Composable
private fun CommentFailureNotice(failure: ApiFailure) {
    val text = when (failure) {
        // The requirement's named case: the post was deleted while the comment
        // was being written. Neutral about WHY it went away (BR-025), explicit
        // that the words are safe.
        is ApiFailure.Unavailable -> stringResource(R.string.comment_post_gone)
        ApiFailure.Offline -> stringResource(R.string.comment_offline)
        is ApiFailure.Restricted -> failure.message
            ?: stringResource(R.string.state_restricted_body)
        is ApiFailure.Validation -> failure.fieldErrors["body"]
            ?: failure.message
            ?: stringResource(R.string.state_error_body)
        else -> failure.message ?: stringResource(R.string.state_error_body)
    }

    Text(
        text = text,
        style = MohallaTheme.text(MohallaType.Caption),
        color = MohallaTheme.colors.Error,
        modifier = Modifier
            .fillMaxWidth()
            .background(MohallaTheme.colors.ErrorSubtle)
            .padding(
                horizontal = MohallaTheme.screenMargin,
                vertical = MohallaTheme.spacing.Space2,
            )
            .semantics { liveRegion = LiveRegionMode.Assertive },
    )
}

@Composable
private fun EmptyThread() {
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space1),
    ) {
        Text(
            text = stringResource(R.string.comment_empty_title),
            style = MohallaTheme.text(MohallaType.Title),
            color = MohallaTheme.colors.TextPrimary,
            modifier = Modifier.semantics { heading() },
        )
        Text(
            text = stringResource(R.string.comment_empty_body),
            style = MohallaTheme.text(MohallaType.Body),
            color = MohallaTheme.colors.TextSecondary,
        )
    }
}

@Composable
private fun CommentsFailed(onRetry: () -> Unit) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space2),
    ) {
        Text(
            // Never "no comments yet" — the thread may be busy and unreachable.
            text = stringResource(R.string.comment_load_failed),
            style = MohallaTheme.text(MohallaType.BodySm),
            color = MohallaTheme.colors.TextSecondary,
        )
        MohallaSecondaryButton(
            text = stringResource(R.string.action_retry),
            onClick = onRetry,
        )
    }
}

@Composable
private fun CommentSkeleton() {
    Column(verticalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space3)) {
        repeat(2) {
            Row(horizontalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space2)) {
                Box(
                    Modifier
                        .size(MohallaTheme.spacing.Space8)
                        .background(
                            MohallaTheme.colors.SurfaceSunken,
                            androidx.compose.foundation.shape.CircleShape,
                        ),
                )
                Column(
                    modifier = Modifier.weight(1f),
                    verticalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space1),
                ) {
                    Box(
                        Modifier
                            .fillMaxWidth(0.3f)
                            .height(MohallaTheme.spacing.Space3)
                            .background(
                                MohallaTheme.colors.SurfaceSunken,
                                MohallaTheme.radius.ShapeSm,
                            ),
                    )
                    Box(
                        Modifier
                            .fillMaxWidth()
                            .height(MohallaTheme.spacing.Space3)
                            .background(
                                MohallaTheme.colors.SurfaceSunken,
                                MohallaTheme.radius.ShapeSm,
                            ),
                    )
                }
            }
        }
    }
}

@Composable
private fun PostFailure(failure: ApiFailure?, onRetry: () -> Unit) {
    when (failure) {
        ApiFailure.Offline -> org.shehersaaz.mohalla.core.ui.OfflineState(onRetry = onRetry)
        is ApiFailure.Server -> org.shehersaaz.mohalla.core.ui.ServerErrorState(
            correlationId = failure.correlationId,
            onRetry = onRetry,
        )
        else -> org.shehersaaz.mohalla.core.ui.ServerErrorState(onRetry = onRetry)
    }
}

/**
 * A T2 confirmation (§6.7).
 *
 * "Bottom sheet with a short list of what changes" is §6.7's T2 shape, and a
 * dialog is used instead for one reason: both of these deletions are
 * irreversible and a sheet is dismissible by tapping outside. §6.7 reserves the
 * dedicated screen for T3 (account deletion, admin ban), so a dialog sits
 * correctly between the two.
 *
 * Cancel is the visually primary path on neither — the destructive action is
 * styled destructive and Cancel is the outline, which §6.7 asks for on T1/T2.
 */
@Composable
private fun DeleteConfirmation(
    title: String,
    body: String,
    confirmLabel: String,
    onCancel: () -> Unit,
    onConfirm: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onCancel,
        title = {
            Text(text = title, style = MohallaTheme.text(MohallaType.H3))
        },
        text = {
            Text(text = body, style = MohallaTheme.text(MohallaType.Body))
        },
        confirmButton = {
            MohallaButton(text = confirmLabel, onClick = onConfirm, destructive = true)
        },
        dismissButton = {
            MohallaSecondaryButton(
                text = stringResource(R.string.action_cancel),
                onClick = onCancel,
            )
        },
        containerColor = MohallaTheme.colors.SurfacePrimary,
    )
}

/** How many replies a deletion would take with it (ENGAGE-FR-004). */
private fun repliesUnder(state: PostDetailUiState, comment: CommentResponse): Int =
    if (comment.parentCommentId != null) {
        0
    } else {
        state.comments.count { it.parentCommentId == comment.id }
    }

/** §19 — "composer 56 sticky". The same platform constant as the app bar. */
private val COMPOSER_HEIGHT: Dp = 56.dp

/** A drawn rule, not a gap — so not on the 4dp spacing scale. */
private val HAIRLINE: Dp = 1.dp

/**
 * How close to the limit the counter appears.
 *
 * A tenth of the allowance, matching the post composer's threshold — but the
 * post composer shows its counter always and this one does not, because a
 * comment is usually a sentence and a permanent counter on a one-line field is
 * furniture.
 */
private const val COUNTER_THRESHOLD = COMMENT_MAX_GRAPHEMES / 10
