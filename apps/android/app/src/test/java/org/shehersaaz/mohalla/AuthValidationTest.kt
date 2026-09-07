package org.shehersaaz.mohalla

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.shehersaaz.mohalla.feature.auth.PASSWORD_MAX_LENGTH
import org.shehersaaz.mohalla.feature.auth.PhoneCheck
import org.shehersaaz.mohalla.feature.auth.PasswordProblem
import org.shehersaaz.mohalla.feature.auth.checkPassword
import org.shehersaaz.mohalla.feature.auth.checkPhone
import org.shehersaaz.mohalla.feature.auth.formatDateOfBirth
import org.shehersaaz.mohalla.feature.auth.formatPhoneForDisplay
import org.shehersaaz.mohalla.feature.auth.isAtLeastMinimumAge
import org.shehersaaz.mohalla.feature.auth.isCompleteOtp
import org.shehersaaz.mohalla.feature.auth.maskPhoneForOwner
import java.util.Calendar

/**
 * Client-side validation.
 *
 * These rules exist for feedback only — the server re-validates everything
 * (SEC-010) — so what is worth testing is that they MATCH the backend's domain.
 * A client stricter than the server refuses numbers that would have worked; one
 * looser sends requests that were always going to fail. Both are worse on
 * expensive mobile data than getting it right.
 */
class AuthValidationTest {

    // ---------------------------------------------------------------- phone

    @Test
    fun `every form the backend accepts normalises to the same E164`() {
        // The backend's `normalizePakistaniMobile` accepts all of these. If the
        // client rejected any, a user who types their number the way they
        // always write it would be told it is invalid.
        val forms = listOf(
            "03001234567",
            "0300 1234567",
            "0300-1234567",
            "+923001234567",
            "+92 300 1234567",
            "00923001234567",
            "923001234567",
        )

        forms.forEach { input ->
            val check = checkPhone(input)
            assertTrue("$input should be valid, was $check", check is PhoneCheck.Valid)
            assertEquals(
                "$input normalised wrongly",
                "+923001234567",
                (check as PhoneCheck.Valid).e164,
            )
        }
    }

    @Test
    fun `A LANDLINE IS REFUSED AS NOT-A-MOBILE, NOT AS MALFORMED`() {
        // 021 is Karachi, 042 is Lahore. Both are real numbers somebody might
        // reasonably type, and "that is not a mobile" is actionable where
        // "invalid number" is not.
        assertEquals(PhoneCheck.NotPakistaniMobile, checkPhone("02112345678"))
        assertEquals(PhoneCheck.NotPakistaniMobile, checkPhone("0421234567890"))
    }

    @Test
    fun `a partial number is INCOMPLETE, which is not an error while typing`() {
        // Showing "invalid number" after the third digit is the classic form
        // that argues with the user as they type.
        assertEquals(PhoneCheck.Incomplete, checkPhone(""))
        assertEquals(PhoneCheck.Incomplete, checkPhone("03"))
        assertEquals(PhoneCheck.Incomplete, checkPhone("0300123"))
    }

    @Test
    fun `too many digits is refused`() {
        assertEquals(PhoneCheck.NotPakistaniMobile, checkPhone("030012345678901"))
    }

    @Test
    fun `display formatting is grouped, and never what gets sent`() {
        assertEquals("+92 300 1234567", formatPhoneForDisplay("+923001234567"))
        // The E.164 form is what the API receives; the grouped form is only for
        // reading, so an unexpected input is returned unchanged rather than
        // mangled into something that looks plausible.
        assertEquals("+9230012", formatPhoneForDisplay("+9230012"))
    }

    @Test
    fun `THE OWNER'S OWN NUMBER IS MASKED WHEREVER IT IS SHOWN BACK`() {
        // PRIV-003, and the same shape the backend's `maskForOwner` produces, so
        // the rendering is consistent between what the app formats and what the
        // server sends.
        assertEquals("+92 3** *** **67", maskPhoneForOwner("+923001234567"))
    }

    // ------------------------------------------------------------- password

    @Test
    fun `password policy matches SRS section 12`() {
        assertEquals(PasswordProblem.TOO_SHORT, checkPassword("abc1"))
        assertEquals(PasswordProblem.NEEDS_DIGIT, checkPassword("abcdefghij"))
        assertEquals(PasswordProblem.NEEDS_LETTER, checkPassword("1234567890"))
        assertEquals(PasswordProblem.TOO_LONG, checkPassword("a1".repeat(PASSWORD_MAX_LENGTH)))
        assertNull(checkPassword("synthetic1"))
    }

    @Test
    fun `exactly eight characters with a letter and a digit is accepted`() {
        // The boundary. Nine would pass a wrong `>` and eight would not.
        assertNull(checkPassword("abcdefg1"))
        assertEquals(PasswordProblem.TOO_SHORT, checkPassword("abcdef1"))
    }

    // ------------------------------------------------------------------ age

    @Test
    fun `BR-002 is checked against a fixed date so the test does not rot`() {
        val now = Calendar.getInstance().apply { clear(); set(2026, Calendar.SEPTEMBER, 7) }

        // Turned 13 the day before.
        assertTrue(isAtLeastMinimumAge(2013, Calendar.SEPTEMBER, 6, now))
        // Turns 13 today — the birthday itself counts.
        assertTrue(isAtLeastMinimumAge(2013, Calendar.SEPTEMBER, 7, now))
        // Turns 13 tomorrow.
        assertTrue(!isAtLeastMinimumAge(2013, Calendar.SEPTEMBER, 8, now))
    }

    @Test
    fun `date of birth is formatted as the only shape the backend accepts`() {
        // `YYYY-MM-DD`, and the month is zero-based coming in because that is
        // what Android's date picker gives — a mismatch here would silently
        // shift every birthday by a month.
        assertEquals("1995-06-15", formatDateOfBirth(1995, 5, 15))
        assertEquals("2000-01-01", formatDateOfBirth(2000, 0, 1))
        assertEquals("1999-12-31", formatDateOfBirth(1999, 11, 31))
    }

    // ------------------------------------------------------------------ otp

    @Test
    fun `a code is complete only at exactly six digits`() {
        assertTrue(isCompleteOtp("481920"))
        assertTrue(!isCompleteOtp("48192"))
        assertTrue(!isCompleteOtp("4819200"))
        assertTrue(!isCompleteOtp("48192a"))
    }
}
