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
}
