package org.shehersaaz.mohalla

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.shehersaaz.mohalla.core.network.UpdatePostBody
import org.shehersaaz.mohalla.feature.create.Attachment
import org.shehersaaz.mohalla.feature.create.AttachmentState
import org.shehersaaz.mohalla.feature.create.BODY_MAX_GRAPHEMES
import org.shehersaaz.mohalla.feature.create.ComposerUiState
import org.shehersaaz.mohalla.feature.create.MAX_IMAGES_PER_POST
import org.shehersaaz.mohalla.feature.create.PostBlockedReason
import org.shehersaaz.mohalla.feature.create.allSettledAndReady
import org.shehersaaz.mohalla.feature.create.readyMediaIds

/**
 * The composer's rules (POST-FR-001/003 · BR-012/013/014 · EDGE-011/013).
 *
 * THESE ARE THE PURE-STATE ASSERTIONS. The sequencing — an upload that fails
 * and is retried alone — is in `AttachmentUploadTest`, which drives the real
 * ViewModel. Split because this half needs no coroutines and no Android, and a
 * rule that can be checked on the JVM should be.
 *
 * NO ANDROID TYPES APPEAR IN THE COMPOSER'S STATE, which is what lets this file
 * be a plain JUnit test. The thumbnail source is a `String` rather than an
 * `android.net.Uri` for exactly that reason — `Uri.parse` throws off a device,
 * so holding one in the `StateFlow` would put every rule below behind
 * Robolectric.
 */
class ComposerTest {

    private fun attachment(
        id: String,
        state: AttachmentState,
    ) = Attachment(localId = id, thumbnailUri = "content://test/$id", state = state)

    // ------------------------------------------------------------- constants
    @Test
    fun `THE LIMITS MATCH THE BACKEND`() {
        // BR-012's 3,000 graphemes and BR-013's four images. Duplicated across
        // a Kotlin app and a TypeScript API with no shared schema, so a
        // divergence would show up as a form that passes its own check and is
        // then refused — which reads as the server being broken.
        assertEquals(3000, BODY_MAX_GRAPHEMES)
        assertEquals(4, MAX_IMAGES_PER_POST)
    }

    // ------------------------------------------------------------ can post
    @Test
    fun `POST IS DISABLED UNTIL TEXT OR AN ATTACHMENT EXISTS`() {
        // §19, verbatim. EITHER is enough, which matches the API: "text is
        // optional when an attachment is present". A photo of a blocked drain
        // with no caption is a complete report.
        assertFalse(ComposerUiState().canPost)

        assertTrue(ComposerUiState(body = "The drain is blocked.").canPost)

        assertTrue(
            ComposerUiState(
                attachments = listOf(attachment("a", AttachmentState.Ready("m1"))),
            ).canPost,
        )
    }

    @Test
    fun `WHITESPACE IS NOT TEXT`() {
        // Otherwise a stray space enables Post and the server refuses an empty
        // body — being refused after tapping is a worse way to learn it.
        assertFalse(ComposerUiState(body = "   \n  ").canPost)
    }

    @Test
    fun `PAST THE LIMIT, POST IS DISABLED AND NOTHING IS TRUNCATED`() {
        // §19: "counter turns error past 3000 and disables Post". The text is
        // NOT cut — silently deleting the end of somebody's sentence is worse
        // than refusing to send it.
        val tooLong = "a".repeat(BODY_MAX_GRAPHEMES + 1)
        val state = ComposerUiState(body = tooLong)

        assertTrue(state.isOverLimit)
        assertFalse(state.canPost)
        assertEquals(PostBlockedReason.TOO_LONG, state.postBlockedReason)
        // Still all there.
        assertEquals(BODY_MAX_GRAPHEMES + 1, state.body.length)
    }

    @Test
    fun `exactly at the limit is allowed`() {
        val state = ComposerUiState(body = "a".repeat(BODY_MAX_GRAPHEMES))
        assertFalse(state.isOverLimit)
        assertTrue(state.canPost)
    }

    @Test
    fun `THE COUNT IS IN GRAPHEMES, SO URDU IS NOT PENALISED`() {
        // BR-012. A string of base letters plus combining marks: twice as many
        // UTF-16 units as graphemes. Counting units would give an Urdu post
        // half the allowance an English one gets, on a platform whose Urdu
        // users are first-class by requirement (O4).
        val urdu = "کِ".repeat(BODY_MAX_GRAPHEMES)
        val state = ComposerUiState(body = urdu)

        assertTrue("the raw string is longer in UTF-16", urdu.length > BODY_MAX_GRAPHEMES)
        assertEquals(BODY_MAX_GRAPHEMES, state.graphemeCount)
        assertFalse(state.isOverLimit)
        assertTrue(state.canPost)
    }

    // --------------------------------------------------------- EDGE-011/013
    @Test
    fun `POST IS BLOCKED WHILE AN UPLOAD IS IN FLIGHT`() {
        // EDGE-011: an upload interrupted at 80% leaves "no post created".
        // Publishing over an unfinished upload would silently drop the image,
        // and the author would find their evidence missing after the fact.
        val state = ComposerUiState(
            body = "Photos attached.",
            attachments = listOf(
                attachment("a", AttachmentState.Ready("m1")),
                attachment("b", AttachmentState.Uploading(percent = 80)),
            ),
        )

        assertFalse(state.canPost)
        assertEquals(PostBlockedReason.UPLOAD_IN_PROGRESS, state.postBlockedReason)
    }

    @Test
    fun `POST IS BLOCKED WHILE AN ATTACHMENT HAS FAILED`() {
        val state = ComposerUiState(
            body = "Photos attached.",
            attachments = listOf(
                attachment("a", AttachmentState.Ready("m1")),
                attachment("b", AttachmentState.Failed),
            ),
        )

        assertFalse(state.canPost)
        assertEquals(PostBlockedReason.UPLOAD_FAILED, state.postBlockedReason)
    }

    @Test
    fun `A REJECTED ATTACHMENT BLOCKS POST AND OFFERS NO RETRY`() {
        // The distinction the state machine exists for: retrying bytes the
        // server already inspected and refused will be refused again, so a
        // retry button here can never work — and people keep pressing one.
        val rejected = attachment("b", AttachmentState.Rejected("Choose a JPG, PNG or WebP image."))

        assertFalse(rejected.canRetry)

        val state = ComposerUiState(body = "Photo attached.", attachments = listOf(rejected))
        assertFalse(state.canPost)
        assertEquals(PostBlockedReason.UPLOAD_REJECTED, state.postBlockedReason)
    }

    @Test
    fun `ONLY A FAILED ATTACHMENT OFFERS A RETRY`() {
        assertTrue(attachment("a", AttachmentState.Failed).canRetry)
        assertFalse(attachment("a", AttachmentState.Pending).canRetry)
        assertFalse(attachment("a", AttachmentState.Uploading(50)).canRetry)
        assertFalse(attachment("a", AttachmentState.Ready("m1")).canRetry)
        assertFalse(attachment("a", AttachmentState.Rejected(null)).canRetry)
    }

    @Test
    fun `A READY ATTACHMENT HOLDS NO BYTES, SO IT CANNOT BE RE-UPLOADED`() {
        // EDGE-013's acceptance criterion enforced structurally rather than by
        // discipline: "the other three are not re-uploaded". A Ready attachment
        // has dropped its image, so there is nothing for a retry to send even
        // if one were somehow requested.
        val ready = Attachment(
            localId = "a",
            thumbnailUri = "content://test/a",
            state = AttachmentState.Ready("m1"),
            image = null,
        )

        assertTrue(ready.isReady)
        assertNull(ready.image)
        assertFalse(ready.canRetry)
    }

    @Test
    fun `all-settled means every attachment, not merely one`() {
        assertTrue("no attachments is settled", emptyList<Attachment>().allSettledAndReady())

        assertTrue(
            listOf(
                attachment("a", AttachmentState.Ready("m1")),
                attachment("b", AttachmentState.Ready("m2")),
            ).allSettledAndReady(),
        )

        assertFalse(
            listOf(
                attachment("a", AttachmentState.Ready("m1")),
                attachment("b", AttachmentState.Pending),
            ).allSettledAndReady(),
        )
    }

    // ------------------------------------------------------- order and ids
    @Test
    fun `THE CHOSEN ORDER IS PRESERVED`() {
        // POST-FR-003 requires it by name. So `readyMediaIds` maps rather than
        // collecting into a set, and nothing sorts.
        val attachments = listOf(
            attachment("first", AttachmentState.Ready("m-c")),
            attachment("second", AttachmentState.Ready("m-a")),
            attachment("third", AttachmentState.Ready("m-b")),
        )

        assertEquals(listOf("m-c", "m-a", "m-b"), attachments.readyMediaIds())
    }

    @Test
    fun `an unfinished attachment contributes no media id`() {
        val attachments = listOf(
            attachment("a", AttachmentState.Ready("m1")),
            attachment("b", AttachmentState.Failed),
            attachment("c", AttachmentState.Uploading(10)),
            attachment("d", AttachmentState.Rejected(null)),
        )

        assertEquals(listOf("m1"), attachments.readyMediaIds())
    }

    @Test
    fun `remaining images counts down from four`() {
        assertEquals(4, ComposerUiState().remainingImages)
        assertEquals(
            2,
            ComposerUiState(
                attachments = listOf(
                    attachment("a", AttachmentState.Ready("m1")),
                    attachment("b", AttachmentState.Pending),
                ),
            ).remainingImages,
        )
    }

    // ------------------------------------------------------------- BR-014
    @Test
    fun `AN EDIT CANNOT CARRY MEDIA IDS, AND THE TYPE MAKES IT IMPOSSIBLE`() {
        // BR-014 forbids changing a post's images after publishing, and the
        // server's update schema is strict — sending the field is REJECTED
        // rather than ignored, so "an author who tries to swap the image must
        // be told it cannot be done, not left believing it worked".
        //
        // Asserted at the TYPE level as an EXACT SET, so no client code can
        // attempt it and no future field can slip past under another name. The
        // earlier version checked that no field name contained "media", and a
        // measurement proved that worthless: a field called `attachmentIds` was
        // added to this very class and all 271 tests still passed.
        assertExactFields(
            type = UpdatePostBody::class.java,
            expected = setOf("body", "categorySlug"),
            because = "BR-014 forbids changing a post's attachments after publishing, " +
                "which prevents bait-and-switch on content others have already endorsed",
        )
    }

    // ------------------------------------------------ no reason when obvious
    @Test
    fun `AN EMPTY COMPOSER GIVES NO BLOCKED REASON`() {
        // A disabled Post on an empty composer needs no explanation — the
        // reason is the empty screen. A notice there would be the app telling
        // somebody they have not written anything yet.
        assertNull(ComposerUiState().postBlockedReason)
    }

    @Test
    fun `a publishable composer gives no blocked reason`() {
        assertNull(ComposerUiState(body = "Ready to go.").postBlockedReason)
    }
}
