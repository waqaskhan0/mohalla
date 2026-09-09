package org.shehersaaz.mohalla.core.state

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * The session was revoked while the app was open — EDGE-010 (SET-FR-002/006).
 *
 * THIS EXISTED AS A COMMENT AND NOT AS CODE. `ApiFailure.Unauthenticated`'s own
 * documentation has said since group 01 that "revocation is server-driven and
 * takes effect on the NEXT request, so this is the app's only signal. The shell
 * intercepts it globally, signs out and clears the cache (SET-FR-006);
 * individual screens do not handle it." `apiCall` grew an `onUnauthenticated`
 * parameter for exactly that, and no repository ever passed one — so nothing
 * intercepted anything, and a revoked session showed a generic error on every
 * screen, forever, until somebody force-quit the app.
 *
 * IT IS NOT A HYPOTHETICAL. SET-FR-002's whole purpose is that changing a
 * password signs out every other device: "GIVEN a password change on device A,
 * WHEN device B makes its next request, THEN device B is signed out." Device B
 * is this app. Somebody who changed their password because they believed
 * another person was in their account would have watched that person's phone go
 * on showing the feed.
 *
 * WHERE IT IS RAISED IS THE POINT. Not in a repository — there are ten of them
 * and the eleventh would forget — but in the AUTH INTERCEPTOR, which is the one
 * place that knows a token was actually attached. A 401 on a request that
 * carried no token is a login being refused, not a session being revoked, and
 * signing out of nothing would be noise on the one screen where it would confuse
 * somebody most.
 *
 * ONCE, NOT ONCE PER REQUEST. Several calls are usually in flight when a session
 * dies, and each of them gets its own 401; the flag latches so the shell
 * navigates once rather than four times.
 */
class SessionRevocation {

    private val _revoked = MutableStateFlow(false)

    /** `true` once, until [acknowledge]. Collected by the navigation graph. */
    val revoked: StateFlow<Boolean> = _revoked.asStateFlow()

    /**
     * Raised from an OkHttp thread, so nothing here may touch the UI.
     *
     * `MutableStateFlow` is safe to write from any thread and conflates repeat
     * writes of the same value, which is what makes the latch free.
     */
    fun raise() {
        _revoked.value = true
    }

    /** Called after the app has signed out and moved, so a later session can raise it again. */
    fun acknowledge() {
        _revoked.value = false
    }
}
