package org.shehersaaz.mohalla

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Accessibility, RTL and layout invariants, asserted over the SOURCE — §26 ·
 * §35 · §36 (NFR-ACC-001…005 · LOCALE-FR-003 · BR-041 · REL-002).
 *
 * WHY THIS IS A TEST AND NOT A REVIEW. Every rule below is a property of the
 * whole codebase rather than of one screen, and every one of them was violated
 * somewhere by the time this group ran — not because anybody disagreed with the
 * rule, but because a rule enforced by reading is a rule that holds until the
 * next screen. §36 says it plainly: "do not treat RTL as final polish." Neither
 * is contrast.
 *
 * WHAT THIS CANNOT DO IS PROVE PIXELS MIRROR. It proves the mistakes that make
 * mirroring fail are absent — an absolute alignment, a left-hand padding, a
 * directional icon that does not mirror — and it proves the contrast tokens are
 * used as the audit permits. A device would still be needed to see the result,
 * and there is none (`20-mobile-open-issues.md` §2). This is the strongest check
 * available without one, which is exactly why it is worth having.
 *
 * EVERY RULE IS AN ALLOWLIST, NOT A DENYLIST. That lesson was measured in group
 * 11: a denylist of guessed names let four real defects through a suite of 271
 * tests. So each check below names what is PERMITTED, and a new use has to be
 * added here — which is the moment somebody reads why the rule exists.
 */
class SourceInvariantTest {

    private val sources: List<Source> by lazy {
        val root = File("src/main/java/org/shehersaaz/mohalla")
        assertTrue(
            "the source tree must be readable from the test working directory",
            root.isDirectory,
        )
        root.walkTopDown()
            .filter { it.isFile && it.extension == "kt" }
            .map { Source(it.path.replace('\\', '/').substringAfter("mohalla/"), it.readText()) }
            .toList()
    }

    private data class Source(val path: String, val text: String) {
        /** Lines of real code — comments explain the rules and must not trip them. */
        fun codeLines(): List<Pair<Int, String>> =
            text.lines().mapIndexed { i, l -> i + 1 to l }.filterNot { (_, l) ->
                val t = l.trimStart()
                t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")
            }
    }

    private fun offences(predicate: (String) -> Boolean): List<String> =
        sources.flatMap { source ->
            source.codeLines()
                .filter { (_, line) -> predicate(line) }
                .map { (number, line) -> "${source.path}:$number  ${line.trim()}" }
        }

    private fun assertNone(rule: String, offences: List<String>) {
        assertEquals(
            "$rule\n\n" + offences.joinToString("\n") { "    $it" } + "\n",
            emptyList<String>(),
            offences,
        )
    }

    // ==================================================================== RTL
    @Test
    fun `NO ABSOLUTE ALIGNMENT ANYWHERE`() {
        // §8's named mistake. `Absolute.Left` pins something to the left in BOTH
        // languages, so an Urdu screen is laid out as a translated English one —
        // which LOCALE-FR-003 rejects and REL-002 tests for.
        assertNone(
            "Absolute alignment does not mirror (§8, LOCALE-FR-003).",
            offences { it.contains("Absolute.") },
        )
    }

    @Test
    fun `NO LEFT OR RIGHT PADDING, ONLY START AND END`() {
        // The same defect in its commonest form. `padding(start = …)` mirrors;
        // `padding(left = …)` does not, and the difference is one word.
        assertNone(
            "Use start/end padding, never left/right (§8).",
            offences {
                it.contains(".padding(left =") ||
                    it.contains(".padding(right =") ||
                    it.contains("PaddingValues(left =") ||
                    it.contains("PaddingValues(right =")
            },
        )
    }

    @Test
    fun `NO LEFT OR RIGHT TEXT ALIGNMENT`() {
        // `TextAlign.Start` follows the paragraph; `TextAlign.Left` fights it.
        assertNone(
            "Use TextAlign.Start/End, never Left/Right (§8).",
            offences { it.contains("TextAlign.Left") || it.contains("TextAlign.Right") },
        )
    }

    @Test
    fun `EVERY DIRECTIONAL ICON MIRRORS`() {
        // `04-mobile-architecture.md` §3 rule 3: directional assets mirror via
        // `AutoMirrored`, non-directional ones are excluded. A back arrow that
        // does not mirror points FORWARD in Urdu, and the spec calls it "the
        // single most noticeable RTL defect in any app".
        val directional = listOf(
            "ArrowBack", "ArrowForward", "Send", "List", "ExitToApp",
            "KeyboardArrowLeft", "KeyboardArrowRight", "ArrowRightAlt", "Login", "Logout",
        )
        assertNone(
            "A directional icon must come from Icons.AutoMirrored (§3 rule 3).",
            offences { line ->
                directional.any { line.contains("Icons.Filled.$it") || line.contains("Icons.Outlined.$it") }
            },
        )
    }

    @Test
    fun `THE TAB ORDER IS NEVER REVERSED IN CODE`() {
        // §14's rule that Create stays third of five falls out of laying the row
        // out logically and letting the layout direction reverse it. Reversing
        // by hand double-mirrors and puts Create off-centre in Urdu — the one
        // thing the requirement forbids by name.
        assertNone(
            "The bottom navigation must never be reversed in code (§14).",
            offences {
                it.contains("ordered.reversed()") || it.contains("entries.reversed()")
            },
        )
    }

    // ========================================================= §35 · contrast
    @Test
    fun `TEXT-TERTIARY IS NEVER THE COLOUR OF INFORMATIONAL TEXT`() {
        // The contrast audit, verbatim: "text-tertiary on white 2.9:1 — Fails AA
        // and is therefore FORBIDDEN for text. Permitted only for decorative
        // dividers, disabled-state icons, and non-informative placeholder
        // glyphs."
        //
        // Forty-four `Text(color = TextTertiary)` sites carried timestamps,
        // handles, counters, day headings and stat labels. The audit names
        // text-secondary (5.4:1) for exactly those: "Metadata, timestamps,
        // helper text".
        //
        // WHAT REMAINS PERMITTED is enumerated by FILE, and each site carries a
        // comment saying which of the three exemptions it is. A new file added
        // here is a new claim that something is decorative, disabled or a
        // placeholder — which is a claim worth making deliberately.
        val permitted = setOf(
            // The bullet glyphs. Non-informative: the sentence beside them
            // carries everything.
            "feature/safety/BlockConfirmSheet.kt",
            "feature/settings/DeleteAccountScreen.kt",
            // A text field's placeholder, and the disabled label of a locked
            // control — WCAG 1.4.3 exempts an inactive component.
            "core/ui/MohallaTextField.kt",
            "core/ui/MohallaBottomNav.kt",
            "core/ui/MohallaButton.kt",
            // Disabled and in-flight states.
            "feature/create/AttachmentSheet.kt",
            "feature/create/ComposerScreen.kt",
            "feature/post/CommentItem.kt",
            "feature/post/PostDetailScreen.kt",
            "feature/events/EventComposerScreen.kt",
            // A disabled send arrow, tinted across two lines so the `tint =`
            // marker sits above the token.
            "feature/messages/ConversationScreen.kt",
            // The token's own declaration.
            "core/design/MohallaPalette.kt",
        )

        val offences = sources
            .filterNot { it.path in permitted }
            .flatMap { source ->
                source.codeLines()
                    .filter { (_, line) ->
                        // WHAT THE RULE LOOKS AT is a TEXT colour and a
                        // BACKGROUND, not an icon `tint`. The audit's first two
                        // exemptions are "decorative dividers" and
                        // "disabled-state icons", and an icon whose meaning is
                        // carried by the text beside it — a chevron, a search
                        // glyph, a location pin, a send arrow that is greyed
                        // when disabled — is decorative by §35's own
                        // definition: colour is not the only carrier, because
                        // the words are. An icon carrying meaning ALONE would
                        // fail §35 whatever colour it was, which is a different
                        // rule and the one each component's
                        // `contentDescription` enforces.
                        line.contains("TextTertiary") &&
                            !line.trim().startsWith("tint =") &&
                            !line.contains("disabledContentColor")
                    }
                    .map { (number, line) -> "${source.path}:$number  ${line.trim()}" }
            }

        assertNone(
            "text-tertiary is 2.9:1 and fails AA. Metadata and timestamps use " +
                "text-secondary (5.4:1); tertiary is permitted only for decorative " +
                "dividers, disabled states and non-informative glyphs.",
            offences,
        )
    }

    // ====================================================== §26 · touch targets
    @Test
    fun `NO BARE MATERIAL TEXT BUTTON, BECAUSE ITS 40dp IS BELOW THE MINIMUM`() {
        // "48×48dp minimum EVERYWHERE." Material 3's `TextButton` is 40dp tall,
        // and twelve of them were — including Forgot password and Resend code,
        // both on recovery paths where the reader is already stuck.
        // `MohallaTextButton` carries the height so the thirteenth caller cannot
        // forget it.
        val permitted = setOf("core/ui/MohallaButton.kt")

        val offences = sources
            .filterNot { it.path in permitted }
            .flatMap { source ->
                source.codeLines()
                    .filter { (_, line) -> Regex("""(^|[^a-zA-Z])TextButton\(""").containsMatchIn(line) }
                    .map { (number, line) -> "${source.path}:$number  ${line.trim()}" }
            }

        assertNone(
            "Use MohallaTextButton: Material's TextButton is 40dp and §26 asks for 48.",
            offences,
        )
    }

    // ====================================== LOCALE-FR-002 · nothing hardcoded
    @Test
    fun `NO USER-VISIBLE STRING IS WRITTEN IN KOTLIN`() {
        // LOCALE-FR-002 and OD-016: every visible string is a resource in both
        // languages, and `LocalizationParityTest` proves the two files agree. A
        // literal in Kotlin is a string no translator will ever see.
        //
        // The three permitted literals are each a case where a RESOURCE would be
        // wrong rather than merely unnecessary.
        val permitted = mapOf(
            // Each language names itself, in itself, whichever language the
            // interface is in — so somebody who cannot read the current one can
            // still find theirs. A translated resource would defeat the point.
            "feature/settings/SettingsScreens.kt" to 2,
            // A bullet, and a handle prefix. Neither is language-dependent, and
            // the handle is ASCII by rule (BR-005).
            "feature/safety/BlockConfirmSheet.kt" to 1,
            "feature/settings/DeleteAccountScreen.kt" to 1,
            "feature/create/ComposerScreen.kt" to 1,
            "feature/profile/ProfileScreen.kt" to 1,
        )

        val offences = sources.flatMap { source ->
            val found = source.codeLines().filter { (_, line) ->
                Regex("""text = "[^"]""").containsMatchIn(line)
            }
            val allowed = permitted[source.path] ?: 0
            if (found.size <= allowed) {
                emptyList()
            } else {
                found.map { (number, line) -> "${source.path}:$number  ${line.trim()}" }
            }
        }

        assertNone(
            "Every user-visible string comes from strings.xml (LOCALE-FR-002, OD-016).",
            offences,
        )
    }

    // ================================================ NFR-PERF · list identity
    @Test
    fun `EVERY LAZY LIST ITEM CARRIES A STABLE KEY`() {
        // Without one, Compose keys by position: a post arriving at the top of
        // the feed re-binds every row below it, loses scroll position and
        // discards per-item state. On the 720x1280 baseline device
        // NFR-PERF-001 budgets for, that is the difference between a list that
        // scrolls and one that stutters.
        val offences = sources.flatMap { source ->
            source.codeLines()
                .filter { (_, line) ->
                    val t = line.trim()
                    (t.startsWith("items(") || t.startsWith("item(") ||
                        t.startsWith("itemsIndexed(")) && !t.contains("key")
                }
                .map { (number, line) -> "${source.path}:$number  ${line.trim()}" }
        }

        assertNone(
            "A lazy list item needs a stable key, or Compose keys it by position.",
            offences,
        )
    }

    // ====================================================== SEC-028 · logging
    @Test
    fun `NOTHING BLOCKS THE MAIN THREAD AND NOTHING LOGS A BODY`() {
        // SEC-028 forbids logging tokens, phone numbers and message content, and
        // a request body on this product contains all three — which is why
        // `okhttp-logging` is not on the classpath at all rather than gated
        // behind a build flag.
        assertNone(
            "No blocking call and no HTTP logging (SEC-028, NFR-PERF-002).",
            offences {
                it.contains("runBlocking") ||
                    it.contains("Thread.sleep") ||
                    it.contains("HttpLoggingInterceptor")
            },
        )
    }

    @Test
    fun `NO LAZY LIST INSIDE THE AUTH SCAFFOLD, WHICH ALREADY SCROLLS`() {
        // THE CRASH THIS PREVENTS was a hard one, on the mandatory Flow A
        // path, and no unit test could have seen it.
        //
        // `AuthScaffold` puts its content slot inside
        // `Column(Modifier.verticalScroll(...))`, so children are measured
        // with an infinite maximum height. A `LazyColumn` there throws
        // `IllegalStateException: Vertically scrollable component was measured
        // with an infinity maximum height constraints` the moment it composes.
        // `SuggestedAccountsScreen` did exactly that: profile setup succeeded,
        // the server wrote the profile, and the app died on the way to the
        // next screen. Found in the first run of Flow A on an emulator.
        //
        // A Compose MEASUREMENT error is invisible to the JVM tests - there is
        // no composition to measure - so the enforceable form of the rule is
        // this one: a file that calls AuthScaffold must not also declare a
        // lazy list.
        val offenders = sources
            .filter { it.text.contains("AuthScaffold(") }
            .filter { src ->
                // Only real code — this rule's own explanation names both.
                src.codeLines().any { (_, line) ->
                    line.contains("LazyColumn(") || line.contains("LazyRow(")
                }
            }
            .map { it.path }
            .sorted()

        assertEquals(
            "These screens use AuthScaffold, which already scrolls, and also " +
                "declare a lazy list. Use a Column \u2014 the scaffold owns the " +
                "scroll, so the lazy list gets infinite height and crashes:\n" +
                offenders.joinToString("\n") { "    $it" } + "\n",
            emptyList<String>(),
            offenders,
        )
    }
}
