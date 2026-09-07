package org.shehersaaz.mohalla.core.network

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * The error envelope every Stage 6 endpoint returns, and the client's single
 * interpretation of it.
 *
 * SEC-018 — no technical detail ever reaches the user. The server has already
 * done that work: it returns a `code`, a human `message` already localised for
 * the caller's language, and a `correlationId`. So the client's job is NOT to
 * write error copy; it is to show the message it was given and, for the classes
 * of failure that change what the UI should do, to branch.
 *
 * WHAT MUST NOT HAPPEN HERE IS THE INTERESTING PART. Several backend refusals
 * are DELIBERATELY INDISTINGUISHABLE — a blocked user, a deleted post and a
 * post that never existed all return the same `404 RESOURCE_UNAVAILABLE`
 * (BR-025, SEC-019, mandatory test A). If this layer mapped them to different
 * client states, different copy, different illustrations or different analytics
 * events, the app would hand back exactly the fact the server spent that design
 * effort withholding. So [ApiFailure.Unavailable] is ONE state, and there is no
 * variant of it.
 *
 * The same applies to authentication: a wrong password, an unknown number and a
 * banned account are one `FAILED` (SEC-006). The client shows one message.
 */
@Serializable
data class ApiErrorEnvelope(
    val error: ApiErrorBody? = null,
)

@Serializable
data class ApiErrorBody(
    val code: String? = null,
    val message: String? = null,
    val correlationId: String? = null,
    val details: List<ApiErrorDetail>? = null,
)

@Serializable
data class ApiErrorDetail(
    val path: String? = null,
    val message: String? = null,
)

/**
 * What a screen actually has to handle.
 *
 * Kept small on purpose. A sealed type with one case per HTTP status would push
 * the decision onto every screen; these are the cases that genuinely need
 * different UI, and everything else is [Server].
 */
sealed interface ApiFailure {

    /** The server's localised message, when there is one worth showing. */
    val message: String?

    /**
     * 400 / 422 — the request was wrong, and usually a specific field was.
     * `fieldErrors` is keyed by the `path` the server named, so a form can put
     * the message under the right input instead of in a banner.
     */
    data class Validation(
        override val message: String?,
        val fieldErrors: Map<String, String> = emptyMap(),
        val code: String? = null,
    ) : ApiFailure

    /**
     * 401 — the session is gone. EDGE-010: revocation is server-driven and
     * takes effect on the NEXT request, so this is the app's only signal. The
     * shell intercepts it globally, signs out and clears the cache (SET-FR-006);
     * individual screens do not handle it.
     */
    data object Unauthenticated : ApiFailure {
        override val message: String? = null
    }

    /**
     * 403 — authenticated, but this account may not. Usually a suspension
     * (BR-034), which has its own explainer screen (UX-SAFE-004).
     *
     * THIS ONE CARRIES A CODE, AND [Unavailable] MUST NOT. The distinction is
     * the whole reason they are separate types. A 404 is about EXISTENCE, so
     * telling its causes apart would leak what the server withheld. A 403 says
     * the resource is there and this caller may not have it — which discloses
     * nothing further, and which some requirements need spelled out.
     *
     * EVENT-FR-003 is the case that forces it: the meeting link is refused
     * either because the caller has not responded to the event or because the
     * 30-minute window has not opened, and its acceptance criterion demands
     * that "the join control is not yet active AND the availability time is
     * stated". One anonymous 403 cannot satisfy that. The event is already
     * public — title, time and attendee count are visible to anybody — so the
     * refusal reveals nothing that was hidden.
     *
     * `details` carries the server's `details[]` keyed by `path`, which is how
     * `availableFrom` arrives.
     */
    data class Restricted(
        override val message: String?,
        val code: String? = null,
        val details: Map<String, String> = emptyMap(),
    ) : ApiFailure

    /**
     * 404 — THE NEUTRAL REFUSAL. Deleted, auto-hidden, blocked, banned or never
     * there. One state, one piece of copy, one screen (UX-STATE-001). There is
     * deliberately nothing here to tell them apart.
     */
    data class Unavailable(override val message: String?) : ApiFailure

    /** 409 — someone else got there first (EDGE-007, EDGE-024). */
    data class Conflict(override val message: String?, val code: String? = null) : ApiFailure

    /** 429 — UX-STATE-004. `retryAfterSeconds` when the server said. */
    data class RateLimited(
        override val message: String?,
        val retryAfterSeconds: Int? = null,
    ) : ApiFailure

    /** 5xx — UX-STATE-003. The correlation ID is shown so it can be quoted. */
    data class Server(
        override val message: String?,
        val correlationId: String? = null,
    ) : ApiFailure

    /**
     * No usable connection. NOT an error state — UX-STATE-002 is a different
     * screen with a different promise, because cached content may still be
     * readable and a retry is likely to work (NFR-AVAIL-002).
     */
    data object Offline : ApiFailure {
        override val message: String? = null
    }
}

/** The result of any call a repository makes. */
sealed interface ApiResult<out T> {
    data class Ok<out T>(val value: T) : ApiResult<T>
    data class Err(val failure: ApiFailure) : ApiResult<Nothing>
}

inline fun <T, R> ApiResult<T>.map(transform: (T) -> R): ApiResult<R> = when (this) {
    is ApiResult.Ok -> ApiResult.Ok(transform(value))
    is ApiResult.Err -> this
}
