package org.shehersaaz.mohalla.feature.auth

import java.util.Calendar

/**
 * Client-side validation — FOR FEEDBACK ONLY.
 *
 * `04-mobile-architecture.md` §2: *"No business rule lives on the client — it
 * validates for feedback only, and the server re-validates everything
 * (SEC-010)."*
 *
 * So nothing here is a gate. It exists to spare somebody on expensive mobile
 * data a round trip to be told their password is too short, and to put the
 * message under the field that caused it rather than in a banner. Every rule
 * below is also enforced server-side, and where the two ever disagree **the
 * server wins** — which is why the screens show the server's field errors when
 * they arrive, rather than trusting what they checked locally.
 *
 * The rules mirror the backend's domain deliberately, and the constants are
 * duplicated rather than fetched: a client that asked the server for its
 * password policy before showing a form would fail to render offline.
 */

// ------------------------------------------------------------------- phone

/**
 * Pakistani mobile, in every form the backend accepts.
 *
 * The backend's `normalizePakistaniMobile` reduces `03001234567`,
 * `00923001234567`, `+923001234567` and separated forms all to `+923XXXXXXXXX`.
 * This mirrors it so the field can show a normalised preview as the user types
 * — which matters more than it sounds: a user who typed `0300 1234567` and sees
 * `+92 300 1234567` appear knows the app understood them, and a user who typed
 * a landline finds out before submitting.
 */
sealed interface PhoneCheck {
    data class Valid(val e164: String) : PhoneCheck
    /** Not enough digits yet. Not an error while typing. */
    data object Incomplete : PhoneCheck
    data object NotPakistaniMobile : PhoneCheck
}

fun checkPhone(input: String): PhoneCheck {
    val digits = input.filter(Char::isDigit)
    if (digits.isEmpty()) return PhoneCheck.Incomplete

    // Reduce to the 10-digit national significant number: 3XXXXXXXXX.
    val nsn = when {
        digits.startsWith("0092") -> digits.removePrefix("0092")
        digits.startsWith("92") && digits.length > 10 -> digits.removePrefix("92")
        digits.startsWith("0") -> digits.removePrefix("0")
        else -> digits
    }

    return when {
        nsn.length < 10 -> PhoneCheck.Incomplete
        nsn.length > 10 -> PhoneCheck.NotPakistaniMobile
        // Pakistani mobile numbers begin 3. A landline (021…, 042…) is a real
        // number and a common mistake, so it is refused as "not a mobile"
        // rather than as malformed.
        !nsn.startsWith("3") -> PhoneCheck.NotPakistaniMobile
        else -> PhoneCheck.Valid("+92$nsn")
    }
}

/** `+92 300 1234567` — grouped for reading, never for sending. */
fun formatPhoneForDisplay(e164: String): String {
    val nsn = e164.removePrefix("+92")
    if (nsn.length != 10) return e164
    return "+92 ${nsn.take(3)} ${nsn.drop(3)}"
}

// ---------------------------------------------------------------- password

/** SRS §12 — 8 to 64 characters, at least one letter and one digit. */
const val PASSWORD_MIN_LENGTH = 8
const val PASSWORD_MAX_LENGTH = 64

enum class PasswordProblem { TOO_SHORT, TOO_LONG, NEEDS_LETTER, NEEDS_DIGIT }

fun checkPassword(password: String): PasswordProblem? = when {
    password.length < PASSWORD_MIN_LENGTH -> PasswordProblem.TOO_SHORT
    password.length > PASSWORD_MAX_LENGTH -> PasswordProblem.TOO_LONG
    password.none(Char::isLetter) -> PasswordProblem.NEEDS_LETTER
    password.none(Char::isDigit) -> PasswordProblem.NEEDS_DIGIT
    else -> null
}

// --------------------------------------------------------------------- age

/**
 * BR-002 — at least 13.
 *
 * THE SERVER CLOCK DECIDES, and this is a client courtesy. The backend
 * re-checks against its own clock precisely because a device clock can be
 * wrong or set deliberately, so a user whose phone is a year fast is told no
 * by the server even if this said yes. Sending the request anyway and letting
 * the server refuse would be correct but wasteful; refusing here and NOT
 * sending would be a client enforcing a rule it cannot be trusted with. So it
 * warns, and the screen still submits.
 */
const val MINIMUM_AGE_YEARS = 13

fun isAtLeastMinimumAge(year: Int, month: Int, dayOfMonth: Int, now: Calendar = Calendar.getInstance()): Boolean {
    val thirteenth = Calendar.getInstance().apply {
        clear()
        set(year + MINIMUM_AGE_YEARS, month, dayOfMonth)
    }
    return !thirteenth.after(now)
}

/** `YYYY-MM-DD`, which is the only form the backend accepts. */
fun formatDateOfBirth(year: Int, monthZeroBased: Int, dayOfMonth: Int): String =
    "%04d-%02d-%02d".format(year, monthZeroBased + 1, dayOfMonth)

// --------------------------------------------------------------------- otp

/** Six digits (SEC-003). Anything else is not worth a round trip. */
const val OTP_LENGTH = 6

fun isCompleteOtp(code: String): Boolean =
    code.length == OTP_LENGTH && code.all(Char::isDigit)

/**
 * Resend cooldown and cap (SEC-003 · EDGE-005).
 *
 * 60 seconds between resends, at most 3 per hour. Mirrored here so the button
 * can show a countdown instead of letting somebody tap into a 429 — but the
 * server owns the limit, and a client that lost count still gets refused.
 */
const val OTP_RESEND_COOLDOWN_SECONDS = 60
const val OTP_MAX_RESENDS_PER_HOUR = 3

/**
 * Individual or Organization (PROFILE-FR-006, BR-011).
 *
 * CHOSEN ONCE, AT REGISTRATION, AND NEVER AGAIN. BR-011 makes it
 * "set once, not user-changeable; an administrator may correct it" - and
 * OD-020 currently forbids provisioning any administrator, so in practice
 * there is no correction path at all. That is why the choice is put in front
 * of the person rather than defaulted silently: the cost of getting it wrong
 * is permanent, and they are the only one who can get it right.
 *
 * CHOOSING ORGANIZATION GRANTS NOTHING. §13 is explicit that it
 * *"does not automatically show a verified badge"* - the badge is
 * ADMIN-FR-010, somebody else's decision - so neither label promises standing.
 * The wire value is the server's own enum, spelled its way.
 */
enum class AccountType(val wire: String) {
    INDIVIDUAL("INDIVIDUAL"),
    ORGANIZATION("ORGANIZATION"),
}
