package org.shehersaaz.mohalla.feature.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.ImeAction
import org.shehersaaz.mohalla.R
import org.shehersaaz.mohalla.core.design.MohallaTheme
import org.shehersaaz.mohalla.core.design.MohallaType
import org.shehersaaz.mohalla.core.network.ApiFailure
import org.shehersaaz.mohalla.core.ui.MohallaBackHeader
import org.shehersaaz.mohalla.core.ui.MohallaButton
import org.shehersaaz.mohalla.core.ui.MohallaTextField
import org.shehersaaz.mohalla.feature.auth.PasswordProblem

/**
 * Change password — UX-SET-004 (SET-FR-002 · SEC-005).
 *
 * THE SCREEN SAYS WHAT WILL HAPPEN TO OTHER DEVICES, ABOVE THE FIELDS. Changing
 * a password signs out every other session, and that is not a side effect — it
 * is what somebody who thinks another person is inside their account came here
 * for. Leaving it unsaid means the same change either surprises a person who
 * only wanted a new password, or is missed by the person who needed it.
 *
 * THREE FIELDS, AND THE THIRD ONE IS NOT CEREMONY. A mistyped new password on
 * this screen locks the owner out of their own account with every other session
 * already dead; confirmation is the cheapest possible guard against that.
 *
 * ERRORS ARE NAMED AT THE FIELD THEY BELONG TO. A wrong current password says so
 * under the current-password field — it discloses nothing the reader did not
 * just type — and the policy failure names the unmet rule rather than saying
 * "invalid", exactly as registration does (§12).
 */
@Composable
fun ChangePasswordScreen(
    state: ChangePasswordUiState,
    onBack: () -> Unit,
    onCurrentChanged: (String) -> Unit,
    onNewChanged: (String) -> Unit,
    onConfirmChanged: (String) -> Unit,
    onSubmit: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .background(MohallaTheme.colors.BgPrimary)
            .imePadding(),
    ) {
        MohallaBackHeader(
            title = stringResource(R.string.settings_change_password),
            onBack = onBack,
        )

        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = MohallaTheme.screenMargin)
                .padding(bottom = MohallaTheme.spacing.Space8),
            verticalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space4),
        ) {
            Spacer(Modifier.height(MohallaTheme.spacing.Space2))

            Text(
                text = stringResource(R.string.password_change_explainer),
                style = MohallaTheme.text(MohallaType.Body),
                color = MohallaTheme.colors.TextSecondary,
            )

            MohallaTextField(
                value = state.current,
                onValueChange = onCurrentChanged,
                label = stringResource(R.string.password_current),
                isPassword = true,
                error = when {
                    state.wrongCurrent -> stringResource(R.string.password_current_wrong)
                    else -> null
                },
            )

            MohallaTextField(
                value = state.new,
                onValueChange = onNewChanged,
                label = stringResource(R.string.password_new),
                isPassword = true,
                helper = stringResource(R.string.field_password_policy),
                error = when {
                    // SET-FR-002 — "the new password must differ from the
                    // current one". Checked before the policy, because it is the
                    // more specific complaint about the same text.
                    state.newSameAsCurrent -> stringResource(R.string.password_same_as_current)
                    else -> state.newPasswordProblem?.let { stringResource(it.messageRes) }
                },
            )

            MohallaTextField(
                value = state.confirm,
                onValueChange = onConfirmChanged,
                label = stringResource(R.string.password_confirm),
                isPassword = true,
                imeAction = ImeAction.Done,
                error = stringResource(R.string.password_mismatch)
                    .takeIf { state.confirmMismatch },
            )

            // Everything that is not a field problem. A rate limit says its own
            // message, because the server knows how long is left.
            state.failure?.takeIf { !state.wrongCurrent }?.let { failure ->
                Text(
                    text = when (failure) {
                        ApiFailure.Offline -> stringResource(R.string.state_offline_banner)
                        is ApiFailure.RateLimited ->
                            failure.message ?: stringResource(R.string.state_rate_limited_body)
                        else -> stringResource(R.string.password_change_failed)
                    },
                    style = MohallaTheme.text(MohallaType.BodySm),
                    color = MohallaTheme.colors.Error,
                )
            }

            MohallaButton(
                text = stringResource(R.string.password_change_submit),
                onClick = onSubmit,
                enabled = state.canSubmit,
                loading = state.submitting,
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

/** Registration's wording, unchanged — one policy means one set of messages. */
private val PasswordProblem.messageRes: Int
    get() = when (this) {
        PasswordProblem.TOO_SHORT -> R.string.field_password_too_short
        PasswordProblem.TOO_LONG -> R.string.field_password_too_long
        PasswordProblem.NEEDS_LETTER -> R.string.field_password_needs_letter
        PasswordProblem.NEEDS_DIGIT -> R.string.field_password_needs_digit
    }
