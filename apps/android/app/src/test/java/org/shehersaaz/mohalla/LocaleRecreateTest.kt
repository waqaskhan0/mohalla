package org.shehersaaz.mohalla

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * RUNTIME-014 — choosing a language did nothing when the system already had it.
 *
 * `applyLanguage` stored the choice and then leaned on a SIDE EFFECT: assigning
 * `applicationLocales` makes the platform recreate the activity. It does — but
 * only when the value changes. Assigning the value it already holds is a no-op:
 * no configuration change, no recreate, `attachBaseContext` never re-reads the
 * store, and every string on screen stays in the previous language until the
 * process dies.
 *
 * OBSERVED ON THE DEVICE, and the state is reachable without a debugger:
 * Android's own per-app language screen writes `applicationLocales` and never
 * touches the app's store, so a reader who picks English there and then picks
 * English in the app is stuck in Urdu. `cmd locale set-app-locales` reproduced
 * exactly that — `applicationLocales` read `[en]`, the app's store read
 * English, the language screen showed English ticked, and every visible string
 * was Urdu.
 *
 * WHAT THIS TESTS IS THE COMPARISON, because that is the whole defect: the old
 * code compared nothing at all, and the obvious repair — `contains` — is wrong
 * in a way no reviewer would see.
 */
class LocaleRecreateTest {

    @Test
    fun `A LIST THAT ALREADY SAYS THE TARGET IS ALREADY SET`() {
        // The RUNTIME-014 state. `applyLanguage` must NOT wait for the system
        // here, because nothing is going to arrive.
        assertTrue(localeAlreadySet("en", "en"))
        assertTrue(localeAlreadySet("ur", "ur"))
    }

    @Test
    fun `A DIFFERENT LANGUAGE IS NOT ALREADY SET`() {
        // The ordinary case: the assignment is a real change, the system
        // recreates, and recreating here as well would be a second one.
        assertFalse(localeAlreadySet("ur", "en"))
        assertFalse(localeAlreadySet("en", "ur"))
    }

    @Test
    fun `AN EMPTY LIST IS NOT ALREADY SET`() {
        // `LocaleList.toLanguageTags()` on an empty list is the empty string —
        // the default on a device where nobody has set a per-app language, so
        // the first in-app choice is a real change.
        assertFalse(localeAlreadySet("", "en"))
    }

    @Test
    fun `A LIST CONTAINING THE TARGET AMONG OTHERS IS NOT ALREADY SET`() {
        // The case `contains` gets wrong, and the reason this function exists
        // rather than an inline check. `en,ur` is not "English": it is a
        // preference order, and which one renders is Android's to decide.
        // Declining to recreate here leaves the screen on the language the
        // reader just chose against.
        assertFalse(localeAlreadySet("en,ur", "en"))
        assertFalse(localeAlreadySet("ur,en", "ur"))
    }

    @Test
    fun `A REGIONAL TAG IS NOT THE SAME ANSWER AS THE BARE LANGUAGE`() {
        // `AppLocale` stores bare `en` / `ur`. A system list of `en-US` is a
        // different tag, so this reports a change and the app recreates — the
        // safe direction, since the alternative is a screen that never updates.
        assertFalse(localeAlreadySet("en-US", "en"))
    }
}
