package org.shehersaaz.mohalla.feature.profile

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
import org.shehersaaz.mohalla.core.network.FeedItemResponse
import org.shehersaaz.mohalla.core.network.OwnProfileResponse
import org.shehersaaz.mohalla.core.network.PublicProfileResponse
import org.shehersaaz.mohalla.core.network.map
import org.shehersaaz.mohalla.core.state.Relation
import org.shehersaaz.mohalla.core.state.ViewerRelations
import org.shehersaaz.mohalla.feature.home.FeedCursor

/**
 * A profile — UX-PROFILE-001 and UX-PROFILE-002
 * (PROFILE-FR-004/005/007/008/009 · SOCIAL-FR-001/002 · BR-025 · BR-032).
 *
 * ONE VIEWMODEL FOR BOTH SCREENS, because they are the same screen with a
 * different action row. Identity, three stat pills, and a post list are
 * identical; what differs is that the owner gets Edit and Saved where a visitor
 * gets Follow and Message, and that the owner ALSO sees their own auto-hidden
 * posts. Splitting them would duplicate the header, the pills, the paging and
 * the neutral-refusal handling to vary two buttons.
 *
 * BR-032 IS THE OWNER'S ONE EXTRA. "GIVEN a post of mine is auto-hidden, WHEN I
 * view my own profile, THEN I see it labelled under review, and no other user
 * sees it at all." Neither half is the client's decision — the server returns
 * those rows only to their author and marks them `underReview` — and `PostCard`
 * already renders the label. What matters here is not filtering them out.
 *
 * THE REFUSAL IS NEUTRAL AND THE SCREEN DOES NOT INTERPRET IT. Blocked, banned,
 * deleted and never-existed all arrive as one 404 (BR-025), and UX-PROFILE-002
 * is explicit: "ONE identical neutral state. No case is distinguishable." So
 * there is no branch here that could tell them apart, and none that could be
 * added without deleting this comment.
 *
 * WHETHER THE VIEWER ALREADY FOLLOWS THIS PERSON IS NOT KNOWN. No response
 * carries it (GAP-M-011). [ViewerRelations] holds what the session has observed
 * and answers `Unknown` otherwise, and Unknown offers FOLLOW — the wasted tap
 * costs nothing because the route is idempotent, where offering "Following" to
 * somebody unfollowed would stop the viewer following them at all.
 */
class ProfileViewModel(
    private val profiles: ProfileSource,
    private val relations: ViewerRelations,
    /** Null for the owner's own profile, which is reached without an id. */
    private val userId: String?,
    private val viewerId: () -> String?,
) : ViewModel() {

    private val _state = MutableStateFlow(ProfileUiState(isOwn = userId == null))
    val state: StateFlow<ProfileUiState> = _state.asStateFlow()

    init {
        load()
    }

    fun load() {
        _state.update { it.copy(loading = it.profile == null, failure = null, unavailable = false) }

        viewModelScope.launch {
            val result = if (userId == null) {
                profiles.own().map { it.toView() }
            } else {
                profiles.user(userId).map { it.toView() }
            }

            when (result) {
                is ApiResult.Ok -> {
                    val view = result.value
                    _state.update {
                        it.copy(
                            profile = view,
                            isOwn = userId == null || view.userId == viewerId(),
                            followState = relations.followState(view.userId),
                            loading = false,
                            loaded = true,
                        )
                    }
                    loadPosts(view.userId)
                }

                is ApiResult.Err -> _state.update {
                    it.copy(
                        loading = false,
                        // UX-STATE-001 wins over everything else on screen, and
                        // says nothing about why.
                        unavailable = result.failure is ApiFailure.Unavailable,
                        failure = result.failure,
                    )
                }
            }
        }
    }

    /**
     * The post list (PROFILE-FR-008).
     *
     * A SEPARATE REQUEST FROM THE HEADER, and separately recoverable. The
     * wireframe is explicit that when a profile has no posts, "statistics still
     * render" — so a post list that fails must not take the identity down with
     * it, and one that is empty is a different thing from one that could not be
     * read.
     */
    private fun loadPosts(id: String) {
        _state.update { it.copy(loadingPosts = true, postsFailure = null) }

        viewModelScope.launch {
            when (val result = profiles.posts(id, cursor = null)) {
                is ApiResult.Ok -> _state.update {
                    it.copy(
                        posts = result.value.posts,
                        postsCursor = result.value.nextCursor,
                        postsLoaded = true,
                        loadingPosts = false,
                    )
                }

                is ApiResult.Err -> _state.update {
                    it.copy(loadingPosts = false, postsFailure = result.failure)
                }
            }
        }
    }

    fun retryPosts() {
        _state.value.profile?.let { loadPosts(it.userId) }
    }

    fun loadMorePosts() {
        val current = _state.value
        val id = current.profile?.userId ?: return
        val cursor = current.postsCursor ?: return
        if (current.loadingMorePosts) return

        _state.update { it.copy(loadingMorePosts = true) }

        viewModelScope.launch {
            when (val result = profiles.posts(id, cursor)) {
                is ApiResult.Ok -> _state.update { s ->
                    s.copy(
                        posts = s.posts + result.value.posts
                            .filterNot { incoming -> s.posts.any { it.id == incoming.id } },
                        postsCursor = result.value.nextCursor,
                        loadingMorePosts = false,
                    )
                }

                is ApiResult.Err -> _state.update { it.copy(loadingMorePosts = false) }
            }
        }
    }

    /**
     * Follow or unfollow (SOCIAL-FR-001/002 · PROFILE-FR-009).
     *
     * OPTIMISTIC, INCLUDING THE COUNT. PROFILE-FR-009: counts "appear on every
     * profile and update on follow or unfollow" — a follower number that stays
     * still for a round trip reads as a control that did nothing, on the one
     * screen where the number is the feedback.
     *
     * AND IT REVERTS. A refused follow that left the button saying Following
     * would be a lie the viewer has no reason to re-check; BR-023's blocked
     * relationship arrives as the same neutral 404 as a deleted account, so the
     * screen says nothing about why and simply puts the control back.
     */
    fun toggleFollow() {
        val current = _state.value
        val profile = current.profile ?: return
        if (current.isOwn || current.followPending) return

        val nowFollowing = !current.followState.isDone
        val delta = if (nowFollowing) 1 else -1

        _state.update {
            it.copy(
                followState = if (nowFollowing) Relation.Yes else Relation.No,
                profile = profile.copy(
                    followerCount = (profile.followerCount + delta).coerceAtLeast(0),
                ),
                followPending = true,
                followFailed = false,
            )
        }

        viewModelScope.launch {
            val result = if (nowFollowing) {
                profiles.follow(profile.userId)
            } else {
                profiles.unfollow(profile.userId)
            }

            when (result) {
                is ApiResult.Ok -> {
                    // Now KNOWN, for every other screen this session. Without
                    // this the same person re-opened from search two taps later
                    // would offer Follow again, which reads as the first tap
                    // having failed.
                    relations.recordFollow(profile.userId, nowFollowing)
                    _state.update { it.copy(followPending = false) }
                }

                is ApiResult.Err -> _state.update {
                    it.copy(
                        followState = current.followState,
                        profile = it.profile?.copy(followerCount = profile.followerCount),
                        followPending = false,
                        followFailed = true,
                    )
                }
            }
        }
    }

    /**
     * Like, or unlike (ENGAGE-FR-001).
     *
     * OPTIMISTIC AND REVERTING, identical to the feed's — "network failure ->
     * the interface reverts to the true server state rather than showing an
     * optimistic value indefinitely". The endpoints return no body, so an
     * optimistic count is the only way to show the change happened at all.
     */
    fun toggleLike(postId: String) {
        val post = _state.value.posts.firstOrNull { it.id == postId } ?: return
        if (postId in _state.value.pendingLikes) return

        val wasLiked = post.viewerHasLiked
        _state.update { s ->
            s.copy(
                posts = s.posts.map {
                    if (it.id == postId) {
                        it.copy(
                            viewerHasLiked = !wasLiked,
                            likeCount = (it.likeCount + if (wasLiked) -1 else 1).coerceAtLeast(0),
                        )
                    } else {
                        it
                    }
                },
                pendingLikes = s.pendingLikes + postId,
            )
        }

        viewModelScope.launch {
            val result = if (wasLiked) profiles.unlike(postId) else profiles.like(postId)

            _state.update { s ->
                val cleared = s.copy(pendingLikes = s.pendingLikes - postId)
                when (result) {
                    is ApiResult.Ok -> cleared

                    // REVERT. A filled heart on a like the server refused tells
                    // the reader something untrue about their own action.
                    is ApiResult.Err -> cleared.copy(
                        posts = cleared.posts.map {
                            if (it.id == postId) {
                                it.copy(
                                    viewerHasLiked = wasLiked,
                                    likeCount = (it.likeCount + if (wasLiked) 1 else -1)
                                        .coerceAtLeast(0),
                                )
                            } else {
                                it
                            }
                        },
                    )
                }
            }
        }
    }

    fun onFollowFailureAcknowledged() = _state.update { it.copy(followFailed = false) }

    class Factory(
        private val profiles: ProfileSource,
        private val relations: ViewerRelations,
        private val userId: String?,
        private val viewerId: () -> String?,
    ) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T =
            ProfileViewModel(profiles, relations, userId, viewerId) as T
    }
}

/**
 * A profile, however it was fetched.
 *
 * ONE SHAPE FOR BOTH RESPONSES. `GET /me` returns a superset of `GET /users/:id`
 * — the same public fields plus account state and interests — so normalising
 * here means the header, the pills and the post list are written once. What is
 * NOT here is anything the public projection does not carry: no phone number, no
 * email, no date of birth (PRIV-003), and nowhere to put one.
 */
data class ProfileView(
    val userId: String,
    val username: String?,
    val displayName: String?,
    val city: String?,
    val bio: String?,
    val photoMediaId: String?,
    val verifiedBadge: Boolean,
    val followerCount: Int,
    val followingCount: Int,
    val postCount: Int,
)

fun OwnProfileResponse.toView() = ProfileView(
    userId = userId,
    username = username,
    displayName = displayName,
    city = city,
    bio = bio,
    photoMediaId = photoMediaId,
    verifiedBadge = verifiedBadge,
    followerCount = followerCount,
    followingCount = followingCount,
    postCount = postCount,
)

fun PublicProfileResponse.toView() = ProfileView(
    userId = userId,
    username = username,
    displayName = displayName,
    city = city,
    bio = bio,
    photoMediaId = photoMediaId,
    verifiedBadge = verifiedBadge,
    followerCount = followerCount,
    followingCount = followingCount,
    postCount = postCount,
)

data class ProfileUiState(
    val profile: ProfileView? = null,

    val isOwn: Boolean = false,

    /**
     * GAP-M-011 — what the session has observed, never what the server said.
     *
     * `Unknown` offers Follow. See [ViewerRelations].
     */
    val followState: Relation = Relation.Unknown,

    val posts: List<FeedItemResponse> = emptyList(),
    val postsCursor: FeedCursor? = null,

    val loading: Boolean = false,
    val loaded: Boolean = false,
    val loadingPosts: Boolean = false,
    val loadingMorePosts: Boolean = false,
    val postsLoaded: Boolean = false,

    /** BR-025's neutral 404. The screen renders UX-STATE-001 and says no more. */
    val unavailable: Boolean = false,
    val failure: ApiFailure? = null,
    val postsFailure: ApiFailure? = null,

    val followPending: Boolean = false,
    val followFailed: Boolean = false,

    /** One in-flight like per post, so a double tap cannot send two writes. */
    val pendingLikes: Set<String> = emptySet(),
) {
    val atEndOfPosts: Boolean get() = postsLoaded && postsCursor == null

    /**
     * Genuinely no posts, as opposed to a post list that could not be read.
     *
     * The wireframe keeps them apart by hand: "No posts → 'No posts yet'.
     * Statistics still render." A failed list rendered as an empty one would
     * tell a visitor this person has never posted.
     */
    val hasNoPosts: Boolean get() = postsLoaded && posts.isEmpty() && postsFailure == null

    /** Never on the viewer's own profile — the server refuses a self-follow (BR-019). */
    val canFollow: Boolean get() = !isOwn && profile != null
}
