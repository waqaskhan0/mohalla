package org.shehersaaz.mohalla.core.design

import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.sp

/**
 * TYPE — 11 tokens, taken verbatim from the UI/UX specification's `.moh` type
 * scale (§16). Sizes are `sp`, so they scale with the system font setting,
 * which NFR-ACC-001 requires and which the 130% target in REL-002 tests.
 *
 * THE TWO-LINE-HEIGHT RULE IS THE INTERESTING PART.
 * `04-mobile-architecture.md` §3 rule 5: *"Two line-height tokens per type
 * token. Urdu Naskh needs ≈1.2× Latin. Vertical padding is specified so a
 * component's height is identical in both languages — which is what stops
 * screens reflowing on switch."*
 *
 * That last clause is the requirement, not the line height. LOCALE-FR-002 makes
 * the language switch instant and in-place; if a card were 4dp taller in Urdu,
 * every card below it would move, and a switch that visibly reflows the screen
 * reads as a reload. So each token carries BOTH line heights and the
 * compensation that cancels the difference — see [MohallaType.compensationFor].
 *
 * Urdu line heights are `ceil(latin × 1.2)` rounded to whole sp, computed once
 * here rather than at call sites, so the ratio cannot drift per component.
 */

/** A type token: one size, two line heights, one weight. */
data class MohallaTextToken(
    val name: String,
    val fontSize: TextUnit,
    val latinLineHeight: TextUnit,
    val urduLineHeight: TextUnit,
    val fontWeight: FontWeight,
    val letterSpacing: TextUnit = 0.sp,
    /** UI/UX §16 sets `t-label` in uppercase; nothing else is transformed. */
    val uppercase: Boolean = false,
)

private fun token(
    name: String,
    size: Int,
    latinLine: Int,
    weight: FontWeight,
    letterSpacingEm: Double = 0.0,
    uppercase: Boolean = false,
) = MohallaTextToken(
    name = name,
    fontSize = size.sp,
    latinLineHeight = latinLine.sp,
    // ceil(×1.2). Naskh's ascenders and descenders need the room; without it
    // Urdu diacritics clip, which is a defect REL-002 would catch late.
    urduLineHeight = ((latinLine * 12 + 9) / 10).sp,
    fontWeight = weight,
    letterSpacing = (size * letterSpacingEm).sp,
    uppercase = uppercase,
)

object MohallaType {
    val Display = token("t-display", 32, 38, FontWeight.Bold, -0.020)
    val H1 = token("t-h1", 26, 32, FontWeight.Bold, -0.018)
    val H2 = token("t-h2", 21, 28, FontWeight.SemiBold, -0.012)
    val H3 = token("t-h3", 18, 24, FontWeight.SemiBold, -0.008)
    val Title = token("t-title", 16, 22, FontWeight.SemiBold, -0.004)
    val BodyLg = token("t-bodylg", 17, 26, FontWeight.Normal)
    val Body = token("t-body", 15, 22, FontWeight.Normal)
    val BodySm = token("t-bodysm", 13, 18, FontWeight.Normal)
    val Caption = token("t-caption", 12, 16, FontWeight.Medium)
    val Button = token("t-button", 15, 20, FontWeight.SemiBold)
    val Label = token("t-label", 11, 14, FontWeight.SemiBold, 0.080, uppercase = true)

    val all: List<MohallaTextToken> =
        listOf(Display, H1, H2, H3, Title, BodyLg, Body, BodySm, Caption, Button, Label)

    /**
     * Half the extra height Urdu takes, to be removed from the vertical padding
     * above and below so the component's total height is unchanged.
     *
     * Returned in sp because it scales with the text it compensates for — a
     * fixed dp would stop cancelling at 130% font scale, which is exactly where
     * REL-002 looks.
     */
    fun compensationFor(token: MohallaTextToken): TextUnit =
        ((token.urduLineHeight.value - token.latinLineHeight.value) / 2f).sp
}

/**
 * The bundled families (LOCALE-FR-004 · DEP-013).
 *
 * NASKH IS THE INTERFACE FACE, NASTALIQ IS NOT. `04-mobile-architecture.md` §3
 * limits Nastaliq to display use, *"in four places, never below 18sp"* — it is
 * beautiful and close to how Urdu is actually written by hand, and it is also
 * tall, slow to lay out and unreadable at 11sp. Putting it on a caption or a
 * button label would look authentic in a screenshot and fail a 55-year-old
 * reading a bus timetable on a 720×1280 screen.
 *
 * TODO(DEP-013): the font files are not yet in `res/font`. Until they are, both
 * resolve to the platform's serif, which renders Urdu correctly on API 26+ but
 * is not the approved face. Recorded in `20-mobile-open-issues.md`.
 */
object MohallaFonts {
    /** Urdu interface and body text. */
    val Naskh: FontFamily = FontFamily.Serif

    /** Urdu display only — never below 18sp, never on a control. */
    val Nastaliq: FontFamily = FontFamily.Serif

    /** Latin interface text. */
    val Latin: FontFamily = FontFamily.SansSerif
}

/**
 * Resolve a token into a Compose [TextStyle] for the active language.
 *
 * The language, not the content: a Latin word inside an Urdu interface keeps
 * the Urdu line height so the row does not change height mid-list. Per-run
 * direction is handled by the text layout itself (LOCALE-FR-005), which is a
 * different concern from line box height.
 */
enum class MohallaFace { LATIN, NASKH, NASTALIQ }

/**
 * Which face a token resolves to — the RULE, separate from the font files.
 *
 * Exposed because the rule is testable and the files are not yet: until
 * DEP-013 supplies them, [MohallaFonts.Naskh] and [MohallaFonts.Nastaliq] are
 * the same platform serif, so a test comparing `fontFamily` cannot tell them
 * apart and would pass no matter what the rule did. This can be asserted today
 * and stays correct once the real faces land.
 */
fun MohallaTextToken.face(urdu: Boolean, display: Boolean): MohallaFace = when {
    !urdu -> MohallaFace.LATIN
    // §10 / 04-mobile-architecture §3: display only, never below 18sp.
    display && fontSize.value >= NASTALIQ_MIN_SP -> MohallaFace.NASTALIQ
    else -> MohallaFace.NASKH
}

/** Nastaliq's floor. Below this it is unreadable, so the rule refuses it. */
const val NASTALIQ_MIN_SP = 18f

fun MohallaTextToken.style(urdu: Boolean, display: Boolean = false): TextStyle = TextStyle(
    fontSize = fontSize,
    lineHeight = if (urdu) urduLineHeight else latinLineHeight,
    fontWeight = fontWeight,
    letterSpacing = letterSpacing,
    fontFamily = when (face(urdu, display)) {
        MohallaFace.LATIN -> MohallaFonts.Latin
        MohallaFace.NASTALIQ -> MohallaFonts.Nastaliq
        MohallaFace.NASKH -> MohallaFonts.Naskh
    },
    // Start, never Left. The whole RTL rule in one property (LOCALE-FR-003).
    textAlign = TextAlign.Start,
)
