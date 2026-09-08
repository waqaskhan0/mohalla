package org.shehersaaz.mohalla.feature.profile

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import org.shehersaaz.mohalla.R
import org.shehersaaz.mohalla.core.design.MohallaTheme
import org.shehersaaz.mohalla.core.design.MohallaType
import org.shehersaaz.mohalla.core.format.ltr
import org.shehersaaz.mohalla.core.network.ApiFailure
import org.shehersaaz.mohalla.core.ui.FailureState
import org.shehersaaz.mohalla.core.ui.MohallaAvatar
import org.shehersaaz.mohalla.core.ui.MohallaBackHeader
import org.shehersaaz.mohalla.core.ui.MohallaTextButton
import org.shehersaaz.mohalla.core.ui.MohallaButton
import org.shehersaaz.mohalla.core.ui.MohallaSecondaryButton
import org.shehersaaz.mohalla.core.ui.MohallaTextField
import org.shehersaaz.mohalla.feature.setup.BIO_MAX

/**
 * Edit profile — UX-PROFILE-003 (PROFILE-FR-003 · PROFILE-FR-010 · BR-005).
 *
 * THE USERNAME IS SHOWN AND EXPLAINED, NOT HIDDEN. BR-005 makes a handle
 * permanent and the server rejects a `username` in this request rather than
 * ignoring it. Somebody who came to this screen to change their handle deserves
 * to be told they cannot, in one line, rather than to search a form for a
 * control that was never there.
 *
 * THREE OF THE FOUR FIELDS MAY BE EMPTIED, AND EMPTYING ONE IS A SAVE. City, bio
 * and photo are all optional, so clearing one is a legitimate edit — and it is a
 * different request from not touching it. Until this group the client could not
 * express the difference at all (see `PatchBody.kt`), so nobody could remove
 * their own bio.
 *
 * THE PHOTO UPLOADS ON SELECTION, NOT ON SAVE, which is what makes
 * PROFILE-FR-010's promise hold: "GIVEN an upload interrupted mid-transfer, WHEN
 * the user returns to their profile, THEN the previous photo is intact." A
 * failed upload produces no media id, so there is nothing partial to save, and
 * the retry is offered for the photo ALONE while the typed fields sit untouched
 * (EDGE-013).
 */
@Composable
fun EditProfileScreen(
    state: EditProfileUiState,
    onBack: () -> Unit,
    onDisplayNameChanged: (String) -> Unit,
    onCityChanged: (String) -> Unit,
    onBioChanged: (String) -> Unit,
    onPickPhoto: () -> Unit,
    onRetryPhoto: () -> Unit,
    onRemovePhoto: () -> Unit,
    onSave: () -> Unit,
    onRetryLoad: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .background(MohallaTheme.colors.BgPrimary)
            .imePadding(),
    ) {
        MohallaBackHeader(
            title = stringResource(R.string.profile_edit_title),
            onBack = onBack,
        )

        when {
            state.loadFailure != null && !state.loaded ->
                LoadFailure(state.loadFailure, onRetryLoad)

            !state.loaded -> EditSkeleton()

            else -> EditForm(
                state = state,
                onDisplayNameChanged = onDisplayNameChanged,
                onCityChanged = onCityChanged,
                onBioChanged = onBioChanged,
                onPickPhoto = onPickPhoto,
                onRetryPhoto = onRetryPhoto,
                onRemovePhoto = onRemovePhoto,
                onSave = onSave,
            )
        }
    }
}

@Composable
private fun EditForm(
    state: EditProfileUiState,
    onDisplayNameChanged: (String) -> Unit,
    onCityChanged: (String) -> Unit,
    onBioChanged: (String) -> Unit,
    onPickPhoto: () -> Unit,
    onRetryPhoto: () -> Unit,
    onRemovePhoto: () -> Unit,
    onSave: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = MohallaTheme.screenMargin)
            .padding(bottom = MohallaTheme.spacing.Space8),
        verticalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space4),
    ) {
        Spacer(Modifier.height(MohallaTheme.spacing.Space2))

        PhotoRow(
            state = state,
            onPick = onPickPhoto,
            onRetry = onRetryPhoto,
            onRemove = onRemovePhoto,
        )

        UsernameRow(username = state.username)

        MohallaTextField(
            value = state.displayName,
            onValueChange = onDisplayNameChanged,
            label = stringResource(R.string.field_display_name),
            error = state.errorFor("displayName")
                ?: stringResource(R.string.field_too_long).takeIf { state.displayNameTooLong },
        )

        MohallaTextField(
            value = state.city,
            onValueChange = onCityChanged,
            label = stringResource(R.string.field_city_optional),
            error = state.errorFor("city")
                ?: stringResource(R.string.field_too_long).takeIf { state.cityTooLong },
        )

        MohallaTextField(
            value = state.bio,
            onValueChange = onBioChanged,
            label = stringResource(R.string.field_bio_optional),
            // Counted in GRAPHEMES, so an Urdu bio gets the same 200 visible
            // characters an English one does rather than being cut off at 90.
            helper = stringResource(R.string.field_characters_left, BIO_MAX - state.bioLength),
            error = state.errorFor("bio")
                ?: stringResource(R.string.field_too_long).takeIf { state.bioTooLong },
            singleLine = false,
        )

        if (state.saveFailure != null && state.fieldError == null) {
            Text(
                text = stringResource(R.string.profile_edit_save_failed),
                style = MohallaTheme.text(MohallaType.BodySm),
                color = MohallaTheme.colors.Error,
            )
        }

        MohallaButton(
            text = stringResource(R.string.action_save),
            onClick = onSave,
            enabled = state.canSave,
            loading = state.saving,
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

/**
 * BR-005 — permanent, and said so out loud.
 *
 * FORCED LEFT-TO-RIGHT. A username is ASCII by rule, and an unmarked
 * "@sana_bashir" inside a right-to-left paragraph has its `@` re-ordered to the
 * far end by the bidi algorithm — so a correct handle renders as `sana_bashir@`
 * and looks mistyped to the one person who knows it is not.
 */
@Composable
private fun UsernameRow(username: String?) {
    if (username == null) return

    Column(verticalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space1)) {
        Text(
            text = stringResource(R.string.username_label),
            style = MohallaTheme.text(MohallaType.Caption),
            color = MohallaTheme.colors.TextSecondary,
        )
        Text(
            text = ltr("@$username"),
            style = MohallaTheme.text(MohallaType.Body),
            color = MohallaTheme.colors.TextSecondary,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        Text(
            text = stringResource(R.string.profile_username_permanent),
            style = MohallaTheme.text(MohallaType.Caption),
            color = MohallaTheme.colors.TextSecondary,
        )
    }
}

@Composable
private fun PhotoRow(
    state: EditProfileUiState,
    onPick: () -> Unit,
    onRetry: () -> Unit,
    onRemove: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space3),
    ) {
        MohallaAvatar(
            mediaId = state.photoMediaId,
            contentDescription = null,
            size = MohallaTheme.spacing.Space16,
        )

        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space1),
        ) {
            when {
                state.uploading -> Text(
                    text = stringResource(R.string.photo_uploading),
                    style = MohallaTheme.text(MohallaType.BodySm),
                    color = MohallaTheme.colors.TextSecondary,
                )

                state.uploadFailed -> Text(
                    text = if (state.uploadRejectedReason != null) {
                        stringResource(R.string.photo_rejected)
                    } else {
                        stringResource(R.string.photo_upload_failed)
                    },
                    style = MohallaTheme.text(MohallaType.BodySm),
                    color = MohallaTheme.colors.Error,
                )
            }

            Row(horizontalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space2)) {
                // EDGE-013 — the bytes are still held, so a retry does not send
                // the reader back to the picker.
                if (state.uploadFailed && state.pendingPhoto != null) {
                    MohallaTextButton(
                        text = stringResource(R.string.action_retry),
                        onClick = onRetry,
                    )
                }

                MohallaTextButton(
                    text = stringResource(R.string.photo_change),
                    onClick = onPick,
                )

                if (state.photoMediaId != null) {
                    MohallaTextButton(
                        text = stringResource(R.string.photo_remove),
                        onClick = onRemove,
                        destructive = true,
                    )
                }
            }
        }
    }
}

@Composable
private fun LoadFailure(failure: ApiFailure, onRetry: () -> Unit) {
    FailureState(failure = failure, onRetry = onRetry)
}

@Composable
private fun EditSkeleton() {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(MohallaTheme.screenMargin),
        verticalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space4),
    ) {
        repeat(SKELETON_FIELDS) {
            Spacer(
                Modifier
                    .fillMaxWidth()
                    .height(MohallaTheme.spacing.Space12)
                    .background(MohallaTheme.colors.SurfaceSunken, MohallaTheme.radius.ShapeMd),
            )
        }
    }
}

/**
 * The server's message for one field, if it named this one.
 *
 * `details[].path` is how the server says which input it refused, so the message
 * lands under that input rather than in a banner the reader has to map back onto
 * a form.
 */
private fun EditProfileUiState.errorFor(path: String): String? =
    fieldError?.takeIf { it.first == path }?.second

private const val SKELETON_FIELDS = 4
