package org.shehersaaz.mohalla

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.shehersaaz.mohalla.core.design.MohallaFace
import org.shehersaaz.mohalla.core.design.MohallaType
import org.shehersaaz.mohalla.core.design.NASTALIQ_MIN_SP
import org.shehersaaz.mohalla.core.design.face
import org.shehersaaz.mohalla.core.design.style
import org.shehersaaz.mohalla.core.locale.AppLocale
import org.shehersaaz.mohalla.navigation.MohallaTab

/**
 * The RTL rules that can be checked without a device.
 *
 * A Compose UI test would prove the row visually mirrors, and one is written
 * for when an emulator exists (see `20-mobile-open-issues.md`). These assert
 * the properties that *make* the mirroring correct, and they run on the JVM on
 * every build — which matters because §36 makes RTL release-critical rather
 * than a final polish pass, and a gate that only runs where hardware exists is
 * a gate that runs late.
 */
class NavigationRtlTest {

    @Test
    fun `CREATE IS THE THIRD OF FIVE, WHICH IS WHAT KEEPS IT CENTRED UNDER MIRRORING`() {
        // §8: "Create remains the CENTER item, third of five." The middle of an
        // odd-length row is the same position counted from either end, so a
        // mirrored Row keeps it centred for free — but only while the list has
        // five entries and Create is at index 2.
        assertEquals(5, MohallaTab.ordered.size)
        assertEquals(MohallaTab.CREATE, MohallaTab.ordered[2])

        // And it is genuinely the midpoint, counted from both directions.
        val fromStart = MohallaTab.ordered.indexOf(MohallaTab.CREATE)
        val fromEnd = MohallaTab.ordered.reversed().indexOf(MohallaTab.CREATE)
        assertEquals(fromStart, fromEnd)
    }

    @Test
    fun `THE TAB LIST IS IN LOGICAL ORDER AND IS NOT PRE-REVERSED`() {
        // Reversing in code would double-mirror in Urdu: Compose already
        // reverses a Row under LayoutDirection.Rtl, so a manual `.reversed()`
        // puts the order back to LTR while everything around it mirrors —
        // which also moves Create off centre.
        assertEquals(
            listOf(
                MohallaTab.HOME,
                MohallaTab.EVENTS,
                MohallaTab.CREATE,
                MohallaTab.MESSAGES,
                MohallaTab.PROFILE,
            ),
            MohallaTab.ordered,
        )
    }

    @Test
    fun `no tab icon is directional, so none is mirrored`() {
        // 04-mobile-architecture §3 rule 3: directional assets mirror, others
        // are explicitly excluded. A house, a calendar, a plus, an envelope and
        // a person read identically in both directions.
        MohallaTab.entries.forEach { tab ->
            assertTrue("${tab.name} icon must not mirror", !tab.icon.mirrors)
        }
    }

    @Test
    fun `URDU LINE HEIGHT IS TALLER, AND THE COMPENSATION CANCELS IT`() {
        // 04-mobile-architecture §3 rule 5. The requirement is not the line
        // height — it is that a component's height is IDENTICAL in both
        // languages, so an in-place language switch does not reflow the screen.
        MohallaType.all.forEach { token ->
            assertTrue(
                "${token.name}: Urdu must have more room for Naskh",
                token.urduLineHeight.value > token.latinLineHeight.value,
            )

            val extra = token.urduLineHeight.value - token.latinLineHeight.value
            val compensation = MohallaType.compensationFor(token).value
            // Half above, half below.
            assertEquals(extra / 2f, compensation, 0.001f)
        }
    }

    @Test
    fun `the Urdu ratio is roughly 1_2x and never less than Latin`() {
        MohallaType.all.forEach { token ->
            val ratio = token.urduLineHeight.value / token.latinLineHeight.value
            assertTrue("${token.name} ratio was $ratio", ratio >= 1.19f && ratio <= 1.26f)
        }
    }

    @Test
    fun `NASTALIQ IS NEVER USED BELOW 18SP, EVEN WHEN DISPLAY IS REQUESTED`() {
        // §10 and 04-mobile-architecture §3: Nastaliq is display-only, never on
        // a small control. Asking for it on a caption must silently get Naskh
        // rather than an unreadable 12sp Nastaliq label.
        // Asserted through `face()` rather than `fontFamily`, because until
        // DEP-013 supplies the files both Urdu faces are the same platform
        // serif — so comparing families would pass whatever the rule did.
        MohallaType.all.forEach { token ->
            val resolved = token.face(urdu = true, display = true)
            if (token.fontSize.value < NASTALIQ_MIN_SP) {
                assertEquals(
                    "${token.name} is under ${NASTALIQ_MIN_SP}sp and must stay Naskh",
                    MohallaFace.NASKH,
                    resolved,
                )
            } else {
                assertEquals(
                    "${token.name} is display-eligible",
                    MohallaFace.NASTALIQ,
                    resolved,
                )
            }
        }

        // And Nastaliq is never reached without asking for display use, however
        // large the text is.
        assertEquals(MohallaFace.NASKH, MohallaType.Display.face(urdu = true, display = false))
    }

    @Test
    fun `English never resolves an Urdu face`() {
        MohallaType.all.forEach { token ->
            val latin = token.style(urdu = false, display = true)
            assertEquals(
                "${token.name} should use the Latin family",
                org.shehersaaz.mohalla.core.design.MohallaFonts.Latin,
                latin.fontFamily,
            )
        }
    }

    @Test
    fun `both locales are declared with the right direction`() {
        assertTrue(AppLocale.URDU.isRtl)
        assertTrue(!AppLocale.ENGLISH.isRtl)
    }
}
