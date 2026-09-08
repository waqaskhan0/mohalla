package org.shehersaaz.mohalla.feature.auth

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.ImeAction
import org.shehersaaz.mohalla.R
import org.shehersaaz.mohalla.core.design.MohallaTheme
import org.shehersaaz.mohalla.core.design.MohallaType
import org.shehersaaz.mohalla.core.network.ApiFailure
import org.shehersaaz.mohalla.core.ui.AuthNotice
import org.shehersaaz.mohalla.core.ui.MohallaTextButton
import org.shehersaaz.mohalla.core.ui.AuthNoticeTone
import org.shehersaaz.mohalla.core.ui.AuthScaffold
import org.shehersaaz.mohalla.core.ui.MohallaButton
import org.shehersaaz.mohalla.core.ui.MohallaCheckbox
import org.shehersaaz.mohalla.core.ui.MohallaPasswordField
import org.shehersaaz.mohalla.core.ui.MohallaPhoneField
import org.shehersaaz.mohalla.core.ui.MohallaTextField

/**
 * Registration, four steps — UX-AUTH-005 · 006 · 007 · 008.
 *
 * ONE STEP PER SCREEN, NOTHING SENT UNTIL THE LAST. AUTH-FR-001 asks for phone,
 * date of birth, password and an explicit acceptance of the Terms; putting all
 * four on one screen would produce a wall of fields on a 720×1280 display, and
 * putting each behind its own request would create three ways to end up with a
 * half-made account. So the steps are presentational and the transaction is
 * single — which is also why they share one ViewModel.
 *
 * EVERY STEP KEEPS WHAT WAS TYPED. §13 requires fields preserved on transient
 * errors, and the failure this prevents is specific: somebody on a bus loses
 * signal at the last step and is sent back to re-enter a number, a birthday and
 * a password. That is where people abandon signing up.
 */

/** UX-AUTH-005 — the mobile number (AUTH-FR-001 · BR-001). */
@Composable
fun RegisterPhoneScreen(
    state: RegisterUiState,
    onPhoneChanged: (String) -> Unit,
    onContinue: () -> Unit,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    AuthScaffold(
        modifier = modifier,
        title = stringResource(R.string.register_phone_title),
        body = stringResource(R.string.register_phone_body),
        onBack = onBack,
        notice = state.phoneError?.let { AuthNotice(it, AuthNoticeTone.ERROR) },
        action = {
            MohallaButton(
                text = stringResource(R.string.action_continue),
                onClick = onContinue,
                enabled = state.phoneCheck is PhoneCheck.Valid,
                modifier = Modifier.fillMaxWidth(),
            )
        },
    ) {
        MohallaPhoneField(
            value = state.phoneInput,
            onValueChange = onPhoneChanged,
            label = stringResource(R.string.field_phone),
            // The normalised form appears as they type, so somebody who wrote
            // `0300 1234567` sees the app understood them.
            normalisedPreview = (state.phoneCheck as? PhoneCheck.Valid)
                ?.let { formatPhoneForDisplay(it.e164) },
            notAMobileMessage = if (state.phoneCheck is PhoneCheck.NotPakistaniMobile) {
                stringResource(R.string.field_phone_not_mobile)
            } else {
                null
            },
            imeAction = ImeAction.Next,
        )
    }
}

/**
 * UX-AUTH-006 — date of birth (BR-002).
 *
 * A TEXT FIELD, NOT A SPINNER DATE PICKER. Somebody entering a birth year in
 * 1968 would scroll a spinner fifty-eight times; typing `1968-03-14` is faster
 * and works with a screen reader. The field is `YYYY-MM-DD` because that is
 * what the API takes and what avoids the day/month ambiguity a localised format
 * would introduce between the two languages.
 *
 * The underage warning does NOT disable Continue — see
 * [RegisterViewModel.onDateOfBirthChanged] for why a client must not enforce
 * BR-002.
 */
@Composable
fun RegisterDateOfBirthScreen(
    state: RegisterUiState,
    onDateChanged: (year: Int, monthZeroBased: Int, day: Int) -> Unit,
    onContinue: () -> Unit,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val raw = state.dateOfBirth ?: ""

    AuthScaffold(
        modifier = modifier,
        title = stringResource(R.string.register_dob_title),
        body = stringResource(R.string.register_dob_body),
        onBack = onBack,
        notice = when {
            state.dobServerError != null -> AuthNotice(state.dobServerError, AuthNoticeTone.ERROR)
            state.looksUnderage -> AuthNotice(
                stringResource(R.string.register_dob_underage),
                AuthNoticeTone.WARNING,
            )
            else -> null
        },
        action = {
            MohallaButton(
                text = stringResource(R.string.action_continue),
                onClick = onContinue,
                // Enabled on a well-formed date. The age itself is the server's
                // call, so a date that looks underage still submits.
                enabled = state.dateOfBirth != null,
                modifier = Modifier.fillMaxWidth(),
            )
        },
    ) {
        MohallaTextField(
            value = raw,
            onValueChange = { typed ->
                parseIsoDate(typed)?.let { (y, m, d) -> onDateChanged(y, m, d) }
            },
            label = stringResource(R.string.register_dob_select),
            helper = "YYYY-MM-DD",
            keyboardType = androidx.compose.ui.text.input.KeyboardType.Number,
            imeAction = ImeAction.Next,
            // Digits and dashes read left-to-right in both languages.
            forceLtrContent = true,
        )
    }
}

/**
 * `YYYY-MM-DD` → `(year, monthZeroBased, day)`, or `null` while incomplete.
 *
 * Returns the month ZERO-BASED because that is what `Calendar` and the
 * ViewModel's formatter expect. Getting this wrong would shift every birthday
 * by a month, silently, and the round trip is asserted in the tests.
 */
internal fun parseIsoDate(input: String): Triple<Int, Int, Int>? {
    val match = Regex("""^(\d{4})-(\d{2})-(\d{2})$""").matchEntire(input.trim()) ?: return null
    val (y, m, d) = match.destructured
    val month = m.toInt()
    val day = d.toInt()
    if (month !in 1..12 || day !in 1..31) return null
    return Triple(y.toInt(), month - 1, day)
}

/** UX-AUTH-007 — the password (SRS §12). */
@Composable
fun RegisterPasswordScreen(
    state: RegisterUiState,
    onPasswordChanged: (String) -> Unit,
    onContinue: () -> Unit,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    AuthScaffold(
        modifier = modifier,
        title = stringResource(R.string.register_password_title),
        onBack = onBack,
        notice = state.passwordServerError?.let { AuthNotice(it, AuthNoticeTone.ERROR) },
        action = {
            MohallaButton(
                text = stringResource(R.string.action_continue),
                onClick = onContinue,
                enabled = state.password.isNotEmpty() && state.passwordProblem == null,
                modifier = Modifier.fillMaxWidth(),
            )
        },
    ) {
        MohallaPasswordField(
            value = state.password,
            onValueChange = onPasswordChanged,
            label = stringResource(R.string.field_password),
            // The rule is shown from the start, not after a rejection. Telling
            // somebody the requirement once they have broken it is the least
            // useful moment to tell them.
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
            imeAction = ImeAction.Next,
        )
    }
}

/**
 * UX-AUTH-008 — Terms and Community Guidelines (BR-004 · PRIV-014).
 *
 * THE BOX IS NEVER PRE-TICKED. BR-004 requires an explicit affirmative and
 * PRIV-014 records the version and timestamp against it, so a box ticked on the
 * user's behalf would make that record untrue. `Create account` stays disabled
 * until they tick it.
 *
 * THE DOCUMENTS DO NOT EXIST YET (OD-015). Their content is Shehersaaz's to
 * write, and rather than link to a placeholder that looks like a real policy,
 * the links are present but report plainly that the document is not yet
 * available. A fake privacy policy is worse than a missing one.
 */
@Composable
fun RegisterTermsScreen(
    state: RegisterUiState,
    onAcceptedChanged: (Boolean) -> Unit,
    onOpenTerms: () -> Unit,
    onOpenGuidelines: () -> Unit,
    onSubmit: () -> Unit,
    onBack: () -> Unit,
    onRegistered: () -> Unit,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(state.registered) { if (state.registered) onRegistered() }

    AuthScaffold(
        modifier = modifier,
        title = stringResource(R.string.register_terms_title),
        onBack = onBack,
        // OD-015 outranks every transient failure below it: the others are
        // worth retrying and this one is not.
        notice = if (state.termsUnavailable) {
            AuthNotice(
                stringResource(R.string.register_terms_unavailable),
                AuthNoticeTone.ERROR,
            )
        } else when (val failure = state.submitFailure) {
            ApiFailure.Offline -> AuthNotice(
                stringResource(R.string.state_offline_banner),
                AuthNoticeTone.WARNING,
            )
            is ApiFailure.RateLimited -> AuthNotice(
                failure.message ?: stringResource(R.string.state_rate_limited_body),
                AuthNoticeTone.WARNING,
            )
            is ApiFailure.Validation -> AuthNotice(
                failure.message ?: stringResource(R.string.state_error_body),
                AuthNoticeTone.ERROR,
            )
            is ApiFailure.Server -> AuthNotice(
                failure.message ?: stringResource(R.string.state_error_body),
                AuthNoticeTone.ERROR,
            )
            else -> null
        },
        action = {
            MohallaButton(
                text = stringResource(R.string.register_submit),
                onClick = onSubmit,
                enabled = state.termsAccepted,
                loading = state.submitting,
                modifier = Modifier.fillMaxWidth(),
            )
        },
    ) {
        MohallaTextButton(
            text = stringResource(R.string.legal_terms),
            onClick = onOpenTerms,
            modifier = Modifier.fillMaxWidth(),
        )
        MohallaTextButton(
            text = stringResource(R.string.legal_guidelines),
            onClick = onOpenGuidelines,
            modifier = Modifier.fillMaxWidth(),
        )

        MohallaCheckbox(
            checked = state.termsAccepted,
            onCheckedChange = onAcceptedChanged,
            label = stringResource(R.string.register_terms_accept),
            enabled = !state.submitting,
        )
    }
}
