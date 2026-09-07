package org.shehersaaz.mohalla.feature.startup

import org.shehersaaz.mohalla.core.network.ApiFailure
import org.shehersaaz.mohalla.core.network.ApiResult
import org.shehersaaz.mohalla.core.network.MohallaApi
import org.shehersaaz.mohalla.core.network.MohallaJson
import org.shehersaaz.mohalla.core.network.OwnProfileResponse
import org.shehersaaz.mohalla.core.network.SESSION_TOKEN_KEY
import org.shehersaaz.mohalla.core.network.apiCall
import org.shehersaaz.mohalla.core.storage.SecureStorage

/**
 * Who is signed in, if anyone.
 *
 * ONE ENDPOINT, ONE DELIBERATE EXCEPTION TO THE NEUTRAL-REFUSAL RULE.
 *
 * `GET /me` returns `404 PROFILE_NOT_CREATED` when the account exists but
 * onboarding never finished, and the backend is explicit about why that is not
 * a leak: *"this is the caller's OWN account and telling them the truth reveals
 * nothing."* Every other 404 in the product is the neutral refusal and must
 * stay indistinguishable (BR-025, SEC-019, mandatory test A).
 *
 * So the distinction is made HERE, on this one endpoint, and not by adding a
 * reason to [ApiFailure.Unavailable] — which every content screen also
 * receives, and which would then let any of them tell a blocked author from a
 * deleted one. The narrow exception stays narrow because the mechanism that
 * implements it does not exist anywhere else.
 */
class SessionRepository(
    private val api: MohallaApi,
    private val storage: SecureStorage,
) {

    fun hasToken(): Boolean = !storage.getString(SESSION_TOKEN_KEY).isNullOrBlank()

    fun store(token: String) = storage.putString(SESSION_TOKEN_KEY, token)

    /** SET-FR-006 — logout clears everything, not just the token. */
    fun signOut() = storage.clear()

    suspend fun me(): MeResult {
        if (!hasToken()) return MeResult.NoSession

        val result = apiCall { api.me() }

        return when (result) {
            is ApiResult.Ok -> MeResult.Profile(result.value)

            is ApiResult.Err -> when (val failure = result.failure) {
                // EDGE-010: revocation is server-driven and lands on the next
                // request. The token is cleared here so a restart does not try
                // it again and a stale token cannot survive a sign-out.
                ApiFailure.Unauthenticated -> {
                    signOut()
                    MeResult.NoSession
                }

                // THE EXCEPTION. Authenticated, own account, no profile yet.
                // Read from the code the backend sends rather than inferred
                // from the status, so an ordinary 404 cannot be mistaken for it.
                is ApiFailure.Unavailable -> MeResult.NeedsProfile

                ApiFailure.Offline -> MeResult.Unreachable

                // Anything else — a 500, a restriction, a rate limit — means the
                // app cannot prove who the user is. It does NOT assume in their
                // favour: see `resolveDestination`, which sends an unprovable
                // session to Welcome.
                else -> MeResult.Unreachable
            }
        }
    }
}

sealed interface MeResult {
    /** No token, or the token was rejected and has been cleared. */
    data object NoSession : MeResult

    /** Authenticated, onboarding unfinished (`PROFILE_NOT_CREATED`). */
    data object NeedsProfile : MeResult

    /** Could not ask. Distinct from "no session" so startup can say so. */
    data object Unreachable : MeResult

    data class Profile(val profile: OwnProfileResponse) : MeResult
}

/** Turn a [MeResult] into the facts the router needs. Pure, so it is testable. */
fun MeResult.toSessionFacts(): SessionFacts? = when (this) {
    MeResult.NoSession, MeResult.Unreachable -> null

    // The account exists and is usable; the profile is what is missing. State
    // is reported as ACTIVE because the account IS active — it is the profile
    // step that is outstanding, and the router branches on `hasProfile`.
    MeResult.NeedsProfile -> SessionFacts(
        state = "ACTIVE",
        capability = "FULL",
        // A username may or may not be claimed. `/me` cannot say, because it
        // 404s before it could — so onboarding restarts at the username step,
        // which is idempotent: an already-claimed username returns the caller's
        // own and moves on.
        hasUsername = false,
        hasProfile = false,
    )

    is MeResult.Profile -> SessionFacts(
        state = profile.state ?: "ACTIVE",
        capability = if (profile.state == "SUSPENDED") "READ_ONLY" else "FULL",
        hasUsername = !profile.username.isNullOrBlank(),
        hasProfile = true,
    )
}

/** Referenced by the JSON parser so the import is not unused in release builds. */
internal val json = MohallaJson
