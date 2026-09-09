package org.shehersaaz.mohalla.feature.post

import org.shehersaaz.mohalla.core.network.ApiResult
import org.shehersaaz.mohalla.core.network.CommentBody
import org.shehersaaz.mohalla.core.network.CommentResponse
import org.shehersaaz.mohalla.feature.home.FeedCursor
import org.shehersaaz.mohalla.core.network.MohallaApi
import org.shehersaaz.mohalla.core.network.PostResponse
import org.shehersaaz.mohalla.core.network.apiCall
import org.shehersaaz.mohalla.core.network.map

/**
 * The post detail screen's network surface
 * (POST-FR-007/009 · ENGAGE-FR-001…005).
 *
 * An interface for the reason the other three are: the defects worth catching
 * here are sequences. A comment refused because the post was deleted while it
 * was being written must keep the typed text (ENGAGE-FR-002's error case); a
 * reply aimed at a nested reply must attach to the thread parent (BR-033); a
 * comment deleted by the post's author must take its replies with it
 * (ENGAGE-FR-004). None of those is visible in a single call.
 */
interface PostDetailSource {
    suspend fun post(postId: String): ApiResult<PostResponse>

    suspend fun comments(postId: String, cursor: FeedCursor? = null): ApiResult<CommentPage>

    suspend fun addComment(postId: String, body: String): ApiResult<CommentResponse>

    suspend fun addReply(parentCommentId: String, body: String): ApiResult<CommentResponse>

    suspend fun deleteComment(commentId: String): ApiResult<Unit>

    suspend fun like(postId: String): ApiResult<Unit>

    suspend fun unlike(postId: String): ApiResult<Unit>

    suspend fun deletePost(postId: String): ApiResult<Unit>

    /**
     * FEED-FR-007 — private, idempotent, and silent.
     *
     * "Saving is private and generates no notification to the author", so this
     * pair is as safe to call twice as the like pair is, and there is no
     * response body to read: the routes return 204 either way.
     */
    suspend fun save(postId: String): ApiResult<Unit>

    suspend fun unsave(postId: String): ApiResult<Unit>
}

class PostDetailRepository(
    private val api: MohallaApi,
) : PostDetailSource {

    override suspend fun post(postId: String): ApiResult<PostResponse> =
        apiCall { api.post(postId) }

    override suspend fun save(postId: String): ApiResult<Unit> =
        apiCall { api.savePost(postId) }.map { }

    override suspend fun unsave(postId: String): ApiResult<Unit> =
        apiCall { api.unsavePost(postId) }.map { }

    /**
     * ENGAGE-FR-002 — oldest first, twenty at a time.
     *
     * THE ONLY OTHER ASCENDING LIST IN THE PRODUCT, alongside upcoming events,
     * and for a different reason: a thread is a conversation, and reading it
     * newest-first puts replies before what they reply to.
     *
     * The cursor shape is the FEED'S (`createdAt`, `id`), not the events one —
     * the comments endpoint returns `nextCursor: {createdAt, id}` where events
     * return `{cursorStartsAt, cursorId}`. Two shapes for the same idea is the
     * API's inconsistency rather than a choice made here, and reusing the wrong
     * type would page in the wrong direction.
     */
    override suspend fun comments(
        postId: String,
        cursor: FeedCursor?,
    ): ApiResult<CommentPage> = apiCall {
        api.comments(
            id = postId,
            limit = COMMENT_PAGE_SIZE,
            cursorCreatedAt = cursor?.createdAt,
            cursorId = cursor?.id,
        )
    }.map { response ->
        CommentPage(
            comments = response.comments,
            nextCursor = response.nextCursor?.let { FeedCursor(it.createdAt, it.id) },
        )
    }

    override suspend fun addComment(
        postId: String,
        body: String,
    ): ApiResult<CommentResponse> = apiCall {
        api.addComment(postId, CommentBody(body = body.trim()))
    }

    override suspend fun addReply(
        parentCommentId: String,
        body: String,
    ): ApiResult<CommentResponse> = apiCall {
        api.addReply(parentCommentId, CommentBody(body = body.trim()))
    }

    override suspend fun deleteComment(commentId: String): ApiResult<Unit> =
        apiCall { api.deleteComment(commentId) }.map { }

    override suspend fun like(postId: String): ApiResult<Unit> =
        apiCall { api.like(postId) }.map { }

    override suspend fun unlike(postId: String): ApiResult<Unit> =
        apiCall { api.unlike(postId) }.map { }

    /**
     * POST-FR-007 — permanent, and not user-reversible.
     *
     * "The post, its comments, its likes and its attachments are removed."
     * BR-014 adds that an administrator cannot restore a user-deleted post
     * either, which is why the screen's confirmation says so plainly rather
     * than implying anything is recoverable.
     */
    override suspend fun deletePost(postId: String): ApiResult<Unit> =
        apiCall { api.deletePost(postId) }.map { }

    companion object {
        /**
         * Twenty comments a page.
         *
         * The same page size as the feed, and for the same 3G reason
         * (NFR-PERF-001) — but it matters less here, because a thread is read
         * top to bottom and the reader is already past the post by the time the
         * second page is needed.
         */
        const val COMMENT_PAGE_SIZE = 20
    }
}

data class CommentPage(
    val comments: List<CommentResponse>,
    /** `null` means the end. Not the same as an empty page. */
    val nextCursor: FeedCursor?,
)

/**
 * The flat comment list, nested exactly one level (BR-033).
 *
 * THE SERVER SENDS A FLAT LIST and this is where it becomes a thread. Nesting
 * is done on the client because one level is the whole rule — a server sending
 * a tree would have to decide how to paginate branches, and a single flat page
 * ordered oldest-first has everything needed.
 *
 * A REPLY WHOSE PARENT IS NOT ON THIS PAGE IS PROMOTED TO TOP LEVEL rather than
 * dropped. It can happen: the parent may have been deleted between pages, or
 * sit on a later page. Dropping it would silently lose somebody's words, and
 * showing it at the top level is a small ordering oddity next to that.
 */
fun List<CommentResponse>.threaded(): List<CommentThread> {
    val topLevel = filter { it.parentCommentId == null }
    val topLevelIds = topLevel.mapTo(mutableSetOf()) { it.id }

    val repliesByParent = filter { it.parentCommentId != null }
        .groupBy { it.parentCommentId }

    val threads = topLevel.map { parent ->
        CommentThread(
            comment = parent,
            // Oldest first within a thread too, which is the order the server
            // already sent them in — so this preserves rather than sorts.
            replies = repliesByParent[parent.id].orEmpty(),
        )
    }

    // Orphans: a reply whose parent is missing from this page.
    val orphans = filter { it.parentCommentId != null && it.parentCommentId !in topLevelIds }
        .map { CommentThread(comment = it, replies = emptyList()) }

    return (threads + orphans).sortedBy { it.comment.createdAt }
}

data class CommentThread(
    val comment: CommentResponse,
    /** One level deep, and never more (BR-033). */
    val replies: List<CommentResponse>,
) {
    /** Everything that disappears if this thread's parent is deleted. */
    val size: Int get() = 1 + replies.size
}
