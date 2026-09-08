package org.shehersaaz.mohalla

import java.io.File
import java.util.Locale
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.shehersaaz.mohalla.core.util.formatLongDate

/**
 * RUNTIME-010 — a suspended account's blocked writes explained nothing.
 *
 * `AccountCapability` was read by the shell and only by the shell, so it gated
 * the Create tab and nothing else. Like, comment, follow and message kept their
 * ordinary appearance; the tap fired a request and the server refused it.
 *
 * The security half held and that is the important half — nothing was written
 * for the suspended account, verified in Postgres during Flow I. The UX half
 * did not: §17 asks that "each attempted write opens approved explanation
 * rather than raw error", and a like produced no message beyond the banner that
 * was already on screen.
 *
 * WHAT THIS FILE CAN AND CANNOT COVER. The notice itself is a composable and
 * there are no Compose UI tests in this module, so what is asserted here is the
 * two things that can be: the CONTRACT with Stage 6 — a code string the compiler
 * cannot check — and the date formatter both the banner and the notice now
 * share. The rendering was verified on the device.
 */
class SuspensionNoticeTest {

    private val main = File("src/main/java/org/shehersaaz/mohalla")

    @Test
    fun `THE CODE THE CLIENT MATCHES IS THE CODE THE SERVER SENDS`() {
        // A CONTRACT WITH A SEPARATE DEPLOYABLE. Stage 6's session guard throws
        // `IdentityErrorCode.ACCOUNT_SUSPENDED` for a write by a READ_ONLY
        // principal; the client matches that string to choose the approved
        // wording. Nothing compiles the two together, so if the server ever
        // renames it the app silently goes back to showing the server's bare
        // "Account is limited." with no date — which is the defect.
        val notice = File(main, "core/ui/FailureNotice.kt").readText()

        assertTrue(
            "FailureNotice must match the server's ACCOUNT_SUSPENDED code",
            notice.contains("\"ACCOUNT_SUSPENDED\""),
        )

        // The server-side name, read from the API source in this same
        // repository, so a rename there fails here rather than on a device.
        val guard = File("../../../apps/api/src/modules/platform/identity/transport/session.guard.ts")
        assertTrue("the session guard must be readable at ${guard.absolutePath}", guard.isFile)
        assertTrue(
            "Stage 6's session guard must still refuse a suspended write with " +
                "ACCOUNT_SUSPENDED; if it has been renamed, FailureNotice's " +
                "constant has to change with it",
            guard.readText().contains("IdentityErrorCode.ACCOUNT_SUSPENDED"),
        )
    }

    @Test
    fun `THE NOTICE USES THE APPROVED WORDING, NOT NEW WORDING`() {
        // §17 says APPROVED explanation. The strings already existed for the
        // banner and the explainer, and reusing them is the point — a second
        // wording for one state is how two screens come to say different
        // things about it.
        val notice = File(main, "core/ui/FailureNotice.kt").readText()

        listOf("suspension_duration_until", "suspension_duration_indefinite")
            .forEach { key ->
                assertTrue(
                    "the suspension notice must use the existing approved " +
                        "string `$key` rather than new copy",
                    notice.contains(key),
                )
            }

        // And it must not be an error tone. The account is in a state; the
        // write did not fail, and the banner already calls this a warning.
        // A WINDOW, not a slice to the first `} else {` - the suspension
        // branch has an inner if/else choosing between the dated and the
        // indefinite wording, so the first `else` is that one and stopping
        // there cut the tone off entirely. What matters is the ORDER: the
        // suspension arm sets WARNING before the generic 403 arm sets ERROR.
        val at = notice.indexOf("CODE_ACCOUNT_SUSPENDED)")
        assertTrue("the suspension branch must exist", at > 0)
        val branch = notice.substring(at, minOf(at + 1400, notice.length))

        val warning = branch.indexOf("AuthNoticeTone.WARNING")
        val error = branch.indexOf("AuthNoticeTone.ERROR")

        assertTrue(
            "a suspension is a WARNING, matching the banner - it is not the " +
                "reader's mistake",
            warning >= 0,
        )
        assertTrue(
            "the WARNING must be the suspension arm and the ERROR the generic " +
                "403 arm, in that order",
            error < 0 || warning < error,
        )
    }

    @Test
    fun `THE DATE READS AS A DATE, IN THE READER'S LANGUAGE`() {
        // The formatter the banner and the notice now share. It exists as one
        // function because two copies are how the two surfaces would come to
        // disagree about the same suspension.
        val english = formatLongDate("2026-09-14T00:00:00Z", Locale.forLanguageTag("en"))
        assertTrue(
            "an English long date should name the month: was $english",
            english != null && english.contains("September"),
        )

        val urdu = formatLongDate("2026-09-14T00:00:00Z", Locale.forLanguageTag("ur"))
        assertTrue("an Urdu date must format rather than fail", urdu != null)
        assertTrue(
            "the Urdu formatting must differ from the English — otherwise the " +
                "locale is being ignored and the banner lied about respecting it",
            urdu != english,
        )
    }

    @Test
    fun `AN UNPARSEABLE DATE IS NO DATE, NEVER A RAW TIMESTAMP`() {
        // The callers fall back to the indefinite wording, which is correct
        // and readable. `2026-09-14T00:00:00Z` in the middle of a sentence
        // about a suspension would be worse than saying nothing about when.
        assertNull(formatLongDate("not a date", Locale.ENGLISH))
        assertNull(formatLongDate("", Locale.ENGLISH))

        // A date-only value is not an instant, and the server sends instants.
        // It must degrade rather than throw.
        assertNull(formatLongDate("2026-09-14", Locale.ENGLISH))
    }

    @Test
    fun `THE FORMATTER IS DECLARED ONCE`() {
        // RUNTIME-010's fix moved this out of `AppContainer`, which owned it
        // privately and made it unreachable from a composable. If a second
        // copy appears, the banner and the notice can disagree about the same
        // date — so the count is the assertion.
        val copies = main.walkTopDown()
            .filter { it.isFile && it.extension == "kt" }
            .filter { it.readText().contains("ofLocalizedDate(FormatStyle.LONG)") ||
                it.readText().contains("ofLocalizedDate(java.time.format.FormatStyle.LONG)") }
            .map { it.name }
            .toList()

        assertEquals(
            "the long-date formatter must be declared exactly once, in " +
                "DateFormatting.kt; found: $copies",
            listOf("DateFormatting.kt"),
            copies,
        )
    }
}
