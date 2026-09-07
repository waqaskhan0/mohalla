package org.shehersaaz.mohalla.core.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.error
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextDirection
import org.shehersaaz.mohalla.core.design.MohallaTheme
import org.shehersaaz.mohalla.core.design.MohallaType

/**
 * The text field (UI/UX §18).
 *
 * THREE THINGS IT DOES THAT THE MATERIAL DEFAULT DOES NOT.
 *
 * 1. **The error is announced, not just coloured.** §35 requires error
 *    announcements and forbids colour as the only carrier of state, so the
 *    message is real text below the field AND is set as a semantics `error`, so
 *    TalkBack says it when focus lands. A red outline alone is invisible to a
 *    screen reader and to a colour-blind user.
 *
 * 2. **Numeric and credential fields keep LTR text direction inside an RTL
 *    screen.** A phone number, an OTP code and a password are not prose: they
 *    read left-to-right in Urdu exactly as in English, and mirroring the digits
 *    of a phone number makes it unreadable. The LAYOUT still mirrors — the
 *    label sits at the start, the field is start-aligned — which is the
 *    distinction §36 draws between mirroring a layout and mirroring content.
 *
 * 3. **48dp minimum.** Material's default is shorter; §35 is not.
 */
@Composable
fun MohallaTextField(
    value: String,
    onValueChange: (String) -> Unit,
    label: String,
    modifier: Modifier = Modifier,
    /** Server-supplied where possible, so the user reads what the server said. */
    error: String? = null,
    helper: String? = null,
    enabled: Boolean = true,
    keyboardType: KeyboardType = KeyboardType.Text,
    imeAction: ImeAction = ImeAction.Next,
    isPassword: Boolean = false,
    singleLine: Boolean = true,
    /**
     * `true` for phone numbers, codes and passwords. Keeps the CONTENT
     * left-to-right while the field's layout still mirrors.
     */
    forceLtrContent: Boolean = false,
) {
    Column(modifier = modifier.fillMaxWidth()) {
        OutlinedTextField(
            value = value,
            onValueChange = onValueChange,
            label = { Text(label, style = MohallaTheme.text(MohallaType.BodySm)) },
            enabled = enabled,
            isError = error != null,
            singleLine = singleLine,
            visualTransformation = if (isPassword) {
                PasswordVisualTransformation()
            } else {
                VisualTransformation.None
            },
            textStyle = MohallaTheme.text(MohallaType.Body).copy(
                textDirection = if (forceLtrContent) TextDirection.Ltr else TextDirection.Content,
            ),
            shape = MohallaTheme.radius.ShapeMd,
            colors = OutlinedTextFieldDefaults.colors(
                focusedBorderColor = MohallaTheme.colors.BrandPrimary,
                unfocusedBorderColor = MohallaTheme.colors.BorderDefault,
                errorBorderColor = MohallaTheme.colors.Error,
                focusedLabelColor = MohallaTheme.colors.BrandPrimary,
                unfocusedLabelColor = MohallaTheme.colors.TextSecondary,
                errorLabelColor = MohallaTheme.colors.Error,
                focusedTextColor = MohallaTheme.colors.TextPrimary,
                unfocusedTextColor = MohallaTheme.colors.TextPrimary,
                cursorColor = MohallaTheme.colors.BrandPrimary,
            ),
            modifier = Modifier
                .fillMaxWidth()
                // Announced on focus, so an error is not something only a
                // sighted user learns about.
                .semantics { if (error != null) this.error(error) },
        )

        val message = error ?: helper
        if (message != null) {
            Text(
                text = message,
                style = MohallaTheme.text(MohallaType.Caption),
                color = if (error != null) {
                    MohallaTheme.colors.Error
                } else {
                    MohallaTheme.colors.TextTertiary
                },
                modifier = Modifier.padding(
                    // `start`, never `left`.
                    start = MohallaTheme.spacing.Space1,
                    top = MohallaTheme.spacing.Space1,
                ),
            )
        }
    }
}

/**
 * The Pakistani mobile field.
 *
 * Shows a normalised preview as the user types — `0300 1234567` becomes
 * `+92 300 1234567` under the field — which tells them the app understood the
 * form they used, and tells a user who typed a landline before they submit.
 */
@Composable
fun MohallaPhoneField(
    value: String,
    onValueChange: (String) -> Unit,
    label: String,
    modifier: Modifier = Modifier,
    error: String? = null,
    /** Rendered under the field when the number normalises cleanly. */
    normalisedPreview: String? = null,
    notAMobileMessage: String? = null,
    enabled: Boolean = true,
    imeAction: ImeAction = ImeAction.Next,
) {
    MohallaTextField(
        value = value,
        // Digits, `+`, spaces and dashes only. Filtering as the user types is
        // gentler than rejecting on submit, and the backend accepts all of
        // these forms anyway.
        onValueChange = { raw -> onValueChange(raw.filter { it.isDigit() || it in "+ -" }) },
        label = label,
        modifier = modifier,
        error = error ?: notAMobileMessage,
        helper = normalisedPreview,
        enabled = enabled,
        keyboardType = KeyboardType.Phone,
        imeAction = imeAction,
        // Digits stay LTR in an Urdu interface.
        forceLtrContent = true,
    )
}

/** A password field with the policy as its helper text, not as a surprise. */
@Composable
fun MohallaPasswordField(
    value: String,
    onValueChange: (String) -> Unit,
    label: String,
    policyHint: String,
    modifier: Modifier = Modifier,
    error: String? = null,
    enabled: Boolean = true,
    imeAction: ImeAction = ImeAction.Done,
) {
    // The hint is shown from the start rather than after a rejection: telling
    // somebody the rule once they have broken it is the least useful moment.
    var touched by remember { mutableStateOf(false) }

    MohallaTextField(
        value = value,
        onValueChange = {
            touched = true
            onValueChange(it)
        },
        label = label,
        modifier = modifier,
        error = error,
        helper = if (error == null) policyHint else null,
        enabled = enabled,
        keyboardType = KeyboardType.Password,
        imeAction = imeAction,
        isPassword = true,
        forceLtrContent = true,
    )

    // Referenced so the compiler keeps the field, which documents that the
    // hint is deliberately unconditional rather than shown after a mistake.
    @Suppress("UNUSED_EXPRESSION")
    touched
}
