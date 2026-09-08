package org.shehersaaz.mohalla.core.ui

import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import org.shehersaaz.mohalla.R
import org.shehersaaz.mohalla.core.network.ApiFailure

/**
 * One line of explanation for any refusal, on a form that stays on screen.
 *
 * WHY THIS EXISTS — RUNTIME-005, found by running Flow A on an emulator.
 *
 * The username step's notice handled `takenMessage`, `Offline` and `Server`, and
 * **nothing else**. When `POST /me/username` answered 401 the screen showed no
 * message, no error and no change: Continue simply did nothing, twice, with
 * nothing on screen to say why. The 401 had a real cause
 * (MOBILE-BACKEND-FIX-001) and is fixed; the silence was a second defect and
 * this is it.
 *
 * Every auth and setup screen had the same shape — a `when` over two or three
 * variants of an eight-variant sealed type, with no `else`. Kotlin does not
 * require exhaustiveness in a `when` used as a statement inside a lambda, so
 * nothing failed to compile and nothing failed a test. What failed was the one
 * moment a reader most needs a sentence.
 *
 * [FailureState] already solved this for FULL-SCREEN failures, and group 20
 * wrote it for exactly this reason. It cannot be used here: these screens keep
 * the form on screen and put one line above it, because replacing a
 * half-completed registration form with a full-screen error would throw away
 * what the person typed. So this is the same discipline in the shape a form
 * needs.
 *
 * THE `when` IS EXHAUSTIVE AND HAS NO `else`. That is the point — adding a
 * ninth `ApiFailure` variant will fail to compile here, which is the only
 * mechanism that reliably survives a new variant.
 */
/**
 * The same mapping, as a bare string.
 *
 * Two screens need the sentence without the envelope: `OtpScreen` builds a
 * `String?` and renders it itself, and `LoginScreen` has its own `AuthNotice`
 * composable with a different signature from the shared data class — so
 * returning the data class there would collide on the name at the call site.
 * One mapping, two shapes, no duplicated `when`.
 */
@Composable
fun failureText(failure: ApiFailure?): String? = noticeFor(failure)?.text

/** True when the refusal is advice to wait rather than a fault to correct. */
fun ApiFailure.isAdvisory(): Boolean =
    this is ApiFailure.RateLimited || this == ApiFailure.Offline

@Composable
fun noticeFor(failure: ApiFailure?): AuthNotice? {
    if (failure == null) return null

    return when (failure) {
        // Not the user's fault and not retryable by pressing again.
        ApiFailure.Offline -> AuthNotice(
            stringResource(R.string.state_offline_banner),
            AuthNoticeTone.WARNING,
        )

        // The server said which field and why; that message is already
        // localised by the server and is better than anything generic.
        is ApiFailure.Validation -> AuthNotice(
            failure.message ?: stringResource(R.string.state_error_body),
            AuthNoticeTone.ERROR,
        )

        // SEC-018 — never the server's own words for a 5xx.
        is ApiFailure.Server -> AuthNotice(
            stringResource(R.string.state_error_body),
            AuthNoticeTone.ERROR,
        )

        // A session that is gone. The revocation observer above the NavHost is
        // what actually moves the reader; this line stops the screen looking
        // inert while that happens.
        ApiFailure.Unauthenticated -> AuthNotice(
            stringResource(R.string.state_session_expired),
            AuthNoticeTone.ERROR,
        )

        // BR-025's neutral absence. Deliberately says nothing about why.
        is ApiFailure.Unavailable -> AuthNotice(
            stringResource(R.string.state_unavailable_body),
            AuthNoticeTone.ERROR,
        )

        // 403 carries a code and a reason the server chose to give.
        is ApiFailure.Restricted -> AuthNotice(
            failure.message ?: stringResource(R.string.state_unavailable_body),
            AuthNoticeTone.ERROR,
        )

        // A real clash — a username taken between the check and the claim.
        is ApiFailure.Conflict -> AuthNotice(
            failure.message ?: stringResource(R.string.state_error_body),
            AuthNoticeTone.ERROR,
        )

        // Waiting is the action, so the tone is a warning rather than an error.
        is ApiFailure.RateLimited -> AuthNotice(
            stringResource(R.string.state_rate_limited_body),
            AuthNoticeTone.WARNING,
        )
    }
}
