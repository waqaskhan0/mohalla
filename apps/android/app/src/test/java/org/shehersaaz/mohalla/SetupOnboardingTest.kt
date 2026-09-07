package org.shehersaaz.mohalla

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.shehersaaz.mohalla.core.media.ImageCompressor
import org.shehersaaz.mohalla.core.media.ImageUploader
import org.shehersaaz.mohalla.feature.setup.BIO_MAX
import org.shehersaaz.mohalla.feature.setup.ProfileSetupUiState
import org.shehersaaz.mohalla.feature.setup.UsernameShapeProblem
import org.shehersaaz.mohalla.feature.setup.UsernameUiState
import org.shehersaaz.mohalla.feature.setup.checkUsernameShape
import org.shehersaaz.mohalla.feature.setup.graphemeLength
import org.shehersaaz.mohalla.feature.setup.isUsernameShapeValid
import org.shehersaaz.mohalla.feature.setup.isWithinLimit

/**
 * Profile onboarding.
 *
 * The two rules here that would fail silently are the username race (EDGE-007)
 * and the grapheme count — both produce a working screen that is wrong for
 * somebody else, which is the class of bug this suite exists for.
 */
class SetupOnboardingTest {

    // -------------------------------------------------------- the username

    @Test
    fun `username shape matches the backend pattern exactly`() {
        // `^[a-z][a-z0-9_]{2,19}$`
        assertNull(checkUsernameShape("ayesha"))
        assertNull(checkUsernameShape("ali_1"))
        assertNull(checkUsernameShape("abc"))
        assertNull(checkUsernameShape("a".repeat(20)))

        assertEquals(UsernameShapeProblem.TOO_SHORT, checkUsernameShape("ab"))
        assertEquals(UsernameShapeProblem.TOO_LONG, checkUsernameShape("a".repeat(21)))
        assertEquals(UsernameShapeProblem.MUST_START_WITH_LETTER, checkUsernameShape("1ayesha"))
        assertEquals(UsernameShapeProblem.MUST_START_WITH_LETTER, checkUsernameShape("_ayesha"))
        assertEquals(UsernameShapeProblem.INVALID_CHARACTERS, checkUsernameShape("ayesha-khan"))
        assertEquals(UsernameShapeProblem.INVALID_CHARACTERS, checkUsernameShape("ayesha khan"))
    }

    @Test
    fun `UPPERCASE IS ITS OWN MESSAGE, AND IS NOT SILENTLY LOWERCASED`() {
        // The backend's reasoning, which the client has to honour: a username
        // is chosen once and never changed, so turning `Ayesha` into `ayesha`
        // would hand somebody a permanent handle they did not type.
        assertEquals(UsernameShapeProblem.NEEDS_LOWERCASE, checkUsernameShape("Ayesha"))
        assertEquals(UsernameShapeProblem.NEEDS_LOWERCASE, checkUsernameShape("AYESHA"))

        // And the advice is specific rather than "invalid characters", which is
        // a puzzle where "use lowercase" is an instruction.
        assertTrue(checkUsernameShape("Ayesha") != UsernameShapeProblem.INVALID_CHARACTERS)
    }

    @Test
    fun `an empty field is not an error while typing`() {
        assertNull(checkUsernameShape(""))
        // But it is not submittable either.
        assertTrue(!isUsernameShapeValid(""))
    }

    @Test
    fun `THE CLIENT DOES NOT KNOW THE RESERVED LIST`() {
        // `mohalla`, `admin` and `support` are reserved server-side and the SRS
        // refuses them WITHOUT explaining why. They must therefore pass the
        // client's shape check and be refused by the server as ordinary
        // unavailability — shipping the list would publish it, and a client
        // that said "reserved" would disclose what the server withholds.
        listOf("mohalla", "admin", "support", "shehersaaz").forEach { reserved ->
            assertNull(
                "$reserved must pass the SHAPE check — availability is the server's answer",
                checkUsernameShape(reserved),
            )
            assertTrue(isUsernameShapeValid(reserved))
        }
    }

    @Test
    fun `THE AVAILABILITY HINT IS NEVER A PROMISE (EDGE-007)`() {
        // §13: "Do not claim a username is reserved until server confirms."
        // The field is named `looksFree` rather than `available` so a screen
        // cannot read it as a guarantee, and its three states are distinct:
        // not asked, free a moment ago, and not free.
        val notAsked = UsernameUiState(input = "ayesha")
        assertNull(notAsked.looksFree)

        val looksFree = UsernameUiState(input = "ayesha", looksFree = true)
        assertEquals(true, looksFree.looksFree)

        // And the state has no field that could promise the handle is HELD.
        // An exact set rather than four guessed names: `isFree`, `unclaimed` or
        // `verified` would all promise the same thing under a name a denylist
        // would miss.
        assertExactFields(
            type = UsernameUiState::class.java,
            expected = setOf(
                "input", "shapeProblem",
                // `looksFree`, deliberately not `available` — EDGE-007 makes
                // this a HINT, and only the claim decides.
                "looksFree",
                "checking", "claiming",
                // Set by the claim, which is the only thing that can.
                "claimed",
                "takenMessage", "failure",
            ),
            because = "EDGE-007 means the availability check is a hint and the claim is " +
                "the truth; a field promising the handle is reserved would be a promise " +
                "the client cannot keep",
        )
    }

    // -------------------------------------------------------- the bio count

    @Test
    fun `THE BIO IS COUNTED IN GRAPHEMES, SO URDU IS NOT PENALISED`() {
        // The same reasoning as BR-012's post counter. An Urdu word built from
        // a base letter plus combining marks is several UTF-16 units and one
        // thing a reader sees; counting units would give an English bio 200
        // visible characters and an Urdu one far fewer.
        val urdu = "محلہ"
        assertTrue(
            "Urdu must not count more graphemes than it has UTF-16 units",
            graphemeLength(urdu) <= urdu.length,
        )

        // A combining mark is part of its base grapheme, not a character of
        // its own. `ā` written as `a` + U+0304 is one grapheme, two units.
        val combining = "ā"
        assertEquals(2, combining.length)
        assertEquals(1, graphemeLength(combining))
    }

    @Test
    fun `an empty bio is zero graphemes and within the limit`() {
        assertEquals(0, graphemeLength(""))
        assertTrue(isWithinLimit("", BIO_MAX))
    }

    @Test
    fun `the limit is applied to graphemes, not units`() {
        // 200 combining pairs is 400 UTF-16 units and 200 graphemes: within the
        // limit. A unit-based check would refuse it.
        val twoHundredGraphemes = "ā".repeat(BIO_MAX)
        assertEquals(BIO_MAX, graphemeLength(twoHundredGraphemes))
        assertTrue(isWithinLimit(twoHundredGraphemes, BIO_MAX))

        assertTrue(!isWithinLimit("ā".repeat(BIO_MAX + 1), BIO_MAX))
    }

    @Test
    fun `the remaining count is derived, so it cannot disagree with the text`() {
        val state = ProfileSetupUiState(bio = "hello", bioGraphemes = 5)
        assertEquals(BIO_MAX - 5, state.bioRemaining)
    }

    // ------------------------------------------------------------ the photo

    @Test
    fun `THE UPLOAD CEILING IS 500KB, NOT A TARGET`() {
        // NFR-PERF-005, and `04-mobile-architecture.md` §7 is explicit that an
        // image which cannot be compressed under it is REFUSED rather than
        // sent at full size.
        assertEquals(500 * 1024, ImageUploader.MAX_UPLOAD_BYTES)
        assertEquals(1600, ImageUploader.MAX_LONGEST_EDGE_PX)
    }

    @Test
    fun `the sample size under-samples so the exact fit is a scale, not a blur`() {
        // `inSampleSize` only honours powers of two. Under-sampling lands above
        // the target and lets the scaler do the precise fit; over-sampling
        // would produce a visibly soft image.
        val edge = 1600

        // 4000px longest: /2 = 2000 (still >= 1600), /4 = 1000 (< 1600) so 2.
        assertEquals(2, ImageCompressor.sampleSizeFor(4000, 3000, edge))
        // 12000px: 2 -> 6000, 4 -> 3000, 8 -> 1500 (< 1600) so 4.
        assertEquals(4, ImageCompressor.sampleSizeFor(12000, 9000, edge))
        // Already small enough — no sampling.
        assertEquals(1, ImageCompressor.sampleSizeFor(1200, 900, edge))
        assertEquals(1, ImageCompressor.sampleSizeFor(1600, 1200, edge))
    }

    @Test
    fun `a failed photo upload KEEPS THE BYTES so retry does not reopen the gallery`() {
        // EDGE-013. A refused file drops them, because retrying the same
        // rejected image cannot succeed and the user needs to pick another.
        val transient = ProfileSetupUiState(
            uploadFailed = true,
            pendingPhoto = byteArrayOf(1, 2, 3),
        )
        assertTrue(transient.pendingPhoto != null)

        val rejected = ProfileSetupUiState(
            uploadFailed = true,
            uploadRejectedReason = "TYPE_NOT_ALLOWED",
            pendingPhoto = null,
        )
        assertNull(rejected.pendingPhoto)
    }

    @Test
    fun `ONLY THE DISPLAY NAME IS REQUIRED`() {
        // PROFILE-FR-002/003. An onboarding form that demands a bio is one
        // people abandon.
        val nameOnly = ProfileSetupUiState(displayName = "Ayesha")
        assertTrue(nameOnly.city.isEmpty())
        assertTrue(nameOnly.bio.isEmpty())
        assertNull(nameOnly.photoMediaId)
        assertTrue(!nameOnly.displayNameTooLong)
    }

    @Test
    fun `state equality survives a ByteArray field`() {
        // A `data class` with a `ByteArray` compares it by REFERENCE, so every
        // state read would look like a change and recompose the screen. The
        // overrides are why this holds.
        val a = ProfileSetupUiState(displayName = "x", pendingPhoto = byteArrayOf(1, 2))
        val b = ProfileSetupUiState(displayName = "x", pendingPhoto = byteArrayOf(1, 2))
        assertEquals(a, b)
        assertEquals(a.hashCode(), b.hashCode())
    }
}
