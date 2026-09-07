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
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.shehersaaz.mohalla.core.network.ApiFailure
import org.shehersaaz.mohalla.core.network.ApiResult
import org.shehersaaz.mohalla.core.network.CommentResponse
import org.shehersaaz.mohalla.core.network.FeedItemResponse
import org.shehersaaz.mohalla.core.network.PostResponse
import org.shehersaaz.mohalla.core.network.PublicProfileResponse
import org.shehersaaz.mohalla.feature.home.FeedCursor
import org.shehersaaz.mohalla.feature.post.COMMENT_MAX_GRAPHEMES
import org.shehersaaz.mohalla.feature.post.CommentPage
import org.shehersaaz.mohalla.feature.post.PostDetailSource
import org.shehersaaz.mohalla.feature.post.PostDetailViewModel
import org.shehersaaz.mohalla.feature.post.threaded

/**
 * Post detail and engagement (POST-FR-007/009 · ENGAGE-FR-001…006 · BR-033).
 *
 * THE THREE ASSERTIONS THAT MATTER MOST HERE, all of them requirement text
 * rather than judgement:
 *
 *   - A refused comment KEEPS ITS TEXT. ENGAGE-FR-002's acceptance criterion is
 *     "the typed text is not lost", and its named cause is the post being
 *     deleted while the comment was being written.
 *   - Replies nest EXACTLY ONE LEVEL (BR-033), and a reply aimed at a reply
 *     attaches to the same thread rather than making a third level.
 *   - Deleting a comment takes its replies with it (ENGAGE-FR-004).
 */
@OptIn(ExperimentalCoroutinesApi::class)
class PostDetailTest {

    private val dispatcher = StandardTestDispatcher()

    @Before fun setUp() = Dispatchers.setMain(dispatcher)

    @After fun tearDown() = Dispatchers.resetMain()

    private fun profile(id: String, name: String = "Ayesha") =
        PublicProfileResponse(userId = id, displayName = name)

    private fun post(
        id: String = "p1",
        authorId: String = "author",
        likes: Int = 4,
        liked: Boolean = false,
        comments: Int = 0,
    ) = PostResponse(
        id = id,
        author = profile(authorId),
        body = "The drain on Nishtar Road has been blocked for three weeks.",
        likeCount = likes,
        commentCount = comments,
        viewerHasLiked = liked,
        createdAt = "2026-09-01T10:00:00Z",
    )

    private fun comment(
        id: String,
        authorId: String = "commenter",
        parent: String? = null,
        at: String = "2026-09-01T11:00:00Z",
    ) = CommentResponse(
        id = id,
        postId = "p1",
        author = profile(authorId),
        parentCommentId = parent,
        body = "Comment $id",
        createdAt = at,
    )

    private class Script(
        var postResult: ApiResult<PostResponse>,
        val commentPages: MutableList<ApiResult<CommentPage>> = mutableListOf(),
        var commentResult: ApiResult<CommentResponse>? = null,
        var replyResult: ApiResult<CommentResponse>? = null,
        var deleteCommentResult: ApiResult<Unit> = ApiResult.Ok(Unit),
        var likeResult: ApiResult<Unit> = ApiResult.Ok(Unit),
        var deletePostResult: ApiResult<Unit> = ApiResult.Ok(Unit),
    ) : PostDetailSource {
        var likeCalls = 0
        var unlikeCalls = 0
        var deletePostCalls = 0
        val commentBodies = mutableListOf<String>()
        val replyTargets = mutableListOf<String>()
        val deletedCommentIds = mutableListOf<String>()
        val requestedCursors = mutableListOf<FeedCursor?>()

        override suspend fun post(postId: String) = postResult

        override suspend fun comments(postId: String, cursor: FeedCursor?): ApiResult<CommentPage> {
            requestedCursors += cursor
            return commentPages.removeFirstOrNull()
                ?: ApiResult.Ok(CommentPage(emptyList(), null))
        }

        override suspend fun addComment(
            postId: String,
            body: String,
        ): ApiResult<CommentResponse> {
            commentBodies += body
            return commentResult ?: ApiResult.Ok(
                CommentResponse(
                    id = "new",
                    postId = postId,
                    author = PublicProfileResponse(userId = "me", displayName = "Me"),
                    body = body,
                    createdAt = "2026-09-01T12:00:00Z",
                ),
            )
        }

        override suspend fun addReply(
            parentCommentId: String,
            body: String,
        ): ApiResult<CommentResponse> {
            replyTargets += parentCommentId
            commentBodies += body
            return replyResult ?: ApiResult.Ok(
                CommentResponse(
                    id = "new-reply",
                    postId = "p1",
                    author = PublicProfileResponse(userId = "me", displayName = "Me"),
                    parentCommentId = parentCommentId,
                    body = body,
                    createdAt = "2026-09-01T12:00:00Z",
                ),
            )
        }

        override suspend fun deleteComment(commentId: String): ApiResult<Unit> {
            deletedCommentIds += commentId
            return deleteCommentResult
        }

        override suspend fun like(postId: String): ApiResult<Unit> {
            likeCalls++
            return likeResult
        }

        override suspend fun unlike(postId: String): ApiResult<Unit> {
            unlikeCalls++
            return likeResult
        }

        override suspend fun deletePost(postId: String): ApiResult<Unit> {
            deletePostCalls++
            return deletePostResult
        }
    }

    private fun detail(
        script: Script,
        cached: FeedItemResponse? = null,
        viewer: String? = "me",
        forgotten: MutableList<String> = mutableListOf(),
    ) = PostDetailViewModel(
        source = script,
        postId = "p1",
        cached = cached,
        viewerId = { viewer },
        onUnavailable = { forgotten += it },
    )

    // ------------------------------------------------------- the cached frame
    @Test
    fun `A CACHED POST FILLS THE FIRST FRAME WITH NO SPINNER`() = runTest(dispatcher) {
        // §19: "post renders from the feed's cached copy instantly; only
        // comments load". The reader has just been looking at this card, so a
        // spinner where the post was is the app forgetting something it knew.
        val cached = FeedItemResponse(
            id = "p1",
            author = profile("author"),
            body = "Cached body",
            likeCount = 4,
            createdAt = "2026-09-01T10:00:00Z",
        )
        val vm = detail(Script(postResult = ApiResult.Ok(post())), cached = cached)

        // BEFORE any coroutine runs.
        assertNotNull(vm.state.value.post)
        assertFalse(vm.state.value.loadingPost)
        assertEquals("Cached body", vm.state.value.post?.body)
        // But it is not confirmed, so nothing irreversible is offered yet.
        assertFalse(vm.state.value.postConfirmed)
    }

    @Test
    fun `WITHOUT A CACHED POST THE SCREEN LOADS, WHICH IS THE DEEP-LINK CASE`() =
        runTest(dispatcher) {
            val vm = detail(Script(postResult = ApiResult.Ok(post())), cached = null)

            assertNull(vm.state.value.post)
            assertTrue(vm.state.value.loadingPost)

            advanceUntilIdle()
            assertNotNull(vm.state.value.post)
            assertTrue(vm.state.value.postConfirmed)
        }

    @Test
    fun `THE SERVER'S COPY REPLACES THE CACHED ONE`() = runTest(dispatcher) {
        // A cached post can be stale in every field — the count moved, the text
        // was edited — so nothing decides anything from it.
        val cached = FeedItemResponse(
            id = "p1",
            author = profile("author"),
            body = "Stale body",
            likeCount = 1,
            createdAt = "2026-09-01T10:00:00Z",
        )
        val vm = detail(
            Script(postResult = ApiResult.Ok(post(likes = 9))),
            cached = cached,
        )
        advanceUntilIdle()

        assertEquals(9, vm.state.value.post?.likeCount)
        assertTrue(vm.state.value.post!!.body.startsWith("The drain"))
    }

    @Test
    fun `A POST THAT IS GONE IS FORGOTTEN BY THE CACHE`() = runTest(dispatcher) {
        // Otherwise "renders instantly" would keep showing a withdrawn post for
        // the life of the process.
        val forgotten = mutableListOf<String>()
        val cached = FeedItemResponse(
            id = "p1",
            author = profile("author"),
            body = "About to vanish",
            createdAt = "2026-09-01T10:00:00Z",
        )
        val vm = detail(
            Script(postResult = ApiResult.Err(ApiFailure.Unavailable(null))),
            cached = cached,
            forgotten = forgotten,
        )
        advanceUntilIdle()

        assertEquals(listOf("p1"), forgotten)
        assertTrue(vm.state.value.unavailable)
        assertNull(vm.state.value.post)
    }

    @Test
    fun `A TRANSIENT FAILURE KEEPS THE CACHED POST ON SCREEN`() = runTest(dispatcher) {
        // Offline is not "gone". Blanking a post the reader can see because the
        // refresh failed would be worse than showing a slightly stale one.
        val cached = FeedItemResponse(
            id = "p1",
            author = profile("author"),
            body = "Still readable",
            createdAt = "2026-09-01T10:00:00Z",
        )
        val vm = detail(
            Script(postResult = ApiResult.Err(ApiFailure.Offline)),
            cached = cached,
        )
        advanceUntilIdle()

        assertNotNull(vm.state.value.post)
        assertFalse(vm.state.value.unavailable)
        assertEquals(ApiFailure.Offline, vm.state.value.postFailure)
    }

    // ------------------------------------------------------ ENGAGE-FR-002
    @Test
    fun `A REFUSED COMMENT KEEPS ITS TEXT`() = runTest(dispatcher) {
        // The acceptance criterion, verbatim: "GIVEN a post deleted while a
        // comment is being written, WHEN the comment is submitted, THEN it is
        // refused and the typed text is not lost."
        val script = Script(
            postResult = ApiResult.Ok(post()),
            commentResult = ApiResult.Err(ApiFailure.Unavailable(null)),
        )
        val vm = detail(script)
        advanceUntilIdle()

        vm.onDraftChanged("Three of us have reported this with no response.")
        vm.submitComment()
        advanceUntilIdle()

        assertEquals(
            "the words must still be in the field",
            "Three of us have reported this with no response.",
            vm.state.value.draft,
        )
        assertEquals(ApiFailure.Unavailable(null), vm.state.value.commentFailure)
        assertTrue(vm.state.value.unavailable)
    }

    @Test
    fun `AN OFFLINE COMMENT ALSO KEEPS ITS TEXT`() = runTest(dispatcher) {
        val script = Script(
            postResult = ApiResult.Ok(post()),
            commentResult = ApiResult.Err(ApiFailure.Offline),
        )
        val vm = detail(script)
        advanceUntilIdle()

        vm.onDraftChanged("Typed on a train.")
        vm.submitComment()
        advanceUntilIdle()

        assertEquals("Typed on a train.", vm.state.value.draft)
        // Offline is not "gone" — the post is still there.
        assertFalse(vm.state.value.unavailable)
    }

    @Test
    fun `A SUCCESSFUL COMMENT CLEARS THE DRAFT AND APPENDS TO THE THREAD`() =
        runTest(dispatcher) {
            val script = Script(postResult = ApiResult.Ok(post(comments = 1)))
            script.commentPages += ApiResult.Ok(CommentPage(listOf(comment("c1")), null))
            val vm = detail(script)
            advanceUntilIdle()

            vm.onDraftChanged("  Adding what I know.  ")
            vm.submitComment()
            advanceUntilIdle()

            assertEquals("", vm.state.value.draft)
            // Trimmed before sending.
            assertEquals(listOf("Adding what I know."), script.commentBodies)
            // Appended, not re-fetched — the thread is oldest-first, so a new
            // comment belongs at the end.
            assertEquals(listOf("c1", "new"), vm.state.value.comments.map { it.id })
            // And the post's own count moves, so the engagement row does not
            // disagree with the thread below it.
            assertEquals(2, vm.state.value.post?.commentCount)
        }

    @Test
    fun `AN EMPTY OR WHITESPACE COMMENT CANNOT BE SUBMITTED`() = runTest(dispatcher) {
        // "Comments cannot be empty or whitespace-only" — enforced here so the
        // send control is disabled rather than tapped and refused.
        val script = Script(postResult = ApiResult.Ok(post()))
        val vm = detail(script)
        advanceUntilIdle()

        vm.onDraftChanged("   \n  ")
        assertFalse(vm.state.value.canComment)

        vm.submitComment()
        advanceUntilIdle()
        assertTrue(script.commentBodies.isEmpty())
    }

    @Test
    fun `A COMMENT OVER 1000 GRAPHEMES CANNOT BE SUBMITTED`() = runTest(dispatcher) {
        assertEquals(1000, COMMENT_MAX_GRAPHEMES)

        val script = Script(postResult = ApiResult.Ok(post()))
        val vm = detail(script)
        advanceUntilIdle()

        vm.onDraftChanged("a".repeat(COMMENT_MAX_GRAPHEMES + 1))
        assertTrue(vm.state.value.draftOverLimit)
        assertFalse(vm.state.value.canComment)
    }

    @Test
    fun `URDU COMMENTS ARE COUNTED IN GRAPHEMES`() = runTest(dispatcher) {
        // BR-012's reasoning applied to a comment. Counting UTF-16 units would
        // give an Urdu comment half the allowance an English one gets.
        val script = Script(postResult = ApiResult.Ok(post()))
        val vm = detail(script)
        advanceUntilIdle()

        val urdu = "کِ".repeat(COMMENT_MAX_GRAPHEMES)
        vm.onDraftChanged(urdu)

        assertTrue(urdu.length > COMMENT_MAX_GRAPHEMES)
        assertEquals(COMMENT_MAX_GRAPHEMES, vm.state.value.draftLength)
        assertFalse(vm.state.value.draftOverLimit)
    }

    // ------------------------------------------------------------- BR-033
    @Test
    fun `REPLYING TO A REPLY TARGETS THE THREAD PARENT, NEVER A THIRD LEVEL`() =
        runTest(dispatcher) {
            // BR-033: "one level of nesting only; a reply to a reply attaches to
            // the same parent thread." The client aims at the parent rather than
            // relying on the server to correct it.
            val script = Script(postResult = ApiResult.Ok(post()))
            script.commentPages += ApiResult.Ok(
                CommentPage(
                    listOf(
                        comment("parent"),
                        comment("reply", parent = "parent", at = "2026-09-01T11:30:00Z"),
                    ),
                    null,
                ),
            )
            val vm = detail(script)
            advanceUntilIdle()

            val reply = vm.state.value.comments.first { it.id == "reply" }
            vm.replyTo(reply)

            // Aimed at the parent, not the reply.
            assertEquals("parent", vm.state.value.replyTarget?.id)
            assertEquals("parent", vm.state.value.replyParentId)

            vm.onDraftChanged("Answering the thread.")
            vm.submitComment()
            advanceUntilIdle()

            assertEquals(listOf("parent"), script.replyTargets)
        }

    @Test
    fun `replying to a top-level comment targets it directly`() = runTest(dispatcher) {
        val script = Script(postResult = ApiResult.Ok(post()))
        script.commentPages += ApiResult.Ok(CommentPage(listOf(comment("c1")), null))
        val vm = detail(script)
        advanceUntilIdle()

        vm.replyTo(vm.state.value.comments.first())
        assertEquals("c1", vm.state.value.replyParentId)

        vm.onDraftChanged("A reply.")
        vm.submitComment()
        advanceUntilIdle()

        assertEquals(listOf("c1"), script.replyTargets)
    }

    @Test
    fun `clearing the reply target returns the composer to the post`() = runTest(dispatcher) {
        val script = Script(postResult = ApiResult.Ok(post()))
        script.commentPages += ApiResult.Ok(CommentPage(listOf(comment("c1")), null))
        val vm = detail(script)
        advanceUntilIdle()

        vm.replyTo(vm.state.value.comments.first())
        vm.replyTo(null)
        assertNull(vm.state.value.replyParentId)

        vm.onDraftChanged("A top-level comment.")
        vm.submitComment()
        advanceUntilIdle()

        // Went to `addComment`, not `addReply`.
        assertTrue(script.replyTargets.isEmpty())
        assertEquals(listOf("A top-level comment."), script.commentBodies)
    }

    @Test
    fun `THREADING NESTS EXACTLY ONE LEVEL`() {
        // A pure function, so asserted directly. The list arrives flat with
        // `parentCommentId`; one level is the whole rule, so there is no
        // recursive case to get wrong.
        val flat = listOf(
            comment("a", at = "2026-09-01T11:00:00Z"),
            comment("a-r1", parent = "a", at = "2026-09-01T11:10:00Z"),
            comment("b", at = "2026-09-01T11:20:00Z"),
            comment("a-r2", parent = "a", at = "2026-09-01T11:30:00Z"),
        )

        val threads = flat.threaded()

        assertEquals(listOf("a", "b"), threads.map { it.comment.id })
        assertEquals(listOf("a-r1", "a-r2"), threads[0].replies.map { it.id })
        assertTrue(threads[1].replies.isEmpty())
        // Nothing nested inside a reply — the type has no such field.
        assertEquals(3, threads[0].size)
    }

    @Test
    fun `AN ORPHANED REPLY IS PROMOTED RATHER THAN DROPPED`() {
        // Its parent may have been deleted between pages, or sit on a later
        // page. Dropping it would silently lose somebody's words.
        val flat = listOf(
            comment("a", at = "2026-09-01T11:00:00Z"),
            comment("orphan", parent = "gone", at = "2026-09-01T11:05:00Z"),
        )

        val threads = flat.threaded()

        assertEquals(listOf("a", "orphan"), threads.map { it.comment.id })
    }

    @Test
    fun `threads are ordered oldest first`() {
        // ENGAGE-FR-002: comments "appear oldest-first beneath the post",
        // because a thread is a conversation and reading it backwards puts
        // replies before what they reply to.
        val flat = listOf(
            comment("later", at = "2026-09-01T13:00:00Z"),
            comment("earlier", at = "2026-09-01T11:00:00Z"),
        )

        assertEquals(listOf("earlier", "later"), flat.threaded().map { it.comment.id })
    }

    // ------------------------------------------------------ ENGAGE-FR-004/005
    @Test
    fun `DELETING A COMMENT REMOVES ITS REPLIES WITH IT`() = runTest(dispatcher) {
        // The acceptance criterion: "GIVEN a comment with 3 replies, WHEN the
        // comment author deletes it, THEN the replies are removed with it."
        val script = Script(postResult = ApiResult.Ok(post(comments = 4)))
        script.commentPages += ApiResult.Ok(
            CommentPage(
                listOf(
                    comment("parent", authorId = "me"),
                    comment("r1", parent = "parent"),
                    comment("r2", parent = "parent"),
                    comment("r3", parent = "parent"),
                ),
                null,
            ),
        )
        val vm = detail(script)
        advanceUntilIdle()

        vm.deleteComment(vm.state.value.comments.first { it.id == "parent" })
        advanceUntilIdle()

        assertTrue(vm.state.value.comments.isEmpty())
        // Only ONE request: the server removes the replies, and re-requesting
        // each would be three round trips to achieve what one already did.
        assertEquals(listOf("parent"), script.deletedCommentIds)
        assertEquals(0, vm.state.value.post?.commentCount)
    }

    @Test
    fun `deleting a reply leaves its siblings and parent alone`() = runTest(dispatcher) {
        val script = Script(postResult = ApiResult.Ok(post(comments = 3)))
        script.commentPages += ApiResult.Ok(
            CommentPage(
                listOf(
                    comment("parent"),
                    comment("r1", parent = "parent", authorId = "me"),
                    comment("r2", parent = "parent"),
                ),
                null,
            ),
        )
        val vm = detail(script)
        advanceUntilIdle()

        vm.deleteComment(vm.state.value.comments.first { it.id == "r1" })
        advanceUntilIdle()

        assertEquals(listOf("parent", "r2"), vm.state.value.comments.map { it.id })
        assertEquals(2, vm.state.value.post?.commentCount)
    }

    @Test
    fun `A FAILED DELETION REMOVES NOTHING`() = runTest(dispatcher) {
        // A comment that vanished and came back would be worse than one that
        // took a moment to go.
        val script = Script(
            postResult = ApiResult.Ok(post(comments = 1)),
            deleteCommentResult = ApiResult.Err(ApiFailure.Offline),
        )
        script.commentPages += ApiResult.Ok(
            CommentPage(listOf(comment("c1", authorId = "me")), null),
        )
        val vm = detail(script)
        advanceUntilIdle()

        vm.deleteComment(vm.state.value.comments.first())
        advanceUntilIdle()

        assertEquals(listOf("c1"), vm.state.value.comments.map { it.id })
        assertTrue(vm.state.value.deletingComments.isEmpty())
    }

    @Test
    fun `THE COMMENT'S AUTHOR AND THE POST'S AUTHOR MAY BOTH DELETE`() =
        runTest(dispatcher) {
            // ENGAGE-FR-004 and ENGAGE-FR-005 (BR-020, "which distributes
            // moderation away from administrators"). Anybody else may not, and
            // the server answers them a neutral 404 so a third party cannot
            // probe who wrote what.
            val script = Script(postResult = ApiResult.Ok(post(authorId = "me")))
            script.commentPages += ApiResult.Ok(
                CommentPage(
                    listOf(
                        comment("mine", authorId = "me"),
                        comment("theirs", authorId = "somebody-else"),
                    ),
                    null,
                ),
            )
            val vm = detail(script, viewer = "me")
            advanceUntilIdle()

            // My own comment.
            assertTrue(vm.canDelete(vm.state.value.comments.first { it.id == "mine" }))
            // Somebody else's comment, on MY post.
            assertTrue(vm.canDelete(vm.state.value.comments.first { it.id == "theirs" }))
        }

    @Test
    fun `A THIRD PARTY MAY DELETE NEITHER`() = runTest(dispatcher) {
        val script = Script(postResult = ApiResult.Ok(post(authorId = "author")))
        script.commentPages += ApiResult.Ok(
            CommentPage(listOf(comment("theirs", authorId = "somebody-else")), null),
        )
        val vm = detail(script, viewer = "bystander")
        advanceUntilIdle()

        assertFalse(vm.canDelete(vm.state.value.comments.first()))
    }

    @Test
    fun `a signed-out viewer may delete nothing`() = runTest(dispatcher) {
        val script = Script(postResult = ApiResult.Ok(post(authorId = "author")))
        script.commentPages += ApiResult.Ok(
            CommentPage(listOf(comment("c1", authorId = "author")), null),
        )
        val vm = detail(script, viewer = null)
        advanceUntilIdle()

        assertFalse(vm.canDelete(vm.state.value.comments.first()))
    }

    // ------------------------------------------------------- ENGAGE-FR-001
    @Test
    fun `RAPID TAPS SEND ONE REQUEST`() = runTest(dispatcher) {
        // "GIVEN a user taps like 6 times rapidly, WHEN the requests settle,
        // THEN the like count has changed by at most one." The server guards
        // the data; this guards the VISIBLE state, which two racing requests
        // would leave up to whichever landed last.
        val script = Script(postResult = ApiResult.Ok(post(likes = 4, liked = false)))
        val vm = detail(script)
        advanceUntilIdle()

        repeat(6) { vm.toggleLike() }
        advanceUntilIdle()

        assertEquals(1, script.likeCalls)
        assertEquals(0, script.unlikeCalls)
        assertEquals(5, vm.state.value.post?.likeCount)
        assertTrue(vm.state.value.post!!.viewerHasLiked)
    }

    @Test
    fun `A REFUSED LIKE REVERTS THE COUNT AND THE STATE`() = runTest(dispatcher) {
        // "Network failure → the interface reverts to the true server state
        // rather than showing an optimistic value indefinitely."
        val script = Script(
            postResult = ApiResult.Ok(post(likes = 4, liked = false)),
            likeResult = ApiResult.Err(ApiFailure.Offline),
        )
        val vm = detail(script)
        advanceUntilIdle()

        vm.toggleLike()
        advanceUntilIdle()

        assertEquals(4, vm.state.value.post?.likeCount)
        assertFalse(vm.state.value.post!!.viewerHasLiked)
        assertTrue(vm.state.value.likeReverted)

        vm.onLikeRevertAcknowledged()
        assertFalse(vm.state.value.likeReverted)
    }

    @Test
    fun `unliking decrements and calls unlike`() = runTest(dispatcher) {
        val script = Script(postResult = ApiResult.Ok(post(likes = 9, liked = true)))
        val vm = detail(script)
        advanceUntilIdle()

        vm.toggleLike()
        advanceUntilIdle()

        assertEquals(1, script.unlikeCalls)
        assertEquals(0, script.likeCalls)
        assertEquals(8, vm.state.value.post?.likeCount)
    }

    @Test
    fun `THE AUTHOR MAY LIKE THEIR OWN POST`() = runTest(dispatcher) {
        // BR-031 says so explicitly, so there is no author check on the like
        // path — and a test, because "don't let people like their own posts"
        // is the kind of rule somebody adds by instinct.
        val script = Script(postResult = ApiResult.Ok(post(authorId = "me")))
        val vm = detail(script, viewer = "me")
        advanceUntilIdle()

        vm.toggleLike()
        advanceUntilIdle()

        assertEquals(1, script.likeCalls)
    }

    @Test
    fun `a like count never goes below zero`() = runTest(dispatcher) {
        // A stale page can report a liked post with a count of zero. A negative
        // count on screen is a visible impossibility.
        val script = Script(postResult = ApiResult.Ok(post(likes = 0, liked = true)))
        val vm = detail(script)
        advanceUntilIdle()

        vm.toggleLike()
        assertEquals(0, vm.state.value.post?.likeCount)
    }

    // --------------------------------------------------------- POST-FR-007
    @Test
    fun `ONLY A CONFIRMED OWN POST MAY BE DELETED`() = runTest(dispatcher) {
        // A cached copy is enough to RENDER but not enough to act irreversibly
        // on — deleting on the strength of a cached author id would be acting
        // on a guess.
        val cached = FeedItemResponse(
            id = "p1",
            author = profile("me"),
            body = "Mine, allegedly",
            createdAt = "2026-09-01T10:00:00Z",
        )
        val script = Script(postResult = ApiResult.Ok(post(authorId = "me")))
        val vm = detail(script, cached = cached, viewer = "me")

        // Before confirmation.
        assertFalse(vm.state.value.canDeletePost)

        advanceUntilIdle()
        assertTrue(vm.state.value.canDeletePost)
    }

    @Test
    fun `somebody else's post offers no delete`() = runTest(dispatcher) {
        val script = Script(postResult = ApiResult.Ok(post(authorId = "author")))
        val vm = detail(script, viewer = "me")
        advanceUntilIdle()

        assertFalse(vm.state.value.isMine)
        assertFalse(vm.state.value.canDeletePost)

        vm.deletePost()
        advanceUntilIdle()
        assertEquals(0, script.deletePostCalls)
    }

    @Test
    fun `a deleted post is forgotten by the cache and reported as deleted`() =
        runTest(dispatcher) {
            val forgotten = mutableListOf<String>()
            val script = Script(postResult = ApiResult.Ok(post(authorId = "me")))
            val vm = detail(script, viewer = "me", forgotten = forgotten)
            advanceUntilIdle()

            vm.deletePost()
            advanceUntilIdle()

            assertEquals(1, script.deletePostCalls)
            assertTrue(vm.state.value.deleted)
            assertEquals(listOf("p1"), forgotten)
        }

    // ---------------------------------------------------------- empty thread
    @Test
    fun `AN EMPTY THREAD IS AN INVITATION, AND A FAILED ONE IS NOT`() =
        runTest(dispatcher) {
            val empty = Script(postResult = ApiResult.Ok(post()))
            empty.commentPages += ApiResult.Ok(CommentPage(emptyList(), null))
            val emptyVm = detail(empty)
            advanceUntilIdle()

            assertTrue(emptyVm.state.value.isEmptyThread)

            val failed = Script(postResult = ApiResult.Ok(post()))
            failed.commentPages += ApiResult.Err(ApiFailure.Offline)
            val failedVm = detail(failed)
            advanceUntilIdle()

            // Never "no comments yet" — the thread may be busy and unreachable,
            // and inviting somebody to start a conversation that is already
            // happening is the same defect as the feed's empty-versus-failed.
            assertFalse(failedVm.state.value.isEmptyThread)
            assertEquals(ApiFailure.Offline, failedVm.state.value.commentsFailure)
        }

    @Test
    fun `comments paginate with the feed's cursor shape`() = runTest(dispatcher) {
        val cursor = FeedCursor("2026-09-01T11:00:00Z", "c1")
        val script = Script(postResult = ApiResult.Ok(post()))
        script.commentPages += ApiResult.Ok(CommentPage(listOf(comment("c1")), cursor))
        script.commentPages += ApiResult.Ok(CommentPage(listOf(comment("c2")), null))
        val vm = detail(script)
        advanceUntilIdle()

        vm.loadMoreComments()
        advanceUntilIdle()

        assertEquals(listOf(null, cursor), script.requestedCursors)
        assertEquals(listOf("c1", "c2"), vm.state.value.comments.map { it.id })
    }

    @Test
    fun `a comment appearing on two pages is added once`() = runTest(dispatcher) {
        val cursor = FeedCursor("2026-09-01T11:00:00Z", "c1")
        val script = Script(postResult = ApiResult.Ok(post()))
        script.commentPages += ApiResult.Ok(CommentPage(listOf(comment("c1")), cursor))
        script.commentPages += ApiResult.Ok(
            CommentPage(listOf(comment("c1"), comment("c2")), null),
        )
        val vm = detail(script)
        advanceUntilIdle()

        vm.loadMoreComments()
        advanceUntilIdle()

        assertEquals(listOf("c1", "c2"), vm.state.value.comments.map { it.id })
    }
}
