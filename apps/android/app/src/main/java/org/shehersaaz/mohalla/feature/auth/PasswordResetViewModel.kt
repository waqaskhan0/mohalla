package org.shehersaaz.mohalla.feature.auth

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import org.shehersaaz.mohalla.core.network.ApiFailure
import org.shehersaaz.mohalla.core.network.ApiResult

/**
 * Password reset — UX-AUTH-010 · 011 (AUTH-FR-006).
 *
 * THE FIRST STEP IS UNIFORM AND THE SECOND IS NOT, and the reason is the same
 * one that governs every disclosure in this flow: *has the caller proved
 * anything yet?*
 *
 *   - **UX-AUTH-010** takes a number and answers identically whether or not an
 *     account exists (SEC-006). At that point the caller has proved nothing, so
 *     `requestSent` is set on ANY success and there is no field to say whether a
 *     message actually went anywhere. Otherwise the screen becomes a way to
 *     check which numbers are registered.
 *   - **UX-AUTH-011** takes the code from that message. Holding it proves
 *     possession of the number, so a wrong or expired code can be reported
 *     specifically — the same reasoning as the OTP screen.
 *
 * ONE VIEWMODEL FOR BOTH, because the phone number has to survive the step
 * boundary and threading it through a navigation argument would put it in the
 * back stack.
 */
class PasswordResetViewModel(
    private val auth: AuthRepository,
) : ViewModel() {

    private val _state = MutableStateFlow(PasswordResetUiState())
    val state: StateFlow<PasswordResetUiState> = _state.asStateFlow()

    // ---------------------------------------------------- UX-AUTH-010
    fun onPhoneChanged(input: String) {
        _state.update {
            it.copy(phoneInput = input, phoneCheck = checkPhone(input), failure = null)
        }
    }

    fun requestCode() {
        val phone = (_state.value.phoneCheck as? PhoneCheck.Valid)?.e164 ?: return
        _state.update { it.copy(submitting = true, failure = null) }

        viewModelScope.launch {
            when (val result = auth.forgotPassword(phone)) {
                // UNIFORM. Set on success regardless of whether a message was
                // sent — the server does not say, and a client that inferred it
                // from timing or a field would be an account oracle.
                is ApiResult.Ok -> _state.update {
                    it.copy(submitting = false, requestSent = true, e164Phone = phone)
                }

                is ApiResult.Err -> _state.update {
                    it.copy(submitting = false, failure = result.failure)
                }
            }
        }
    }

    // ---------------------------------------------------- UX-AUTH-011
    fun onCodeChanged(raw: String) {
        val digits = raw.filter(Char::isDigit).take(OTP_LENGTH)
        _state.update {
            it.copy(code = digits, invalidCode = false, expiredCode = false, failure = null)
        }
    }

    fun onNewPasswordChanged(password: String) {
        _state.update {
            it.copy(
                newPassword = password,
                passwordProblem = if (password.isEmpty()) null else checkPassword(password),
                failure = null,
            )
        }
    }

    val canSubmitReset: Boolean
        get() = _state.value.let { s ->
            isCompleteOtp(s.code) &&
                s.newPassword.isNotEmpty() &&
                s.passwordProblem == null &&
                !s.submitting
        }

    fun submitReset() {
        val current = _state.value
        val phone = current.e164Phone ?: return
        if (!isCompleteOtp(current.code) || current.passwordProblem != null) return

        _state.update { it.copy(submitting = true, failure = null) }

        viewModelScope.launch {
            when (val result = auth.resetPassword(phone, current.code, current.newPassword)) {
                is ApiResult.Ok -> _state.update {
                    // BR-007: the backend revokes every session in the same
                    // transaction as the change, so there is nothing for the
                    // client to clean up — and the user signs in fresh, which
                    // is what `resetComplete` routes to.
                    it.copy(
                        submitting = false,
                        resetComplete = true,
                        code = "",
                        newPassword = "",
                    )
                }

                is ApiResult.Err -> _state.update { s ->
                    when (val failure = result.failure) {
                        is ApiFailure.Validation -> s.copy(
                            submitting = false,
                            expiredCode = failure.code == "OTP_EXPIRED",
                            invalidCode = failure.code != "OTP_EXPIRED",
                            // The new password is KEPT. A rejected code is not
                            // a reason to make somebody retype a password they
                            // just chose (§13).
                            serverMessage = failure.message,
                        )

                        is ApiFailure.RateLimited -> s.copy(
                            submitting = false,
                            lockedOut = true,
                            serverMessage = failure.message,
                        )

                        else -> s.copy(submitting = false, failure = failure)
                    }
                }
            }
        }
    }

    class Factory(private val auth: AuthRepository) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T =
            PasswordResetViewModel(auth) as T
    }
}

data class PasswordResetUiState(
    val phoneInput: String = "",
    val phoneCheck: PhoneCheck = PhoneCheck.Incomplete,
    /** Set once the request is accepted, so step two knows the number. */
    val e164Phone: String? = null,

    /**
     * `true` on any accepted request. There is deliberately no companion field
     * saying whether a message was actually sent — the server does not say, and
     * inventing one would turn this screen into a registered-number check.
     */
    val requestSent: Boolean = false,

    val code: String = "",
    val newPassword: String = "",
    val passwordProblem: PasswordProblem? = null,

    val submitting: Boolean = false,
    val resetComplete: Boolean = false,
    val invalidCode: Boolean = false,
    val expiredCode: Boolean = false,
    val lockedOut: Boolean = false,

    val serverMessage: String? = null,
    val failure: ApiFailure? = null,
) {
    val maskedPhone: String? get() = e164Phone?.let(::maskPhoneForOwner)
}
