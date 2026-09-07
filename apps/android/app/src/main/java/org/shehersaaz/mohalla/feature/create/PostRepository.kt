package org.shehersaaz.mohalla.feature.create

import org.shehersaaz.mohalla.core.media.ImageUploader
import org.shehersaaz.mohalla.core.media.UploadResult
import org.shehersaaz.mohalla.core.network.ApiResult
import org.shehersaaz.mohalla.core.network.CategoryResponse
import org.shehersaaz.mohalla.core.network.CreatePostBody
import org.shehersaaz.mohalla.core.network.MohallaApi
import org.shehersaaz.mohalla.core.network.PostResponse
import org.shehersaaz.mohalla.core.network.UpdatePostBody
import org.shehersaaz.mohalla.core.network.apiCall
import org.shehersaaz.mohalla.core.network.map
import org.shehersaaz.mohalla.core.storage.SecureStorage

/**
 * What the composer needs (POST-FR-001/003/006/008 · MEDIA-FR-001).
 *
 * The image upload is behind this interface too, rather than the composer
 * holding an [ImageUploader] directly, so the per-attachment state machine can
 * be tested against scripted upload outcomes — which is where EDGE-013 lives
 * and where nothing else can reach it.
 */
interface PostSource {
    suspend fun create(
        body: String,
        categorySlug: String?,
        mediaIds: List<String>,
    ): ApiResult<PostResponse>

    /** POST-FR-008. `mediaIds` is absent by design — see [PostRepository.update]. */
    suspend fun update(
        postId: String,
        body: String?,
        categorySlug: String?,
    ): ApiResult<PostResponse>

    suspend fun delete(postId: String): ApiResult<Unit>

    suspend fun categories(): ApiResult<List<CategoryResponse>>

    suspend fun uploadImage(bytes: ByteArray): UploadResult
}

class PostRepository(
    private val api: MohallaApi,
    private val uploader: ImageUploader,
) : PostSource {

    override suspend fun create(
        body: String,
        categorySlug: String?,
        mediaIds: List<String>,
    ): ApiResult<PostResponse> = apiCall {
        api.createPost(
            CreatePostBody(
                body = body,
                categorySlug = categorySlug,
                // In the chosen order (POST-FR-003). Sent even when empty is
                // wrong: the server's schema makes it optional, and an empty
                // array is a claim about attachments rather than the absence of
                // one.
                mediaIds = mediaIds.takeIf { it.isNotEmpty() },
            ),
        )
    }

    /**
     * POST-FR-008 — edit the text and the category, and nothing else.
     *
     * `mediaIds` IS NOT A PARAMETER, and its absence is the requirement. BR-014
     * forbids changing a post's images after publishing, and the server's
     * update schema is `.strict()`, so sending the field is REJECTED rather
     * than ignored — "an author who tries to swap the image must be told it
     * cannot be done, not left believing it worked". Leaving it out of this
     * signature means no client code can attempt it.
     */
    override suspend fun update(
        postId: String,
        body: String?,
        categorySlug: String?,
    ): ApiResult<PostResponse> = apiCall {
        api.updatePost(postId, UpdatePostBody(body = body, categorySlug = categorySlug))
    }

    override suspend fun delete(postId: String): ApiResult<Unit> =
        apiCall { api.deletePost(postId) }.map { }

    /** BR-017 — eleven seeded rows, not user-extensible. */
    override suspend fun categories(): ApiResult<List<CategoryResponse>> =
        apiCall { api.categories() }.map { it.categories }

    /** ADR-013's three steps, unchanged. See [ImageUploader]. */
    override suspend fun uploadImage(bytes: ByteArray): UploadResult = uploader.upload(bytes)
}

/**
 * The composer's draft (§19 — "Draft persists locally, never uploads").
 *
 * WHY IT IS ENCRYPTED. The obvious reading is that a post draft is public
 * content in waiting — BR-VIS-001 makes every published post PUBLIC — so plain
 * `SharedPreferences` would do. The reason it does not is what an UNPUBLISHED
 * draft is on this particular product: somebody half-way through writing about
 * a local official, a contested project or a neighbour, who has not decided
 * whether to send it. That is the one piece of user text on the device whose
 * exposure the author has explicitly not consented to yet, and it costs one
 * Keystore-backed read on composer open to keep it out of a filesystem backup
 * or an adb pull. SEC-004's store already exists; using it here is free.
 *
 * ONE DRAFT, NOT A LIST. §19 describes the composer as a single full-screen
 * modal reached from the centre tab. Keeping several drafts would need a drafts
 * list, a UI to choose between them, and a rule for when one is discarded —
 * none of which any requirement asks for.
 *
 * TEXT ONLY. Attachments are deliberately not persisted: a media id would name
 * an object in quarantine that the server's sweep may already have collected,
 * and re-holding 500KB of compressed bytes per image across a process death is
 * heap spent on a guess about what the author will do next. A restored draft
 * therefore has its words and not its photos, which the screen does not pretend
 * otherwise about.
 */
interface DraftStore {
    fun read(): String?
    fun write(body: String)
    fun clear()
}

class SecureDraftStore(
    private val storage: SecureStorage,
) : DraftStore {

    override fun read(): String? = storage.getString(KEY)?.takeIf { it.isNotBlank() }

    override fun write(body: String) {
        // A blank draft is removed rather than stored as "". Storing it would
        // leave a key behind whose only effect is to make `read` return
        // something falsy, and `clear()` already means what it says.
        if (body.isBlank()) storage.remove(KEY) else storage.putString(KEY, body)
    }

    override fun clear() = storage.remove(KEY)

    private companion object {
        /**
         * Namespaced under `draft.` rather than sharing the session's prefix.
         *
         * `SecureStorage.clear()` is what SET-FR-006's sign-out calls, and it
         * clears everything — which is correct here too: a draft left behind
         * after a sign-out would be waiting in the composer for whoever signs in
         * next.
         */
        const val KEY = "draft.post.body"
    }
}
