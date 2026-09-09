package org.shehersaaz.mohalla.core.design

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.ProvidableCompositionLocal
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.LayoutDirection

/**
 * The Mohalla theme.
 *
 * ONE LIGHT SCHEME, NO DARK. §49 of the Stage 7 brief excludes dark mode from
 * V1, the approved prototype declares no dark values, and the previous
 * foundation theme's `darkColorScheme` was inventing a palette nobody approved.
 * It is gone. If dark mode is ever scoped, it arrives as prototype values first
 * and generated tokens second — not as a guess in a Compose file.
 *
 * MATERIAL3 IS THE ENGINE, NOT THE DESIGN. A `ColorScheme` is provided so that
 * Material components (ripples, text-field indicators, the keyboard's own
 * chrome) resolve sensibly, but Mohalla components read [MohallaTheme] rather
 * than `MaterialTheme.colorScheme`. Reading Material's roles instead would
 * quietly substitute Material's design decisions for the approved ones — an
 * `onSurfaceVariant` is not `--text-tertiary`, and the difference shows up as a
 * contrast failure rather than as a visible mistake.
 */

/** The active language's layout direction, resolved once at the theme root. */
val LocalIsUrdu: ProvidableCompositionLocal<Boolean> = staticCompositionLocalOf { false }

/** Screen margin for the current width (UI/UX §17 grid). */
val LocalScreenMargin: ProvidableCompositionLocal<Dp> =
    staticCompositionLocalOf { MohallaSpacing.Space4 }

object MohallaTheme {
    val colors = MohallaPalette
    val spacing = MohallaSpacing
    val radius = MohallaRadius
    val elevation = MohallaElevation
    val motion = MohallaMotion

    /** `true` when the interface language is Urdu — not when the content is. */
    val isUrdu: Boolean
        @Composable @ReadOnlyComposable get() = LocalIsUrdu.current

    val screenMargin: Dp
        @Composable @ReadOnlyComposable get() = LocalScreenMargin.current

    /** Resolve a type token for the active language. */
    @Composable
    @ReadOnlyComposable
    fun text(token: MohallaTextToken, display: Boolean = false): TextStyle =
        token.style(urdu = LocalIsUrdu.current, display = display)
}

private val MohallaColorScheme = lightColorScheme(
    primary = MohallaPalette.BrandPrimary,
    onPrimary = MohallaPalette.TextInverse,
    primaryContainer = MohallaPalette.BrandPrimarySubtle,
    onPrimaryContainer = MohallaPalette.BrandPrimary,
    secondary = MohallaPalette.BrandSecondary,
    onSecondary = MohallaPalette.TextInverse,
    secondaryContainer = MohallaPalette.BrandSecondarySubtle,
    onSecondaryContainer = MohallaPalette.BrandSecondary,
    background = MohallaPalette.BgPrimary,
    onBackground = MohallaPalette.TextPrimary,
    surface = MohallaPalette.SurfacePrimary,
    onSurface = MohallaPalette.TextPrimary,
    surfaceVariant = MohallaPalette.SurfaceSunken,
    onSurfaceVariant = MohallaPalette.TextSecondary,
    outline = MohallaPalette.BorderStrong,
    outlineVariant = MohallaPalette.BorderDefault,
    error = MohallaPalette.Error,
    onError = MohallaPalette.TextInverse,
    errorContainer = MohallaPalette.ErrorSubtle,
    onErrorContainer = MohallaPalette.Error,
)

/**
 * @param isUrdu whether the INTERFACE language is Urdu. The caller resolves it
 *   from the stored preference, because the layout direction has to be decided
 *   before the first frame — reading it inside composition would paint one
 *   frame in the wrong direction on every cold start in Urdu.
 */
@Composable
fun MohallaTheme(
    isUrdu: Boolean,
    content: @Composable () -> Unit,
) {
    val widthDp = LocalConfiguration.current.screenWidthDp

    // LayoutDirection is provided HERE and nowhere else. Every `start`/`end`
    // modifier below this point mirrors from this one value, which is what
    // makes the switch total rather than per-screen (LOCALE-FR-003).
    CompositionLocalProvider(
        LocalLayoutDirection provides if (isUrdu) LayoutDirection.Rtl else LayoutDirection.Ltr,
        LocalIsUrdu provides isUrdu,
        LocalScreenMargin provides MohallaSpacing.screenMargin(widthDp),
    ) {
        MaterialTheme(
            colorScheme = MohallaColorScheme,
            content = content,
        )
    }
}
