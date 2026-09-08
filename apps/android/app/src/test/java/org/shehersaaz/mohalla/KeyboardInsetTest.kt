package org.shehersaaz.mohalla

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The keyboard inset is counted once, not twice.
 *
 * RUNTIME-017, and it made the post detail screen unusable for any post with no
 * comments — which in a young Mohalla is most of them.
 *
 * WHAT HAPPENED. Ten screens apply `imePadding()`, which is the Compose way and
 * what `ComposerScreen` documents in its own comment: it lifts the toolbar
 * above the keyboard rather than shrinking the text area. That comment assumes
 * the window keeps its height. It did not — `windowSoftInputMode` was not
 * declared, so the platform default `adjustResize` applied and the window
 * shrank too. Measured on the device: a 2280px window became 1520px with the
 * keyboard up, and `imePadding()` then subtracted the same 760px again.
 *
 * WHAT IT LOOKED LIKE. Post detail had 700px left for a header, a scrolling
 * thread and a composer. The reader tapped a post and got a comment box
 * floating in an empty screen: no header, no author, no body, no engagement
 * row, no "Start the conversation". The comment field auto-focuses when a
 * thread is empty, so the keyboard opened by itself and nobody had to touch
 * anything to see it. Dismissing the keyboard restored the whole screen, which
 * is why it survived every earlier pass — the screen is only broken while
 * somebody is trying to type on it.
 *
 * WHY A TEST OVER THE MANIFEST. The defect was a platform DEFAULT, not a line
 * anybody wrote, so there was nothing for a reviewer to look at and nothing for
 * a unit test to call. The 500 tests were green, lint was clean, and the screen
 * did not work.
 */
class KeyboardInsetTest {

    private val manifest = File("src/main/AndroidManifest.xml").readText()

    private val main = File("src/main/java/org/shehersaaz/mohalla")

    @Test
    fun `THE WINDOW DOES NOT RESIZE FOR THE KEYBOARD`() {
        // `adjustNothing` keeps the window at full height, which makes
        // `imePadding()` the single account of the keyboard. Anything else —
        // including the default, i.e. saying nothing at all — counts it twice.
        assertTrue(
            "MainActivity must declare android:windowSoftInputMode=\"adjustNothing\". " +
                "Without it the platform default `adjustResize` shrinks the " +
                "window AND every screen's `imePadding()` subtracts the same " +
                "keyboard height again, which left post detail with 700px of " +
                "2280 and rendered it as a comment box in an empty screen " +
                "(RUNTIME-017).",
            manifest.contains("android:windowSoftInputMode=\"adjustNothing\""),
        )
    }

    @Test
    fun `THE SCREENS THAT TAKE TEXT STILL ACCOUNT FOR THE KEYBOARD`() {
        // The other half of the pair. `adjustNothing` alone would put the
        // keyboard OVER the text field, so the fix is only correct while the
        // screens keep their `imePadding()`. If this count ever drops, the
        // window is no longer resizing and nothing is padding either — the
        // field would sit behind the keyboard.
        val padded = main.walkTopDown()
            .filter { it.isFile && it.extension == "kt" }
            .filter { it.readText().contains(".imePadding()") }
            .map { it.name }
            .toList()
            .sorted()

        assertTrue(
            "At least the screens that take text must apply imePadding(); " +
                "found ${padded.size}: $padded",
            padded.size >= 10,
        )

        // Named rather than counted, so a screen that quietly loses its
        // padding is a failure with a name in it.
        listOf(
            "AuthScaffold.kt",
            "ChangePasswordScreen.kt",
            "ComposerScreen.kt",
            "ConversationScreen.kt",
            "EditProfileScreen.kt",
            "LoginScreen.kt",
            "OtpScreen.kt",
            "PostDetailScreen.kt",
            "ReportSheet.kt",
            "SearchScreen.kt",
        ).forEach { screen ->
            assertTrue(
                "$screen takes text and must apply imePadding() — with " +
                    "`adjustNothing` the window no longer moves, so a screen " +
                    "without it puts the keyboard over its own input",
                padded.contains(screen),
            )
        }
    }

    @Test
    fun `THE MANIFEST SAYS WHY`() {
        // The attribute is one word and the reason is not obvious from it —
        // `adjustResize` is what most Android apps want. Somebody tidying the
        // manifest needs to find the reason next to the line.
        assertEquals(
            "the windowSoftInputMode declaration must keep its comment: the " +
                "reason it is not the platform default is not recoverable from " +
                "the attribute",
            true,
            manifest.contains("RUNTIME-017"),
        )
    }
}
