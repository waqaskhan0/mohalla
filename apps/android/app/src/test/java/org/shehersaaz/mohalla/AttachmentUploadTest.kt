package org.shehersaaz.mohalla

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.shehersaaz.mohalla.core.media.UploadResult
import org.shehersaaz.mohalla.core.network.ApiFailure
import org.shehersaaz.mohalla.core.network.ApiResult
import org.shehersaaz.mohalla.core.network.CategoryResponse
import org.shehersaaz.mohalla.core.network.PostResponse
import org.shehersaaz.mohalla.core.network.PublicProfileResponse
import org.shehersaaz.mohalla.core.media.ImageSource
import org.shehersaaz.mohalla.core.media.PickedImage
import org.shehersaaz.mohalla.feature.create.AttachmentState
import org.shehersaaz.mohalla.feature.create.ComposerViewModel
import org.shehersaaz.mohalla.feature.create.DraftStore
import org.shehersaaz.mohalla.feature.create.PostSource

/**
 * EDGE-013 and EDGE-011, driven through the composer's real sequencing.
 *
 * THE ACCEPTANCE CRITERION UNDER TEST, verbatim: "GIVEN 4 images where the
 * third fails to upload, WHEN the user retries only the third, THEN the other
 * three are not re-uploaded." That is a claim about a SEQUENCE of calls, so the
 * upload source counts them — asserting the final state would pass even if
 * every image had been sent twice.
 *
 * The composer is exercised through a scripted [PostSource] rather than a mock,
 * for the same reason the feed and events tests are: what is being checked is an
 * ordering, and a queue of prepared answers reads as the scenario it describes.
 *
 * THE REAL `ComposerViewModel` IS UNDER TEST, not a stand-in. It holds an
 * `ImageSource` rather than an `ImagePicker` and speaks in URI strings rather
 * than `android.net.Uri`, which is exactly what makes that possible — a
 * reimplementation of the state machine in the test file would assert that the
 * test file works. What remains untested here is the picker's own
 * read-and-compress path, which needs a real `ContentResolver` and a device;
 * that gap is recorded in `20-mobile-open-issues.md`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class AttachmentUploadTest {

    private val dispatcher = StandardTestDispatcher()

    @Before fun setUp() = Dispatchers.setMain(dispatcher)

    @After fun tearDown() = Dispatchers.resetMain()

    /** Counts what was sent, which is the only way to prove EDGE-013. */
    private class Script(
        /** One answer per upload attempt, in order. */
        val uploads: MutableList<UploadResult> = mutableListOf(),
        var createResult: ApiResult<PostResponse>? = null,
    ) : PostSource {
        /** Every set of bytes handed over, in order. Duplicates are the defect. */
        val uploadedSizes = mutableListOf<Int>()
        var createCalls = 0
        var lastMediaIds: List<String>? = null
        var lastBody: String? = null
        var lastCategory: String? = null

        override suspend fun uploadImage(bytes: ByteArray): UploadResult {
            uploadedSizes += bytes.size
            return uploads.removeFirstOrNull() ?: UploadResult.Ok("media-${uploadedSizes.size}")
        }

        override suspend fun create(
            body: String,
            categorySlug: String?,
            mediaIds: List<String>,
        ): ApiResult<PostResponse> {
            createCalls++
            lastBody = body
            lastCategory = categorySlug
            lastMediaIds = mediaIds
            return createResult ?: ApiResult.Ok(
                PostResponse(
                    id = "p1",
                    author = PublicProfileResponse(userId = "u1", displayName = "Sana"),
                    body = body,
                    mediaIds = mediaIds,
                    createdAt = "2026-09-01T10:00:00Z",
                ),
            )
        }

        override suspend fun update(postId: String, body: String?, categorySlug: String?) =
            create(body.orEmpty(), categorySlug, emptyList())

        override suspend fun delete(postId: String): ApiResult<Unit> = ApiResult.Ok(Unit)

        override suspend fun categories(): ApiResult<List<CategoryResponse>> =
            ApiResult.Ok(listOf(CategoryResponse(slug = "general", nameEn = "General")))
    }

    /** Hands back prepared images; the picker's own file reading is elsewhere. */
    private class Images(
        /** Keyed by the URI string, so a test names the bytes it expects. */
        private val bytesFor: (String) -> Int?,
    ) : ImageSource {
        val reads = mutableListOf<String>()

        override suspend fun read(uriString: String): PickedImage? {
            reads += uriString
            val size = bytesFor(uriString) ?: return null
            return PickedImage(thumbnailUri = uriString, bytes = ByteArray(size))
        }
    }

    private class MemoryDraftStore(private var value: String? = null) : DraftStore {
        var writes = 0
        var cleared = 0
        override fun read(): String? = value?.takeIf { it.isNotBlank() }
        override fun write(body: String) {
            writes++
            value = body
        }
        override fun clear() {
            cleared++
            value = null
        }
    }

    /**
     * The real ViewModel, with an image source that hands back `size` bytes for
     * the URI `"pick://<size>"`.
     *
     * Encoding the size in the URI is what lets [Script.uploadedSizes] identify
     * WHICH image each upload call carried — the only way to prove that a retry
     * re-sent one attachment and not four.
     */
    private fun composer(script: Script, drafts: DraftStore) = ComposerViewModel(
        posts = script,
        images = Images { uri -> uri.removePrefix("pick://").toIntOrNull() },
        drafts = drafts,
    )

    private fun ComposerViewModel.add(bytes: Int) = onImagesPicked(listOf("pick://$bytes"))

    private fun ComposerViewModel.stateOf(index: Int) = state.value.attachments[index].state

    private fun ComposerViewModel.bytesOf(index: Int) =
        state.value.attachments[index].image?.bytes?.size

    private fun ComposerViewModel.localIdOf(index: Int) =
        state.value.attachments[index].localId

    // ------------------------------------------------------------- EDGE-013
    @Test
    fun `RETRYING THE THIRD OF FOUR RE-UPLOADS ONLY THE THIRD`() = runTest(dispatcher) {
        // The acceptance criterion, exactly. Distinct byte sizes stand in for
        // distinct images so the calls can be told apart by what was sent.
        val script = Script(
            uploads = mutableListOf(
                UploadResult.Ok("m1"),
                UploadResult.Ok("m2"),
                UploadResult.Failed,
                UploadResult.Ok("m4"),
                // The retry.
                UploadResult.Ok("m3-retry"),
            ),
        )
        val composer = composer(script, MemoryDraftStore())

        composer.add(100)
        composer.add(200)
        composer.add(300)
        composer.add(400)
        advanceUntilIdle()

        assertEquals(listOf(100, 200, 300, 400), script.uploadedSizes)
        assertEquals(AttachmentState.Failed, composer.stateOf(2))

        composer.retryAttachment(composer.localIdOf(2))
        advanceUntilIdle()

        // FIVE uploads in total: the original four plus the one retry. Not
        // eight, which is what a composer that re-sent everything would do.
        assertEquals(listOf(100, 200, 300, 400, 300), script.uploadedSizes)
        assertEquals(AttachmentState.Ready("m3-retry"), composer.stateOf(2))
        // And the other three are untouched.
        assertEquals(AttachmentState.Ready("m1"), composer.stateOf(0))
        assertEquals(AttachmentState.Ready("m2"), composer.stateOf(1))
        assertEquals(AttachmentState.Ready("m4"), composer.stateOf(3))
    }

    @Test
    fun `A SUCCEEDED ATTACHMENT DROPS ITS BYTES, SO A RETRY CANNOT REACH IT`() =
        runTest(dispatcher) {
            val script = Script(uploads = mutableListOf(UploadResult.Ok("m1")))
            val composer = composer(script, MemoryDraftStore())

            composer.add(100)
            advanceUntilIdle()

            assertNull("a ready attachment holds no bytes", composer.bytesOf(0))

            composer.retryAttachment(composer.localIdOf(0))
            advanceUntilIdle()

            // Nothing further was sent. Structural rather than a guard somebody
            // could remove: there is nothing left to send.
            assertEquals(listOf(100), script.uploadedSizes)
        }

    @Test
    fun `A REJECTED ATTACHMENT DROPS ITS BYTES AND IS NOT RETRYABLE`() = runTest(dispatcher) {
        // The server inspected these bytes and refused them (SEC-012/013).
        // Retrying would be refused again, so the offer and the bytes both go.
        val script = Script(
            uploads = mutableListOf(UploadResult.Rejected("Choose a JPG, PNG or WebP image.")),
        )
        val composer = composer(script, MemoryDraftStore())

        composer.add(100)
        advanceUntilIdle()

        assertEquals(
            AttachmentState.Rejected("Choose a JPG, PNG or WebP image."),
            composer.stateOf(0),
        )
        assertNull(composer.bytesOf(0))

        composer.retryAttachment(composer.localIdOf(0))
        advanceUntilIdle()
        assertEquals(listOf(100), script.uploadedSizes)
    }

    @Test
    fun `A FAILED ATTACHMENT KEEPS ITS BYTES, WHICH IS WHAT MAKES RETRY POSSIBLE`() =
        runTest(dispatcher) {
            // Without this, a retry would have to reopen the picker and ask the
            // user to find the same photo again.
            val script = Script(uploads = mutableListOf(UploadResult.Failed))
            val composer = composer(script, MemoryDraftStore())

            composer.add(100)
            advanceUntilIdle()

            assertEquals(AttachmentState.Failed, composer.stateOf(0))
            assertEquals(100, composer.bytesOf(0))
        }

    @Test
    fun `removing an attachment mid-upload leaves the others alone`() = runTest(dispatcher) {
        val script = Script(
            uploads = mutableListOf(UploadResult.Ok("m1"), UploadResult.Ok("m2")),
        )
        val composer = composer(script, MemoryDraftStore())

        composer.add(100)
        composer.add(200)
        advanceUntilIdle()

        composer.removeAttachment(composer.localIdOf(0))

        assertEquals(1, composer.state.value.attachments.size)
        assertEquals(AttachmentState.Ready("m2"), composer.stateOf(0))
    }

    // ------------------------------------------------------------- EDGE-011
    @Test
    fun `NO POST IS CREATED WHILE AN UPLOAD IS UNFINISHED`() = runTest(dispatcher) {
        // "Upload is interrupted at 80% by loss of network. No post is created.
        // Text is preserved in the composer. Retry does not produce a duplicate."
        val script = Script(uploads = mutableListOf(UploadResult.Failed))
        val composer = composer(script, MemoryDraftStore())

        composer.onBodyChanged("The drain on Nishtar Road has been blocked for three weeks.")
        composer.add(100)
        advanceUntilIdle()

        composer.publish()
        advanceUntilIdle()

        assertEquals("no post may be created over a failed upload", 0, script.createCalls)
        // And the words are still there.
        assertTrue(composer.state.value.body.startsWith("The drain"))
    }

    @Test
    fun `THE DRAFT IS CLEARED ONLY AFTER A SUCCESSFUL PUBLISH`() = runTest(dispatcher) {
        val drafts = MemoryDraftStore()
        val script = Script()
        val composer = composer(script, drafts)

        composer.onBodyChanged("Water supply has been off since Tuesday.")
        advanceUntilIdle()
        assertEquals(0, drafts.cleared)

        composer.publish()
        advanceUntilIdle()

        assertEquals(1, script.createCalls)
        assertEquals(1, drafts.cleared)
        assertNull(drafts.read())
    }

    @Test
    fun `A FAILED PUBLISH KEEPS THE DRAFT AND THE TEXT`() = runTest(dispatcher) {
        // EDGE-011 again, on the publish rather than the upload. Clearing the
        // draft optimistically and then failing would lose the words to a
        // dropped connection.
        val drafts = MemoryDraftStore()
        val script = Script(createResult = ApiResult.Err(ApiFailure.Offline))
        val composer = composer(script, drafts)

        composer.onBodyChanged("The street light outside 42-C has been out for a month.")
        advanceUntilIdle()

        composer.publish()
        advanceUntilIdle()

        assertEquals(0, drafts.cleared)
        assertTrue(composer.state.value.body.startsWith("The street light"))
        assertEquals(ApiFailure.Offline, composer.state.value.failure)
    }

    @Test
    fun `A RESTORED DRAFT IS IN THE FIRST STATE THE SCREEN SEES`() = runTest(dispatcher) {
        // Read synchronously in the initialiser, so the first frame already has
        // the words. A draft that appeared a moment later would look like the
        // app had typed something.
        val drafts = MemoryDraftStore("Half-written report about the tanker queue")
        val composer = composer(Script(), drafts)

        assertEquals("Half-written report about the tanker queue", composer.state.value.body)
    }

    @Test
    fun `discarding clears the draft, and merely leaving does not`() = runTest(dispatcher) {
        val drafts = MemoryDraftStore()
        val composer = composer(Script(), drafts)

        composer.onBodyChanged("Something I have not decided whether to send.")
        assertEquals(0, drafts.cleared)

        // §19's "draft persists locally" is about surviving everything except an
        // intentional discard.
        composer.discard()
        assertEquals(1, drafts.cleared)
        assertEquals("", composer.state.value.body)
    }

    // -------------------------------------------------------------- publish
    @Test
    fun `THE MEDIA IDS ARE SENT IN THE CHOSEN ORDER`() = runTest(dispatcher) {
        // POST-FR-003 requires it by name, and the ids are deliberately not
        // alphabetical here — a set or a sort would pass a weaker test.
        val script = Script(
            uploads = mutableListOf(
                UploadResult.Ok("m-zebra"),
                UploadResult.Ok("m-apple"),
                UploadResult.Ok("m-mango"),
            ),
        )
        val composer = composer(script, MemoryDraftStore())

        composer.onBodyChanged("Three photos.")
        composer.add(100)
        composer.add(200)
        composer.add(300)
        advanceUntilIdle()

        composer.publish()
        advanceUntilIdle()

        assertEquals(listOf("m-zebra", "m-apple", "m-mango"), script.lastMediaIds)
    }

    @Test
    fun `the body is trimmed and the category is sent as chosen`() = runTest(dispatcher) {
        val script = Script()
        val composer = composer(script, MemoryDraftStore())

        composer.onBodyChanged("  Blocked drain on Nishtar Road.  ")
        composer.onCategoryChanged("infrastructure")
        advanceUntilIdle()

        composer.publish()
        advanceUntilIdle()

        assertEquals("Blocked drain on Nishtar Road.", script.lastBody)
        assertEquals("infrastructure", script.lastCategory)
    }

    @Test
    fun `NO CATEGORY IS SENT WHEN NONE WAS CHOSEN`() = runTest(dispatcher) {
        // §13: "choosing is one tap; skipping is free". Nothing is pre-selected,
        // so a post with no category sends none rather than a guess.
        val script = Script()
        val composer = composer(script, MemoryDraftStore())

        composer.onBodyChanged("No category on this one.")
        composer.publish()
        advanceUntilIdle()

        assertNull(script.lastCategory)
    }

    @Test
    fun `publishing twice sends one post`() = runTest(dispatcher) {
        // EDGE-011's "retry does not produce a duplicate", from the client's
        // side: a double tap must not create two posts.
        val script = Script()
        val composer = composer(script, MemoryDraftStore())

        composer.onBodyChanged("One post, please.")
        composer.publish()
        composer.publish()
        advanceUntilIdle()

        assertEquals(1, script.createCalls)
    }

    // ---------------------------------------------------------------- limit
    @Test
    fun `A FIFTH IMAGE IS REFUSED AND THE LIMIT IS FLAGGED`() = runTest(dispatcher) {
        // POST-FR-001's acceptance criterion: "GIVEN a post with 4 images
        // attached, WHEN a fifth is selected, THEN the selection is refused and
        // the limit is stated."
        val script = Script()
        val composer = composer(script, MemoryDraftStore())

        repeat(4) { composer.add(100 + it) }
        advanceUntilIdle()

        composer.add(500)
        advanceUntilIdle()

        assertEquals(4, composer.state.value.attachments.size)
        assertTrue(composer.state.value.attachmentLimitReached)
        assertFalse(script.uploadedSizes.contains(500))
    }
}
