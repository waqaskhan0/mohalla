package org.shehersaaz.mohalla.core.network

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST

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
