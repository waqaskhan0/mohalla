package org.shehersaaz.mohalla.feature.search

import org.shehersaaz.mohalla.core.storage.SecureStorage

/**
 * The last ten queries, on the device and nowhere else
 * (SEARCH-FR-005 · PRIV-011).
 *
 * PRIV-011 IS UNUSUALLY ABSOLUTE: "recent searches are stored on the device
 * only. They are never transmitted to or retained on the server." So there is
 * no endpoint here, no sync, and no field on any request body that carries one.
 * That is worth stating plainly because search history is among the most
 * revealing things a person generates — on a civic platform, a list of what
 * somebody looked up is a list of what they are worried about, who they are
 * checking on, and which official they are investigating. A server that held it
 * could be compelled to produce it.
 *
 * STORED ENCRYPTED, for the same reason the composer's draft is. The
 * Keystore-backed store already exists (SEC-004), so keeping a search history
 * out of a filesystem backup or an `adb pull` costs one read when the search
 * screen opens.
 *
 * CLEARED BY SIGN-OUT, because `SecureStorage.clear()` takes everything
 * (SET-FR-006) — a history left behind would offer the previous account's
 * queries to whoever signs in next on a shared phone, which is a common
 * arrangement in the market this product serves.
 *
 * TEN, NEWEST FIRST, DE-DUPLICATED. Searching the same thing twice moves it to
 * the top rather than adding a second row: a list of the same query four times
 * is a list with one useful entry.
 */
class RecentSearches(
    private val storage: SecureStorage,
) {

    /** Newest first. Empty when nothing has been searched or after a clear. */
    fun all(): List<String> = storage.getString(KEY)
        ?.split(SEPARATOR)
        ?.map { it.trim() }
        ?.filter { it.isNotEmpty() }
        .orEmpty()
        .take(MAX_ENTRIES)

    /**
     * Record a query.
     *
     * Only called on a SUBMITTED search, never on a keystroke. A history that
     * recorded every prefix would fill with "p", "pa", "pan" and be useless —
     * and would record a query somebody typed and then thought better of.
     */
    fun add(query: String) {
        val trimmed = query.trim()
        if (trimmed.length < SEARCH_QUERY_MIN_LENGTH) return

        // Case-insensitive de-duplication, so "Pani" and "pani" are one entry —
        // but the NEW casing is what is kept, because it is what the person
        // most recently chose to type.
        val existing = all().filterNot { it.equals(trimmed, ignoreCase = true) }
        val updated = (listOf(trimmed) + existing).take(MAX_ENTRIES)

        storage.putString(KEY, updated.joinToString(SEPARATOR))
    }

    /**
     * Remove one entry.
     *
     * Offered per row as well as in bulk: somebody who searched for a name they
     * would rather not have on the screen of a shared phone should not have to
     * discard the whole history to remove it.
     */
    fun remove(query: String) {
        val updated = all().filterNot { it.equals(query.trim(), ignoreCase = true) }
        if (updated.isEmpty()) {
            storage.remove(KEY)
        } else {
            storage.putString(KEY, updated.joinToString(SEPARATOR))
        }
    }

    /** SEARCH-FR-005's acceptance criterion: after this, reopening shows nothing. */
    fun clear() = storage.remove(KEY)

    private companion object {
        const val KEY = "search.recent"

        /** SEARCH-FR-005 — "the last 10 queries". */
        const val MAX_ENTRIES = 10

        /**
         * A newline separates entries.
         *
         * A query cannot contain one: the search field is single-line, and the
         * server's own query check rejects a string that is not usable. A comma
         * or a space would collide with ordinary search text — "water, drains"
         * is one query somebody would plausibly type.
         */
        const val SEPARATOR = "\n"
    }
}
