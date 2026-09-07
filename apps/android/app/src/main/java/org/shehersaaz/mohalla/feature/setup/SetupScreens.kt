package org.shehersaaz.mohalla.feature.setup

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import org.shehersaaz.mohalla.R
import org.shehersaaz.mohalla.core.design.MohallaTheme
import org.shehersaaz.mohalla.core.design.MohallaType
import org.shehersaaz.mohalla.core.network.ApiFailure
import org.shehersaaz.mohalla.core.network.SuggestedUser
import org.shehersaaz.mohalla.core.ui.AuthNotice
import org.shehersaaz.mohalla.core.ui.AuthNoticeTone
import org.shehersaaz.mohalla.core.ui.AuthScaffold
import org.shehersaaz.mohalla.core.ui.MohallaButton
import org.shehersaaz.mohalla.core.ui.MohallaSecondaryButton
import org.shehersaaz.mohalla.core.ui.MohallaTextField

/**
 * UX-SETUP-001 — username selection (PROFILE-FR-001 · EDGE-007).
 *
 * THE TICK SAYS "FREE A MOMENT AGO", NOT "YOURS". Continue is enabled on a
 * well-formed handle rather than on a positive availability check, because the
 * check is advisory and gating on it would make a stale answer into a locked
 * button. Losing the race at claim time is a normal outcome with its own
 * message, and the field keeps what was typed so `ayesha` can become
 * `ayesha_lhr` without starting again.
 *
 * "CHOSEN ONCE" IS SAID BEFORE THEY CHOOSE, not after. PROFILE-FR-001 makes the
 * handle permanent, and somebody who learns that on the confirmation screen has
 * already lost the chance to think about it.
 */
@Composable
fun UsernameScreen(
    state: UsernameUiState,
    onUsernameChanged: (String) -> Unit,
    onSubmit: () -> Unit,
    onClaimed: () -> Unit,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(state.claimed) { if (state.claimed) onClaimed() }

    AuthScaffold(
        modifier = modifier,
        title = stringResource(R.string.username_title),
        body = stringResource(R.string.username_permanent_warning),
        notice = when {
            state.takenMessage != null || state.looksFree == false -> AuthNotice(
                state.takenMessage ?: stringResource(R.string.username_unavailable),
                AuthNoticeTone.ERROR,
            )
            state.failure is ApiFailure.Offline -> AuthNotice(
                stringResource(R.string.state_offline_banner),
                AuthNoticeTone.WARNING,
            )
            state.failure is ApiFailure.Server -> AuthNotice(
                stringResource(R.string.state_error_body),
                AuthNoticeTone.ERROR,
            )
            state.looksFree == true -> AuthNotice(
                stringResource(R.string.username_looks_free),
                AuthNoticeTone.SUCCESS,
            )
            else -> null
        },
        action = {
            MohallaButton(
                text = stringResource(R.string.action_continue),
                onClick = onSubmit,
                // Shape, not availability. See the class comment.
                enabled = isUsernameShapeValid(state.input),
                loading = state.claiming,
                modifier = Modifier.fillMaxWidth(),
            )
        },
    ) {
        MohallaTextField(
            value = state.input,
            onValueChange = onUsernameChanged,
            label = stringResource(R.string.username_label),
            error = state.shapeProblem?.let { problem ->
                stringResource(
                    when (problem) {
                        UsernameShapeProblem.TOO_SHORT -> R.string.username_too_short
                        UsernameShapeProblem.TOO_LONG -> R.string.username_too_long
                        UsernameShapeProblem.MUST_START_WITH_LETTER ->
                            R.string.username_must_start_with_letter
                        UsernameShapeProblem.NEEDS_LOWERCASE -> R.string.username_needs_lowercase
                        UsernameShapeProblem.INVALID_CHARACTERS ->
                            R.string.username_invalid_characters
                    },
                )
            },
            helper = if (state.checking) stringResource(R.string.a11y_loading) else null,
            imeAction = ImeAction.Done,
            // A handle is lowercase ASCII, so it reads left-to-right in both
            // languages even though the screen around it mirrors.
            forceLtrContent = true,
        )
    }
}

/**
 * UX-SETUP-002 — profile setup (PROFILE-FR-002/003).
 *
 * ONE REQUIRED FIELD, AND THE OTHERS SAY SO. City, bio and photo are all
 * optional and labelled optional — an onboarding form that looks mandatory is
 * an onboarding form people leave.
 *
 * THE PHOTO IS ITS OWN TRANSACTION. It uploads on selection through ADR-013's
 * three steps, and a failure offers a retry for the photo ALONE while the typed
 * fields sit untouched (§13, EDGE-013). A refused file is different from a
 * dropped connection and says so, because retrying a rejected image cannot work.
 */
@Composable
fun ProfileSetupScreen(
    state: ProfileSetupUiState,
    onDisplayNameChanged: (String) -> Unit,
    onCityChanged: (String) -> Unit,
    onBioChanged: (String) -> Unit,
    onPickPhoto: () -> Unit,
    onRetryPhoto: () -> Unit,
    onRemovePhoto: () -> Unit,
    onSubmit: () -> Unit,
    onCreated: () -> Unit,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(state.created) { if (state.created) onCreated() }

    AuthScaffold(
        modifier = modifier,
        title = stringResource(R.string.profile_setup_title),
        body = stringResource(R.string.profile_setup_body),
        notice = when {
            state.uploadRejectedReason != null -> AuthNotice(
                stringResource(R.string.photo_rejected),
                AuthNoticeTone.ERROR,
            )
            state.uploadFailed -> AuthNotice(
                stringResource(R.string.photo_upload_failed),
                AuthNoticeTone.WARNING,
            )
            state.failure is ApiFailure.Offline -> AuthNotice(
                stringResource(R.string.state_offline_banner),
                AuthNoticeTone.WARNING,
            )
            state.failure is ApiFailure.Server -> AuthNotice(
                stringResource(R.string.state_error_body),
                AuthNoticeTone.ERROR,
            )
            else -> null
        },
        action = {
            MohallaButton(
                text = stringResource(R.string.action_continue),
                onClick = onSubmit,
                enabled = state.displayName.isNotBlank() &&
                    !state.displayNameTooLong &&
                    !state.cityTooLong &&
                    !state.bioTooLong &&
                    !state.uploading,
                loading = state.submitting,
                modifier = Modifier.fillMaxWidth(),
            )
        },
    ) {
        PhotoRow(
            state = state,
            onPick = onPickPhoto,
            onRetry = onRetryPhoto,
            onRemove = onRemovePhoto,
        )

        MohallaTextField(
            value = state.displayName,
            onValueChange = onDisplayNameChanged,
            label = stringResource(R.string.field_display_name),
            error = state.displayNameServerError
                ?: if (state.displayNameTooLong) {
                    stringResource(R.string.field_too_long)
                } else {
                    null
                },
            imeAction = ImeAction.Next,
        )

        MohallaTextField(
            value = state.city,
            onValueChange = onCityChanged,
            label = stringResource(R.string.field_city_optional),
            error = if (state.cityTooLong) stringResource(R.string.field_too_long) else null,
            imeAction = ImeAction.Next,
        )

        MohallaTextField(
            value = state.bio,
            onValueChange = onBioChanged,
            label = stringResource(R.string.field_bio_optional),
            // Counted in GRAPHEMES, so an Urdu bio gets the same 200 visible
            // characters an English one does rather than being cut off at 90.
            helper = stringResource(R.string.field_characters_left, state.bioRemaining),
            error = if (state.bioTooLong) stringResource(R.string.field_too_long) else null,
            singleLine = false,
            imeAction = ImeAction.Done,
        )
    }
}

@Composable
private fun PhotoRow(
    state: ProfileSetupUiState,
    onPick: () -> Unit,
    onRetry: () -> Unit,
    onRemove: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space4),
    ) {
        // The placeholder avatar. A circle with the surface colour rather than
        // a stock silhouette — a generic face reads as a person who is not
        // there, where an empty circle reads as a space for one.
        Box(
            modifier = Modifier
                .size(MohallaTheme.spacing.Space16)
                .background(MohallaTheme.colors.SurfaceSunken, CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            if (state.uploading) {
                Text(
                    text = stringResource(R.string.a11y_loading),
                    style = MohallaTheme.text(MohallaType.Label),
                    color = MohallaTheme.colors.TextTertiary,
                )
            }
        }

        Column(verticalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space1)) {
            when {
                // Transient failure — retry, using the bytes already held, so
                // the user does not go back to the gallery.
                state.uploadFailed && state.pendingPhoto != null -> TextButton(
                    onClick = onRetry,
                    modifier = Modifier.defaultMinSize(minHeight = MohallaTheme.spacing.Space12),
                ) {
                    Text(
                        text = stringResource(R.string.action_retry),
                        style = MohallaTheme.text(MohallaType.Button),
                        color = MohallaTheme.colors.BrandPrimary,
                    )
                }

                state.photoMediaId != null -> TextButton(
                    onClick = onRemove,
                    modifier = Modifier.defaultMinSize(minHeight = MohallaTheme.spacing.Space12),
                ) {
                    Text(
                        text = stringResource(R.string.photo_remove),
                        style = MohallaTheme.text(MohallaType.Button),
                        color = MohallaTheme.colors.Error,
                    )
                }

                else -> TextButton(
                    onClick = onPick,
                    enabled = !state.uploading,
                    modifier = Modifier.defaultMinSize(minHeight = MohallaTheme.spacing.Space12),
                ) {
                    Text(
                        text = stringResource(R.string.photo_add_optional),
                        style = MohallaTheme.text(MohallaType.Button),
                        color = MohallaTheme.colors.BrandPrimary,
                    )
                }
            }
        }
    }
}

/**
 * UX-SETUP-003 — suggested accounts (SOCIAL-FR-004 · RSK-001).
 *
 * THE COLD-START SCREEN. A new account follows nobody, and RSK-001 is that
 * their first feed is empty and they never come back. This is the one chance to
 * fix that before they see Home, which is why Skip is present but secondary.
 *
 * SKIP IS NOT HIDDEN, THOUGH. Forcing follows would inflate the graph with
 * relationships nobody wanted and make the Following feed useless for exactly
 * the people it was meant to serve. Featured and Discover already carry the
 * empty case (REL-005).
 *
 * NO FOLLOWER COUNTS ARE SHOWN as social proof. A count next to a suggestion
 * turns a neighbourhood list into a popularity ranking, and the product's
 * feed is deliberately chronological rather than ranked.
 */
@Composable
fun SuggestedAccountsScreen(
    state: SuggestionsUiState,
    onToggleFollow: (SuggestedUser) -> Unit,
    onContinue: () -> Unit,
    onSkip: () -> Unit,
    modifier: Modifier = Modifier,
) {
    AuthScaffold(
        modifier = modifier,
        title = stringResource(R.string.suggestions_title),
        body = stringResource(R.string.suggestions_body),
        notice = when {
            state.failure is ApiFailure.Offline -> AuthNotice(
                stringResource(R.string.state_offline_banner),
                AuthNoticeTone.WARNING,
            )
            else -> null
        },
        action = {
            MohallaButton(
                text = stringResource(R.string.action_continue),
                onClick = onContinue,
                enabled = !state.loading,
                modifier = Modifier.fillMaxWidth(),
            )
            MohallaSecondaryButton(
                text = stringResource(R.string.suggestions_skip),
                onClick = onSkip,
                modifier = Modifier.fillMaxWidth(),
            )
        },
    ) {
        // An empty suggestion list is a real state on a platform with few
        // accounts, and it must not look like a failure — Continue still works
        // and Featured will carry the feed (REL-005).
        if (state.users.isEmpty() && !state.loading) {
            Text(
                text = stringResource(R.string.suggestions_empty),
                style = MohallaTheme.text(MohallaType.Body),
                color = MohallaTheme.colors.TextSecondary,
            )
            return@AuthScaffold
        }

        LazyColumn(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space2),
        ) {
            items(state.users, key = { it.userId }) { user ->
                SuggestionRow(
                    user = user,
                    following = state.following.contains(user.userId),
                    pending = state.pending.contains(user.userId),
                    onToggle = { onToggleFollow(user) },
                )
            }
        }
    }
}

@Composable
private fun SuggestionRow(
    user: SuggestedUser,
    following: Boolean,
    pending: Boolean,
    onToggle: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .defaultMinSize(minHeight = MohallaTheme.spacing.Space12)
            .padding(vertical = MohallaTheme.spacing.Space1),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space3),
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
                    text = user.displayName.orEmpty(),
                    style = MohallaTheme.text(MohallaType.Title),
                    color = MohallaTheme.colors.TextPrimary,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                // ADMIN-FR-010 — granted, never implied by account type.
                if (user.verifiedBadge) {
                    Text(
                        text = stringResource(R.string.badge_verified),
                        style = MohallaTheme.text(MohallaType.Label),
                        color = MohallaTheme.colors.BrandPrimary,
                    )
                }
            }
            Text(
                text = listOfNotNull(
                    user.username?.let { "@$it" },
                    user.city,
                ).joinToString(" · "),
                style = MohallaTheme.text(MohallaType.Caption),
                color = MohallaTheme.colors.TextTertiary,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }

        if (following) {
            MohallaSecondaryButton(
                text = stringResource(R.string.action_following),
                onClick = onToggle,
                enabled = !pending,
            )
        } else {
            MohallaButton(
                text = stringResource(R.string.action_follow),
                onClick = onToggle,
                enabled = !pending,
            )
        }
    }
}
