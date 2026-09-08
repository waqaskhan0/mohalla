package org.shehersaaz.mohalla

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The top bar's two-action cap, checked before a device has to.
 *
 * RUNTIME-013. `MohallaTopBar` enforces UI/UX §18.5 with a `require`, and §18.5
 * draws Home's bar as `Shehersaaz · search · bell` — both slots already spent.
 * UX-HOME-005's filter was added as a THIRD action, and the app died with
 * `IllegalArgumentException: The top app bar takes at most 2 actions` on the
 * recomposition that follows the category fetch.
 *
 * NOTHING COULD SEE IT. Not the compiler — the cap is a runtime `require` over a
 * list size. Not the 500 unit tests — before this file, no test touched the top
 * bar at all. Not a launch-and-look — the bar is correct until `/categories`
 * returns, so the crash arrives a second in, on a state no unit test constructed.
 *
 * SO THE RULE IS SOURCE-LEVEL, and it has to be: `homeActions` is `@Composable`
 * and cannot be called from a JVM unit test, which is exactly why the direct
 * test that would have caught this could not be written. A source rule can be.
 *
 * `listOfNotNull` IS REJECTED OUTRIGHT in an actions position, and that is the
 * substance of the fix rather than the count. A `listOf` of three is a mistake
 * any reader sees. A `listOfNotNull` whose length depends on state is a mistake
 * nobody sees, in any state but the failing one — and that is the construct
 * RUNTIME-013 was written in.
 */
class TopBarActionTest {

    private val main = File("src/main/java/org/shehersaaz/mohalla")

    private fun kotlinSources(): List<File> =
        main.walkTopDown().filter { it.isFile && it.extension == "kt" }.toList()

    /** Read the cap from the source, so this test tracks it rather than guesses. */
    private fun declaredCap(): Int {
        val bar = File(main, "core/ui/MohallaTopBar.kt").readText()
        val found = Regex("""const val MAX_ACTIONS = (\d+)""").find(bar)
        assertTrue("MAX_ACTIONS must be declared in MohallaTopBar.kt", found != null)
        return found!!.groupValues[1].toInt()
    }

    @Test
    fun `THE CAP IS THE ONE THE SPEC WRITES DOWN`() {
        // §18.5: "screen title left (right in RTL), plus up to two actions".
        // If this ever changes it is a spec change, not a convenience.
        assertEquals(2, declaredCap())
    }

    @Test
    fun `NO ACTIONS LIST CAN EXCEED THE CAP`() {
        val cap = declaredCap()
        val over = mutableListOf<String>()

        kotlinSources().forEach { file ->
            val text = file.readText()

            // Every `actions = <expr>` argument, plus every function whose
            // body IS an actions list (`homeActions` is the second kind).
            val starts = Regex("""actions = listOf(?:NotNull)?\(|List<TopBarAction> = listOf(?:NotNull)?\(""")
                .findAll(text)

            starts.forEach { start ->
                // Walk to the matching close paren so nested `TopBarAction(...)`
                // calls are counted inside this list and not the next one.
                var depth = 1
                var i = start.range.last + 1
                while (i < text.length && depth > 0) {
                    when (text[i]) {
                        '(' -> depth++
                        ')' -> depth--
                    }
                    i++
                }
                val body = text.substring(start.range.last + 1, i)
                val count = Regex("""\bTopBarAction\(""").findAll(body).count()
                val line = text.take(start.range.first).count { it == '\n' } + 1
                val where = "${file.relativeTo(main)}:$line"

                if (count > cap) {
                    over += "$where declares $count actions, and the cap is $cap"
                }

                // The RUNTIME-013 shape: a length that varies with state.
                if (start.value.contains("listOfNotNull")) {
                    over += "$where builds its actions with listOfNotNull, so " +
                        "its length depends on state and an overflow is " +
                        "invisible until the state that overflows it occurs " +
                        "(RUNTIME-013). Put the conditional control somewhere " +
                        "that is not one of §18.5's two slots."
                }
            }
        }

        assertEquals(
            "Top-bar actions violate UI/UX §18.5. `MohallaTopBar` rejects these " +
                "at runtime with an IllegalArgumentException, which on a device " +
                "means the screen does not open:\n" +
                over.joinToString("\n") { "    $it" } + "\n",
            emptyList<String>(),
            over,
        )
    }

    @Test
    fun `THE CAP IS ACTUALLY ENFORCED, IN BOTH BAR VARIANTS`() {
        // A cap nothing checks is a comment. Both the top bar and the back
        // header take an `actions` list, so both must reject an over-long one —
        // and it was the top bar's `require` that caught RUNTIME-013 on the
        // device, so this asserts the safety net is still there.
        val bar = File(main, "core/ui/MohallaTopBar.kt").readText()
        val guards = Regex("""require\(actions\.size <= MAX_ACTIONS\)""")
            .findAll(bar)
            .count()

        assertEquals(
            "Both MohallaTopBar and MohallaBackHeader must guard the cap; " +
                "removing a guard would turn a loud crash into a silently " +
                "over-full bar",
            2,
            guards,
        )
    }
}
