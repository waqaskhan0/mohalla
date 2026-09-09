package org.shehersaaz.mohalla.core.config

import org.shehersaaz.mohalla.BuildConfig

/**
 * Typed access to build configuration.
 *
 * The API base URL is a BuildConfig field (see app/build.gradle.kts), so it is
 * baked per build type rather than hardcoded in source. A device build points
 * at a real host; a local debug build points at the loopback alias that reaches
 * the developer machine from the emulator.
 */
object BuildEnvironment {
    val apiBaseUrl: String get() = BuildConfig.API_BASE_URL
    val isDebug: Boolean get() = BuildConfig.DEBUG

    /**
     * The version string recorded when a user accepts the Terms (AUTH-FR-002).
     *
     * A BUILD-TIME VALUE, NOT A CONSTANT IN SOURCE, because it has to change
     * whenever the document does, and a source constant would be updated by
     * whoever noticed rather than by whoever published. Empty in a release build
     * until OD-015 is resolved: the registration step refuses to submit an empty
     * version, so the app cannot record an acceptance of a document nobody has
     * written.
     */
    val termsVersion: String get() = BuildConfig.TERMS_VERSION

    /**
     * SET-FR-009's support contact, which is email in V1.
     *
     * EMPTY UNTIL SHEHERSAAZ PUBLISHES ONE, exactly as [termsVersion] is. The
     * Help screen states that rather than opening a mail composer addressed to
     * somewhere invented - and this is the channel a suspended user appeals
     * through (OD-020), which is the one place where sending into a void has a
     * real cost.
     */
    val supportEmail: String get() = BuildConfig.SUPPORT_EMAIL

    /** SET-FR-010 - what support asks for when diagnosing a report. */
    val versionName: String get() = BuildConfig.VERSION_NAME

    val versionCode: Int get() = BuildConfig.VERSION_CODE

    /**
     * The host this build claims links for (§42), and shares links to.
     *
     * ONE VALUE FOR BOTH, so the link the app hands to WhatsApp and the link it
     * agrees to open cannot disagree - a share pointing at a host the intent
     * filter does not match is a link that opens the browser instead of the app,
     * and the two drifting apart is the ordinary way that happens.
     *
     * EMPTY IN A RELEASE BUILD until DEP-007 provisions a domain. The resolver
     * refuses every link when this is blank, and the share sheet says so rather
     * than sending somebody a URL that cannot resolve.
     */
    val appHost: String get() = BuildConfig.APP_HOST
}
