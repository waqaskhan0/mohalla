package org.shehersaaz.mohalla.core.network

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.PATCH
import retrofit2.http.POST
import retrofit2.http.PUT
import retrofit2.http.Path
import retrofit2.http.Query

/**
 * The Retrofit surface, built against the GENERATED Stage 6 contract
 * (`docs/architecture/contracts/openapi-stage6-generated.json` — 88 paths, 104
 * operations, emitted from the running backend).
 *
 * NOT built against `openapi-v1.yaml`. That Stage 4 file describes 20
 * operations under different prefixes — `/auth/register`, `/m/me/username`,
 * `/a/moderation/queue` — and the implementation serves `/register`,
 * `/me/username` and `/admin/moderation/queue`. A client generated from it
 * would compile and talk to nothing. Recorded as a correction in
 * `docs/implementation/mobile/00-mobile-baseline.md` rather than followed
 * silently (§4 of the Stage 7 brief).
 *
 * Paths are relative, with no leading slash, so the base URL's own path segment
 * is preserved if one is ever added.
 */
interface MohallaApi {

    // ---------------------------------------------------------------- identity
    @POST("register")
    suspend fun register(@Body body: RegisterRequest): Response<AcceptedResponse>

    @POST("otp/verify")
    suspend fun verifyOtp(@Body body: VerifyOtpRequest): Response<SessionResponse>

    @POST("otp/resend")
    suspend fun resendOtp(@Body body: ResendOtpRequest): Response<AcceptedResponse>

    @POST("login")
    suspend fun login(@Body body: LoginRequest): Response<LoginResponse>

    @POST("logout")
    suspend fun logout(): Response<Unit>

    @POST("password/forgot")
    suspend fun forgotPassword(@Body body: ForgotPasswordRequest): Response<AcceptedResponse>

    @POST("password/reset")
    suspend fun resetPassword(@Body body: ResetPasswordRequest): Response<AcceptedResponse>

    @POST("password/change")
    suspend fun changePassword(@Body body: ChangePasswordRequest): Response<Unit>

    /** SET-FR-005 — reachable with the RESTORE_ONLY session login issues. */
    @POST("me/restore")
    suspend fun restoreAccount(): Response<RestoreResponse>

    // ------------------------------------------------------------------ profile
    @GET("me")
    suspend fun me(): Response<OwnProfileResponse>

    /**
     * ADVISORY ONLY (EDGE-007). The answer can be stale by the time the user
     * taps Continue; `claimUsername` is what decides.
     */
    @GET("username/available")
    suspend fun usernameAvailable(@Query("username") username: String): Response<AvailabilityResponse>

    @POST("me/username")
    suspend fun claimUsername(@Body body: ClaimUsernameRequest): Response<OwnProfileResponse>

    @POST("me/profile")
    suspend fun createProfile(@Body body: CreateProfileRequest): Response<OwnProfileResponse>

    @PATCH("me/profile")
    suspend fun updateProfile(@Body body: UpdateProfileRequest): Response<OwnProfileResponse>

    @GET("categories")
    suspend fun categories(): Response<CategoriesResponse>

    @GET("suggestions")
    suspend fun suggestions(@Query("limit") limit: Int): Response<SuggestionsResponse>

    @PUT("users/{id}/follow")
    suspend fun follow(@Path("id") userId: String): Response<Unit>

    @DELETE("users/{id}/follow")
    suspend fun unfollow(@Path("id") userId: String): Response<Unit>

    // --------------------------------------------------------------------- feed
    //
    // FEED-FR-001: reverse chronological, no ranking. Pagination is KEYSET, not
    // offset - a cursor of (createdAt, id) - because a new post arriving
    // between pages shifts every offset and makes page two repeat or skip.
    @GET("feed/following")
    suspend fun feedFollowing(
        @Query("limit") limit: Int? = null,
        @Query("cursorCreatedAt") cursorCreatedAt: String? = null,
        @Query("cursorId") cursorId: String? = null,
        @Query("category") category: String? = null,
    ): Response<FeedResponse>

    @GET("feed/discover")
    suspend fun feedDiscover(
        @Query("limit") limit: Int? = null,
        @Query("cursorCreatedAt") cursorCreatedAt: String? = null,
        @Query("cursorId") cursorId: String? = null,
        @Query("category") category: String? = null,
    ): Response<FeedResponse>

    /**
     * FEED-FR-002 - its OWN endpoint, by requirement.
     *
     * Featured renders independently of the feeds, so a Following feed that is
     * empty or failing still leaves something on screen (RSK-001, REL-005).
     * Unauthenticated-safe and locale-parameterised.
     */
    @GET("feed/featured")
    suspend fun feedFeatured(@Query("locale") locale: String? = null): Response<FeaturedResponse>

    @GET("posts/{id}")
    suspend fun post(@Path("id") id: String): Response<PostResponse>

    @PUT("posts/{id}/like")
    suspend fun like(@Path("id") id: String): Response<Unit>

    @DELETE("posts/{id}/like")
    suspend fun unlike(@Path("id") id: String): Response<Unit>

    // -------------------------------------------------------------------- media
    //
    // ADR-013's three steps: ask for a slot, put the bytes into quarantine,
    // then ask the server to inspect and promote. The client cannot shortcut
    // it - `complete` is what makes the object usable, and it is the server's
    // inspection that decides (SEC-012).
    @POST("media/upload-slot")
    suspend fun requestUploadSlot(@Body body: UploadSlotRequest): Response<UploadSlotResponse>

    @POST("media/{id}/complete")
    suspend fun completeUpload(@Path("id") mediaId: String): Response<MediaResponse>
}

// ============================================================ request bodies
//
// Field names mirror the backend's Zod schemas exactly. `@SerialName` is used
// wherever Kotlin convention and the wire format differ, so a rename on either
// side is a compile-time change rather than a silent null at runtime.

@Serializable
data class RegisterRequest(
    val phone: String,
    val password: String,
    val dateOfBirth: String,
    val termsVersion: String,
    val accountType: String? = null,
)

@Serializable
data class VerifyOtpRequest(
    val phone: String,
    val code: String,
    val purpose: String,
)

@Serializable
data class ResendOtpRequest(
    val phone: String,
    val purpose: String,
)

@Serializable
data class ForgotPasswordRequest(
    val phone: String,
)

@Serializable
data class ResetPasswordRequest(
    val phone: String,
    val code: String,
    val newPassword: String,
)

@Serializable
data class ChangePasswordRequest(
    val currentPassword: String,
    val newPassword: String,
)

@Serializable
data class ClaimUsernameRequest(
    val username: String,
)

/**
 * PROFILE-FR-002. `null` is meaningful for the optional fields and is NOT the
 * same as an empty string - see `SetupRepository.createProfile`.
 */
@Serializable
data class CreateProfileRequest(
    val displayName: String,
    val city: String? = null,
    val bio: String? = null,
    val photoMediaId: String? = null,
)

@Serializable
data class UpdateProfileRequest(
    val displayName: String? = null,
    val city: String? = null,
    val bio: String? = null,
    val photoMediaId: String? = null,
)

@Serializable
data class UploadSlotRequest(
    val kind: String,
    /** Advisory. The stored object is re-measured server-side (SEC-012). */
    val declaredBytes: Long,
    val visibility: String? = null,
)

@Serializable
data class LoginRequest(
    val phone: String,
    val password: String,
    val deviceLabel: String? = null,
)

// =========================================================== response bodies

/**
 * The uniform acknowledgement (SEC-006).
 *
 * `/register` and the password-reset endpoints return this whether the number
 * was free, already held, pending deletion or banned. There is deliberately
 * nothing in it to branch on, and the client must not try — the distinction is
 * delivered by the OTP, which only reaches the number's actual holder.
 */
@Serializable
data class AcceptedResponse(
    val status: String? = null,
)

@Serializable
data class SessionResponse(
    val token: String? = null,
    val expiresAt: String? = null,
    val userId: String? = null,
    val capability: String? = null,
)

@Serializable
data class LoginResponse(
    val status: String? = null,
    val token: String? = null,
    val expiresAt: String? = null,
    /** `FULL`, `READ_ONLY` (BR-034) or `RESTORE_ONLY` (SET-FR-005). */
    val capability: String? = null,
    val suspendedUntil: String? = null,
)

@Serializable
data class AvailabilityResponse(
    val available: Boolean? = null,
)

@Serializable
data class CategoriesResponse(
    val categories: List<CategoryResponse> = emptyList(),
)

@Serializable
data class CategoryResponse(
    val id: String,
    val slug: String,
    val nameEn: String? = null,
    val nameUr: String? = null,
)

@Serializable
data class SuggestionsResponse(
    val users: List<SuggestedUser> = emptyList(),
)

/**
 * A suggested account (SOCIAL-FR-004).
 *
 * Carries NO phone number, email or date of birth - PRIV-003 - and the client
 * has no field here that could render one even if a future response added it.
 */
@Serializable
data class SuggestedUser(
    val userId: String,
    val username: String? = null,
    val displayName: String? = null,
    val city: String? = null,
    val photoMediaId: String? = null,
    val verifiedBadge: Boolean = false,
    val accountType: String? = null,
    val followerCount: Int = 0,
)

@Serializable
data class UploadSlotResponse(
    val mediaId: String,
    val upload: UploadTarget,
)

@Serializable
data class UploadTarget(
    val url: String,
    val method: String,
    val headers: Map<String, String> = emptyMap(),
    val expiresAt: String? = null,
)

@Serializable
data class MediaResponse(
    val id: String? = null,
    val status: String? = null,
    val width: Int? = null,
    val height: Int? = null,
)

/**
 * One post as a feed renders it.
 *
 * `author` is a `PublicProfileResponse` whose `displayName` may be the
 * `profile.deletedUser` KEY rather than a name - BR-009 keeps a departed
 * account's posts and attributes them to "Deleted User", and the server sends a
 * localisation key so both languages say it. The card resolves that key; it
 * does not print it.
 */
@Serializable
data class FeedItemResponse(
    val id: String,
    val author: PublicProfileResponse,
    val body: String,
    val categorySlug: String? = null,
    val mediaIds: List<String> = emptyList(),
    val likeCount: Int = 0,
    val commentCount: Int = 0,
    /** So the like control renders in the right state without a second call. */
    val viewerHasLiked: Boolean = false,
    val editedAt: String? = null,
    val createdAt: String,
    /** BR-032 - the AUTHOR's own view of an auto-hidden post. */
    val underReview: Boolean = false,
)

@Serializable
data class PublicProfileResponse(
    val userId: String,
    val username: String? = null,
    val displayName: String? = null,
    val city: String? = null,
    val bio: String? = null,
    val photoMediaId: String? = null,
    val verifiedBadge: Boolean = false,
    val accountType: String? = null,
    val followerCount: Int = 0,
    val followingCount: Int = 0,
    val postCount: Int = 0,
)

@Serializable
data class FeedCursorResponse(
    val createdAt: String,
    val id: String,
)

@Serializable
data class FeedResponse(
    val items: List<FeedItemResponse> = emptyList(),
    /** `null` means the end. NOT the same as an empty page. */
    val nextCursor: FeedCursorResponse? = null,
)

@Serializable
data class FeaturedResponse(
    val announcements: List<FeaturedItemResponse> = emptyList(),
)

@Serializable
data class FeaturedItemResponse(
    val id: String,
    val title: String,
    val body: String,
    val expiresAt: String? = null,
)

@Serializable
data class PostResponse(
    val id: String,
    val author: PublicProfileResponse,
    val body: String,
    val categorySlug: String? = null,
    val mediaIds: List<String> = emptyList(),
    val likeCount: Int = 0,
    val commentCount: Int = 0,
    val viewerHasLiked: Boolean = false,
    val editedAt: String? = null,
    val createdAt: String,
    val underReview: Boolean = false,
)

@Serializable
data class RestoreResponse(
    val status: String? = null,
)

/**
 * `GET /me` — the owner's own projection.
 *
 * PRIV-003: carries no phone number and no date of birth, and the client must
 * never display either even if a future field appeared. A superset of the
 * public projection, adding account state and suspension expiry.
 */
@Serializable
data class OwnProfileResponse(
    val userId: String,
    val username: String? = null,
    val displayName: String? = null,
    val city: String? = null,
    val bio: String? = null,
    val photoMediaId: String? = null,
    val verifiedBadge: Boolean = false,
    val accountType: String? = null,
    val state: String? = null,
    val suspendedUntil: String? = null,
    val followerCount: Int = 0,
    val followingCount: Int = 0,
    val postCount: Int = 0,
    @SerialName("interests") val interests: List<String> = emptyList(),
)
