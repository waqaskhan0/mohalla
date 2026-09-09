package org.shehersaaz.mohalla.core.design

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * The token scales the prototype's `:root` block does not declare.
 *
 * Colours are GENERATED into [MohallaPalette]. These are not: spacing, motion
 * and the grid live in the UI/UX specification's own tables rather than in the
 * prototype's CSS, so they are declared here, by hand, with the approved source
 * cited on each scale.
 *
 * THE RULE THAT MATTERS MORE THAN THE VALUES. UI/UX §17: *"Any value not on
 * this scale is a defect. There is no 6px, no 10px, no 14px, no 18px anywhere
 * in the product."* Which is why these are named constants and not a `dp`
 * literal at a call site — a literal is how 14px gets into a product that
 * forbids it, one component at a time.
 */

/**
 * SPACING — 10 tokens, UI/UX §17. No other value is permitted.
 *
 * Indices are multiples of 4dp, and the gaps in the sequence are deliberate:
 * there is no `space-7`, `space-9` or `space-11`, because the scale is the
 * whole vocabulary rather than a starting point.
 */
object MohallaSpacing {
    /** Icon-to-label gap inside a chip · badge inset. */
    val Space1: Dp = 4.dp

    /** Between chips · avatar-to-name gap · image inset within a card. */
    val Space2: Dp = 8.dp

    /** Gutter between cards · icon-to-label in navigation · list row internal gap. */
    val Space3: Dp = 12.dp

    /** Screen margin · card internal padding · between form fields. */
    val Space4: Dp = 16.dp

    /** Between a heading and its content · sheet horizontal padding. */
    val Space5: Dp = 20.dp

    /** Between distinct content groups within a screen · sheet top padding. */
    val Space6: Dp = 24.dp

    /** Between major sections · above a primary button. */
    val Space8: Dp = 32.dp

    /** Empty-state vertical rhythm · onboarding heading offset. */
    val Space10: Dp = 40.dp

    /**
     * Minimum touch target · button height · list row height.
     *
     * UI/UX §17 is explicit about why this number: *"space-12 doubles as the
     * minimum touch dimension, which is why 48 rather than 44 sits on the
     * scale."* Material's 44dp would have been the obvious choice; 48 was
     * picked for NFR-ACC-002 and for a cautious 55-year-old's thumb, and the
     * spacing scale was bent to fit the accessibility requirement rather than
     * the other way round.
     */
    val Space12: Dp = 48.dp

    /** Empty-state top offset · large section break. */
    val Space16: Dp = 64.dp

    /**
     * Screen margin — the one value that changes with width (UI/UX §17 grid).
     *
     * 12dp on a 360dp screen, 16dp at 390–430dp. On the low-end devices
     * NFR-COMP-002 targets, four extra points of margin is a visible amount of
     * a 360dp line.
     */
    fun screenMargin(widthDp: Int): Dp = if (widthDp < 390) Space3 else Space4
}

/** RADIUS — 5 tokens, from the approved prototype's `--r-*` declarations. */
object MohallaRadius {
    val Sm: Dp = 8.dp
    val Md: Dp = 12.dp
    val Lg: Dp = 16.dp
    val Xl: Dp = 24.dp

    /** `--r-full`: 999px in CSS; a large dp does the same job in Compose. */
    val Full: Dp = 999.dp

    val ShapeSm = RoundedCornerShape(Sm)
    val ShapeMd = RoundedCornerShape(Md)
    val ShapeLg = RoundedCornerShape(Lg)
    val ShapeXl = RoundedCornerShape(Xl)
    val ShapeFull = RoundedCornerShape(Full)

    /**
     * A sheet is rounded at the TOP only, and stays that way in both
     * directions — `RoundedCornerShape`'s top-start/top-end resolve per
     * direction, so this needs no RTL variant.
     */
    val ShapeSheet = RoundedCornerShape(topStart = Xl, topEnd = Xl)
}

/**
 * ELEVATION — 3 tokens, from the prototype's `--e1`/`--e2`/`--e3`.
 *
 * The CSS values are two-layer shadows; Compose takes a single dp. These are
 * the tonal equivalents, and the mapping is deliberately conservative:
 * `04-mobile-architecture.md` §1 and UI/UX §34 both push against heavy
 * shadows, because on the 2 GB devices NFR-COMP-002 targets, a shadow on every
 * card in a scrolling list is measurable.
 */
object MohallaElevation {
    /** Cards. */
    val E1: Dp = 1.dp

    /** Sheets and floating controls. */
    val E2: Dp = 3.dp

    /** Modals. */
    val E3: Dp = 8.dp
}

/**
 * MOTION — 5 tokens, UI/UX §16.
 *
 * `Instant` is 0 and exists on purpose. `04-mobile-architecture.md` §6 assigns
 * it to Like: an optimistic action that animates is an optimistic action that
 * looks like it is still deciding, and the point of optimism is that it does
 * not.
 */
object MohallaMotion {
    const val InstantMs: Int = 0
    const val FastMs: Int = 120
    const val BaseMs: Int = 180
    const val SlowMs: Int = 240
    const val SheetMs: Int = 280
}
