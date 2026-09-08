package org.shehersaaz.mohalla.core.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.TextButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import org.shehersaaz.mohalla.core.design.MohallaTheme
import org.shehersaaz.mohalla.core.design.MohallaType

/**
 * The primary and secondary buttons (UI/UX §18).
 *
 * HEIGHT IS `space-12` — 48dp — AND THAT IS NOT A STYLE CHOICE. UI/UX §17 puts
 * 48 on the spacing scale specifically because it doubles as the minimum touch
 * target, and §35 requires 48dp targets. Material's default `Button` is 40dp
 * high, which is why this wraps rather than uses it directly: taking the
 * default would have quietly shipped a product-wide accessibility failure that
 * looks completely normal.
 *
 * `defaultMinSize` rather than a fixed `height`, so the button GROWS at 130%
 * font scale instead of clipping its label — which is the case REL-002 tests
 * and the case a fixed height fails.
 */
@Composable
fun MohallaButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    loading: Boolean = false,
    destructive: Boolean = false,
) {
    Button(
        onClick = onClick,
        // A loading button is not disabled-looking, but it must not fire twice.
        // Double-submitting a registration is EDGE-001's race arriving from the
        // client's own side.
        enabled = enabled && !loading,
        modifier = modifier.defaultMinSize(minHeight = MohallaTheme.spacing.Space12),
        shape = MohallaTheme.radius.ShapeMd,
        colors = ButtonDefaults.buttonColors(
            containerColor = if (destructive) {
                MohallaTheme.colors.Error
            } else {
                MohallaTheme.colors.BrandPrimary
            },
            contentColor = MohallaTheme.colors.TextInverse,
            disabledContainerColor = MohallaTheme.colors.BorderDefault,
            disabledContentColor = MohallaTheme.colors.TextTertiary,
        ),
        contentPadding = ButtonDefaults.ContentPadding,
    ) {
        if (loading) {
            CircularProgressIndicator(
                modifier = Modifier.defaultMinSize(minWidth = 18.dp, minHeight = 18.dp),
                strokeWidth = 2.dp,
                color = MohallaTheme.colors.TextInverse,
            )
            Box(Modifier.padding(start = MohallaTheme.spacing.Space2))
        }
        Text(text = text, style = MohallaTheme.text(MohallaType.Button))
    }
}

/** Secondary action. Same height, same shape, no fill. */
@Composable
fun MohallaSecondaryButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
) {
    OutlinedButton(
        onClick = onClick,
        enabled = enabled,
        modifier = modifier.defaultMinSize(minHeight = MohallaTheme.spacing.Space12),
        shape = MohallaTheme.radius.ShapeMd,
        colors = ButtonDefaults.outlinedButtonColors(
            containerColor = Color.Transparent,
            contentColor = MohallaTheme.colors.BrandPrimary,
            disabledContentColor = MohallaTheme.colors.TextTertiary,
        ),
    ) {
        Text(text = text, style = MohallaTheme.text(MohallaType.Button))
    }
}

/**
 * A text-only action, at the project's own minimum height.
 *
 * MATERIAL'S `TextButton` IS 40dp TALL AND THE SPEC ASKS FOR 48. The a11y
 * checklist is unambiguous — "48×48dp minimum everywhere" — and twelve bare
 * `TextButton`s were 40: Forgot password, Resend code, both legal links, the
 * photo controls on two screens, Remove from saved, and Unblock. Two of those
 * are on recovery paths, where the reader is already stuck and a missed tap is
 * the second thing that has gone wrong.
 *
 * The height lives HERE rather than in twelve `defaultMinSize` calls, so the
 * thirteenth caller cannot forget it.
 */
@Composable
fun MohallaTextButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    destructive: Boolean = false,
) {
    TextButton(
        onClick = onClick,
        enabled = enabled,
        modifier = modifier.defaultMinSize(minHeight = MohallaTheme.spacing.Space12),
        colors = ButtonDefaults.textButtonColors(
            contentColor = if (destructive) {
                MohallaTheme.colors.Error
            } else {
                MohallaTheme.colors.BrandPrimary
            },
            disabledContentColor = MohallaTheme.colors.TextTertiary,
        ),
    ) {
        Text(text = text, style = MohallaTheme.text(MohallaType.Button))
    }
}
