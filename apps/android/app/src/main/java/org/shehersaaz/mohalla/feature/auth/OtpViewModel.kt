package org.shehersaaz.mohalla.feature.auth

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import org.shehersaaz.mohalla.core.network.ApiFailure
import org.shehersaaz.mohalla.core.network.ApiResult

/**
 * OTP verification — UX-AUTH-009 (AUTH-FR-003 · SEC-003 · EDGE-005 · §12).
 *
 * WHAT THIS FILE MUST NOT DO, and the reason it is stated first: **the code is
 * never logged, never persisted and never leaves this object.** SEC-028 and §12
 * both forbid it, and the failure would be silent — a crash reporter or an
 * analytics breadcrumb carrying a live OTP is invisible until somebody reads
 * the logs. So the code lives in `MutableStateFlow` and nowhere else: not in
 * `SavedStateHandle` (which the platform writes to disk), not in a log, not in
 * an exception message.
 *
 * The phone number IS held, because the screen has to show which number the
 * code went to, and it is masked for display (`+92 3** *** **67`) — the same
 * masking the backend uses for the owner's own view.
 *
 * WHY THE COUNTDOWN IS HERE AND NOT IN THE COMPOSABLE. A `LaunchedEffect`
 * ticking a `remember`ed counter restarts on every recomposition and resets on
 * the `recreate()` a language switch performs — so somebody switching language
 * while waiting would get a fresh 60 seconds. In the ViewModel it survives both.
 */
class OtpViewModel(
    private val auth: AuthRepository,
    private val e164Phone: String,
    private val purpose: OtpPurpose,
) : ViewModel() {

    private val _state = MutableStateFlow(
        OtpUiState(maskedPhone = maskPhoneForOwner(e164Phone)),
    )
    val state: StateFlow<OtpUiState> = _state.asStateFlow()

    private var countdown: Job? = null

    init {
        // The code was sent by whatever brought the user here, so the cooldown
        // starts immediately rather than after the first resend — otherwise the
        // resend button is live the instant the screen opens and the first tap
        // is guaranteed to hit the 60-second limit server-side.
        startCooldown()
    }

    /**
     * §12 — digit entry with auto-advance and correct backspace.
     *
     * Non-digits are dropped rather than rejected, which is what makes paste
     * work: an SMS pasted as "Your code is 481920" yields 481920. That is the
     * "paste support where safe" §12 asks for — safe because the filter cannot
     * produce anything but digits.
     */
    fun onCodeChanged(raw: String) {
        val digits = raw.filter(Char::isDigit).take(OTP_LENGTH)
        _state.update {
            it.copy(
                code = digits,
                // Cleared as soon as the user edits. A rejection that stays on
                // screen while they retype reads as the app not noticing.
                invalidCode = false,
                expiredCode = false,
                failure = null,
            )
        }

        // Auto-submit on the sixth digit. There is no Continue button to press
        // for a code that can only be one length, and making the user press one
        // adds a step to the most-repeated screen in onboarding.
        if (isCompleteOtp(digits) && !_state.value.submitting) {
            submit()
        }
    }

    fun submit() {
        val code = _state.value.code
        if (!isCompleteOtp(code) || _state.value.submitting) return

        _state.update { it.copy(submitting = true, invalidCode = false, failure = null) }

        viewModelScope.launch {
            when (val result = auth.verifyOtp(e164Phone, code, purpose)) {
                is ApiResult.Ok -> _state.update {
                    // The session token was stored by the repository, never
                    // handed to this layer. Nothing here holds a credential.
                    it.copy(submitting = false, verified = true, code = "")
                }

                is ApiResult.Err -> _state.update { current ->
                    when (val failure = result.failure) {
                        // 400/422 with a code the server named. Wrong or
                        // expired are DIFFERENT advice — "check the digits"
                        // versus "get a new one" — so unlike the login screen
                        // this distinction is useful and safe: reaching it
                        // required possession of the number.
                        is ApiFailure.Validation -> current.copy(
                            submitting = false,
                            code = "",
                            expiredCode = failure.code == "OTP_EXPIRED",
                            invalidCode = failure.code != "OTP_EXPIRED",
                            serverMessage = failure.message,
                        )

                        // EDGE-005 — attempts exhausted, 15-minute lockout.
                        is ApiFailure.RateLimited -> current.copy(
                            submitting = false,
                            code = "",
                            lockedOut = true,
                            serverMessage = failure.message,
                        )

                        else -> current.copy(submitting = false, failure = failure)
                    }
                }
            }
        }
    }

    /** SEC-003 — 60-second cooldown, at most 3 per hour. */
    fun resend() {
        val current = _state.value
        if (current.cooldownSeconds > 0 || current.resendsUsed >= OTP_MAX_RESENDS_PER_HOUR) return

        _state.update { it.copy(resending = true, failure = null) }

        viewModelScope.launch {
            when (val result = auth.resendOtp(e164Phone, purpose)) {
                is ApiResult.Ok -> {
                    _state.update {
                        it.copy(
                            resending = false,
                            resendsUsed = it.resendsUsed + 1,
                            // A new code invalidates the old one server-side,
                            // so the field is cleared rather than left holding
                            // digits from a code that no longer works.
                            code = "",
                            invalidCode = false,
                            expiredCode = false,
                            codeResent = true,
                        )
                    }
                    startCooldown()
                }

                is ApiResult.Err -> _state.update {
                    it.copy(resending = false, failure = result.failure)
                }
            }
        }
    }

    fun onResentAcknowledged() = _state.update { it.copy(codeResent = false) }

    private fun startCooldown() {
        countdown?.cancel()
        countdown = viewModelScope.launch {
            var remaining = OTP_RESEND_COOLDOWN_SECONDS
            while (remaining > 0) {
                _state.update { it.copy(cooldownSeconds = remaining) }
                delay(1_000)
                remaining -= 1
            }
            _state.update { it.copy(cooldownSeconds = 0) }
        }
    }

    override fun onCleared() {
        countdown?.cancel()
        super.onCleared()
    }

    class Factory(
        private val auth: AuthRepository,
        private val e164Phone: String,
        private val purpose: OtpPurpose,
    ) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T =
            OtpViewModel(auth, e164Phone, purpose) as T
    }
}

data class OtpUiState(
    /** `+92 3** *** **67` — never the full number on this screen. */
    val maskedPhone: String,
    val code: String = "",
    val submitting: Boolean = false,
    val resending: Boolean = false,
    val cooldownSeconds: Int = 0,
    val resendsUsed: Int = 0,

    val verified: Boolean = false,
    val invalidCode: Boolean = false,
    val expiredCode: Boolean = false,
    /** EDGE-005 — too many attempts. */
    val lockedOut: Boolean = false,
    val codeResent: Boolean = false,

    /** The server's own localised message, when it sent one (LOCALE-FR-006). */
    val serverMessage: String? = null,
    val failure: ApiFailure? = null,
) {
    val canResend: Boolean
        get() = cooldownSeconds == 0 && !resending && resendsUsed < OTP_MAX_RESENDS_PER_HOUR

    val resendsExhausted: Boolean get() = resendsUsed >= OTP_MAX_RESENDS_PER_HOUR
}

/**
 * Masks all but the last two digits — the same shape the backend's
 * `maskForOwner` produces, so the user sees a consistent rendering wherever
 * their number is shown back to them (PRIV-003).
 */
fun maskPhoneForOwner(e164: String): String {
    val last2 = e164.takeLast(2)
    return "+92 3** *** **$last2"
}
