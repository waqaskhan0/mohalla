package org.shehersaaz.mohalla

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import java.lang.reflect.Proxy
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import okhttp3.OkHttpClient
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.shehersaaz.mohalla.core.format.ltr
import org.shehersaaz.mohalla.core.media.ImageUploader
import org.shehersaaz.mohalla.core.network.ApiFailure
import org.shehersaaz.mohalla.core.network.ApiResult
import org.shehersaaz.mohalla.core.network.FeedItemResponse
import org.shehersaaz.mohalla.core.network.OwnProfileResponse
import org.shehersaaz.mohalla.core.network.Patch
import org.shehersaaz.mohalla.core.network.MohallaApi
import org.shehersaaz.mohalla.core.network.MohallaJson
import org.shehersaaz.mohalla.core.network.PublicProfileResponse
import org.shehersaaz.mohalla.core.network.changedTo
import org.shehersaaz.mohalla.core.network.patch
import org.shehersaaz.mohalla.core.state.Relation
import org.shehersaaz.mohalla.core.state.ViewerRelations
import org.shehersaaz.mohalla.feature.home.FeedCursor
import org.shehersaaz.mohalla.feature.profile.EditProfileViewModel
import org.shehersaaz.mohalla.feature.profile.ProfileChanges
import org.shehersaaz.mohalla.feature.profile.ProfilePostPage
import org.shehersaaz.mohalla.feature.profile.ProfileSource
import org.shehersaaz.mohalla.feature.profile.ProfileView
import org.shehersaaz.mohalla.feature.profile.ProfileViewModel
import org.shehersaaz.mohalla.feature.profile.SavedPostsViewModel
import org.shehersaaz.mohalla.feature.profile.UserListKind
import org.shehersaaz.mohalla.feature.profile.UserListViewModel
import org.shehersaaz.mohalla.feature.profile.UserPage

/**
 * Profiles and the social graph
 * (PROFILE-FR-003…010 · SOCIAL-FR-001…004 · FEED-FR-007 · PRIV-003 · BR-005/025).
 *
 * THE ASSERTION THIS GROUP EXISTS FOR IS ABOUT A JSON KEY BEING PRESENT AND
 * NULL. The API's rule is "send null to clear an optional field; omit it to
 * leave it alone" — three states — and the client's parser is configured with
 * `explicitNulls = false`, which OMITS a null property when writing. So a typed
 * request body could not express a clear at all: nobody could remove their bio,
 * their city or their photo, and switching an event's type was impossible
 * because the field belonging to the old type was merged back in. Those are the
 * first tests below, and they check the encoded body rather than a data class,
 * because the data class was exactly what looked correct.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class ProfileTest {

    private val dispatcher = StandardTestDispatcher()

    @Before fun setUp() = Dispatchers.setMain(dispatcher)

    @After fun tearDown() = Dispatchers.resetMain()

    private fun own(
        displayName: String? = "Ayesha Khan",
        username: String? = "ayesha_khan",
        city: String? = "Karachi",
        bio: String? = "Water and sanitation.",
        photoMediaId: String? = "m1",
        followerCount: Int = 64,
        followingCount: Int = 41,
        postCount: Int = 128,
    ) = OwnProfileResponse(
        userId = "me",
        username = username,
        displayName = displayName,
        city = city,
        bio = bio,
        photoMediaId = photoMediaId,
        followerCount = followerCount,
        followingCount = followingCount,
        postCount = postCount,
    )

    private fun person(id: String, name: String = id) = PublicProfileResponse(
        userId = id,
        username = id,
        displayName = name,
        followerCount = 3,
        followingCount = 2,
        postCount = 1,
    )

    private fun post(id: String, liked: Boolean = false, likes: Int = 2) = FeedItemResponse(
        id = id,
        author = person("them"),
        body = "The drain is blocked again.",
        likeCount = likes,
        viewerHasLiked = liked,
        createdAt = "2026-09-07T10:00:00Z",
    )

    private class Script(
        var ownResult: ApiResult<OwnProfileResponse>? = null,
        var userResult: ApiResult<PublicProfileResponse>? = null,
        val postPages: MutableList<ApiResult<ProfilePostPage>> = mutableListOf(),
        val userPages: MutableList<ApiResult<UserPage>> = mutableListOf(),
        val savedPages: MutableList<ApiResult<ProfilePostPage>> = mutableListOf(),
        var followResult: ApiResult<Unit> = ApiResult.Ok(Unit),
        var updateResult: ApiResult<OwnProfileResponse>? = null,
        var unsaveResult: ApiResult<Unit> = ApiResult.Ok(Unit),
        var likeResult: ApiResult<Unit> = ApiResult.Ok(Unit),
    ) : ProfileSource {
        var followCalls = 0
        var unfollowCalls = 0
        val listedKinds = mutableListOf<UserListKind>()
        val listedIds = mutableListOf<String>()
        /** THE ENCODED PATCH is what the clearing tests assert. */
        var sentChanges: ProfileChanges? = null
        var updateCalls = 0

        override suspend fun own(): ApiResult<OwnProfileResponse> =
            ownResult ?: ApiResult.Ok(
                OwnProfileResponse(userId = "me", username = "me", displayName = "Me"),
            )

        override suspend fun user(userId: String): ApiResult<PublicProfileResponse> =
            userResult ?: ApiResult.Ok(
                PublicProfileResponse(userId = userId, username = userId, displayName = userId),
            )

        override suspend fun updateProfile(
            changes: ProfileChanges,
        ): ApiResult<OwnProfileResponse> {
            updateCalls++
            sentChanges = changes
            return updateResult
                ?: ApiResult.Ok(
                    OwnProfileResponse(userId = "me", username = "me", displayName = "Me"),
                )
        }

        override suspend fun posts(
            userId: String,
            cursor: FeedCursor?,
        ): ApiResult<ProfilePostPage> =
            postPages.removeFirstOrNull() ?: ApiResult.Ok(ProfilePostPage(emptyList(), null))

        override suspend fun followers(userId: String, before: String?): ApiResult<UserPage> {
            listedKinds += UserListKind.FOLLOWERS
            listedIds += userId
            return userPages.removeFirstOrNull() ?: ApiResult.Ok(UserPage(emptyList(), null))
        }

        override suspend fun following(userId: String, before: String?): ApiResult<UserPage> {
            listedKinds += UserListKind.FOLLOWING
            listedIds += userId
            return userPages.removeFirstOrNull() ?: ApiResult.Ok(UserPage(emptyList(), null))
        }

        override suspend fun follow(userId: String): ApiResult<Unit> {
            followCalls++
            return followResult
        }

        override suspend fun unfollow(userId: String): ApiResult<Unit> {
            unfollowCalls++
            return followResult
        }

        override suspend fun saved(cursor: FeedCursor?): ApiResult<ProfilePostPage> =
            savedPages.removeFirstOrNull() ?: ApiResult.Ok(ProfilePostPage(emptyList(), null))

        override suspend fun unsave(postId: String): ApiResult<Unit> = unsaveResult

        override suspend fun like(postId: String): ApiResult<Unit> = likeResult

        override suspend fun unlike(postId: String): ApiResult<Unit> = likeResult
    }

    private fun profileVm(
        script: Script,
        relations: ViewerRelations = ViewerRelations(),
        userId: String? = "them",
        viewer: String? = "me",
    ) = ProfileViewModel(
        profiles = script,
        relations = relations,
        userId = userId,
        viewerId = { viewer },
    )

    // ==================================================== the encoded PATCH
    @Test
    fun `AN EMPTIED FIELD IS SENT AS AN EXPLICIT NULL, NOT OMITTED`() {
        // The API: "send null to clear an optional field; omit it to leave it
        // alone." `MohallaJson` sets `explicitNulls = false`, which omits a null
        // property when writing — so a typed body said "leave it alone" every
        // time and nobody could remove their own bio. Asserted on the ENCODED
        // OBJECT, because the data class was exactly what looked correct.
        val body = patch {
            field("displayName", "Ayesha Khan")
            field("bio", null)
        }

        assertEquals(JsonPrimitive("Ayesha Khan"), body["displayName"])
        assertTrue("the key must be PRESENT", "bio" in body)
        assertEquals("and its value must be null", JsonNull, body["bio"])
        assertFalse("an untouched field is absent entirely", "city" in body)
    }

    @Test
    fun `A DATA CLASS CANNOT EXPRESS A CLEAR UNDER THIS PARSER, AND THAT IS THE BUG`() {
        // The reason `PatchBody` exists, demonstrated rather than asserted in a
        // comment. `MohallaJson` sets `explicitNulls = false` — correct for
        // READING, because a server that stops sending an optional field must
        // not crash a screen — and it also OMITS a null property when writing.
        //
        // So the obvious implementation is silently wrong: this body means
        // "clear the bio" and encodes as "leave everything alone". Anyone
        // tempted to replace the JsonObject with a tidy data class fails here,
        // with the encoded string in the message.
        val typed = MohallaJson.encodeToString(
            Clearable.serializer(),
            Clearable(displayName = "Ayesha Khan", bio = null),
        )
        assertFalse(
            "explicitNulls = false drops it: $typed",
            typed.contains("bio"),
        )

        val built = MohallaJson.encodeToString(
            kotlinx.serialization.json.JsonObject.serializer(),
            patch {
                field("displayName", "Ayesha Khan")
                field("bio", null)
            },
        )
        assertTrue("the JSON body keeps it: $built", built.contains("\"bio\":null"))
    }

    @Serializable
    private data class Clearable(val displayName: String? = null, val bio: String? = null)

    @Test
    fun `AN UNCHANGED FIELD IS ABSENT, BECAUSE LAST WRITE WINS`() {
        // Re-sending a value the reader never touched would quietly overwrite a
        // change made on another device between this screen loading and saving.
        assertEquals(Patch.Unchanged, changedTo("Karachi", "Karachi"))
        assertEquals(Patch.Unchanged, changedTo("Karachi", "  Karachi  "))
        assertEquals(Patch.Clear, changedTo("Karachi", ""))
        assertEquals(Patch.Clear, changedTo("Karachi", "   "))
        assertEquals(Patch.Set("Lahore"), changedTo("Karachi", "Lahore"))
        // Blank and absent mean the same thing: a field the user emptied holds
        // "" and a field the server never had is null.
        assertEquals(Patch.Unchanged, changedTo(null, ""))
    }

    @Test
    fun `A PATCH WITH NOTHING IN IT IS EMPTY, AND IS NOT SENT`() = runTest(dispatcher) {
        val script = Script(ownResult = ApiResult.Ok(own()))
        val vm = EditProfileViewModel(script, uploader = FailingUploader)
        advanceUntilIdle()

        var saved = false
        vm.save(onSaved = { saved = true })
        advanceUntilIdle()

        assertTrue("leaving without a request is the honest outcome", saved)
        assertEquals(0, script.updateCalls)
    }

    @Test
    fun `CLEARING A BIO REACHES THE REPOSITORY AS A CLEAR`() = runTest(dispatcher) {
        val script = Script(ownResult = ApiResult.Ok(own(bio = "Water and sanitation.")))
        val vm = EditProfileViewModel(script, uploader = FailingUploader)
        advanceUntilIdle()

        vm.onBioChanged("")
        vm.save(onSaved = {})
        advanceUntilIdle()

        val changes = requireNotNull(script.sentChanges)
        assertEquals(Patch.Clear, changes.bio)
        assertEquals("nothing else was touched", Patch.Unchanged, changes.city)
        assertNull(changes.displayName)
    }

    @Test
    fun `REMOVING A PHOTO IS A CLEAR AND NOT AN OMISSION`() = runTest(dispatcher) {
        val script = Script(ownResult = ApiResult.Ok(own(photoMediaId = "m1")))
        val vm = EditProfileViewModel(script, uploader = FailingUploader)
        advanceUntilIdle()

        vm.removePhoto()
        vm.save(onSaved = {})
        advanceUntilIdle()

        assertEquals(Patch.Clear, requireNotNull(script.sentChanges).photoMediaId)
    }

    // ================================================== BR-005 · the handle
    @Test
    fun `THE USERNAME IS NOT AN EDITABLE FIELD, ANYWHERE IN THE REQUEST`() {
        // BR-005 makes a handle permanent and the server REJECTS a `username`
        // in this body rather than ignoring it. So there is no field to send —
        // asserted on the request type's complete shape, because a field added
        // later would compile and would be refused at runtime by a server the
        // client had no reason to be arguing with.
        assertExactFields(
            ProfileChanges::class.java,
            setOf("displayName", "city", "bio", "photoMediaId"),
            "BR-005 — a username is claimed once and is permanent; PROFILE-FR-003 edits " +
                "the four fields that are not",
        )
    }

    @Test
    fun `A HANDLE IS WRAPPED SO AN URDU LINE CANNOT RE-ORDER ITS AT-SIGN`() {
        // The `@` is a NEUTRAL character: the bidi algorithm gives it the
        // paragraph's direction, so an unmarked "@sana_bashir" in a
        // right-to-left line renders as "sana_bashir@" and looks mistyped.
        val wrapped = ltr("@sana_bashir")

        assertTrue("opens with a left-to-right isolate", wrapped.startsWith('⁦'))
        assertTrue("and closes it", wrapped.endsWith('⁩'))
        assertEquals("@sana_bashir", wrapped.trim('⁦', '⁩'))
        // Nothing invisible is added to nothing.
        assertEquals("", ltr(""))
    }

    // ============================================== PRIV-003 · the projection
    @Test
    fun `A PROFILE HAS NOWHERE TO PUT A PHONE NUMBER`() {
        // PRIV-003: "phone, email and date of birth are never shown." §162 puts
        // it structurally: the projection is built by NAMING the fields it
        // wants, so "adding a column to `profiles` can never widen what this
        // returns". The client's own view type is asserted the same way — a
        // field added under any name fails here, with the requirement quoted.
        assertExactFields(
            ProfileView::class.java,
            setOf(
                "userId", "username", "displayName", "city", "bio", "photoMediaId",
                "verifiedBadge", "followerCount", "followingCount", "postCount",
            ),
            "PRIV-003 — display name, username, photo, city, bio, badge and counts, and " +
                "nothing else. `GET /me` returns a superset and the extra fields are the " +
                "owner's own account state, never contact details",
        )
    }

    // ================================================ SOCIAL-FR-001 · GAP-M-011
    @Test
    fun `AN UNKNOWN FOLLOW STATE OFFERS FOLLOW, BECAUSE THE OTHER MISTAKE IS WORSE`() =
        runTest(dispatcher) {
            // No response anywhere says whether the viewer already follows
            // somebody (GAP-M-011). A repeat follow is idempotent and moves no
            // count, so offering Follow to somebody already followed costs a
            // wasted tap — where a wrongly-shown "Following" would stop the
            // viewer following them at all.
            val vm = profileVm(Script())
            advanceUntilIdle()

            assertEquals(Relation.Unknown, vm.state.value.followState)
            assertFalse("Unknown is never treated as done", vm.state.value.followState.isDone)
        }

    @Test
    fun `FOLLOWING SOMEBODY IS REMEMBERED FOR EVERY OTHER SCREEN THIS SESSION`() =
        runTest(dispatcher) {
            // Without this the same person re-opened from search two taps later
            // would offer Follow again, which reads as the first tap having
            // failed.
            val relations = ViewerRelations()
            val script = Script()
            val vm = profileVm(script, relations)
            advanceUntilIdle()

            vm.toggleFollow()
            advanceUntilIdle()

            assertEquals(1, script.followCalls)
            assertEquals(Relation.Yes, relations.followState("them"))

            // A second screen, built fresh, agrees.
            val second = profileVm(Script(), relations)
            advanceUntilIdle()
            assertEquals(Relation.Yes, second.state.value.followState)
        }

    @Test
    fun `THE FOLLOWER COUNT MOVES AT ONCE AND MOVES BACK ON A REFUSAL`() =
        runTest(dispatcher) {
            // PROFILE-FR-009: counts "update on follow or unfollow". A number
            // that stays still for a round trip reads as a control that did
            // nothing, on the one screen where the number IS the feedback.
            val script = Script(
                userResult = ApiResult.Ok(person("them").copy(followerCount = 10)),
                followResult = ApiResult.Err(ApiFailure.Offline),
            )
            val vm = profileVm(script)
            advanceUntilIdle()

            assertEquals(10, vm.state.value.profile?.followerCount)

            vm.toggleFollow()
            // Immediately, before the request has run.
            assertEquals(11, vm.state.value.profile?.followerCount)
            assertEquals(Relation.Yes, vm.state.value.followState)

            advanceUntilIdle()

            assertEquals("back where it was", 10, vm.state.value.profile?.followerCount)
            assertEquals(Relation.Unknown, vm.state.value.followState)
            assertTrue(vm.state.value.followFailed)
        }

    @Test
    fun `THE VIEWER'S OWN PROFILE OFFERS NO FOLLOW CONTROL AT ALL`() = runTest(dispatcher) {
        // BR-019 — a user cannot follow themselves, and the server refuses it
        // with a 400. The control is simply not there rather than there and
        // refused.
        val vm = profileVm(Script(), userId = null)
        advanceUntilIdle()

        assertTrue(vm.state.value.isOwn)
        assertFalse(vm.state.value.canFollow)

        vm.toggleFollow()
        advanceUntilIdle()
        // Nothing happened.
        assertEquals(Relation.Unknown, vm.state.value.followState)
    }

    @Test
    fun `OPENING SOMEBODY ELSE'S PROFILE BY THEIR OWN ID STILL READS AS THEIRS`() =
        runTest(dispatcher) {
            // The route carries an id and the viewer's own id is known
            // separately; a profile opened by id that happens to be the viewer's
            // is the OWNER's, and must offer Edit rather than Follow.
            val script = Script(userResult = ApiResult.Ok(person("me")))
            val vm = profileVm(script, userId = "me", viewer = "me")
            advanceUntilIdle()

            assertTrue(vm.state.value.isOwn)
        }

    // ============================================== BR-025 · the neutral state
    @Test
    fun `BLOCKED, BANNED, DELETED AND NEVER-EXISTED ARE ONE STATE`() = runTest(dispatcher) {
        // UX-PROFILE-002: "Blocked, banned, deleted or not found → ONE identical
        // neutral state. No case is distinguishable." The client is handed one
        // 404 and there is exactly one branch for it.
        val script = Script(
            userResult = ApiResult.Err(ApiFailure.Unavailable("This content is no longer available.")),
        )
        val vm = profileVm(script)
        advanceUntilIdle()

        assertTrue(vm.state.value.unavailable)
        assertNull(vm.state.value.profile)
    }

    @Test
    fun `AN OFFLINE PROFILE IS NOT THE NEUTRAL STATE`() = runTest(dispatcher) {
        // UX-STATE-002 is a different screen with a different promise: the
        // profile may well exist and a retry is likely to work. Collapsing the
        // two would tell somebody a neighbour's account was gone because a
        // train went into a tunnel.
        val script = Script(userResult = ApiResult.Err(ApiFailure.Offline))
        val vm = profileVm(script)
        advanceUntilIdle()

        assertFalse(vm.state.value.unavailable)
        assertEquals(ApiFailure.Offline, vm.state.value.failure)
    }

    // ================================================ PROFILE-FR-004/008
    @Test
    fun `STATISTICS STILL RENDER WHEN THE POST LIST FAILS`() = runTest(dispatcher) {
        // The wireframe says so by hand: "No posts → 'No posts yet'. Statistics
        // still render." Two requests, two independent states — a post list that
        // failed must not take the identity down with it.
        val script = Script(
            userResult = ApiResult.Ok(person("them").copy(postCount = 128)),
            postPages = mutableListOf(ApiResult.Err(ApiFailure.Offline)),
        )
        val vm = profileVm(script)
        advanceUntilIdle()

        assertEquals(128, vm.state.value.profile?.postCount)
        assertEquals(ApiFailure.Offline, vm.state.value.postsFailure)
        assertFalse("a failed list is not an empty one", vm.state.value.hasNoPosts)
    }

    @Test
    fun `a genuinely empty post list says so`() = runTest(dispatcher) {
        val script = Script(
            postPages = mutableListOf(ApiResult.Ok(ProfilePostPage(emptyList(), null))),
        )
        val vm = profileVm(script)
        advanceUntilIdle()

        assertTrue(vm.state.value.hasNoPosts)
        assertNull(vm.state.value.postsFailure)
    }

    @Test
    fun `BR-032's UNDER-REVIEW POSTS ARE NOT FILTERED OUT OF THE OWNER'S OWN LIST`() =
        runTest(dispatcher) {
            // "GIVEN a post of mine is auto-hidden, WHEN I view my own profile,
            // THEN I see it labelled under review, and no other user sees it at
            // all." The server decides who gets the row; the client's job is not
            // to drop it.
            val hidden = post("p1").copy(underReview = true)
            val script = Script(
                postPages = mutableListOf(ApiResult.Ok(ProfilePostPage(listOf(hidden, post("p2")), null))),
            )
            val vm = profileVm(script, userId = null)
            advanceUntilIdle()

            assertEquals(listOf("p1", "p2"), vm.state.value.posts.map { it.id })
            assertTrue(vm.state.value.posts.first().underReview)
        }

    @Test
    fun `a post arriving twice between pages is listed once`() = runTest(dispatcher) {
        val script = Script(
            postPages = mutableListOf(
                ApiResult.Ok(
                    ProfilePostPage(listOf(post("p1"), post("p2")), FeedCursor("t", "p2")),
                ),
                ApiResult.Ok(ProfilePostPage(listOf(post("p2"), post("p3")), null)),
            ),
        )
        val vm = profileVm(script)
        advanceUntilIdle()

        vm.loadMorePosts()
        advanceUntilIdle()

        assertEquals(listOf("p1", "p2", "p3"), vm.state.value.posts.map { it.id })
    }

    @Test
    fun `A LIKE ON A PROFILE'S POST WORKS, AND REVERTS`() = runTest(dispatcher) {
        // ENGAGE-FR-001 applies wherever a post card is drawn. A heart that does
        // nothing outside the feed is the kind of inert control a reader taps
        // three times before deciding the app is broken.
        val script = Script(
            postPages = mutableListOf(
                ApiResult.Ok(ProfilePostPage(listOf(post("p1", liked = false, likes = 2)), null)),
            ),
            likeResult = ApiResult.Err(ApiFailure.Offline),
        )
        val vm = profileVm(script)
        advanceUntilIdle()

        vm.toggleLike("p1")
        assertEquals(3, vm.state.value.posts.single().likeCount)
        assertTrue(vm.state.value.posts.single().viewerHasLiked)

        advanceUntilIdle()

        assertEquals(2, vm.state.value.posts.single().likeCount)
        assertFalse(vm.state.value.posts.single().viewerHasLiked)
    }

    // ================================================ SOCIAL-FR-003/004
    @Test
    fun `EACH LIST CALLS ITS OWN ENDPOINT`() = runTest(dispatcher) {
        val followers = Script(userPages = mutableListOf(ApiResult.Ok(UserPage(listOf(person("a")), null))))
        UserListViewModel(followers, ViewerRelations(), "them", UserListKind.FOLLOWERS) { "me" }
        advanceUntilIdle()
        assertEquals(listOf(UserListKind.FOLLOWERS), followers.listedKinds)

        val following = Script()
        UserListViewModel(following, ViewerRelations(), "them", UserListKind.FOLLOWING) { "me" }
        advanceUntilIdle()
        assertEquals(listOf(UserListKind.FOLLOWING), following.listedKinds)
    }

    @Test
    fun `THE VIEWER'S OWN FOLLOWING LIST IS THE ONE PLACE THE API ANSWERS THE QUESTION`() =
        runTest(dispatcher) {
            // Twenty people at a time, incidentally. Nothing else in the product
            // answers "does this viewer follow that person" (GAP-M-011), so a
            // Follow control that is right more often is worth two lines.
            val relations = ViewerRelations()
            val script = Script(
                userPages = mutableListOf(
                    ApiResult.Ok(UserPage(listOf(person("a"), person("b")), null)),
                ),
            )
            UserListViewModel(script, relations, "me", UserListKind.FOLLOWING) { "me" }
            advanceUntilIdle()

            assertEquals(Relation.Yes, relations.followState("a"))
            assertEquals(Relation.Yes, relations.followState("b"))
            // Anybody not on the page stays unknown: the list is paginated, so
            // an absent id may simply be on page three.
            assertEquals(Relation.Unknown, relations.followState("c"))
        }

    @Test
    fun `SOMEBODY ELSE'S LISTS PROVE NOTHING ABOUT THE VIEWER`() = runTest(dispatcher) {
        // A follower list says who follows the PROFILE, and somebody else's
        // following list says who THEY follow. Recording either would put a
        // confident wrong answer where an honest `Unknown` was.
        val relations = ViewerRelations()

        UserListViewModel(
            Script(userPages = mutableListOf(ApiResult.Ok(UserPage(listOf(person("a")), null)))),
            relations,
            "them",
            UserListKind.FOLLOWING,
        ) { "me" }
        advanceUntilIdle()
        assertEquals(Relation.Unknown, relations.followState("a"))

        UserListViewModel(
            Script(userPages = mutableListOf(ApiResult.Ok(UserPage(listOf(person("b")), null)))),
            relations,
            "me",
            UserListKind.FOLLOWERS,
        ) { "me" }
        advanceUntilIdle()
        assertEquals(Relation.Unknown, relations.followState("b"))
    }

    @Test
    fun `A FAILED LIST IS NEVER RENDERED AS AN EMPTY ONE`() = runTest(dispatcher) {
        // "No followers yet" after a timeout is a statement about somebody's
        // standing in their neighbourhood that the request never established.
        val script = Script(userPages = mutableListOf(ApiResult.Err(ApiFailure.Offline)))
        val vm = UserListViewModel(script, ViewerRelations(), "them", UserListKind.FOLLOWERS) { "me" }
        advanceUntilIdle()

        assertFalse(vm.state.value.isEmpty)
        assertEquals(ApiFailure.Offline, vm.state.value.firstPageFailure)
    }

    // ==================================================== FEED-FR-007
    @Test
    fun `EVERY ROW IN THE SAVED LIST IS KNOWN TO BE SAVED`() = runTest(dispatcher) {
        // The one place the client can be certain, which is the opposite of the
        // post detail screen where the toggle's resting position is a guess
        // (GAP-M-012).
        val relations = ViewerRelations()
        val script = Script(
            savedPages = mutableListOf(
                ApiResult.Ok(ProfilePostPage(listOf(post("p1"), post("p2")), null)),
            ),
        )
        SavedPostsViewModel(script, relations)
        advanceUntilIdle()

        assertEquals(Relation.Yes, relations.saveState("p1"))
        assertEquals(Relation.Yes, relations.saveState("p2"))
    }

    @Test
    fun `AN UNSAVE THAT FAILS PUTS THE ROW BACK WHERE IT WAS`() = runTest(dispatcher) {
        // Appending it to the end would look like a different post arriving.
        val relations = ViewerRelations()
        val script = Script(
            savedPages = mutableListOf(
                ApiResult.Ok(ProfilePostPage(listOf(post("p1"), post("p2"), post("p3")), null)),
            ),
            unsaveResult = ApiResult.Err(ApiFailure.Offline),
        )
        val vm = SavedPostsViewModel(script, relations)
        advanceUntilIdle()

        vm.unsave("p2")
        assertEquals(listOf("p1", "p3"), vm.state.value.posts.map { it.id })

        advanceUntilIdle()

        assertEquals(listOf("p1", "p2", "p3"), vm.state.value.posts.map { it.id })
        assertTrue(vm.state.value.actionFailed)
        assertEquals(Relation.Yes, relations.saveState("p2"))
    }

    @Test
    fun `a successful unsave leaves the row out and the state known`() = runTest(dispatcher) {
        val relations = ViewerRelations()
        val script = Script(
            savedPages = mutableListOf(
                ApiResult.Ok(ProfilePostPage(listOf(post("p1"), post("p2")), null)),
            ),
        )
        val vm = SavedPostsViewModel(script, relations)
        advanceUntilIdle()

        vm.unsave("p1")
        advanceUntilIdle()

        assertEquals(listOf("p2"), vm.state.value.posts.map { it.id })
        assertEquals(Relation.No, relations.saveState("p1"))
        assertFalse(vm.state.value.actionFailed)
    }

    @Test
    fun `a failed saved list is not an empty collection`() = runTest(dispatcher) {
        val script = Script(savedPages = mutableListOf(ApiResult.Err(ApiFailure.Offline)))
        val vm = SavedPostsViewModel(script, ViewerRelations())
        advanceUntilIdle()

        assertFalse(vm.state.value.isEmpty)
        assertEquals(ApiFailure.Offline, vm.state.value.firstPageFailure)
    }

    // ================================================ the relation tri-state
    @Test
    fun `UNKNOWN IS A THIRD ANSWER AND NEVER COLLAPSES INTO NO`() {
        // A `Map<String, Boolean>` would allow the same information and would
        // also allow `map[id] ?: false` — collapsing the third state back into a
        // guess, silently, at one call site.
        val relations = ViewerRelations()

        assertEquals(Relation.Unknown, relations.followState("a"))
        assertFalse(Relation.Unknown.isDone)

        relations.recordFollow("a", false)
        assertEquals(Relation.No, relations.followState("a"))
        assertFalse(Relation.No.isDone)

        relations.recordFollow("a", true)
        assertEquals(Relation.Yes, relations.followState("a"))
        assertTrue(Relation.Yes.isDone)
    }

    @Test
    fun `signing out forgets every relationship`() {
        // A relationship belongs to an account, not to an install — and a shared
        // phone is a common arrangement in this market.
        val relations = ViewerRelations()
        relations.recordFollow("a", true)
        relations.recordSave("p1", true)

        relations.clear()

        assertEquals(Relation.Unknown, relations.followState("a"))
        assertEquals(Relation.Unknown, relations.saveState("p1"))
    }

    private companion object {
        /**
         * Never used.
         *
         * These tests exercise REMOVING a photo, which is a client-side state
         * change and a JSON null — the upload path itself is `ImageUploader`'s
         * and is covered where the composer's per-attachment sequencing is. Its
         * API is a proxy that throws, so a test that started uploading would
         * fail loudly rather than quietly reaching the network.
         */
        val FailingUploader = ImageUploader(
            api = Proxy.newProxyInstance(
                MohallaApi::class.java.classLoader,
                arrayOf(MohallaApi::class.java),
            ) { _, _, _ -> error("the profile tests never upload") } as MohallaApi,
            http = OkHttpClient(),
        )
    }
}
