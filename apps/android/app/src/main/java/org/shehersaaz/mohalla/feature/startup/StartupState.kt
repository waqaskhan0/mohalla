package org.shehersaaz.mohalla.feature.startup

import org.shehersaaz.mohalla.core.locale.AppLocale

/**
 * Where the app opens, decided once (UX-AUTH-001 · §9 of the Stage 7 brief).
 *
 * WHY THIS IS A SEALED TYPE AND NOT A SEQUENCE OF `if`s IN A COMPOSABLE.
 * Startup routing reads four facts — is a language chosen, is there a session,
 * what state is the account in, is the profile finished — and each of the eight
 * destinations is reachable from a different combination. Written inline it
 * becomes a nest of conditions that nobody can test and that renders a frame of
 * the wrong screen whenever a fact arrives late. Written as a resolved value,
 * the whole decision is one pure function ([resolveDestination]) with a unit
 * test per branch, and the UI shows [Resolving] until it has an answer.
 *
 * "DO NOT FLASH UNAUTHORIZED SCREENS WHILE STATE IS RESOLVING" is the
 * requirement that shapes it. [Resolving] is not a loading spinner for the
 * network — it is the splash, and it is the only thing on screen until the
 * destination is known.
 */
sealed interface StartupDestination {

    /** Still deciding. The splash stays up; nothing else is composed. */
    data object Resolving : StartupDestination

    /** BR-040 — no language has ever been chosen. UX-AUTH-002. */
    data class ChooseLanguage(val suggestion: AppLocale) : StartupDestination

    /** No session, or the session was rejected. UX-AUTH-003. */
    data object Welcome : StartupDestination

    /** ACTIVE and onboarded. The shell, on Home. */
    data object Home : StartupDestination

    /**
     * UNVERIFIED — registration was interrupted before the OTP. UX-AUTH-009.
     *
     * EDGE-002: the account exists but cannot act, and the only way forward is
     * the code. Sending them to Welcome would offer a "create account" that
     * their number would then be refused for.
     */
    data object VerifyOtp : StartupDestination

    /** ACTIVE with no username yet. UX-SETUP-001. */
    data object ChooseUsername : StartupDestination

    /** Username claimed, profile not created. UX-SETUP-002. */
    data object CompleteProfile : StartupDestination

    /**
     * SUSPENDED — BR-034. Home, readable, with the banner. NOT a blocking
     * screen: a suspension restricts writing, and locking someone out of
     * reading would be a harsher penalty than the one that was imposed.
     */
    data object HomeReadOnly : StartupDestination

    /** PENDING_DELETION — SET-FR-005 offers restoration. UX-AUTH-012. */
    data object RestoreAccount : StartupDestination
}

/** The facts the router needs. Nothing else. */
data class StartupFacts(
    val storedLocale: AppLocale?,
    val deviceSuggestion: AppLocale,
    val hasSessionToken: Boolean,
    /** `null` when `/me` could not be reached or the session was rejected. */
    val session: SessionFacts?,
)

data class SessionFacts(
    val state: String,
    val capability: String,
    val hasUsername: Boolean,
    val hasProfile: Boolean,
)

/**
 * The whole routing decision, as one pure function.
 *
 * ORDER IS LOAD-BEARING and each step is here for a reason:
 *
 * 1. LANGUAGE FIRST, before anything is drawn. The direction of the very first
 *    laid-out frame depends on it (LOCALE-FR-003), and asking someone to choose
 *    a language on a screen already rendered in the other one is the first
 *    impression the product would rather not make.
 * 2. NO TOKEN → Welcome. No network call, so a cold start with no session costs
 *    nothing and cannot hang (NFR-PERF-003).
 * 3. TOKEN BUT NO SESSION → Welcome. Covers a revoked session (EDGE-010) and an
 *    unreachable server identically, which is right: in both cases the app
 *    cannot prove who the user is, and guessing in their favour would show an
 *    authenticated shell to someone who has been signed out.
 * 4. ACCOUNT STATE before onboarding, because a suspended or pending-deletion
 *    account should not be walked through profile setup.
 * 5. BANNED collapses to Welcome — the same neutral refusal an unknown account
 *    gets (SEC-006). No screen anywhere says "you are banned".
 */
fun resolveDestination(facts: StartupFacts): StartupDestination {
    val locale = facts.storedLocale
        ?: return StartupDestination.ChooseLanguage(facts.deviceSuggestion)

    // Referenced so the compiler keeps step 1 above honest: a language must be
    // resolved before any destination below can be returned.
    check(locale.tag.isNotEmpty())

    if (!facts.hasSessionToken) return StartupDestination.Welcome
    val session = facts.session ?: return StartupDestination.Welcome

    return when (session.state) {
        "PENDING_DELETION" -> StartupDestination.RestoreAccount

        // Neutral. Indistinguishable from having no account at all.
        "BANNED", "DELETED" -> StartupDestination.Welcome

        "UNVERIFIED" -> StartupDestination.VerifyOtp

        "SUSPENDED" -> when {
            !session.hasUsername -> StartupDestination.ChooseUsername
            !session.hasProfile -> StartupDestination.CompleteProfile
            else -> StartupDestination.HomeReadOnly
        }

        "ACTIVE" -> when {
            !session.hasUsername -> StartupDestination.ChooseUsername
            !session.hasProfile -> StartupDestination.CompleteProfile
            else -> StartupDestination.Home
        }

        // An account state this build does not know. Treated as unusable rather
        // than as ACTIVE: a client that guesses "probably fine" on an unknown
        // state is a client that grants access the server may have revoked.
        else -> StartupDestination.Welcome
    }
}
