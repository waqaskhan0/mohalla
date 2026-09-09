package org.shehersaaz.mohalla.feature.auth

import org.shehersaaz.mohalla.core.network.ApiFailure
import org.shehersaaz.mohalla.core.network.ApiResult
import org.shehersaaz.mohalla.core.network.ForgotPasswordRequest
import org.shehersaaz.mohalla.core.network.LoginRequest
import org.shehersaaz.mohalla.core.network.MohallaApi
import org.shehersaaz.mohalla.core.network.RegisterRequest
import org.shehersaaz.mohalla.core.network.ResendOtpRequest
import org.shehersaaz.mohalla.core.network.ResetPasswordRequest
import org.shehersaaz.mohalla.core.network.VerifyOtpRequest
import org.shehersaaz.mohalla.core.network.apiCall
import org.shehersaaz.mohalla.feature.startup.SessionRepository

/**
 * The authentication calls, and the one discipline the client must not break.
 *
 * SEC-006 — THE BACKEND'S RESPONSES ARE DELIBERATELY UNIFORM, AND THIS LAYER
 * KEEPS THEM THAT WAY.
 *
 *   - `/register` returns `202` whether the number was free, already held,
 *     pending deletion or banned. The distinction is delivered by the OTP,
 *     which only reaches the number's actual holder. So [register] returns
 *     `Unit` on success: **there is nothing to branch on, and no field is
 *     exposed that a screen could branch on.**
 *   - `/login` returns one `FAILED` for a wrong password, an unknown number and
 *     a banned account — *in comparable time*, because the backend hashes even
 *     when there is no account. [login] therefore has a single
 *     [LoginOutcome.Failed] and no variants.
 *   - `/password/forgot` is uniform for the same reason.
 *
 * A client that mapped these to different copy would hand back precisely the
 * fact the backend spent that effort withholding — and it would do it while
 * every backend test still passed, because the leak would be entirely on this
 * side. That is why the *types* here refuse to carry the distinction rather
 * than relying on screens not to look.
 */
class AuthRepository(
    private val api: MohallaApi,
    private val sessions: SessionRepository,
) {

    /**
     * AUTH-FR-001/002 — register.
     *
     * `Unit` on success, deliberately. Returning the server's body would let a
     * screen inspect it, and there is nothing in it worth inspecting: the
     * acknowledgement is identical in every case.
     */
    suspend fun register(
        e164Phone: String,
        password: String,
        dateOfBirth: String,
        termsVersion: String,
        accountType: AccountType,
    ): ApiResult<Unit> = apiCall {
        api.register(
            RegisterRequest(
                phone = e164Phone,
                password = password,
                dateOfBirth = dateOfBirth,
                termsVersion = termsVersion,
                // PROFILE-FR-006. NOT OPTIONAL HERE even though it is optional
                // on the wire: the server defaults an absent value to
                // INDIVIDUAL, so leaving this nullable is what let every
                // account created through this app become an individual
                // regardless of what the person was. A required parameter
                // means a caller has to have asked.
                accountType = accountType.wire,
            ),
        )
    }.let { result ->
        when (result) {
            is ApiResult.Ok -> ApiResult.Ok(Unit)
            is ApiResult.Err -> result
        }
    }

    /**
     * AUTH-FR-003 — verify the OTP, which is what actually creates the session.
     *
     * The token is stored HERE rather than returned to the caller, so no screen
     * ever holds a bearer token in composition state where a recomposition or a
     * crash report could carry it (SEC-028).
     */
    suspend fun verifyOtp(e164Phone: String, code: String, purpose: OtpPurpose): ApiResult<Unit> {
        val result = apiCall {
            api.verifyOtp(VerifyOtpRequest(phone = e164Phone, code = code, purpose = purpose.wire))
        }
        return when (result) {
            is ApiResult.Ok -> {
                result.value.token?.let(sessions::store)
                ApiResult.Ok(Unit)
            }
            is ApiResult.Err -> result
        }
    }

    suspend fun resendOtp(e164Phone: String, purpose: OtpPurpose): ApiResult<Unit> =
        apiCall { api.resendOtp(ResendOtpRequest(phone = e164Phone, purpose = purpose.wire)) }
            .let { if (it is ApiResult.Ok) ApiResult.Ok(Unit) else it as ApiResult.Err }

    /**
     * AUTH-FR-005 — log in.
     *
     * The capability comes back with the session and matters: `READ_ONLY` is a
     * suspension (BR-034) and `RESTORE_ONLY` is a pending deletion
     * (SET-FR-005), and both are legitimate sign-ins that land somewhere other
     * than Home.
     */
    suspend fun login(e164Phone: String, password: String): ApiResult<LoginOutcome> {
        val result = apiCall {
            api.login(LoginRequest(phone = e164Phone, password = password))
        }

        return when (result) {
            is ApiResult.Ok -> {
                val body = result.value
                when {
                    body.status == "VERIFICATION_REQUIRED" ->
                        ApiResult.Ok(LoginOutcome.VerificationRequired)

                    body.token != null -> {
                        sessions.store(body.token)
                        ApiResult.Ok(
                            LoginOutcome.Authenticated(
                                capability = body.capability ?: "FULL",
                            ),
                        )
                    }

                    else -> ApiResult.Ok(LoginOutcome.Failed)
                }
            }

            is ApiResult.Err -> when (result.failure) {
                // 401 is the uniform failure. ONE outcome — no variant for
                // "wrong password" versus "no such account" versus "banned",
                // because the server does not distinguish them and neither may
                // this. `Unauthenticated` here is a failed sign-in ATTEMPT, not
                // an expired session, so it must not trigger the global
                // sign-out interceptor's copy.
                ApiFailure.Unauthenticated -> ApiResult.Ok(LoginOutcome.Failed)
                else -> result
            }
        }
    }

    /** AUTH-FR-006 — uniform acknowledgement, like registration. */
    suspend fun forgotPassword(e164Phone: String): ApiResult<Unit> =
        apiCall { api.forgotPassword(ForgotPasswordRequest(phone = e164Phone)) }
            .let { if (it is ApiResult.Ok) ApiResult.Ok(Unit) else it as ApiResult.Err }

    suspend fun resetPassword(
        e164Phone: String,
        code: String,
        newPassword: String,
    ): ApiResult<Unit> = apiCall {
        api.resetPassword(
            ResetPasswordRequest(phone = e164Phone, code = code, newPassword = newPassword),
        )
    }.let { if (it is ApiResult.Ok) ApiResult.Ok(Unit) else it as ApiResult.Err }

    /** SET-FR-005 — restore inside the grace period. */
    suspend fun restoreAccount(): ApiResult<Unit> =
        apiCall { api.restoreAccount() }
            .let { if (it is ApiResult.Ok) ApiResult.Ok(Unit) else it as ApiResult.Err }

    suspend fun logout(): ApiResult<Unit> {
        val result = apiCall { api.logout() }
        // SET-FR-006 — cleared regardless of whether the server call succeeded.
        // A failed logout must still sign the user out locally; leaving the
        // token because the network dropped would be the opposite of what they
        // asked for.
        sessions.signOut()
        return if (result is ApiResult.Ok) ApiResult.Ok(Unit) else result as ApiResult.Err
    }
}

enum class OtpPurpose(val wire: String) {
    REGISTRATION("REGISTRATION"),
    PASSWORD_RESET("PASSWORD_RESET"),
}

/**
 * What a login attempt produced.
 *
 * [Failed] has no detail and must not gain any. Everything the user is told
 * about a failed sign-in is one sentence, identical in every case.
 */
sealed interface LoginOutcome {
    data class Authenticated(val capability: String) : LoginOutcome
    /** UNVERIFIED — registration was interrupted. Safe to disclose: the
     *  password was correct, so this is the caller's own account. */
    data object VerificationRequired : LoginOutcome
    data object Failed : LoginOutcome
}
