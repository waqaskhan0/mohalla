package org.shehersaaz.mohalla

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Does every layer actually reach the next one? — §44/§45 integration validation.
 *
 * [ApiContractTest] checks the seam between the client and the server. This
 * checks the seams INSIDE the client: a repository function that no ViewModel,
 * screen or navigation graph ever calls is a feature that exists in the source
 * tree and not in the app.
 *
 * THE REASON THIS IS A TEST AND NOT A READING is the lesson group 20 wrote down
 * after finding `onUnauthenticated` declared and passed by nobody for nineteen
 * groups: **a callback nothing passes looks exactly like a callback that
 * works.** The same is true one layer down. `PostSource.update` carries six
 * lines explaining why BR-014 keeps `mediaIds` out of its signature; it reads
 * like live code and it is not called. `NotificationSource.markAllRead` states
 * that "a user who has scrolled a long way and then taps 'Mark all read' is
 * served by [markAllRead]" — and no such control is drawn on any screen. Both
 * pass compilation, both pass every unit test written against them, and neither
 * runs when somebody uses the app.
 *
 * NAMES ARE RESOLVED BY PACKAGE because two interfaces legitimately share one.
 * `EventSource.update` and `PostSource.update` are different functions, and
 * `events.update(...)` in the event composer must not be counted as a caller of
 * the post one — that single ambiguity is what hid `PostSource.update` from the
 * first version of this check. So a call site sitting in a package that
 * declares its own `*Source` with the same name belongs to that interface.
 */
class IntegrationWiringTest {

    private val sourceRoot = File("src/main/java/org/shehersaaz/mohalla")

    /**
     * The three functions that reach no caller, each with the reason it is
     * allowed to. AN ALLOWLIST, following the rule group 11 paid for: a
     * denylist of guessed names let four real defects through 271 tests. A
     * fourth orphan fails this test until somebody decides which it is —
     * dead code to delete, or a screen that was never built.
     */
    private val knownOrphans = mapOf(
        // A DUPLICATE, not a missing feature. POST-FR-007 is fully wired
        // through `PostDetailRepository.deletePost`, which the post-detail
        // screen calls behind a confirmation dialog. This second declaration
        // on `PostSource` is the same route reached from the composer's
        // repository and reached by nothing.
        "PostSource.delete" to
            "Duplicate of PostDetailRepository.deletePost, which POST-FR-007 actually uses.",
        // POST-FR-008 "Edit own post" is a COULD, and the 61-screen UI/UX
        // inventory contains no edit-post screen — so the requirement has an
        // API route, a repository method and nowhere to be invoked from.
        // GAP-M-017.
        "PostSource.update" to
            "POST-FR-008 is a Could with no designed screen (GAP-M-017).",
        // NOTIF-FR-002 asks for "a list newest-first with an unread count"
        // where "opening one navigates to the item that caused it". It does
        // NOT ask for a bulk control, and §49 forbids adding functionality
        // outside scope — so the server's capability stays unused rather than
        // becoming a feature nobody asked for. GAP-M-018.
        "NotificationSource.markAllRead" to
            "NOTIF-FR-002 does not require a bulk control; §49 forbids adding one (GAP-M-018).",
    )

    private data class Decl(val file: File, val iface: String, val fn: String) {
        val key get() = "$iface.$fn"
    }

    private val kotlinFiles: List<File> by lazy {
        assertTrue("the source tree must be readable", sourceRoot.isDirectory)
        sourceRoot.walkTopDown().filter { it.isFile && it.extension == "kt" }.toList()
    }

    /** Every function declared on a `*Source` interface. */
    private val declarations: List<Decl> by lazy {
        kotlinFiles.flatMap { file ->
            val text = file.readText()
            Regex("""(?m)^interface (\w*Source)\b""").findAll(text).flatMap { header ->
                val body = braceBlock(text, text.indexOf('{', header.range.last))
                Regex("""\bfun (\w+)""").findAll(body)
                    .map { Decl(file, header.groupValues[1], it.groupValues[1]) }
            }
        }
    }

    /** The interface body, by matching braces from its opening one. */
    private fun braceBlock(text: String, open: Int): String {
        var depth = 0
        for (i in open until text.length) {
            when (text[i]) {
                '{' -> depth++
                '}' -> {
                    depth--
                    if (depth == 0) return text.substring(open, i)
                }
            }
        }
        return ""
    }

    @Test
    fun `EVERY REPOSITORY FUNCTION REACHES A CALLER, OR SAYS WHY NOT`() {
        // Which packages declare their own `*Source` exposing each name — the
        // disambiguation the class comment describes.
        val owners: Map<String, Set<File>> = declarations
            .groupBy { it.fn }
            .mapValues { (_, ds) -> ds.map { it.file.parentFile }.toSet() }

        val orphans = declarations.filter { decl ->
            val callers = kotlinFiles.filter { candidate ->
                if (candidate == decl.file) return@filter false
                if (!candidate.readText().contains(Regex("""\.${decl.fn}\s*\("""))) {
                    return@filter false
                }
                val here = candidate.parentFile
                // A call in a package owning its own same-named function is
                // that interface's caller, not this one's.
                !(here in owners.getValue(decl.fn) && here != decl.file.parentFile)
            }
            callers.isEmpty()
        }.map { it.key }.distinct().sorted()

        assertEquals(
            "Repository functions that reach no caller. Wire it, delete it, or " +
                "add it to knownOrphans with the reason:\n" +
                orphans.filterNot { it in knownOrphans }.joinToString("\n") { "    $it" } + "\n",
            knownOrphans.keys.sorted(),
            orphans,
        )
    }

    @Test
    fun `THE SOURCE INTERFACES ARE ACTUALLY BEING FOUND`() {
        // Without this, the check above passes perfectly on an empty parse —
        // no declarations found, no orphans found, green. The same guard
        // ApiContractTest puts on its own fixture.
        assertTrue(
            "only ${declarations.size} Source functions parsed — the regex has stopped matching",
            declarations.size >= 60,
        )
        assertTrue(
            "only ${kotlinFiles.size} Kotlin files walked",
            kotlinFiles.size >= 100,
        )
    }
}
