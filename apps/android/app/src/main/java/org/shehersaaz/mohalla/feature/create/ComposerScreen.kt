package org.shehersaaz.mohalla.feature.create

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
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
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
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.style.TextOverflow
import org.shehersaaz.mohalla.R
import org.shehersaaz.mohalla.core.design.MohallaTheme
import org.shehersaaz.mohalla.core.design.MohallaType
import org.shehersaaz.mohalla.core.network.ApiFailure
import org.shehersaaz.mohalla.core.network.PublicProfileResponse
import org.shehersaaz.mohalla.core.ui.AddAttachmentTile
import org.shehersaaz.mohalla.core.ui.MohallaAvatar
import org.shehersaaz.mohalla.core.ui.MohallaButton
import org.shehersaaz.mohalla.core.ui.MohallaSecondaryButton
import org.shehersaaz.mohalla.core.ui.UPLOAD_TILE
import org.shehersaaz.mohalla.core.ui.UploadTile
import org.shehersaaz.mohalla.core.ui.UploadTileState

/**
 * The composer — UX-CREATE-001.
 *
 * §19's content order, and each item is there for a stated reason:
 *
 *   1. Close ✕ — "task abandoned, not navigated away from". A ✕ rather than a
 *      back chevron, because leaving a composer is discarding work rather than
 *      going up a level. It WARNS BEFORE DISCARDING.
 *   2. Post, top-right, disabled until valid.
 *   3. Author block — "confirms identity". Mohalla's premise is that neighbours
 *      speak under their own names, so the composer shows whose name is about
 *      to be attached.
 *   4. Text area, auto-growing.
 *   5. Attachment previews with PER-FILE progress and retry.
 *   6. Category control, inline.
 *   7. Toolbar, above the keyboard.
 *
 * THIS SCREEN IS ALSO THE PREVIEW. §19: "Doubles as the preview — there is no
 * separate preview screen." So the text renders in the same type token a post
 * card uses, and what the author sees is what publishes.
 *
 * A SUSPENDED ACCOUNT NEVER ARRIVES HERE. The shell intercepts the Create tap
 * and opens the suspension explainer instead (BR-034, §6.2). There is no
 * capability check on this screen and there must not be one — a composer that
 * opens and then refuses on submit is the defect that rule prevents.
 */
@Composable
fun ComposerScreen(
    state: ComposerUiState,
    author: PublicProfileResponse?,
    onBodyChanged: (String) -> Unit,
    onPickImages: () -> Unit,
    onRetryAttachment: (String) -> Unit,
    onRemoveAttachment: (String) -> Unit,
    onCategoryChanged: (String?) -> Unit,
    onPublish: () -> Unit,
    onClose: () -> Unit,
    onDiscard: () -> Unit,
    onPublished: () -> Unit,
    isUrdu: Boolean,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(state.published) { if (state.published != null) onPublished() }

    var confirmingDiscard by remember { mutableStateOf(false) }
    var attachmentSheetOpen by remember { mutableStateOf(false) }
    var categorySheetOpen by remember { mutableStateOf(false) }

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(MohallaTheme.colors.BgPrimary)
            // The toolbar sits above the keyboard (§19 item 7), which is what
            // `imePadding` on the whole column achieves — the alternative,
            // `adjustResize` on the window, resizes the text area instead and
            // makes a long post scroll inside a shrinking box.
            .imePadding(),
    ) {
        ComposerHeader(
            canPost = state.canPost,
            publishing = state.publishing,
            onClose = { if (state.hasContent) confirmingDiscard = true else onClose() },
            onPublish = onPublish,
        )

        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = MohallaTheme.screenMargin),
            verticalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space3),
        ) {
            // A failure that is not about the body text. Every typed word stays
            // on screen — §13, and EDGE-011's guarantee that "text is preserved
            // in the composer".
            state.failure?.let { PublishFailureNotice(it, state) }

            AuthorRow(author = author)

            BodyField(
                value = state.body,
                onValueChange = onBodyChanged,
                error = state.fieldError,
                isUrdu = isUrdu,
            )

            Counter(count = state.graphemeCount, over = state.isOverLimit)

            if (state.attachments.isNotEmpty() || state.remainingImages > 0) {
                AttachmentRow(
                    state = state,
                    onAdd = { attachmentSheetOpen = true },
                    onRetry = onRetryAttachment,
                    onRemove = onRemoveAttachment,
                )
            }

            // BR-013's limit, stated when it is hit — POST-FR-001's acceptance
            // criterion asks for exactly that: "the selection is refused and
            // the limit is stated".
            if (state.attachmentLimitReached) {
                Text(
                    text = stringResource(R.string.composer_image_limit, MAX_IMAGES_PER_POST),
                    style = MohallaTheme.text(MohallaType.Caption),
                    color = MohallaTheme.colors.Warning,
                    modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
                )
            }

            // §19 item 6 — inline, beneath the text field, and skipping is free.
            CategoryControl(
                state = state,
                isUrdu = isUrdu,
                onOpen = { categorySheetOpen = true },
                onClear = { onCategoryChanged(null) },
            )

            // Why Post is disabled, when the screen does not already show it.
            state.postBlockedReason?.let { BlockedReasonNotice(it) }

            Box(Modifier.height(MohallaTheme.spacing.Space8))
        }
    }

    if (attachmentSheetOpen) {
        AttachmentSheet(
            imagesRemaining = state.remainingImages,
            onPickImages = {
                attachmentSheetOpen = false
                onPickImages()
            },
            onDismiss = { attachmentSheetOpen = false },
        )
    }

    if (categorySheetOpen) {
        CategoryPickerSheet(
            categories = state.categories,
            selected = state.categorySlug,
            isUrdu = isUrdu,
            onSelect = {
                onCategoryChanged(it)
                categorySheetOpen = false
            },
            onDismiss = { categorySheetOpen = false },
        )
    }

    if (confirmingDiscard) {
        DiscardConfirmation(
            onKeep = { confirmingDiscard = false },
            onDiscard = {
                confirmingDiscard = false
                onDiscard()
                onClose()
            },
        )
    }
}

/**
 * ✕ on one side, Post on the other (§19 items 1 and 2).
 *
 * Laid out in logical order, so Urdu mirrors it and Post lands at the visual
 * start — which is correct: the primary action belongs where the reading eye
 * ends up, and that is the other side in an RTL script.
 */
@Composable
private fun ComposerHeader(
    canPost: Boolean,
    publishing: Boolean,
    onClose: () -> Unit,
    onPublish: () -> Unit,
) {
    Column {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(MohallaTheme.colors.SurfacePrimary)
                .defaultMinSize(minHeight = HEADER_HEIGHT)
                .padding(horizontal = MohallaTheme.spacing.Space2),
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
                    contentDescription = stringResource(R.string.composer_close),
                    tint = MohallaTheme.colors.TextSecondary,
                    modifier = Modifier.size(MohallaTheme.spacing.Space6),
                )
            }

            Text(
                text = stringResource(R.string.composer_title),
                style = MohallaTheme.text(MohallaType.Title),
                color = MohallaTheme.colors.TextPrimary,
                modifier = Modifier.weight(1f),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )

            MohallaButton(
                text = stringResource(R.string.composer_post),
                onClick = onPublish,
                enabled = canPost,
                loading = publishing,
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

/**
 * §19 item 3 — "author block, confirms identity".
 *
 * Not decoration. §03's first product principle is "people before posts", and
 * the composer is where somebody decides whether to attach their real name to
 * something contentious. Showing whose name it will be, before they publish, is
 * the point.
 */
@Composable
private fun AuthorRow(author: PublicProfileResponse?) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(top = MohallaTheme.spacing.Space3),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space2),
    ) {
        MohallaAvatar(
            mediaId = author?.photoMediaId,
            contentDescription = null,
            size = MohallaTheme.spacing.Space12,
        )

        Column {
            Text(
                text = author?.displayName.orEmpty(),
                style = MohallaTheme.text(MohallaType.Title),
                color = MohallaTheme.colors.TextPrimary,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            author?.username?.let {
                Text(
                    text = "@$it",
                    style = MohallaTheme.text(MohallaType.Caption),
                    color = MohallaTheme.colors.TextTertiary,
                    maxLines = 1,
                )
            }
        }
    }
}

/**
 * §19 item 4 — the auto-growing text area.
 *
 * A `BasicTextField` rather than an `OutlinedTextField`, because this screen IS
 * the preview: a bordered box with a floating label would frame the text as
 * form input, and what the author should see is the post. So the field is
 * unstyled, grows with its content, and renders in the same `Body` token a post
 * card uses.
 *
 * NOT LENGTH-CAPPED IN THE FIELD. Typing past 3,000 graphemes is allowed and
 * the counter turns error; truncating mid-sentence would silently delete
 * somebody's words, and §19 asks for the counter to disable Post rather than
 * for the field to refuse input.
 */
@Composable
private fun BodyField(
    value: String,
    onValueChange: (String) -> Unit,
    error: String?,
    isUrdu: Boolean,
) {
    Column(verticalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space1)) {
        Box(modifier = Modifier.fillMaxWidth()) {
            if (value.isEmpty()) {
                Text(
                    text = stringResource(R.string.composer_placeholder),
                    style = MohallaTheme.text(MohallaType.Body, display = isUrdu),
                    color = MohallaTheme.colors.TextTertiary,
                )
            }

            BasicTextField(
                value = value,
                onValueChange = onValueChange,
                textStyle = MohallaTheme.text(MohallaType.Body, display = isUrdu)
                    .copy(color = MohallaTheme.colors.TextPrimary),
                cursorBrush = SolidColor(MohallaTheme.colors.BrandPrimary),
                modifier = Modifier
                    .fillMaxWidth()
                    // A floor rather than a fixed height, so the field grows
                    // with the text and never scrolls inside itself while the
                    // page around it also scrolls.
                    .defaultMinSize(minHeight = MohallaTheme.spacing.Space16),
            )
        }

        if (error != null) {
            Text(
                text = error,
                style = MohallaTheme.text(MohallaType.Caption),
                color = MohallaTheme.colors.Error,
                modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
            )
        }
    }
}

/**
 * "182 / 3000" (§19 — "counter turns error past 3000 and disables Post").
 *
 * ALWAYS VISIBLE, unlike the event composer's counter which appears near the
 * limit. The mock shows "0/3000" on an empty composer, and it is right to
 * differ: a 3,000-character allowance is generous enough that people want to
 * know where they stand while writing a long report, and this is the one field
 * in the product where somebody deliberately writes to the limit.
 *
 * COUNTED IN GRAPHEMES (BR-012), so an Urdu post is not charged for diacritics
 * a reader never sees.
 */
@Composable
private fun Counter(count: Int, over: Boolean) {
    Text(
        text = stringResource(R.string.composer_counter, count, BODY_MAX_GRAPHEMES),
        style = MohallaTheme.text(MohallaType.Caption),
        color = if (over) MohallaTheme.colors.Error else MohallaTheme.colors.TextTertiary,
        modifier = Modifier
            .fillMaxWidth()
            // Announced when it crosses into error, and not on every keystroke:
            // a live region on a counter would read a number after every letter.
            .then(
                if (over) {
                    Modifier.semantics { liveRegion = LiveRegionMode.Polite }
                } else {
                    Modifier
                },
            ),
    )
}

/**
 * §19 item 5 — the attachment previews.
 *
 * A `LazyRow` THAT SCROLLS rather than a wrapping grid. Four 80dp tiles with
 * three 8dp gaps come to 344dp, which fits a 360dp screen's margins with
 * nothing to spare — so on any narrower configuration, or at a large font
 * scale, the row scrolls instead of reflowing into a second line that would
 * push the category control off screen.
 *
 * Laid out in logical order and NEVER reversed: POST-FR-003 preserves the
 * chosen order, and the layout direction is what mirrors it.
 */
@Composable
private fun AttachmentRow(
    state: ComposerUiState,
    onAdd: () -> Unit,
    onRetry: (String) -> Unit,
    onRemove: (String) -> Unit,
) {
    LazyRow(
        modifier = Modifier
            .fillMaxWidth()
            .height(UPLOAD_TILE),
        horizontalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space2),
        contentPadding = PaddingValues(0.dp),
    ) {
        items(state.attachments, key = { it.localId }) { attachment ->
            UploadTile(
                thumbnailUri = attachment.thumbnailUri,
                state = attachment.state.toTileState(),
                onRemove = { onRemove(attachment.localId) },
                onRetry = if (attachment.canRetry) {
                    { onRetry(attachment.localId) }
                } else {
                    null
                },
            )
        }

        // Absent at four rather than disabled: the limit reads better as the
        // absence of an offer than as a control that refuses.
        if (state.remainingImages > 0) {
            item(key = "add") { AddAttachmentTile(onClick = onAdd) }
        }
    }
}

/**
 * §19 item 6 — the category control, inline beneath the text.
 *
 * §13: "the category control sits inline beneath the text field with a default
 * of General visible but unselected. Choosing is one tap; skipping is free."
 *
 * SO THERE IS NO PRE-SELECTED CATEGORY. The chip shows the placeholder until
 * somebody chooses, and Post is never gated on it — the same reasoning as
 * BR-040's language choice: a pre-selected answer is an answer the product gave
 * itself, and here it would file a drainage complaint under whatever happened
 * to be first.
 */
@Composable
private fun CategoryControl(
    state: ComposerUiState,
    isUrdu: Boolean,
    onOpen: () -> Unit,
    onClear: () -> Unit,
) {
    val chosen = state.categories.find { it.slug == state.categorySlug }

    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space2),
    ) {
        Row(
            modifier = Modifier
                .defaultMinSize(minHeight = MohallaTheme.spacing.Space12)
                .background(
                    if (chosen == null) {
                        MohallaTheme.colors.SurfaceSunken
                    } else {
                        MohallaTheme.colors.BrandPrimarySubtle
                    },
                    MohallaTheme.radius.ShapeFull,
                )
                .clickable(role = Role.Button, onClick = onOpen)
                .padding(
                    horizontal = MohallaTheme.spacing.Space3,
                    vertical = MohallaTheme.spacing.Space2,
                ),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space1),
        ) {
            Text(
                text = chosen?.displayName(isUrdu)
                    ?: stringResource(R.string.composer_add_category),
                style = MohallaTheme.text(MohallaType.Button),
                color = if (chosen == null) {
                    MohallaTheme.colors.TextSecondary
                } else {
                    MohallaTheme.colors.BrandPrimary
                },
                maxLines = 1,
            )
        }

        // Clearing is offered only once something is chosen, and it is a
        // separate target from the chip — tapping the chip reopens the picker,
        // which is what somebody changing their mind wants.
        if (chosen != null) {
            Box(
                modifier = Modifier
                    .size(MohallaTheme.spacing.Space12)
                    .clickable(role = Role.Button, onClick = onClear),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    imageVector = Icons.Filled.Close,
                    contentDescription = stringResource(R.string.composer_clear_category),
                    tint = MohallaTheme.colors.TextTertiary,
                    modifier = Modifier.size(MohallaTheme.spacing.Space4),
                )
            }
        }
    }
}

@Composable
private fun BlockedReasonNotice(reason: PostBlockedReason) {
    Text(
        text = stringResource(
            when (reason) {
                PostBlockedReason.TOO_LONG -> R.string.composer_blocked_too_long
                PostBlockedReason.UPLOAD_IN_PROGRESS -> R.string.composer_blocked_uploading
                // The mock's own copy: "One image didn't upload. Tap retry —
                // your other image and text are saved." The reassurance is the
                // important half, because EDGE-013's whole point is that
                // nothing else was lost.
                PostBlockedReason.UPLOAD_FAILED -> R.string.composer_blocked_upload_failed
                PostBlockedReason.UPLOAD_REJECTED -> R.string.composer_blocked_upload_rejected
            },
        ),
        style = MohallaTheme.text(MohallaType.BodySm),
        color = MohallaTheme.colors.Warning,
        modifier = Modifier
            .fillMaxWidth()
            .background(MohallaTheme.colors.WarningSubtle, MohallaTheme.radius.ShapeSm)
            .padding(MohallaTheme.spacing.Space3)
            .semantics { liveRegion = LiveRegionMode.Polite },
    )
}

@Composable
private fun PublishFailureNotice(failure: ApiFailure, state: ComposerUiState) {
    // A complaint about the body is already rendered under the field.
    if (state.fieldError != null) return

    val text = when (failure) {
        ApiFailure.Offline -> stringResource(R.string.composer_offline)
        is ApiFailure.Conflict -> when (failure.code) {
            // ADR-013 step 7 — the database refused a post referencing media
            // still under inspection. Should be unreachable, because `canPost`
            // requires every attachment READY; kept because a race between the
            // last completion and the tap is possible.
            "MEDIA_NOT_READY" -> stringResource(R.string.composer_media_not_ready)
            "PROFILE_NOT_CREATED" -> stringResource(R.string.composer_needs_profile)
            else -> failure.message ?: stringResource(R.string.state_error_body)
        }
        is ApiFailure.Restricted -> failure.message
            ?: stringResource(R.string.state_restricted_body)
        is ApiFailure.RateLimited -> failure.message
            ?: stringResource(R.string.state_rate_limited_body)
        else -> failure.message ?: stringResource(R.string.state_error_body)
    }

    Text(
        text = text,
        style = MohallaTheme.text(MohallaType.BodySm),
        color = MohallaTheme.colors.Error,
        modifier = Modifier
            .fillMaxWidth()
            .padding(top = MohallaTheme.spacing.Space3)
            .background(MohallaTheme.colors.ErrorSubtle, MohallaTheme.radius.ShapeSm)
            .padding(MohallaTheme.spacing.Space3)
            .semantics { liveRegion = LiveRegionMode.Assertive },
    )
}

/**
 * §19 — "✕ warns before discarding".
 *
 * A T1 confirmation per §6.7: one sentence naming what is lost, a destructive
 * primary, and Cancel as the safe path. NOT offered on an empty composer — a
 * dialog over nothing teaches people to dismiss dialogs without reading them.
 *
 * "Keep writing" rather than "Cancel", because "Cancel" on a discard dialog is
 * genuinely ambiguous: it could mean cancel the discard or cancel the post.
 */
@Composable
private fun DiscardConfirmation(onKeep: () -> Unit, onDiscard: () -> Unit) {
    androidx.compose.material3.AlertDialog(
        onDismissRequest = onKeep,
        title = {
            Text(
                text = stringResource(R.string.composer_discard_title),
                style = MohallaTheme.text(MohallaType.H3),
            )
        },
        text = {
            Text(
                text = stringResource(R.string.composer_discard_body),
                style = MohallaTheme.text(MohallaType.Body),
            )
        },
        confirmButton = {
            MohallaButton(
                text = stringResource(R.string.composer_discard_confirm),
                onClick = onDiscard,
                destructive = true,
            )
        },
        dismissButton = {
            MohallaSecondaryButton(
                text = stringResource(R.string.composer_keep_writing),
                onClick = onKeep,
            )
        },
        containerColor = MohallaTheme.colors.SurfacePrimary,
    )
}

/** Both names arrive in one response, so either language renders (BR-017). */
fun org.shehersaaz.mohalla.core.network.CategoryResponse.displayName(isUrdu: Boolean): String =
    (if (isUrdu) nameUr else nameEn) ?: nameEn ?: nameUr ?: slug

private fun AttachmentState.toTileState(): UploadTileState = when (this) {
    AttachmentState.Pending -> UploadTileState.Pending
    is AttachmentState.Uploading -> UploadTileState.Uploading(percent)
    is AttachmentState.Ready -> UploadTileState.Ready
    AttachmentState.Failed -> UploadTileState.Failed
    is AttachmentState.Rejected -> UploadTileState.Rejected(reason)
}

/** §19 — "Header 56". The same platform constant as the app bar. */
private val HEADER_HEIGHT: Dp = 56.dp

/** A drawn rule, not a gap — so not on the 4dp spacing scale. */
private val HAIRLINE: Dp = 1.dp
