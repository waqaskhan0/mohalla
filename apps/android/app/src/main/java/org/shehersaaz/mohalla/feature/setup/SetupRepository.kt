package org.shehersaaz.mohalla.feature.setup

import org.shehersaaz.mohalla.core.network.ApiFailure
import org.shehersaaz.mohalla.core.network.ApiResult
import org.shehersaaz.mohalla.core.network.ClaimUsernameRequest
import org.shehersaaz.mohalla.core.network.CreateProfileRequest
import org.shehersaaz.mohalla.core.network.MohallaApi
import org.shehersaaz.mohalla.core.network.OwnProfileResponse
import org.shehersaaz.mohalla.core.network.SuggestedUser
import org.shehersaaz.mohalla.core.network.apiCall

/**
 * Onboarding — username, profile, suggestions (PROFILE-FR-001…004 · SOCIAL-FR-004).
 *
 * EDGE-007 IS THE REASON THIS FILE IS INTERESTING. Two people can pick the same
 * handle at the same moment, and only one gets it. §13 states the client's duty
 * precisely: *"Do not claim a username is reserved until server confirms."*
 *
 * So availability is advisory and the CLAIM is authoritative. [checkAvailable]
 * exists to spare somebody typing a handle that is already gone, and its answer
 * is explicitly modelled as a hint that can be stale by the time they tap
 * Continue — see [UsernameAvailability]. The only thing that decides is
 * [claimUsername], and a 409 there is the race being lost, not a bug.
 */
class SetupRepository(
    private val api: MohallaApi,
) {

    /**
     * Advisory. NEVER the basis for telling the user they have the handle.
     *
     * The backend reports a reserved handle as the same `UNAVAILABLE` as a taken
     * one, so there is nothing here to distinguish them and the client must not
     * try (the SRS refuses a reserved handle without explaining why).
     */
    suspend fun checkAvailable(username: String): ApiResult<UsernameAvailability> {
        val result = apiCall { api.usernameAvailable(username) }
        return when (result) {
            is ApiResult.Ok -> ApiResult.Ok(
                if (result.value.available == true) {
                    UsernameAvailability.LooksFree
                } else {
                    UsernameAvailability.Unavailable
                },
            )
            is ApiResult.Err -> result
        }
    }

    /**
     * The authoritative act. PROFILE-FR-001 — chosen once, never changed.
     *
     * A `409` is two different situations and they need different handling:
     *
     *   - `USERNAME_TAKEN` — somebody else got it. The user picks again, and the
     *     field keeps what they typed so they can edit rather than retype.
     *   - `USERNAME_ALREADY_SET` — *this* account already has one. Not an error
     *     to show: it means onboarding is further along than the screen thought,
     *     usually because the user completed it on another device, so the right
     *     response is to move on rather than to complain.
     */
    suspend fun claimUsername(username: String): ApiResult<ClaimOutcome> {
        val result = apiCall { api.claimUsername(ClaimUsernameRequest(username)) }
        return when (result) {
            is ApiResult.Ok -> ApiResult.Ok(ClaimOutcome.Claimed(result.value))

            is ApiResult.Err -> when (val failure = result.failure) {
                is ApiFailure.Conflict -> when (failure.code) {
                    "USERNAME_ALREADY_SET" -> ApiResult.Ok(ClaimOutcome.AlreadySetForThisAccount)
                    // Covers `USERNAME_TAKEN` and any future conflict code:
                    // treated as "not yours" rather than assumed to be a bug.
                    else -> ApiResult.Ok(ClaimOutcome.Taken(failure.message))
                }
                else -> result
            }
        }
    }

    suspend fun createProfile(
        displayName: String,
        city: String?,
        bio: String?,
        photoMediaId: String?,
    ): ApiResult<OwnProfileResponse> = apiCall {
        api.createProfile(
            CreateProfileRequest(
                displayName = displayName,
                // Empty is sent as `null`, not `""`. The backend's schema is
                // `nullish`, and an empty string would store a city that
                // renders as a blank line on the profile rather than as absent.
                city = city?.takeIf { it.isNotBlank() },
                bio = bio?.takeIf { it.isNotBlank() },
                photoMediaId = photoMediaId,
            ),
        )
    }

    /** SOCIAL-FR-004 — suggestions for an account that follows nobody. */
    suspend fun suggestions(limit: Int = 10): ApiResult<List<SuggestedUser>> {
        val result = apiCall { api.suggestions(limit) }
        return when (result) {
            is ApiResult.Ok -> ApiResult.Ok(result.value.users)
            is ApiResult.Err -> result
        }
    }

    suspend fun follow(userId: String): ApiResult<Unit> =
        apiCall { api.follow(userId) }
            .let { if (it is ApiResult.Ok) ApiResult.Ok(Unit) else it as ApiResult.Err }

    suspend fun unfollow(userId: String): ApiResult<Unit> =
        apiCall { api.unfollow(userId) }
            .let { if (it is ApiResult.Ok) ApiResult.Ok(Unit) else it as ApiResult.Err }
}

/**
 * The availability hint.
 *
 * Named `LooksFree` rather than `Available` on purpose. It is a snapshot that
 * can be false by the time the user acts on it (EDGE-007), and a type called
 * `Available` invites a screen to treat it as a promise — which is exactly what
 * §13 forbids.
 */
sealed interface UsernameAvailability {
    data object LooksFree : UsernameAvailability
    /** Taken OR reserved. The server does not say which, and neither does this. */
    data object Unavailable : UsernameAvailability
}

sealed interface ClaimOutcome {
    data class Claimed(val profile: OwnProfileResponse) : ClaimOutcome
    /** Lost the race, or reserved. One outcome, as the server reports it. */
    data class Taken(val message: String?) : ClaimOutcome
    /** This account already has a handle — move on rather than complain. */
    data object AlreadySetForThisAccount : ClaimOutcome
}
