package org.shehersaaz.mohalla.core.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import org.shehersaaz.mohalla.R
import org.shehersaaz.mohalla.core.design.MohallaTheme
import org.shehersaaz.mohalla.core.design.MohallaType
import org.shehersaaz.mohalla.core.network.ApiFailure
import org.shehersaaz.mohalla.core.util.formatLongDate

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
        is ApiFailure.Restricted -> if (failure.code == CODE_ACCOUNT_SUSPENDED) {
            // RUNTIME-010. A SUSPENSION IS NOT AN ERROR AND NOT THE READER'S
            // MISTAKE, and the server's own words for it are "Account is
            // limited." - true, and no use to somebody who has just tried to
            // like a post and wants to know what is going on and for how long.
            //
            // §17 asks for the APPROVED explanation, so this is the same copy
            // the banner and the explainer use, with the end date the server
            // already sends in `details`. Nothing new is written here; a
            // second wording for one state is how two screens come to say
            // different things about it.
            //
            // WARNING, NOT ERROR, matching the banner: the account is in a
            // state, the write did not fail.
            val until = failure.details["suspendedUntil"]
                ?.let { formatLongDate(it, currentLocale()) }

            AuthNotice(
                if (until != null) {
                    stringResource(R.string.suspension_duration_until, until)
                } else {
                    stringResource(R.string.suspension_duration_indefinite)
                },
                AuthNoticeTone.WARNING,
            )
        } else {
            AuthNotice(
                failure.message ?: stringResource(R.string.state_unavailable_body),
                AuthNoticeTone.ERROR,
            )
        }

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

/**
 * The server's code for a suspension, from `IdentityErrorCode`.
 *
 * A CONSTANT rather than the literal inline, because it is a contract with a
 * separate deployable and the compiler cannot check it. If Stage 6 ever renames
 * it, `SuspensionNoticeTest` fails on the value rather than the app quietly
 * going back to saying "Account is limited." with no date.
 */
private const val CODE_ACCOUNT_SUSPENDED = "ACCOUNT_SUSPENDED"

/**
 * The language the reader chose, for formatting a date inside a composable.
 *
 * READ FROM THE CONFIGURATION rather than the DI container, because this file
 * is used by every screen and threading the container into all of them to
 * format one date would be the wrong trade. `MainActivity.attachBaseContext`
 * has already resolved the configuration to the stored choice, so this is that
 * choice and not the device default.
 */
@Composable
private fun currentLocale(): java.util.Locale =
    androidx.compose.ui.platform.LocalConfiguration.current.locales[0]

/**
 * A failure, said out loud on a screen that is otherwise fine.
 *
 * WHY THIS EXISTS. The same rendering was buried inside `AuthScaffold`, which
 * only the auth screens use, so a feed or a post detail had nowhere to put a
 * refusal and the ViewModels reduced theirs to a boolean nobody read
 * (RUNTIME-010). This is that rendering, reusable, and it takes the failure
 * rather than a string so the suspension wording above is what a suspended
 * reader gets here too.
 *
 * IT RENDERS NOTHING FOR NULL, so a caller can place it unconditionally.
 */
@Composable
fun InlineFailureNotice(failure: ApiFailure?, modifier: Modifier = Modifier) {
    val notice = noticeFor(failure) ?: return

    Text(
        text = notice.text,
        style = MohallaTheme.text(MohallaType.BodySm),
        color = when (notice.tone) {
            AuthNoticeTone.ERROR -> MohallaTheme.colors.Error
            AuthNoticeTone.WARNING -> MohallaTheme.colors.Warning
            AuthNoticeTone.SUCCESS -> MohallaTheme.colors.Success
        },
        modifier = modifier
            .fillMaxWidth()
            .background(MohallaTheme.colors.SurfacePrimary)
            .padding(
                horizontal = MohallaTheme.screenMargin,
                vertical = MohallaTheme.spacing.Space2,
            )
            .semantics {
                liveRegion = when (notice.tone) {
                    // An error interrupts; a condition the reader is already in
                    // does not.
                    AuthNoticeTone.ERROR -> LiveRegionMode.Assertive
                    else -> LiveRegionMode.Polite
                }
            },
    )
}
