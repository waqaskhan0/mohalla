package org.shehersaaz.mohalla.core.ui

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import org.shehersaaz.mohalla.core.network.ApiFailure

/**
 * One failure, one screen — UX-STATE-001…004 (NFR-AVAIL-002 · SEC-018/019).
 *
 * THIS FILE EXISTS BECAUSE THE MAPPING WAS BEING WRITTEN BY HAND, TWELVE TIMES,
 * AND MOST OF THE COPIES WERE WRONG. §21 specifies four distinct states with
 * four different promises, and the shape that kept appearing across groups 11 to
 * 19 was two branches:
 *
 * ```
 * when (failure) {
 *     ApiFailure.Offline -> OfflineState(onRetry)
 *     else -> ServerErrorState(...)          // ← everything else
 * }
 * ```
 *
 * WHICH SENDS A RATE LIMIT TO A SCREEN THAT APOLOGISES FOR THE SERVER. A 429 is
 * the reader's own recent behaviour with a stated cool-down (SAFETY-FR-009,
 * UX-STATE-004), and "something went wrong on our end" is both untrue and
 * useless — it invites a retry that will be refused again. `RateLimitedState`
 * existed from group 01 and only two screens reached it.
 *
 * IT ALSO SENDS A NEUTRAL 404 TO AN ERROR SCREEN. BR-025's refusal is not a
 * failure: the content is not available and there is nothing to retry. An error
 * page with a Try again button on a post that was deleted teaches the reader
 * that the app is broken rather than that the post is gone.
 *
 * SO THE `when` IS EXHAUSTIVE AND CENTRAL. A new `ApiFailure` variant becomes a
 * COMPILE ERROR in one file, in front of whoever added it, instead of silently
 * landing in somebody's `else` branch — which is exactly how the two defects
 * above spread in the first place.
 */
@Composable
fun FailureState(
    failure: ApiFailure,
    onRetry: (() -> Unit)?,
    modifier: Modifier = Modifier,
) {
    when (failure) {
        // UX-STATE-002 — "a different screen with a different promise, because
        // cached content may still be readable and a retry is likely to work"
        // (NFR-AVAIL-002). Never the error screen: nothing went wrong.
        ApiFailure.Offline -> OfflineState(onRetry = onRetry, modifier = modifier)

        // UX-STATE-001 — the neutral refusal. Deleted, auto-hidden, blocked,
        // banned or never there: one state, one piece of copy, no reason, and
        // NO RETRY. There is nothing to try again.
        is ApiFailure.Unavailable -> ContentUnavailable(modifier = modifier)

        // UX-STATE-004 — the reader's own recent behaviour, with the server's
        // own cool-down message where it sent one. Not an apology from us.
        is ApiFailure.RateLimited -> RateLimitedState(onRetry = onRetry, modifier = modifier)

        // UX-STATE-003, and the only one that carries a correlation id: SRS §16
        // lets the reader quote it to support, which is the one technical string
        // the product ever puts on screen.
        is ApiFailure.Server -> ServerErrorState(
            correlationId = failure.correlationId,
            onRetry = onRetry,
            modifier = modifier,
        )

        // A 403 the screen did not handle itself. BR-034's suspension has its
        // own explainer and every screen that can hit one handles it before
        // reaching here; anything else is a permission this account does not
        // have, which is not retryable and not ours to explain further.
        is ApiFailure.Restricted -> ContentUnavailable(modifier = modifier)

        // EDGE-010 — handled globally by the auth interceptor, which signs out
        // and sends the app to the welcome screen. Rendering the error screen
        // for the frame before that happens would flash an apology at somebody
        // whose session was revoked, so the neutral state stands in.
        ApiFailure.Unauthenticated -> ContentUnavailable(modifier = modifier)

        // 400 and 409 reaching a whole-screen renderer means a request the
        // screen could not validate itself. Both are ours to have got wrong, so
        // they get the error screen — and neither carries a correlation id,
        // because neither came from a server fault.
        is ApiFailure.Validation -> ServerErrorState(
            correlationId = null,
            onRetry = onRetry,
            modifier = modifier,
        )

        is ApiFailure.Conflict -> ServerErrorState(
            correlationId = null,
            onRetry = onRetry,
            modifier = modifier,
        )
    }
}

/**
 * Whether this failure is worth offering a retry for.
 *
 * TWO OF THE EIGHT ARE NOT. A neutral 404 has nothing to try again — the content
 * is not there — and a 403 will refuse the same way for as long as the
 * permission stands. Offering a button that cannot work is how a screen teaches
 * somebody to stop believing its buttons.
 *
 * Exposed so a caller with its own layout can ask the same question rather than
 * deciding it again.
 */
fun ApiFailure.isRetryable(): Boolean = when (this) {
    ApiFailure.Offline,
    is ApiFailure.Server,
    is ApiFailure.RateLimited,
    is ApiFailure.Validation,
    is ApiFailure.Conflict,
    -> true

    is ApiFailure.Unavailable,
    is ApiFailure.Restricted,
    ApiFailure.Unauthenticated,
    -> false
}
