package org.shehersaaz.mohalla.feature.post

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import org.shehersaaz.mohalla.core.network.ApiFailure
import org.shehersaaz.mohalla.core.network.ApiResult
import org.shehersaaz.mohalla.core.network.CommentResponse
import org.shehersaaz.mohalla.core.network.FeedItemResponse
import org.shehersaaz.mohalla.core.network.PostResponse
import org.shehersaaz.mohalla.feature.home.FeedCursor
import org.shehersaaz.mohalla.feature.setup.graphemeLength

/**
 * Post detail — UX-HOME-003
 * (POST-FR-007/009 · ENGAGE-FR-001…006 · BR-033).
 *
 * FIVE RULES SHAPE THIS FILE.
 *
 * 1. THE POST RENDERS FROM CACHE INSTANTLY; ONLY COMMENTS LOAD. §19 says so in
 *    those words. The reader has just been looking at this card, so a spinner
 *    where the post was is the app forgetting something it knew. The cached copy
 *    fills the first frame and the real one replaces it when it lands — and
 *    nothing decides anything from the cached version, which can be stale in
 *    every field.
 *
 * 2. A COMMENT REFUSED KEEPS ITS TEXT. ENGAGE-FR-002's error case is exact:
 *    "post deleted while composing → submission refused with a clear
 *    explanation and the text preserved for copying", and its acceptance
 *    criterion is that "the typed text is not lost". So the draft is cleared
 *    only on success, and a refusal leaves it in the field.
 *
 * 3. REPLIES NEST EXACTLY ONE LEVEL (BR-033). Replying to a reply targets the
 *    same THREAD PARENT rather than being refused — the intent is obvious, and
 *    the server would attach it there anyway.
 *
 * 4. LIKES ARE OPTIMISTIC AND REVERT. ENGAGE-FR-001: "network failure → the
 *    interface reverts to the true server state rather than showing an
 *    optimistic value indefinitely." The like endpoints return no body, so an
 *    optimistic increment is the only way to show the change at all.
 *
 * 5. A POST THAT GOES AWAY WHILE OPEN BECOMES THE NEUTRAL STATE, not an error.
 *    POST-FR-009: an auto-hidden or deleted post "returns a not-available state
 *    on the next interaction". Deleted, hidden past the threshold, blocked
 *    author and never-existed are one answer (BR-025), and the screen says
 *    nothing about which.
 */
class PostDetailViewModel(
    private val source: PostDetailSource,
    private val postId: String,
    /** The feed's copy, for the first frame. Null when arriving by deep link. */
    cached: FeedItemResponse?,
    private val viewerId: () -> String?,
    /** Called when the server says the post is gone, so the cache stops serving it. */
    private val onUnavailable: (String) -> Unit,
) : ViewModel() {

    private val _state = MutableStateFlow(
        PostDetailUiState(
            post = cached?.toPost(),
            // A cached post is not a loaded one. `loadingPost` stays false
            // because there is something to render; `postConfirmed` stays false
            // because what is rendered has not been verified.
            loadingPost = cached == null,
            loadingComments = true,
        ),
    )
    val state: StateFlow<PostDetailUiState> = _state.asStateFlow()

    init {
        refreshPost()
        loadComments()
    }

    /**
     * Fetch the real post.
     *
     * Runs alongside the comment load rather than before it — the two are
     * independent, and making comments wait on the post would double the time
     * to a readable thread on a connection where each round trip is expensive.
     */
    fun refreshPost() {
        viewModelScope.launch {
            when (val result = source.post(postId)) {
                is ApiResult.Ok -> _state.update {
                    it.copy(
                        post = result.value,
                        loadingPost = false,
                        postConfirmed = true,
                        isMine = result.value.author.userId == viewerId(),
                        unavailable = false,
                    )
                }

                is ApiResult.Err -> {
                    if (result.failure is ApiFailure.Unavailable) {
                        // The post is gone. The cached copy must stop being
                        // served, or "renders instantly" would keep showing a
                        // withdrawn post for the life of the process.
                        onUnavailable(postId)
                        _state.update {
                            it.copy(
                                loadingPost = false,
                                post = null,
                                unavailable = true,
                            )
                        }
                    } else {
                        _state.update {
                            it.copy(loadingPost = false, postFailure = result.failure)
                        }
                    }
                }
            }
        }
    }

    fun loadComments() {
        _state.update { it.copy(loadingComments = it.comments.isEmpty(), commentsFailure = null) }

        viewModelScope.launch {
            when (val result = source.comments(postId, cursor = null)) {
                is ApiResult.Ok -> _state.update {
                    it.copy(
                        comments = result.value.comments,
                        commentsCursor = result.value.nextCursor,
                        commentsLoaded = true,
                        loadingComments = false,
                    )
                }

                is ApiResult.Err -> _state.update {
                    it.copy(
                        loadingComments = false,
                        // Kept separate from an empty thread, exactly as the
                        // feed keeps a failure separate from an empty feed:
                        // "no comments yet" after a timeout invites somebody to
                        // start a conversation that may already be happening.
                        commentsFailure = result.failure,
                    )
                }
            }
        }
    }

    fun loadMoreComments() {
        val current = _state.value
        val cursor = current.commentsCursor ?: return
        if (current.loadingMoreComments) return

        _state.update { it.copy(loadingMoreComments = true) }

        viewModelScope.launch {
            when (val result = source.comments(postId, cursor)) {
                is ApiResult.Ok -> _state.update { s ->
                    s.copy(
                        // De-duplicated by id: a comment added between pages
                        // can appear twice, and a duplicate key crashes a
                        // LazyColumn.
                        comments = s.comments + result.value.comments.filterNot { incoming ->
                            s.comments.any { it.id == incoming.id }
                        },
                        commentsCursor = result.value.nextCursor,
                        loadingMoreComments = false,
                    )
                }

                is ApiResult.Err -> _state.update {
                    it.copy(loadingMoreComments = false, commentsFailure = result.failure)
                }
            }
        }
    }

    // ------------------------------------------------------------------- like
    /**
     * ENGAGE-FR-001, and the acceptance criterion is about rapid taps.
     *
     * "GIVEN a user taps like 6 times rapidly, WHEN the requests settle, THEN
     * the like count has changed by at most one." The server guarantees that
     * through its composite key; the guard here is about the VISIBLE state,
     * because two requests racing would leave the screen showing whichever
     * landed last rather than what the reader chose.
     *
     * BR-031 — a user may like their own post, so there is no author check.
     */
    fun toggleLike() {
        val post = _state.value.post ?: return
        if (_state.value.likeInFlight) return

        val wasLiked = post.viewerHasLiked

        _state.update {
            it.copy(
                likeInFlight = true,
                likeReverted = false,
                post = post.copy(
                    viewerHasLiked = !wasLiked,
                    likeCount = (post.likeCount + if (wasLiked) -1 else 1).coerceAtLeast(0),
                ),
            )
        }

        viewModelScope.launch {
            val result = if (wasLiked) source.unlike(postId) else source.like(postId)

            _state.update { s ->
                when (result) {
                    is ApiResult.Ok -> s.copy(likeInFlight = false)

                    is ApiResult.Err -> s.copy(
                        likeInFlight = false,
                        // Reverted. A filled heart on a like the server refused
                        // tells the reader something untrue about their own
                        // action.
                        post = s.post?.copy(
                            viewerHasLiked = wasLiked,
                            likeCount = (s.post.likeCount + if (wasLiked) 1 else -1)
                                .coerceAtLeast(0),
                        ),
                        likeReverted = true,
                    )
                }
            }
        }
    }

    fun onLikeRevertAcknowledged() = _state.update { it.copy(likeReverted = false) }

    // --------------------------------------------------------------- comments
    fun onDraftChanged(value: String) {
        _state.update { it.copy(draft = value, commentFailure = null) }
    }

    /**
     * Aim the composer at a comment (ENGAGE-FR-003).
     *
     * BR-033 — ONE LEVEL ONLY. Replying to a reply targets that reply's THREAD
     * PARENT, not the reply itself: the intent is obvious, the server attaches
     * it to the parent thread anyway, and a client that sent the reply's own id
     * would be relying on the server to correct it. Passing null clears the
     * reply target and returns the composer to the post.
     */
    fun replyTo(comment: CommentResponse?) {
        val target = when {
            comment == null -> null
            // Already top level.
            comment.parentCommentId == null -> comment
            // A reply. Aim at its parent instead, if the parent is on screen —
            // and at the reply's stated parent id regardless, because that is
            // the thread.
            else -> _state.value.comments.find { it.id == comment.parentCommentId } ?: comment
        }

        _state.update {
            it.copy(
                replyTarget = target,
                // The reply's parent id if the target is itself a reply whose
                // parent is off-page: still one level, never two.
                replyParentId = target?.parentCommentId ?: target?.id,
            )
        }
    }

    /**
     * Submit the draft (ENGAGE-FR-002/003).
     *
     * THE DRAFT IS CLEARED ONLY ON SUCCESS. That is the requirement's error
     * case, not politeness: "post deleted while composing → submission refused
     * with a clear explanation and the text preserved for copying".
     */
    fun submitComment() {
        val current = _state.value
        if (!current.canComment) return

        val body = current.draft.trim()
        val parentId = current.replyParentId

        _state.update { it.copy(commentInFlight = true, commentFailure = null) }

        viewModelScope.launch {
            val result = if (parentId == null) {
                source.addComment(postId, body)
            } else {
                source.addReply(parentId, body)
            }

            _state.update { s ->
                when (result) {
                    is ApiResult.Ok -> s.copy(
                        commentInFlight = false,
                        // Appended rather than re-fetched: the thread is
                        // oldest-first, so a new comment belongs at the end and
                        // reloading twenty rows to learn that would cost a
                        // round trip to move the reader's scroll position.
                        comments = s.comments + result.value,
                        draft = "",
                        replyTarget = null,
                        replyParentId = null,
                        // The post's own count moves too, so the engagement row
                        // does not disagree with the thread below it.
                        post = s.post?.copy(commentCount = s.post.commentCount + 1),
                    )

                    is ApiResult.Err -> s.copy(
                        commentInFlight = false,
                        // The TEXT STAYS. Whatever went wrong, the words are
                        // still in the field and can be copied out.
                        commentFailure = result.failure,
                        // A 404 here means the post went away while the comment
                        // was being written — the requirement's named case. The
                        // screen reports it and keeps the draft.
                        unavailable = result.failure is ApiFailure.Unavailable,
                    )
                }
            }

            if (result is ApiResult.Err && result.failure is ApiFailure.Unavailable) {
                onUnavailable(postId)
            }
        }
    }

    fun onCommentFailureAcknowledged() = _state.update { it.copy(commentFailure = null) }

    /**
     * Delete a comment (ENGAGE-FR-004/005).
     *
     * TWO PEOPLE MAY DO IT: the comment's author, and the POST'S author
     * (BR-020, "which distributes moderation away from administrators"). The
     * server enforces both and answers a neutral 404 to anybody else, so a
     * third party cannot probe who wrote what.
     *
     * REPLIES GO WITH IT. ENGAGE-FR-004's acceptance criterion: "GIVEN a comment
     * with 3 replies, WHEN the comment author deletes it, THEN the replies are
     * removed with it." The server does that; this mirrors it locally rather
     * than re-fetching, so the thread does not briefly show orphaned replies.
     */
    fun deleteComment(comment: CommentResponse) {
        if (comment.id in _state.value.deletingComments) return

        _state.update { it.copy(deletingComments = it.deletingComments + comment.id) }

        viewModelScope.launch {
            when (source.deleteComment(comment.id)) {
                is ApiResult.Ok -> _state.update { s ->
                    // Whatever the parent took with it.
                    val removedIds = buildSet {
                        add(comment.id)
                        if (comment.parentCommentId == null) {
                            s.comments.filter { it.parentCommentId == comment.id }
                                .forEach { add(it.id) }
                        }
                    }

                    s.copy(
                        comments = s.comments.filterNot { it.id in removedIds },
                        deletingComments = s.deletingComments - comment.id,
                        post = s.post?.copy(
                            commentCount = (s.post.commentCount - removedIds.size)
                                .coerceAtLeast(0),
                        ),
                        // If the composer was aimed at what just went away,
                        // return it to the post rather than leaving it pointed
                        // at nothing.
                        replyTarget = s.replyTarget?.takeIf { it.id !in removedIds },
                        replyParentId = s.replyParentId?.takeIf { it !in removedIds },
                    )
                }

                is ApiResult.Err -> _state.update {
                    // Nothing is removed on failure. A comment that vanished
                    // and came back would be worse than one that never moved.
                    it.copy(deletingComments = it.deletingComments - comment.id)
                }
            }
        }
    }

    /** Whether the viewer may delete this comment (ENGAGE-FR-004/005). */
    fun canDelete(comment: CommentResponse): Boolean {
        val viewer = viewerId() ?: return false
        return comment.author.userId == viewer || _state.value.post?.author?.userId == viewer
    }

    // ------------------------------------------------------------------ post
    /**
     * POST-FR-007 — delete the post.
     *
     * Permanent and not user-reversible (BR-014): the post, its comments, its
     * likes and its attachments all go, and an administrator cannot restore it
     * either. Only offered to the author, and the confirmation says what is
     * lost rather than implying anything can be recovered.
     */
    fun deletePost() {
        if (!_state.value.isMine || _state.value.deletingPost) return

        _state.update { it.copy(deletingPost = true) }

        viewModelScope.launch {
            when (val result = source.deletePost(postId)) {
                is ApiResult.Ok -> {
                    onUnavailable(postId)
                    _state.update { it.copy(deletingPost = false, deleted = true) }
                }

                is ApiResult.Err -> _state.update {
                    it.copy(deletingPost = false, postFailure = result.failure)
                }
            }
        }
    }

    class Factory(
        private val source: PostDetailSource,
        private val postId: String,
        private val cached: FeedItemResponse?,
        private val viewerId: () -> String?,
        private val onUnavailable: (String) -> Unit,
    ) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T =
            PostDetailViewModel(source, postId, cached, viewerId, onUnavailable) as T
    }
}

data class PostDetailUiState(
    val post: PostResponse? = null,

    /**
     * `true` once the server's own copy has arrived.
     *
     * Distinct from `post != null`, which a cached copy also satisfies. Nothing
     * irreversible is offered until the real post is confirmed — deleting a post
     * on the strength of a cached author id would be acting on a guess.
     */
    val postConfirmed: Boolean = false,

    val isMine: Boolean = false,

    val comments: List<CommentResponse> = emptyList(),
    val commentsCursor: FeedCursor? = null,
    val commentsLoaded: Boolean = false,

    val loadingPost: Boolean = false,
    val loadingComments: Boolean = false,
    val loadingMoreComments: Boolean = false,

    /** UX-STATE-001. Deleted, hidden, blocked or never there — one answer. */
    val unavailable: Boolean = false,
    val postFailure: ApiFailure? = null,
    val commentsFailure: ApiFailure? = null,

    val likeInFlight: Boolean = false,
    val likeReverted: Boolean = false,

    val draft: String = "",
    val replyTarget: CommentResponse? = null,
    val replyParentId: String? = null,
    val commentInFlight: Boolean = false,
    val commentFailure: ApiFailure? = null,

    val deletingComments: Set<String> = emptySet(),
    val deletingPost: Boolean = false,
    val deleted: Boolean = false,
) {
    /** BR-033 — nested one level, here rather than on the server. */
    val threads: List<CommentThread> get() = comments.threaded()

    /** ENGAGE-FR-002 — 1,000 grapheme clusters, so Urdu is not penalised. */
    val draftLength: Int get() = graphemeLength(draft.trim())

    val draftOverLimit: Boolean get() = draftLength > COMMENT_MAX_GRAPHEMES

    val canComment: Boolean
        get() = draft.isNotBlank() && !draftOverLimit && !commentInFlight && !unavailable

    /**
     * Genuinely no comments — an invitation, not a failure.
     *
     * §21's copy: "Start the conversation / No comments yet. Ask a question or
     * add what you know", with the comment field auto-focused. Requires
     * `commentsLoaded` and no failure, for the same reason the feed's empty
     * state does: a timeout rendered as "no comments" invites somebody to start
     * a conversation that may already be under way.
     */
    val isEmptyThread: Boolean
        get() = commentsLoaded && comments.isEmpty() && commentsFailure == null

    /**
     * Deleting is offered only once the post is confirmed to be the viewer's.
     *
     * A cached copy is enough to RENDER but not enough to act irreversibly on.
     */
    val canDeletePost: Boolean get() = isMine && postConfirmed && !deletingPost
}

/** ENGAGE-FR-002 — "a comment of up to 1,000 characters". */
const val COMMENT_MAX_GRAPHEMES = 1000

/**
 * The feed's copy of a post, as a post.
 *
 * The two types carry the same fields under the same names — the API returns
 * the same projection from the feed routes and from `/posts/{id}` — but they are
 * separate Kotlin types, so the first frame needs this conversion. Written out
 * field by field rather than reflected, so adding a field to one and not the
 * other fails to compile here instead of silently rendering a default.
 *
 * (A literal `/feed/` glob in this comment is deliberately avoided: Kotlin block
 * comments NEST, so a slash-star inside a KDoc opens a comment that never closes
 * and silently swallows the rest of the file.)
 */
private fun FeedItemResponse.toPost() = PostResponse(
    id = id,
    author = author,
    body = body,
    categorySlug = categorySlug,
    mediaIds = mediaIds,
    likeCount = likeCount,
    commentCount = commentCount,
    viewerHasLiked = viewerHasLiked,
    editedAt = editedAt,
    createdAt = createdAt,
    underReview = underReview,
)
