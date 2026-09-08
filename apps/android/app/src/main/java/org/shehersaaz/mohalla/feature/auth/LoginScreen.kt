package org.shehersaaz.mohalla.feature.auth

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import org.shehersaaz.mohalla.R
import org.shehersaaz.mohalla.core.design.MohallaTheme
import org.shehersaaz.mohalla.core.design.MohallaType
import org.shehersaaz.mohalla.core.network.ApiFailure
import org.shehersaaz.mohalla.core.ui.MohallaButton
import org.shehersaaz.mohalla.core.ui.MohallaTextButton
import org.shehersaaz.mohalla.core.ui.MohallaPasswordField
import org.shehersaaz.mohalla.core.ui.MohallaPhoneField

/**
 * UX-AUTH-004 — Log in (AUTH-FR-005 · SEC-006/007).
 *
 * THE ERROR IS ONE SENTENCE, AND ALWAYS THE SAME ONE. `credentialsRejected` is
 * a single boolean by design (see [LoginUiState]); this screen has no branch
 * that could say "no account with that number" or "that account is suspended",
 * because the server refuses all three identically and in comparable time. The
 * uniformity is only worth anything if it survives the last mile.
 *
 * The message is a **live region**, so a screen reader announces it when it
 * appears rather than only on the next focus move — §35 requires error
 * announcements, and a silently-changing banner is not one.
 */
@Composable
fun LoginScreen(
    state: LoginUiState,
    onPhoneChanged: (String) -> Unit,
    onPasswordChanged: (String) -> Unit,
    onSubmit: () -> Unit,
    onForgotPassword: () -> Unit,
    onAuthenticated: (capability: String) -> Unit,
    onVerificationRequired: () -> Unit,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(state.authenticatedCapability) {
        state.authenticatedCapability?.let(onAuthenticated)
    }
    LaunchedEffect(state.verificationRequired) {
        if (state.verificationRequired) onVerificationRequired()
    }

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(MohallaTheme.colors.BgPrimary)
            // The keyboard must not cover the password field on the 720x1280
            // screen NFR-COMP-002 targets.
            .imePadding()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = MohallaTheme.screenMargin),
        verticalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space4),
    ) {
        Spacer(Modifier.height(MohallaTheme.spacing.Space10))

        Text(
            text = stringResource(R.string.login_title),
            style = MohallaTheme.text(MohallaType.H1),
            color = MohallaTheme.colors.TextPrimary,
            modifier = Modifier.semantics { heading() },
        )

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
            enabled = !state.submitting,
        )

        MohallaPasswordField(
            value = state.password,
            onValueChange = onPasswordChanged,
            label = stringResource(R.string.field_password),
            // No policy hint when signing IN: the rule applies to choosing a
            // password, and repeating it here would imply the existing one is
            // being judged.
            policyHint = "",
            enabled = !state.submitting,
            imeAction = ImeAction.Done,
        )

        // ONE message for every rejected sign-in.
        if (state.credentialsRejected) {
            Text(
                text = stringResource(R.string.login_failed),
                style = MohallaTheme.text(MohallaType.BodySm),
                color = MohallaTheme.colors.Error,
                modifier = Modifier.semantics { liveRegion = LiveRegionMode.Assertive },
            )
        }

        // Rate limiting is separate advice - "wait", not "check what you
        // typed" - so it gets its own message (UX-STATE-004).
        when (val failure = state.failure) {
            is ApiFailure.RateLimited -> AuthNotice(
                text = failure.message ?: stringResource(R.string.state_rate_limited_body),
                warning = true,
            )

            ApiFailure.Offline -> AuthNotice(
                text = stringResource(R.string.state_offline_banner),
                warning = true,
            )

            is ApiFailure.Server -> AuthNotice(
                text = failure.message ?: stringResource(R.string.state_error_body),
                warning = false,
            )

            else -> Unit
        }

        MohallaButton(
            text = stringResource(R.string.login_submit),
            onClick = onSubmit,
            enabled = state.phoneCheck is PhoneCheck.Valid && state.password.isNotEmpty(),
            loading = state.submitting,
            modifier = Modifier.fillMaxWidth(),
        )

        MohallaTextButton(
            text = stringResource(R.string.login_forgot_password),
            onClick = onForgotPassword,
            modifier = Modifier.fillMaxWidth(),
        )

        Spacer(Modifier.height(MohallaTheme.spacing.Space8))
    }
}

/**
 * A non-field message on an auth screen.
 *
 * A live region in both cases, so a screen reader announces it when it appears
 * rather than only on the next focus move (§35). `Assertive` for an error the
 * user must act on, `Polite` for a condition they only need to know about.
 */
@Composable
private fun AuthNotice(text: String, warning: Boolean) {
    Text(
        text = text,
        style = MohallaTheme.text(MohallaType.BodySm),
        color = if (warning) MohallaTheme.colors.Warning else MohallaTheme.colors.Error,
        modifier = Modifier.semantics {
            liveRegion = if (warning) LiveRegionMode.Polite else LiveRegionMode.Assertive
        },
    )
}
