package org.shehersaaz.mohalla.core.locale

import android.content.Context

/**
 * The stored language choice — and the absence of one.
 *
 * BR-040: NO LANGUAGE IS PRE-SELECTED. That makes "not yet chosen" a real third
 * state, not a synonym for English, and it is what the startup router branches
 * on to decide whether UX-AUTH-002 is shown at all. Defaulting to English on
 * first launch would silently skip the choice for every Urdu-first user — who
 * are, on this product, the majority of the audience.
 *
 * NOT ENCRYYPTED, DELIBERATELY. A language preference is not a credential;
 * putting it in `EncryptedSharedPreferences` would mean the very first read on
 * every cold start has to unlock a Keystore key before the first frame can be
 * laid out in the right direction, which is exactly the kind of startup work
 * NFR-PERF-003's 4-second budget cannot afford. It is also read
 * SYNCHRONOUSLY for that reason: the layout direction must be known before
 * composition begins, and one small preference read is measured in
 * microseconds. See `MainActivity`.
 *
 * The device's own locale is used as the SUGGESTION on the selection screen,
 * never as the answer. A Pakistani handset set to English is extremely common
 * and says nothing about which language its owner reads most comfortably.
 */
class LocaleStore(context: Context) {

    private val prefs = context.getSharedPreferences(FILE, Context.MODE_PRIVATE)

    /** `null` when the user has never chosen (BR-040). */
    fun stored(): AppLocale? = when (prefs.getString(KEY, null)) {
        AppLocale.ENGLISH.tag -> AppLocale.ENGLISH
        AppLocale.URDU.tag -> AppLocale.URDU
        else -> null
    }

    fun store(locale: AppLocale) {
        // `commit()`, not `apply()`. Choosing a language recreates the activity
        // (04-mobile-architecture §3 rule 2), and an asynchronous write that
        // loses that race shows the new activity in the old direction.
        prefs.edit().putString(KEY, locale.tag).commit()
    }

    /**
     * What to pre-highlight on UX-AUTH-002 — a hint, not a choice.
     *
     * Nothing is written by reading this, so [stored] keeps returning `null`
     * until the user actually picks.
     */
    fun deviceSuggestion(context: Context): AppLocale {
        val language = context.resources.configuration.locales[0].language
        return if (language == AppLocale.URDU.tag) AppLocale.URDU else AppLocale.ENGLISH
    }

    private companion object {
        const val FILE = "mohalla.prefs.v1"
        const val KEY = "locale"
    }
}
