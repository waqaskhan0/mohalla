package org.shehersaaz.mohalla

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Two rules from the §25 device audit, both about labels nothing else can see.
 *
 * RUNTIME-015 — FOUR `BasicTextField`s carried no accessible label: the post
 * composer, the message composer, the comment field and search. Each had a
 * visible placeholder, and a placeholder drawn as a SIBLING `Text` behind the
 * field is a drawing, not a label. The composer's node on the device read
 * `text="" content-desc="" hint=""` and the placeholder string appeared nowhere
 * in the accessibility tree, so TalkBack announced "edit box" and nothing about
 * what belongs in it — on the one screen that exists to write that one thing.
 *
 * RUNTIME-016 — the two labels the app DID have were hardcoded English
 * literals, so an Urdu screen-reader user heard English. One was the OTP
 * field's only label, on the screen where somebody is copying digits out of an
 * SMS.
 *
 * WHY THESE TESTS AND NOT THE ONES THAT EXIST. `LocalizationParityTest`
 * compares `values/` against `values-ur/`, and a literal in a Kotlin file is in
 * neither, so parity was green through both defects. Android Lint's
 * `ContentDescription` check looks at `ImageView`/`ImageButton` in XML layouts
 * and there are no XML layouts here. And a Compose UI test could catch the
 * first rule but not the second — a hardcoded English label passes a semantics
 * assertion perfectly.
 */
class AccessibilityLabelTest {

    private val main = File("src/main/java/org/shehersaaz/mohalla")

    private fun sources(): List<File> =
        main.walkTopDown().filter { it.isFile && it.extension == "kt" }.toList()

    /** The body of the call starting at `at`, to its matching close paren. */
    private fun callBody(text: String, at: Int): String {
        var depth = 1
        var i = at
        while (i < text.length && depth > 0) {
            when (text[i]) {
                '(' -> depth++
                ')' -> depth--
            }
            i++
        }
        return text.substring(at, i)
    }

    @Test
    fun `EVERY TEXT FIELD CARRIES A LABEL AN ASSISTIVE READER CAN HEAR`() {
        val unlabelled = mutableListOf<String>()

        sources().forEach { file ->
            val text = file.readText()
            Regex("""BasicTextField\(""").findAll(text).forEach { match ->
                val body = callBody(text, match.range.last + 1)
                val line = text.take(match.range.first).count { it == '\n' } + 1

                // A label is `contentDescription` in the field's own semantics.
                // A `Text` drawn beside the field is NOT one, which is the
                // whole of RUNTIME-015.
                if (!body.contains("contentDescription")) {
                    unlabelled += "${file.relativeTo(main)}:$line"
                }
            }
        }

        assertEquals(
            "These text fields have no accessible label. A placeholder drawn " +
                "behind the field does not reach the accessibility tree — the " +
                "node reads `content-desc=\"\" hint=\"\"` and TalkBack says " +
                "\"edit box\" (RUNTIME-015). Add " +
                "`.semantics { contentDescription = <the placeholder> }`, " +
                "reading the same string the placeholder draws so the two " +
                "cannot drift:\n" +
                unlabelled.joinToString("\n") { "    $it" } + "\n",
            emptyList<String>(),
            unlabelled,
        )
    }

    @Test
    fun `NO ACCESSIBILITY LABEL IS A HARDCODED LITERAL`() {
        val hardcoded = mutableListOf<String>()

        sources().forEach { file ->
            file.readText().split('\n').forEachIndexed { index, line ->
                // `contentDescription = "..."` with a quote straight after the
                // `=` is a literal. A resource lookup reads
                // `stringResource(...)`, and a variable reads as a name.
                val literal = Regex("""contentDescription\s*=\s*"""").containsMatchIn(line)
                if (literal) {
                    hardcoded += "${file.relativeTo(main)}:${index + 1}  ${line.trim()}"
                }
            }
        }

        assertEquals(
            "These accessibility labels are English literals, so an Urdu " +
                "screen-reader user hears English (RUNTIME-016). " +
                "`LocalizationParityTest` cannot see them — it compares " +
                "resource files, and a Kotlin literal is in neither. Move the " +
                "text to `values/` and `values-ur/`:\n" +
                hardcoded.joinToString("\n") { "    $it" } + "\n",
            emptyList<String>(),
            hardcoded,
        )
    }

    @Test
    fun `THE LABELS THE AUDIT ADDED EXIST IN BOTH LANGUAGES`() {
        // Belt and braces on the rule above: having moved two literals into
        // resources, assert they are actually in both files. Parity covers
        // this in general; naming them here ties the two RUNTIME-016 fixes to
        // the defect rather than trusting a count.
        val en = File("src/main/res/values/strings.xml").readText()
        val ur = File("src/main/res/values-ur/strings.xml").readText()

        listOf("a11y_loading", "a11y_otp_field").forEach { name ->
            assertTrue("$name must exist in values/", en.contains("\"$name\""))
            assertTrue("$name must exist in values-ur/", ur.contains("\"$name\""))
        }
    }
}
