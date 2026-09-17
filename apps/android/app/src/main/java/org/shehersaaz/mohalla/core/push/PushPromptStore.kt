package org.shehersaaz.mohalla.core.push

import android.content.Context

/**
 * Whether this install has already asked for POST_NOTIFICATIONS.
 *
 * WHY THIS EXISTS. The first version kept "have we asked?" in
 * `rememberSaveable`, which survives a rotation but not process death — so
 * every cold start asked again. QA-009 caught it on the device: refusing the
 * prompt, then relaunching, showed it a second time, and revoking the
 * permission in Android Settings brought it back on the very next launch. A
 * reader who goes into Settings to turn notifications off has stated their
 * answer clearly, and asking again the next morning is not a contextual
 * request, it is nagging.
 *
 * SO THE ANSWER IS REMEMBERED, NOT THE PERMISSION. This never mirrors the
 * grant state — that is the operating system's to hold, and a cached copy goes
 * stale the moment somebody changes it in Settings. All that is stored is the
 * fact that the app has had its turn to ask.
 *
 * PLAIN PREFERENCES, like [org.shehersaaz.mohalla.core.locale.LocaleStore] and
 * for the same reason: a boolean about a dialog is not a credential, and it is
 * read during startup composition where unlocking a Keystore key would cost
 * more than the whole screen.
 */
class PushPromptStore(context: Context) {

    private val prefs = context.getSharedPreferences(FILE, Context.MODE_PRIVATE)

    fun hasAsked(): Boolean = prefs.getBoolean(KEY, false)

    fun markAsked() {
        // `apply()` is enough here — unlike the language choice, nothing is
        // recreated as a result of this write and a lost race would only mean
        // one extra prompt.
        prefs.edit().putBoolean(KEY, true).apply()
    }

    private companion object {
        // The same file the language lives in: one small preferences file read
        // once at startup, rather than a second one for a second boolean.
        const val FILE = "mohalla.prefs.v1"
        const val KEY = "push_permission_asked"
    }
}
