package org.shehersaaz.mohalla

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Every requirement and screen id cited in the mobile documentation exists.
 *
 * WHY THIS IS A TEST. Group 23 found six requirement ids in
 * `17-mobile-screen-coverage.md` that were wrong by one: "Forgot password" and
 * "Reset password" both cited `AUTH-FR-006`, which is *Logout*; "Username
 * selection" cited `PROFILE-FR-001`, which is *Create profile*, while "Profile
 * setup" cited `PROFILE-FR-002`, which is *Username Selection* — the two were
 * swapped; "Suggested accounts" cited `SOCIAL-FR-004`, which is *Following
 * list*; "Category filter" cited `FEED-FR-005`, which is *Pull to refresh*.
 *
 * **Every one of those ids exists.** They are real requirements, correctly
 * spelled, in the right family — just not the requirement the row was about. So
 * this test cannot catch a wrong-but-valid id, and nothing can except reading
 * the title beside it. What it CAN catch is the other half of the same failure
 * mode: an id that exists in the documentation and nowhere in the SRS, which is
 * what happens when somebody invents, mistypes or renumbers one.
 *
 * That is worth having because the documentation is now the evidence for a
 * completion claim. A traceability matrix citing `PROFILE-FR-014` would look
 * exactly as authoritative as one citing `PROFILE-FR-011`, and only a check
 * against the source can tell them apart.
 *
 * THE SRS IS PARSED IN BOTH ITS FORMATS. `docs/srs-mvp-v1.html` stores
 * requirements as fully-specified `div.fr` blocks AND as condensed
 * "remaining requirements" tables. Reading only the tables silently loses 14
 * requirements — most families' `-FR-001` among them — so a naive parser would
 * report those 14 as unknown ids and this test would fail on correct
 * documentation.
 */
class DocumentationIdTest {

    /** Three levels up from `apps/android/app` is the repository root. */
    private val repoRoot = File("../../..")
    private val mobileDocs = File(repoRoot, "docs/implementation/mobile")

    private val srs: String by lazy {
        val f = File(repoRoot, "docs/srs-mvp-v1.html")
        assertTrue("the SRS must be readable at ${f.absolutePath}", f.isFile)
        f.readText()
    }

    /** Every functional-requirement id the SRS actually defines. */
    private val definedRequirements: Set<String> by lazy {
        val fromBlocks = Regex("""<span class="fr-id">([A-Z][A-Z0-9]*-FR-\d{3})</span>""")
            .findAll(srs).map { it.groupValues[1] }
        val fromTables = Regex("""<td class="id">([A-Z][A-Z0-9]*-FR-\d{3})</td>""")
            .findAll(srs).map { it.groupValues[1] }
        (fromBlocks + fromTables).toSet()
    }

    /** Every screen id the UI/UX specification defines. */
    private val definedScreens: Set<String> by lazy {
        val f = File(repoRoot, "docs/uiux-spec-v1.html")
        assertTrue("the UI/UX spec must be readable", f.isFile)
        Regex("""\bUX-[A-Z]+-\d{3}\b""").findAll(f.readText())
            .map { it.value }.toSet()
    }

    private val docFiles: List<File> by lazy {
        assertTrue("the mobile documentation directory must exist", mobileDocs.isDirectory)
        mobileDocs.listFiles { f -> f.extension == "md" }!!.sortedBy { it.name }
    }

    @Test
    fun `THE SRS AND THE UIUX SPEC ARE ACTUALLY BEING PARSED`() {
        // The guard the other two tests need. A regex that stops matching turns
        // every citation into an unknown id, or - worse, if the assertion were
        // written the other way round - turns the check into a no-op.
        assertEquals(
            "the SRS should define 124 functional requirements",
            124,
            definedRequirements.size,
        )
        assertTrue(
            "only ${definedScreens.size} screen ids found in the UI/UX spec",
            definedScreens.size >= 60,
        )
        assertTrue("no mobile documentation found", docFiles.size >= 5)
    }

    @Test
    fun `EVERY REQUIREMENT ID CITED IN THE MOBILE DOCS EXISTS IN THE SRS`() {
        val unknown = sortedMapOf<String, MutableSet<String>>()

        docFiles.forEach { file ->
            Regex("""\b[A-Z][A-Z0-9]*-FR-\d{3}\b""").findAll(file.readText())
                .map { it.value }
                .filterNot { it in definedRequirements }
                .forEach { unknown.getOrPut(it) { sortedSetOf() }.add(file.name) }
        }

        assertEquals(
            "These requirement ids appear in the mobile documentation and in no " +
                "SRS requirement:\n" +
                unknown.entries.joinToString("\n") { (id, files) ->
                    "    $id  cited in ${files.joinToString(", ")}"
                } + "\n",
            emptyMap<String, Set<String>>(),
            unknown.toMap(),
        )
    }

    @Test
    fun `EVERY SCREEN ID CITED IN THE MOBILE DOCS EXISTS IN THE UIUX SPEC`() {
        // The same failure mode one axis over. A coverage table is only a
        // coverage table if its rows name screens somebody actually designed.
        val unknown = sortedMapOf<String, MutableSet<String>>()

        docFiles.forEach { file ->
            Regex("""\bUX-[A-Z]+-\d{3}\b""").findAll(file.readText())
                .map { it.value }
                .filterNot { it in definedScreens }
                .forEach { unknown.getOrPut(it) { sortedSetOf() }.add(file.name) }
        }

        assertEquals(
            "These screen ids appear in the mobile documentation and in no " +
                "UI/UX screen:\n" +
                unknown.entries.joinToString("\n") { (id, files) ->
                    "    $id  cited in ${files.joinToString(", ")}"
                } + "\n",
            emptyMap<String, Set<String>>(),
            unknown.toMap(),
        )
    }
}
