package org.shehersaaz.mohalla.feature.auth

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import org.shehersaaz.mohalla.R
import org.shehersaaz.mohalla.core.network.ApiFailure
import org.shehersaaz.mohalla.core.ui.AuthNotice
import org.shehersaaz.mohalla.core.ui.AuthNoticeTone
import org.shehersaaz.mohalla.core.ui.noticeFor
import org.shehersaaz.mohalla.core.ui.AuthScaffold
import org.shehersaaz.mohalla.core.ui.MohallaButton
import org.shehersaaz.mohalla.core.ui.MohallaPasswordField
import org.shehersaaz.mohalla.core.ui.MohallaPhoneField
import org.shehersaaz.mohalla.core.ui.MohallaTextField

/**
 * UX-AUTH-010 — Forgot password (AUTH-FR-006).
 *
 * THE SCREEN THAT MUST NOT CONFIRM ANYTHING. It takes a number and moves on,
 * whether or not an account exists. There is no "we could not find that
 * number", because that sentence is a registered-number lookup available to
 * anybody with the app installed — which on a platform where the identifier IS
 * the phone number would be a way to check who is a member.
 *
 * So success and "no such account" are the same screen transition, and the copy
 * says a code has been sent *if the number is registered* — accurate in both
 * cases without distinguishing them.
 */
@Composable
fun ForgotPasswordScreen(
    state: PasswordResetUiState,
    onPhoneChanged: (String) -> Unit,
    onSubmit: () -> Unit,
    onBack: () -> Unit,
    onCodeRequested: () -> Unit,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(state.requestSent) { if (state.requestSent) onCodeRequested() }

    AuthScaffold(
        modifier = modifier,
        title = stringResource(R.string.forgot_title),
        body = stringResource(R.string.forgot_body),
        onBack = onBack,
        notice = when (val failure = state.failure) {
            ApiFailure.Offline -> AuthNotice(
                stringResource(R.string.state_offline_banner),
                AuthNoticeTone.WARNING,
            )
            is ApiFailure.RateLimited -> AuthNotice(
                failure.message ?: stringResource(R.string.state_rate_limited_body),
                AuthNoticeTone.WARNING,
            )
            is ApiFailure.Server -> AuthNotice(
                failure.message ?: stringResource(R.string.state_error_body),
                AuthNoticeTone.ERROR,
            )
            else -> null
        },
        action = {
            MohallaButton(
                text = stringResource(R.string.forgot_submit),
                onClick = onSubmit,
                enabled = state.phoneCheck is PhoneCheck.Valid,
                loading = state.submitting,
                modifier = Modifier.fillMaxWidth(),
            )
        },
    ) {
        MohallaPhoneField(
            value = state.phoneInput,
            onValueChange = onPhoneChanged,
            label = stringResource(R.string.field_phone),
            normalisedPreview = (state.phoneCheck as? PhoneCheck.Valid)
                ?.let { formatPhoneForDisplay(it.e164) },
            notAMobileMessage = if (state.phoneCheck is PhoneCheck.NotPakistaniMobile) {
                stringResource(R.string.field_phone_not_mobile)
            } else {
                null
            },
            imeAction = ImeAction.Done,
        )
    }
}

/**
 * UX-AUTH-011 — Reset password (AUTH-FR-006 · BR-007).
 *
 * The code and the new password on ONE screen, because they are one submission
 * — splitting them would mean holding a verified code across a navigation step,
 * and a code held longer is a code with a longer window to be used.
 *
 * A rejected code does NOT clear the new password. Somebody who mistyped one
 * digit of a six-digit code should not have to choose a password again.
 */
@Composable
fun ResetPasswordScreen(
    state: PasswordResetUiState,
    onCodeChanged: (String) -> Unit,
    onNewPasswordChanged: (String) -> Unit,
    onSubmit: () -> Unit,
    onBack: () -> Unit,
    onComplete: () -> Unit,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(state.resetComplete) { if (state.resetComplete) onComplete() }

    AuthScaffold(
        modifier = modifier,
        title = stringResource(R.string.reset_title),
        // The masked number, so the user can confirm which account this is
        // without the screen showing a full number (PRIV-003).
        body = state.maskedPhone?.let { stringResource(R.string.otp_sent_to, it) },
        onBack = onBack,
        notice = when {
            state.lockedOut -> AuthNotice(
                state.serverMessage ?: stringResource(R.string.otp_locked_out),
                AuthNoticeTone.ERROR,
            )
            state.expiredCode -> AuthNotice(
                state.serverMessage ?: stringResource(R.string.otp_expired),
                AuthNoticeTone.ERROR,
            )
            state.invalidCode -> AuthNotice(
                state.serverMessage ?: stringResource(R.string.otp_invalid),
                AuthNoticeTone.ERROR,
            )
            // Every OTHER refusal, exhaustively - see [noticeFor]. Two
            // variants used to be handled here and the other six rendered
            // nothing at all (RUNTIME-005).
            state.failure != null -> noticeFor(state.failure)
            else -> null
        },
        action = {
            MohallaButton(
                text = stringResource(R.string.reset_submit),
                onClick = onSubmit,
                enabled = isCompleteOtp(state.code) &&
                    state.newPassword.isNotEmpty() &&
                    state.passwordProblem == null &&
                    !state.lockedOut,
                loading = state.submitting,
                modifier = Modifier.fillMaxWidth(),
            )
        },
    ) {
        MohallaTextField(
            value = state.code,
            onValueChange = onCodeChanged,
            label = stringResource(R.string.field_code),
            keyboardType = KeyboardType.NumberPassword,
            imeAction = ImeAction.Next,
            // Digits stay left-to-right in an Urdu interface.
            forceLtrContent = true,
        )

        MohallaPasswordField(
            value = state.newPassword,
            onValueChange = onNewPasswordChanged,
            label = stringResource(R.string.field_new_password),
            policyHint = stringResource(R.string.field_password_policy),
            error = state.passwordProblem?.let { problem ->
                stringResource(
                    when (problem) {
                        PasswordProblem.TOO_SHORT -> R.string.field_password_too_short
                        PasswordProblem.TOO_LONG -> R.string.field_password_policy
                        PasswordProblem.NEEDS_LETTER -> R.string.field_password_needs_letter
                        PasswordProblem.NEEDS_DIGIT -> R.string.field_password_needs_digit
                    },
                )
            },
            imeAction = ImeAction.Done,
        )
    }
}
