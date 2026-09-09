package org.shehersaaz.mohalla.feature.setup

/**
 * Username shape — mirrored from the backend's domain, for feedback only.
 *
 * `^[a-z][a-z0-9_]{2,19}$` — 3 to 20 characters, lowercase ASCII, digits and
 * underscore, beginning with a letter.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO IS LOWERCASE THE INPUT. The backend is
 * explicit about why: *"A username is chosen once and never changed, so quietly
 * transforming `Ayesha` into `ayesha` would hand someone a permanent handle
 * they did not type. They are told, and they choose."* So `Ayesha` is reported
 * as needing lowercase rather than silently accepted as `ayesha`.
 *
 * IT ALSO DOES NOT KNOW THE RESERVED LIST. The backend keeps one — `mohalla`,
 * `admin`, `support` and so on — and reports a reserved handle as the SAME
 * "unavailable" as a taken one, because the SRS refuses it *without explaining
 * why*. Shipping the list to the client would publish it, and a client that
 * said "that name is reserved" would be telling the user something the server
 * deliberately withholds. So availability is only ever the server's answer.
 */

const val USERNAME_MIN_LENGTH = 3
const val USERNAME_MAX_LENGTH = 20
private val USERNAME_PATTERN = Regex("^[a-z][a-z0-9_]{2,19}$")

enum class UsernameShapeProblem {
    TOO_SHORT,
    TOO_LONG,
    MUST_START_WITH_LETTER,
    /** Includes uppercase, which is the common case worth its own message. */
    NEEDS_LOWERCASE,
    INVALID_CHARACTERS,
}

/** `null` when the shape is fine. Says nothing about availability. */
fun checkUsernameShape(username: String): UsernameShapeProblem? {
    if (username.isEmpty()) return null

    // Counted in CODE POINTS, matching the backend's `[...username].length`.
    // Every legal character here is one UTF-16 unit, so this only differs for
    // input that is already invalid - but it makes the length message accurate
    // for that input rather than surprising.
    val length = username.codePointCount(0, username.length)
    if (length < USERNAME_MIN_LENGTH) return UsernameShapeProblem.TOO_SHORT
    if (length > USERNAME_MAX_LENGTH) return UsernameShapeProblem.TOO_LONG

    if (USERNAME_PATTERN.matches(username)) return null

    // Ordered by how useful the advice is. Uppercase is separated from
    // "invalid characters" because it is the mistake almost everybody makes
    // first, and "use lowercase" is actionable where "invalid characters" is a
    // puzzle.
    if (username.any(Char::isUpperCase)) return UsernameShapeProblem.NEEDS_LOWERCASE
    if (!username.first().isLetter()) return UsernameShapeProblem.MUST_START_WITH_LETTER
    return UsernameShapeProblem.INVALID_CHARACTERS
}

fun isUsernameShapeValid(username: String): Boolean =
    username.isNotEmpty() && checkUsernameShape(username) == null

/** Kotlin's String does not expose it; the platform's does. */
private fun String.codePointCount(begin: Int, end: Int): Int =
    java.lang.Character.codePointCount(this, begin, end)

// ------------------------------------------------------------------- profile

/** PROFILE-FR-002 field bounds, from the backend's `createProfileBody`. */
const val DISPLAY_NAME_MAX = 50
const val CITY_MAX = 60
const val BIO_MAX = 200

/**
 * Grapheme-aware length, so Urdu is not penalised.
 *
 * BR-012's reasoning applies to any counted field: an Urdu word built from a
 * base letter plus combining marks is several UTF-16 units and one thing a
 * reader sees. Counting units would let an English bio run to 200 visible
 * characters and cut an Urdu one off at 90.
 *
 * `BreakIterator` is the platform's own grapheme segmenter and is available
 * from API 1, unlike `Intl.Segmenter`'s Android equivalent.
 */
fun graphemeLength(text: String): Int {
    if (text.isEmpty()) return 0
    val iterator = java.text.BreakIterator.getCharacterInstance()
    iterator.setText(text)
    var count = 0
    while (iterator.next() != java.text.BreakIterator.DONE) count += 1
    return count
}

fun isWithinLimit(text: String, limit: Int): Boolean = graphemeLength(text) <= limit
