package org.shehersaaz.mohalla.navigation

import org.shehersaaz.mohalla.feature.startup.StartupDestination

/**
 * The startup resolver's decision, as a navigation route.
 *
 * SEPARATE FROM THE DECISION, AND SEPARATE FROM THE ACTIVITY. `resolveDestination`
 * decides where the user belongs and has no Android in it; this maps that answer
 * onto a route string. Keeping the mapping out of `MainActivity` is what makes it
 * testable on the JVM — an activity method cannot be asserted without an
 * instrumentation runner, and there is no device in this project yet
 * (`20-mobile-open-issues.md`), so a mapping that lived there would be the one
 * piece of routing nothing checked.
 *
 * BOTH READ-ONLY AND FULL LAND ON THE SHELL. BR-034 restricts writing, not
 * reading, so a suspended account goes exactly where an active one goes and the
 * banner explains the difference. Routing a suspended user anywhere else would be
 * a lockout the sanction does not authorise.
 */
fun StartupDestination.startRoute(): String = when (this) {
    StartupDestination.Home,
    StartupDestination.HomeReadOnly,
    -> Routes.SHELL

    StartupDestination.Welcome -> Routes.WELCOME
    StartupDestination.VerifyOtp -> Routes.OTP
    StartupDestination.ChooseUsername -> Routes.USERNAME
    StartupDestination.CompleteProfile -> Routes.PROFILE_SETUP
    StartupDestination.RestoreAccount -> Routes.RESTORE_ACCOUNT

    // Neither is routed: `Resolving` holds the splash and `ChooseLanguage` is
    // rendered before the graph exists, because choosing a language ends in
    // `recreate()` and would destroy its own destination. Enumerated rather
    // than covered by an `else`, so adding a destination fails to COMPILE here
    // instead of silently falling through to Welcome — which is how a new
    // account state ends up looking like a signed-out one.
    StartupDestination.Resolving,
    is StartupDestination.ChooseLanguage,
    -> Routes.WELCOME
}

/** `true` when the destination is rendered directly rather than routed. */
fun StartupDestination.isPreGraph(): Boolean =
    this is StartupDestination.ChooseLanguage || this == StartupDestination.Resolving
