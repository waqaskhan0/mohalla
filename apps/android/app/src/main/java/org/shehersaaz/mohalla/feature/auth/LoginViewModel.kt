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
 * Log in — UX-AUTH-004 (AUTH-FR-005 · SEC-006/007).
 *
 * THE UNIFORM FAILURE IS THE WHOLE DESIGN. A wrong password, an unknown number
 * and a banned account produce one message. The backend already made them
 * indistinguishable *and comparable in time* — it hashes a decoy even when
 * there is no account, so latency is not an oracle either. This ViewModel has a
 * single `credentialsRejected` boolean and no field to say which; the state
 * type itself refuses to carry the distinction, so no screen can render one.
 *
 * WHAT IS SAFE TO DISCLOSE, AND WHY. `VERIFICATION_REQUIRED` is shown plainly,
 * because reaching it required the CORRECT PASSWORD — at that point the caller
 * has proved the account is theirs, and telling them their registration was
 * never finished reveals nothing to anyone else. Same reasoning as
 * `PROFILE_NOT_CREATED` on `/me`.
 */
class LoginViewModel(
    private val auth: AuthRepository,
) : ViewModel() {

    private val _state = MutableStateFlow(LoginUiState())
    val state: StateFlow<LoginUiState> = _state.asStateFlow()

    fun onPhoneChanged(input: String) {
        _state.update {
            it.copy(
                phoneInput = input,
                phoneCheck = checkPhone(input),
                credentialsRejected = false,
                failure = null,
            )
        }
    }

    fun onPasswordChanged(password: String) {
        _state.update {
            it.copy(password = password, credentialsRejected = false, failure = null)
        }
    }

    val canSubmit: Boolean
        get() = _state.value.phoneCheck is PhoneCheck.Valid &&
            _state.value.password.isNotEmpty() &&
            !_state.value.submitting

    fun submit() {
        val current = _state.value
        val phone = (current.phoneCheck as? PhoneCheck.Valid)?.e164 ?: return
        if (current.password.isEmpty()) return

        _state.update { it.copy(submitting = true, credentialsRejected = false, failure = null) }

        viewModelScope.launch {
            when (val result = auth.login(phone, current.password)) {
                is ApiResult.Ok -> when (val outcome = result.value) {
                    is LoginOutcome.Authenticated -> _state.update {
                        it.copy(
                            submitting = false,
                            // Cleared on success so a correct password does not
                            // linger in memory any longer than the request.
                            password = "",
                            authenticatedCapability = outcome.capability,
                        )
                    }

                    LoginOutcome.VerificationRequired -> _state.update {
                        it.copy(submitting = false, password = "", verificationRequired = true)
                    }

                    LoginOutcome.Failed -> _state.update {
                        it.copy(
                            submitting = false,
                            // The password is kept, not cleared: a mistyped
                            // character is the common case and clearing the
                            // field makes the user retype the whole thing.
                            credentialsRejected = true,
                        )
                    }
                }

                is ApiResult.Err -> _state.update {
                    // Rate limiting is its own state (UX-STATE-004) because it
                    // is not a credential problem and the advice differs —
                    // "wait" rather than "check what you typed".
                    it.copy(submitting = false, failure = result.failure)
                }
            }
        }
    }

    class Factory(private val auth: AuthRepository) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T = LoginViewModel(auth) as T
    }
}

data class LoginUiState(
    val phoneInput: String = "",
    val phoneCheck: PhoneCheck = PhoneCheck.Incomplete,
    val password: String = "",
    val submitting: Boolean = false,

    /**
     * ONE flag for every rejected sign-in. There is deliberately no
     * `wrongPassword`, no `noSuchAccount` and no `banned` — the server does not
     * distinguish them and neither may this (SEC-006).
     */
    val credentialsRejected: Boolean = false,

    /** Safe: reaching this required the correct password. */
    val verificationRequired: Boolean = false,

    /** Non-null when signed in. `FULL`, `READ_ONLY` or `RESTORE_ONLY`. */
    val authenticatedCapability: String? = null,

    /** Offline, rate limited, or a server error — not a credential problem. */
    val failure: ApiFailure? = null,
)
