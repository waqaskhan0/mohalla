package org.shehersaaz.mohalla.core.locale

/**
 * The two peer languages. Urdu is not a fallback.
 */
enum class AppLocale(val tag: String, val isRtl: Boolean) {
    ENGLISH("en", false),
    URDU("ur", true),
    ;

    companion object {
        /**
         * The account's stored language, as the server spells it.
         *
         * `null` IS A REAL ANSWER AND IS RETURNED AS ONE. BR-040 pre-selects no
         * default, so an account that has never chosen has no stored language —
         * and the settings screen then shows the choice made on THIS device
         * rather than inventing one and showing it as the account's.
         *
         * An unrecognised tag is also null: a language this build cannot render
         * is not a language it can claim is selected.
         */
        fun fromTag(tag: String?): AppLocale? = entries.firstOrNull { it.tag == tag }
    }
}
