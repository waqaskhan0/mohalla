package org.shehersaaz.mohalla.feature.profile

import org.shehersaaz.mohalla.core.network.ApiResult
import org.shehersaaz.mohalla.core.network.FeedItemResponse
import org.shehersaaz.mohalla.core.network.MohallaApi
import org.shehersaaz.mohalla.core.network.OwnProfileResponse
import org.shehersaaz.mohalla.core.network.Patch
import org.shehersaaz.mohalla.core.network.PublicProfileResponse
import org.shehersaaz.mohalla.core.network.apiCall
import org.shehersaaz.mohalla.core.network.field
import org.shehersaaz.mohalla.core.network.map
import org.shehersaaz.mohalla.core.network.patch
import org.shehersaaz.mohalla.feature.home.FeedCursor

/**
 * Profiles and the social graph (PROFILE-FR-003…009 · SOCIAL-FR-001…004).
 *
 * ONE PROJECTION DESCRIBES A PERSON EVERYWHERE. The follower list, the following
 * list, a post's author, a search result, a conversation's participant and a
 * profile header are all `PublicProfileResponse` — §162's "one definition of
 * what a person looks like", so a revoked badge (PROFILE-FR-007) or a new block
 * takes effect on every surface at the same moment rather than in the six places
 * somebody remembered.
 *
 * AND THAT PROJECTION CARRIES NO CONTACT DETAIL AT ALL. PRIV-003: "phone, email
 * and date of birth are never shown." The backend builds it by NAMING the fields
 * it wants rather than deleting the ones it does not, and the client's mirror of
 * it has no field a number could arrive in.
 *
 * WHAT THE VIEWER'S OWN RELATIONSHIP IS, THIS API DOES NOT SAY. No response
 * anywhere carries `viewerFollows` — the server has `isFollowing` internally and
 * exposes it nowhere — so a Follow control cannot be rendered in the right state
 * on a cold open. That is GAP-M-011, and [ViewerRelations] is how the client
 * survives it.
 */
interface ProfileSource {
    suspend fun own(): ApiResult<OwnProfileResponse>

    suspend fun user(userId: String): ApiResult<PublicProfileResponse>

    suspend fun updateProfile(changes: ProfileChanges): ApiResult<OwnProfileResponse>

    suspend fun posts(userId: String, cursor: FeedCursor? = null): ApiResult<ProfilePostPage>

    suspend fun followers(userId: String, before: String? = null): ApiResult<UserPage>

    suspend fun following(userId: String, before: String? = null): ApiResult<UserPage>

    suspend fun follow(userId: String): ApiResult<Unit>

    suspend fun unfollow(userId: String): ApiResult<Unit>

    suspend fun saved(cursor: FeedCursor? = null): ApiResult<ProfilePostPage>

    suspend fun unsave(postId: String): ApiResult<Unit>

    /**
     * ENGAGE-FR-001, on the post lists these screens draw.
     *
     * A POST CARD IS THE SAME CONTROL WHEREVER IT APPEARS, so a like offered on
     * a profile has to work there. The alternative — a heart that does nothing
     * outside the feed — is the kind of inert control a reader taps three times
     * before deciding the app is broken.
     */
    suspend fun like(postId: String): ApiResult<Unit>

    suspend fun unlike(postId: String): ApiResult<Unit>
}

class ProfileRepository(
    private val api: MohallaApi,
) : ProfileSource {

    override suspend fun own(): ApiResult<OwnProfileResponse> = apiCall { api.me() }

    /**
     * Somebody else (PROFILE-FR-005).
     *
     * ONE NEUTRAL 404 for missing, banned, deleted and blocked alike (BR-025),
     * and the client must not try to tell them apart: "GIVEN user A has blocked
     * user B, WHEN B opens A's profile by direct link, THEN a not-available
     * state is shown." A suspended profile IS visible, because a suspension is
     * temporary and hiding it would break conversations already under way.
     */
    override suspend fun user(userId: String): ApiResult<PublicProfileResponse> =
        apiCall { api.user(userId) }

    /**
     * Edit (PROFILE-FR-003).
     *
     * ONLY WHAT CHANGED, AND EXPLICITLY WHAT WAS EMPTIED. A field the editor did
     * not touch is absent; one the editor cleared is sent as `null`, which is
     * what the server reads as "remove this". Those are different requests and a
     * nullable Kotlin field cannot express both — see `PatchBody.kt` for the
     * parser configuration that made this necessary and the two screens it broke.
     *
     * `username` is deliberately not here. BR-005 makes it permanent, and the
     * server rejects it rather than ignoring it — so there is no field to send
     * and no way to construct the request that would.
     */
    override suspend fun updateProfile(
        changes: ProfileChanges,
    ): ApiResult<OwnProfileResponse> = apiCall {
        api.updateProfile(
            patch {
                changes.displayName?.let { field("displayName", it.trim()) }
                field("city", changes.city)
                field("bio", changes.bio)
                field("photoMediaId", changes.photoMediaId)
            },
        )
    }

    override suspend fun posts(
        userId: String,
        cursor: FeedCursor?,
    ): ApiResult<ProfilePostPage> = apiCall {
        api.userPosts(
            userId = userId,
            limit = PAGE_SIZE,
            cursorCreatedAt = cursor?.createdAt,
            cursorId = cursor?.id,
        )
    }.map { response ->
        ProfilePostPage(
            posts = response.posts,
            nextCursor = response.nextCursor?.let { FeedCursor(it.createdAt, it.id) },
        )
    }

    override suspend fun followers(
        userId: String,
        before: String?,
    ): ApiResult<UserPage> = apiCall {
        api.followers(userId = userId, limit = PAGE_SIZE, before = before)
    }.map { UserPage(users = it.users, nextBefore = it.nextBefore) }

    override suspend fun following(
        userId: String,
        before: String?,
    ): ApiResult<UserPage> = apiCall {
        api.following(userId = userId, limit = PAGE_SIZE, before = before)
    }.map { UserPage(users = it.users, nextBefore = it.nextBefore) }

    override suspend fun follow(userId: String): ApiResult<Unit> =
        apiCall { api.follow(userId) }.map { }

    override suspend fun unfollow(userId: String): ApiResult<Unit> =
        apiCall { api.unfollow(userId) }.map { }

    /**
     * Saved posts (FEED-FR-007).
     *
     * NEWEST-SAVED-FIRST rather than newest-posted-first, so a three-year-old
     * post saved this morning is at the top. Private: no route reveals who saved
     * a post, and saving notifies nobody.
     */
    override suspend fun saved(cursor: FeedCursor?): ApiResult<ProfilePostPage> = apiCall {
        api.savedPosts(
            limit = PAGE_SIZE,
            cursorCreatedAt = cursor?.createdAt,
            cursorId = cursor?.id,
        )
    }.map { response ->
        ProfilePostPage(
            posts = response.items,
            nextCursor = response.nextCursor?.let { FeedCursor(it.createdAt, it.id) },
        )
    }

    override suspend fun unsave(postId: String): ApiResult<Unit> =
        apiCall { api.unsavePost(postId) }.map { }

    override suspend fun like(postId: String): ApiResult<Unit> =
        apiCall { api.like(postId) }.map { }

    override suspend fun unlike(postId: String): ApiResult<Unit> =
        apiCall { api.unlike(postId) }.map { }

    companion object {
        /** SOCIAL-FR-003 and PROFILE-FR-008 both say twenty. */
        const val PAGE_SIZE = 20
    }
}

data class UserPage(
    val users: List<PublicProfileResponse>,
    /** A TIMESTAMP. `null` means the end — not the same as an empty page. */
    val nextBefore: String?,
)

data class ProfilePostPage(
    val posts: List<FeedItemResponse>,
    val nextCursor: FeedCursor?,
)

/**
 * What an edit is asking for.
 *
 * `displayName` is required and therefore nullable-as-"unchanged"; the other
 * three are [Patch]es, because each of them can be legitimately EMPTIED and
 * "the user cleared their bio" is a different request from "the user did not
 * open the bio field".
 */
data class ProfileChanges(
    val displayName: String? = null,
    val city: Patch<String> = Patch.Unchanged,
    val bio: Patch<String> = Patch.Unchanged,
    val photoMediaId: Patch<String> = Patch.Unchanged,
) {
    val isEmpty: Boolean
        get() = displayName == null && city == Patch.Unchanged &&
            bio == Patch.Unchanged && photoMediaId == Patch.Unchanged
}
