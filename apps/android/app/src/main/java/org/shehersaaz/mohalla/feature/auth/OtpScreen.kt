package org.shehersaaz.mohalla.feature.auth

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import org.shehersaaz.mohalla.R
import org.shehersaaz.mohalla.core.design.MohallaTheme
import org.shehersaaz.mohalla.core.design.MohallaType
import org.shehersaaz.mohalla.core.network.ApiFailure
import org.shehersaaz.mohalla.core.ui.MohallaButton
import org.shehersaaz.mohalla.core.ui.MohallaTextButton
import org.shehersaaz.mohalla.core.ui.failureText

/**
 * UX-AUTH-009 — OTP verification (AUTH-FR-003 · SEC-003 · EDGE-005 · §12).
 *
 * THE RTL CASE THAT IS EASY TO GET WRONG. The screen mirrors — heading at the
 * start, back arrow flipped, resend button start-aligned — but **the six digit
 * boxes stay left-to-right**, because a code is read in the order it was sent
 * regardless of the interface language. Mirroring them would show `029184` for
 * the code `481920`, and the user would enter what they see.
 *
 * That is done by providing `LayoutDirection.Ltr` for the digit row *only*, not
 * by opting the whole screen out of mirroring. §36's distinction between
 * mirroring a layout and mirroring content is exactly this.
 *
 * ONE HIDDEN FIELD, NOT SIX. Six separate fields means six focus managers,
 * six backspace edge cases and a paste that only fills the first box. A single
 * invisible `BasicTextField` holding all six digits gives correct auto-advance,
 * correct backspace and working paste for free — and the boxes are a rendering
 * of its value.
 */
@Composable
fun OtpScreen(
    state: OtpUiState,
    onCodeChanged: (String) -> Unit,
    onResend: () -> Unit,
    onVerified: () -> Unit,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(state.verified) { if (state.verified) onVerified() }

    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) { focus.requestFocus() }

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(MohallaTheme.colors.BgPrimary)
            .imePadding()
            .padding(horizontal = MohallaTheme.screenMargin),
        verticalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space4),
    ) {
        Spacer(Modifier.height(MohallaTheme.spacing.Space10))

        Text(
            text = stringResource(R.string.otp_title),
            style = MohallaTheme.text(MohallaType.H1),
            color = MohallaTheme.colors.TextPrimary,
            modifier = Modifier.semantics { heading() },
        )

        // The masked number, so the user can tell whether they mistyped it a
        // screen ago — but never the full number (PRIV-003).
        Text(
            text = stringResource(R.string.otp_sent_to, state.maskedPhone),
            style = MohallaTheme.text(MohallaType.Body),
            color = MohallaTheme.colors.TextSecondary,
        )

        Spacer(Modifier.height(MohallaTheme.spacing.Space2))

        OtpDigitRow(
            code = state.code,
            onCodeChanged = onCodeChanged,
            enabled = !state.submitting && !state.lockedOut,
            hasError = state.invalidCode || state.expiredCode,
            focusRequester = focus,
        )

        // The server's own localised message is preferred over the app's copy
        // wherever it sent one (LOCALE-FR-006).
        val message = when {
            state.lockedOut -> state.serverMessage ?: stringResource(R.string.otp_locked_out)
            state.expiredCode -> state.serverMessage ?: stringResource(R.string.otp_expired)
            state.invalidCode -> state.serverMessage ?: stringResource(R.string.otp_invalid)
            // Every refusal, exhaustively. Offline and Server were handled
            // here and the other six variants produced no message at all
            // (RUNTIME-005).
            state.failure != null -> failureText(state.failure)
            state.codeResent -> stringResource(R.string.otp_resent)
            else -> null
        }

        if (message != null) {
            Text(
                text = message,
                style = MohallaTheme.text(MohallaType.BodySm),
                color = if (state.codeResent && !state.invalidCode && !state.lockedOut) {
                    MohallaTheme.colors.Success
                } else {
                    MohallaTheme.colors.Error
                },
                modifier = Modifier.semantics { liveRegion = LiveRegionMode.Assertive },
            )
        }

        Spacer(Modifier.height(MohallaTheme.spacing.Space4))

        // Verified by auto-submit on the sixth digit, so this button is the
        // fallback for a user who pasted and wants to confirm, and for
        // accessibility — a screen-reader user should not depend on an implicit
        // submit they cannot perceive.
        MohallaButton(
            text = stringResource(R.string.otp_submit),
            onClick = { onCodeChanged(state.code) },
            enabled = isCompleteOtp(state.code) && !state.lockedOut,
            loading = state.submitting,
            modifier = Modifier.fillMaxWidth(),
        )

        ResendRow(state = state, onResend = onResend)
    }
}

/**
 * The six boxes.
 *
 * `LayoutDirection.Ltr` is provided for this row alone. Everything above and
 * below it still mirrors.
 */
@Composable
private fun OtpDigitRow(
    code: String,
    onCodeChanged: (String) -> Unit,
    enabled: Boolean,
    hasError: Boolean,
    focusRequester: FocusRequester,
) {
    val otpLabel = stringResource(R.string.a11y_otp_field, OTP_LENGTH)

    Box {
        // The real field, invisible and one pixel wide. It owns focus, the
        // keyboard, backspace and paste; the boxes below only render its value.
        BasicTextField(
            value = code,
            onValueChange = onCodeChanged,
            enabled = enabled,
            keyboardOptions = KeyboardOptions(
                keyboardType = KeyboardType.NumberPassword,
                imeAction = ImeAction.Done,
            ),
            cursorBrush = androidx.compose.ui.graphics.SolidColor(Color.Transparent),
            modifier = Modifier
                .size(1.dp)
                .focusRequester(focusRequester)
                // Announced as one field with a clear label, rather than as six
                // unlabelled boxes a screen reader would read as empty.
                //
                // FROM A RESOURCE, NOT A LITERAL. This was
                // `"verification code, $OTP_LENGTH digits"` inline, so the one
                // screen where an Urdu reader is copying digits out of an SMS
                // announced its only label in English (RUNTIME-016).
                .semantics { contentDescription = otpLabel },
        )

        CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Ltr) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space2),
            ) {
                repeat(OTP_LENGTH) { index ->
                    val digit = code.getOrNull(index)?.toString() ?: ""
                    val active = index == code.length

                    Box(
                        modifier = Modifier
                            .weight(1f)
                            .height(MohallaTheme.spacing.Space12)
                            .background(
                                MohallaTheme.colors.SurfacePrimary,
                                MohallaTheme.radius.ShapeMd,
                            )
                            .border(
                                width = if (active || hasError) 2.dp else 1.dp,
                                color = when {
                                    hasError -> MohallaTheme.colors.Error
                                    active -> MohallaTheme.colors.BrandPrimary
                                    else -> MohallaTheme.colors.BorderDefault
                                },
                                shape = MohallaTheme.radius.ShapeMd,
                            ),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(
                            text = digit,
                            style = MohallaTheme.text(MohallaType.H2),
                            color = MohallaTheme.colors.TextPrimary,
                            textAlign = TextAlign.Center,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun ResendRow(state: OtpUiState, onResend: () -> Unit) {
    when {
        // SEC-003 — 3 per hour. Told plainly rather than by a dead button,
        // because a button that does nothing is read as a bug.
        state.resendsExhausted -> Text(
            text = stringResource(R.string.otp_resend_exhausted),
            style = MohallaTheme.text(MohallaType.BodySm),
            color = MohallaTheme.colors.TextSecondary,
        )

        state.cooldownSeconds > 0 -> Text(
            text = stringResource(R.string.otp_resend_in, state.cooldownSeconds),
            style = MohallaTheme.text(MohallaType.BodySm),
            color = MohallaTheme.colors.TextSecondary,
            // Polite: a ticking countdown announced assertively would interrupt
            // the user every second.
            modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
        )

        else -> MohallaTextButton(
            text = stringResource(R.string.otp_resend),
            onClick = onResend,
            enabled = state.canResend,
        )
    }
}
