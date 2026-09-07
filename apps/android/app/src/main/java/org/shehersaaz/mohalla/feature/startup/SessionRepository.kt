package org.shehersaaz.mohalla.feature.startup

import org.shehersaaz.mohalla.core.network.ApiFailure
import org.shehersaaz.mohalla.core.network.ApiResult
import org.shehersaaz.mohalla.core.network.MohallaApi
import org.shehersaaz.mohalla.core.network.MohallaJson
import org.shehersaaz.mohalla.core.network.OwnProfileResponse
import org.shehersaaz.mohalla.core.network.SESSION_TOKEN_KEY
import org.shehersaaz.mohalla.core.network.DISPLAY_NAME_KEY
import org.shehersaaz.mohalla.core.network.PHOTO_KEY
import org.shehersaaz.mohalla.core.network.PublicProfileResponse
import org.shehersaaz.mohalla.core.network.USERNAME_KEY
import org.shehersaaz.mohalla.core.network.USER_ID_KEY
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

    /**
     * The signed-in user's own id, from the last successful `/me`.
     *
     * WHY IT IS CACHED AT ALL. Several screens need to know whether something is
     * the viewer's own — a creator sees Edit on their event where everyone else
     * sees Report (EVENT-FR-007), and "my events" is a request keyed by user id.
     * Calling `/me` on each of those screens would spend a round trip to learn
     * something that cannot change while the session lives.
     *
     * STORED WITH THE TOKEN, in the same Keystore-backed store (SEC-004), so
     * `signOut()` clearing everything clears this too. A user id left behind
     * after a sign-out would let the next account's screens ask "is this mine?"
     * against the previous account's identity.
     *
     * Null when nothing is known yet, which is a real state: a cold start
     * resolves the session before any screen that needs this can be reached, so
     * a screen finding null here is a screen that raced the sign-out.
     */
    fun cachedUserId(): String? = storage.getString(USER_ID_KEY)?.takeIf { it.isNotBlank() }

    /**
     * The signed-in person's own name, handle and photo.
     *
     * WHY THIS IS CACHED AND NOT FETCHED. The composer's author block exists to
     * confirm whose name is about to be attached to a post (UI/UX §19 item 3,
     * and §03's "people before posts"). It opens on a tap from the centre tab,
     * so a screen that waited on `/me` would show a blank name for the first
     * moment somebody looked at it — on the one screen whose whole job is to
     * make the identity unmistakable before they publish.
     *
     * FOUR FIELDS, NOT THE WHOLE PROFILE. Counts, bio and city all change
     * without notice and none of them is needed off-line; caching them would be
     * caching something to go stale. These four are what a header row renders.
     *
     * Cleared with the token by `signOut()`, like [cachedUserId] — a name left
     * behind would greet the next account with the previous one's.
     */
    fun cachedIdentity(): CachedIdentity? {
        val userId = cachedUserId() ?: return null
        return CachedIdentity(
            userId = userId,
            username = storage.getString(USERNAME_KEY),
            displayName = storage.getString(DISPLAY_NAME_KEY),
            photoMediaId = storage.getString(PHOTO_KEY),
        )
    }

    /**
     * Write the header fields.
     *
     * A NULL FIELD IS REMOVED RATHER THAN SKIPPED. Somebody who deletes their
     * profile photo would otherwise keep the old id in storage and go on seeing
     * the old photo in the composer indefinitely — the absence of a value is
     * itself a value, and `putString` cannot express it.
     */
    private fun cacheIdentity(profile: OwnProfileResponse) {
        putOrRemove(USERNAME_KEY, profile.username)
        putOrRemove(DISPLAY_NAME_KEY, profile.displayName)
        putOrRemove(PHOTO_KEY, profile.photoMediaId)
    }

    private fun putOrRemove(key: String, value: String?) {
        if (value.isNullOrBlank()) storage.remove(key) else storage.putString(key, value)
    }

    suspend fun me(): MeResult {
        if (!hasToken()) return MeResult.NoSession

        val result = apiCall { api.me() }

        return when (result) {
            is ApiResult.Ok -> {
                // Recorded on every successful read rather than once at login,
                // so a session restored from storage populates it too.
                storage.putString(USER_ID_KEY, result.value.userId)
                cacheIdentity(result.value)
                MeResult.Profile(result.value)
            }

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

/**
 * Just enough of the signed-in person to draw a header row.
 *
 * `photoMediaId` is an id rather than a URL for the same reason it is
 * everywhere else: a media id is resolved to a URL in exactly one place
 * (`MohallaImage`), so no call site can get the base wrong or forget the token.
 */
data class CachedIdentity(
    val userId: String,
    val username: String?,
    val displayName: String?,
    val photoMediaId: String?,
) {
    /**
     * As a [PublicProfileResponse], so a header row takes one type.
     *
     * The composer's author block and a post card's author row render the same
     * four fields, and giving them two types would mean two components. The
     * counts are zero rather than guessed: this is a cache of a header, not of
     * a profile, and a fabricated follower count on the composer would be a
     * number somebody could read and believe.
     */
    fun asProfile() = PublicProfileResponse(
        userId = userId,
        username = username,
        displayName = displayName,
        photoMediaId = photoMediaId,
    )
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
