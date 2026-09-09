package org.shehersaaz.mohalla.feature.create

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.CreationExtras
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import org.shehersaaz.mohalla.core.media.ImageSource
import org.shehersaaz.mohalla.core.media.UploadResult
import org.shehersaaz.mohalla.core.network.ApiFailure
import org.shehersaaz.mohalla.core.network.ApiResult
import org.shehersaaz.mohalla.core.network.CategoryResponse
import org.shehersaaz.mohalla.core.network.PostResponse
import org.shehersaaz.mohalla.feature.setup.graphemeLength

/**
 * The composer — UX-CREATE-001 (POST-FR-001/003/006 · BR-012/013 · EDGE-011/013).
 *
 * FOUR RULES SHAPE THIS FILE, and each one is a requirement rather than a
 * preference.
 *
 * 1. EACH ATTACHMENT UPLOADS INDEPENDENTLY AND RETRIES ALONE. EDGE-013 is
 *    explicit: three of four succeed, the fourth is retried, "the other three
 *    are not re-uploaded". [retryAttachment] can only reach a [Failed] one, and
 *    a [Ready] one has already dropped its bytes — so re-uploading a succeeded
 *    file is not merely avoided, it is impossible.
 *
 * 2. NO POST IS CREATED UNTIL EVERY ATTACHMENT IS READY. EDGE-011: an upload
 *    interrupted at 80% leaves "no post created" and the text preserved.
 *    Publishing is gated on [ComposerUiState.canPost], never attempted
 *    speculatively, and a failed upload never becomes a post with a missing
 *    photo.
 *
 * 3. THE DRAFT PERSISTS LOCALLY AND NEVER UPLOADS. §19 says so in as many
 *    words. There is no server-side draft, no autosave request, and the text is
 *    written to [DraftStore] on every change so that closing the composer,
 *    switching language (which recreates the activity), or losing the process
 *    all leave the words intact.
 *
 * 4. THE COUNT IS IN GRAPHEMES (BR-012). 3,000 grapheme clusters, so an Urdu
 *    post is not charged for diacritics a reader never sees. Past the limit the
 *    counter turns error and Post is disabled — it is not truncated, because
 *    silently cutting somebody's sentence is worse than refusing to send it.
 *
 * A SUSPENDED ACCOUNT NEVER REACHES THIS SCREEN. The Create control opens the
 * suspension explainer instead (BR-034, §6.2), so there is no capability check
 * here — a composer that opens and then refuses on submit is precisely the
 * defect that rule prevents.
 */
class ComposerViewModel(
    private val posts: PostSource,
    private val images: ImageSource,
    private val drafts: DraftStore,
) : ViewModel() {

    private val _state = MutableStateFlow(
        // Read synchronously so the first frame already has the words in it. A
        // draft that appeared a moment after the screen opened would look like
        // the app had typed something.
        ComposerUiState(body = drafts.read().orEmpty()),
    )
    val state: StateFlow<ComposerUiState> = _state.asStateFlow()

    init {
        loadCategories()
    }

    fun onBodyChanged(value: String) {
        // Written on every keystroke rather than on a timer. A debounce would
        // be cheaper and would lose the last few words to a process death,
        // which is the only case the draft exists for.
        drafts.write(value)
        _state.update {
            it.copy(body = value, failure = null, fieldError = null)
        }
    }

    /** POST-FR-006 — one of eleven, and skipping is free. */
    fun onCategoryChanged(slug: String?) {
        _state.update { it.copy(categorySlug = slug) }
    }

    /**
     * POST-FR-006's eleven categories (BR-017).
     *
     * Both names arrive in one response so either language renders without a
     * second call. A failure is SILENT: the category control simply has nothing
     * to offer, and choosing a category is optional — putting an error on the
     * composer because a nice-to-have list did not load would block a post that
     * is otherwise ready to publish.
     */
    private fun loadCategories() {
        viewModelScope.launch {
            when (val result = posts.categories()) {
                is ApiResult.Ok -> _state.update { it.copy(categories = result.value) }
                is ApiResult.Err -> Unit
            }
        }
    }

    /**
     * Images chosen from the picker (POST-FR-003 · BR-013).
     *
     * The list is CAPPED at what remains of the four before anything is read.
     * The picker is already told the remaining count, so this is the belt to
     * that braces — and it truncates rather than refusing the whole selection,
     * because somebody who picked five images meant to add images.
     */
    fun onImagesPicked(uris: List<String>) {
        val room = MAX_IMAGES_PER_POST - _state.value.attachments.size
        if (room <= 0) {
            _state.update { it.copy(attachmentLimitReached = true) }
            return
        }

        val accepted = uris.take(room)
        if (accepted.size < uris.size) {
            _state.update { it.copy(attachmentLimitReached = true) }
        }

        accepted.forEach { uri -> addAttachment(uri) }
    }

    private fun addAttachment(uri: String) {
        val localId = nextLocalId()

        _state.update {
            it.copy(
                attachments = it.attachments + Attachment(
                    localId = localId,
                    thumbnailUri = uri,
                    state = AttachmentState.Pending,
                ),
            )
        }

        viewModelScope.launch {
            // Read and compressed off the main thread. `null` means the file
            // cannot be used at all — unreadable, or no quality step reached
            // the 500KB ceiling — and neither is retryable, so it lands in
            // Rejected rather than Failed.
            val picked = images.read(uri)
            if (picked == null) {
                updateAttachment(localId) {
                    it.copy(
                        state = AttachmentState.Rejected(reason = null),
                        image = null,
                    )
                }
                return@launch
            }

            updateAttachment(localId) { it.copy(image = picked) }
            uploadAttachment(localId)
        }
    }

    /**
     * Upload one attachment.
     *
     * ADR-013's three steps live in `ImageUploader`; this is the state machine
     * around them. Progress is reported as a coarse value rather than a byte
     * count, because the uploader hands OkHttp a whole request body and there
     * is no per-chunk callback — a fabricated smooth bar would be a lie, and a
     * bar that jumps from nothing to done is honest about what is known.
     */
    private fun uploadAttachment(localId: String) {
        val attachment = _state.value.attachments.find { it.localId == localId } ?: return
        val image = attachment.image ?: return

        updateAttachment(localId) { it.copy(state = AttachmentState.Uploading()) }

        viewModelScope.launch {
            when (val result = posts.uploadImage(image.bytes)) {
                is UploadResult.Ok -> updateAttachment(localId) {
                    it.copy(
                        state = AttachmentState.Ready(result.mediaId),
                        // The bytes are dropped. A Ready attachment is never
                        // re-uploaded, so holding 500KB per image for the life
                        // of the composer would be heap spent on nothing.
                        image = null,
                    )
                }

                // Transient. The bytes are KEPT, which is what makes the retry
                // possible without reopening the picker (EDGE-013).
                UploadResult.Failed -> updateAttachment(localId) {
                    it.copy(state = AttachmentState.Failed)
                }

                // The server inspected the file and refused it. Retrying the
                // same bytes would be refused again, so they are dropped along
                // with the offer.
                is UploadResult.Rejected -> updateAttachment(localId) {
                    it.copy(state = AttachmentState.Rejected(result.reason), image = null)
                }
            }
        }
    }

    /**
     * EDGE-013's acceptance criterion, as a method.
     *
     * Retries ONE attachment. Reaching a succeeded one is impossible: the guard
     * requires [Attachment.canRetry], which only a [AttachmentState.Failed] one
     * satisfies, and a [AttachmentState.Ready] one has no bytes left to send.
     */
    fun retryAttachment(localId: String) {
        val attachment = _state.value.attachments.find { it.localId == localId } ?: return
        if (!attachment.canRetry) return
        if (attachment.image == null) return
        uploadAttachment(localId)
    }

    /**
     * Remove one attachment, whatever state it is in.
     *
     * Always allowed, including mid-upload. An attachment the user has decided
     * against should not have to finish uploading first — the media row is left
     * in quarantine and the server's own sweep collects it, which is why
     * quarantine exists.
     */
    fun removeAttachment(localId: String) {
        _state.update {
            it.copy(
                attachments = it.attachments.filterNot { a -> a.localId == localId },
                attachmentLimitReached = false,
            )
        }
    }

    fun onLimitAcknowledged() = _state.update { it.copy(attachmentLimitReached = false) }

    /** POST-FR-001. Gated on every attachment being ready — see the class comment. */
    fun publish() {
        val current = _state.value
        if (!current.canPost) return

        _state.update { it.copy(publishing = true, failure = null, fieldError = null) }

        viewModelScope.launch {
            val result = posts.create(
                body = current.body.trim(),
                categorySlug = current.categorySlug,
                mediaIds = current.attachments.readyMediaIds(),
            )

            _state.update { s ->
                when (result) {
                    is ApiResult.Ok -> {
                        // The draft is cleared only NOW. Clearing it optimistically
                        // and then failing would lose the words to a dropped
                        // connection, which is exactly what EDGE-011 forbids.
                        drafts.clear()
                        s.copy(publishing = false, published = result.value)
                    }

                    is ApiResult.Err -> s.copy(
                        publishing = false,
                        failure = result.failure,
                        fieldError = bodyFieldError(result.failure),
                    )
                }
            }
        }
    }

    /**
     * The ✕ control (§19 — "✕ warns before discarding").
     *
     * Returns whether there is anything to lose, so the screen knows whether to
     * warn. A confirmation dialog over an empty composer is a dialog that
     * teaches people to dismiss dialogs.
     */
    fun hasUnsavedWork(): Boolean = _state.value.let {
        it.body.isNotBlank() || it.attachments.isNotEmpty()
    }

    /**
     * Discard deliberately.
     *
     * The ONLY path that clears the draft without publishing, and it is reached
     * only through an explicit confirmation. Merely leaving the composer keeps
     * the draft — §19's "draft persists locally" is about surviving everything
     * except an intentional discard.
     */
    fun discard() {
        drafts.clear()
        _state.update { ComposerUiState(categories = it.categories) }
    }

    private fun updateAttachment(localId: String, transform: (Attachment) -> Attachment) {
        _state.update { s ->
            s.copy(
                attachments = s.attachments.map {
                    if (it.localId == localId) transform(it) else it
                },
            )
        }
    }

    private var localIdCounter = 0

    /**
     * A local identity for an attachment.
     *
     * A counter rather than a UUID or the URI: the same photo can legitimately
     * be attached twice, and keying on the URI would make the second one
     * collide with the first in a `LazyRow` — which crashes the list rather
     * than merely looking wrong.
     */
    private fun nextLocalId(): String = "attachment-${localIdCounter++}"

    class Factory(
        private val posts: PostSource,
        private val images: ImageSource,
        private val drafts: DraftStore,
    ) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(
            modelClass: Class<T>,
            extras: CreationExtras,
        ): T = ComposerViewModel(posts, images, drafts) as T
    }
}

data class ComposerUiState(
    val body: String = "",
    val categorySlug: String? = null,
    val categories: List<CategoryResponse> = emptyList(),

    /** In the order they were chosen (POST-FR-003). */
    val attachments: List<Attachment> = emptyList(),

    /** BR-013 — a fifth image was offered and refused. */
    val attachmentLimitReached: Boolean = false,

    val publishing: Boolean = false,
    val published: PostResponse? = null,

    val failure: ApiFailure? = null,
    /** A server complaint about the body specifically, shown under the field. */
    val fieldError: String? = null,
) {
    /** BR-012 — grapheme clusters, so Urdu is not penalised. */
    val graphemeCount: Int get() = graphemeLength(body.trim())

    val isOverLimit: Boolean get() = graphemeCount > BODY_MAX_GRAPHEMES

    val remainingImages: Int get() = MAX_IMAGES_PER_POST - attachments.size

    /**
     * §19 — "Post disabled until text or an attachment exists."
     *
     * EITHER is enough, which matches the API: "text is optional when an
     * attachment is present". A photo of a blocked drain with no caption is a
     * complete report.
     */
    val hasContent: Boolean get() = body.isNotBlank() || attachments.isNotEmpty()

    /**
     * Whether Post is offered.
     *
     * Four conditions, and the third is the one that carries EDGE-011: nothing
     * may be in flight or failed, because a post published over an unfinished
     * upload would silently lose the image.
     */
    val canPost: Boolean
        get() = hasContent &&
            !isOverLimit &&
            attachments.allSettledAndReady() &&
            !publishing

    /**
     * Why Post is disabled, when the reason is not obvious from the screen.
     *
     * An attachment that failed shows its own retry control, so the composer
     * does not repeat it — but "one image is still uploading" is invisible
     * otherwise, and a disabled button with no explanation is the thing §13
     * calls out.
     */
    val postBlockedReason: PostBlockedReason?
        get() = when {
            !hasContent -> null
            isOverLimit -> PostBlockedReason.TOO_LONG
            attachments.any { it.isBusy } -> PostBlockedReason.UPLOAD_IN_PROGRESS
            attachments.any { it.state is AttachmentState.Failed } ->
                PostBlockedReason.UPLOAD_FAILED
            attachments.any { it.state is AttachmentState.Rejected } ->
                PostBlockedReason.UPLOAD_REJECTED
            else -> null
        }
}

enum class PostBlockedReason {
    TOO_LONG,
    UPLOAD_IN_PROGRESS,
    UPLOAD_FAILED,
    UPLOAD_REJECTED,
}

/** BR-012 — 3,000 grapheme clusters. */
const val BODY_MAX_GRAPHEMES = 3000

/**
 * The server's complaint about the body, if it made one.
 *
 * Only `body` is read. A validation failure naming another path is a contract
 * mismatch rather than something to show under the text field, and putting an
 * unrecognised message there would label the user's writing with a fault that
 * is not in it.
 */
private fun bodyFieldError(failure: ApiFailure): String? =
    (failure as? ApiFailure.Validation)?.fieldErrors?.get("body")
