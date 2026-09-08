package org.shehersaaz.mohalla.feature.settings

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
import org.shehersaaz.mohalla.feature.auth.PasswordProblem
import org.shehersaaz.mohalla.feature.auth.checkPassword

/**
 * Change password — UX-SET-004 (SET-FR-002 · AUTH-FR-007 · SEC-005).
 *
 * WHAT THIS SCREEN IS ACTUALLY FOR is not "I want a different password". It is
 * the control somebody reaches for when they think another person is inside
 * their account: "GIVEN a password change on device A, WHEN device B makes its
 * next request, THEN device B is signed out." Every other session dies and this
 * one lives. That framing decides two things below.
 *
 * FIRST, THE CURRENT PASSWORD IS REQUIRED AND THE SERVER CHECKS IT. Somebody who
 * walked up to an unlocked phone must not be able to lock the owner out of their
 * own account — so a wrong current password is refused, and rate-limited after
 * five attempts (SEC-005).
 *
 * SECOND, THE NEW PASSWORD MUST DIFFER FROM THE CURRENT ONE, checked here as
 * well as on the server. Re-entering the same password would invalidate the
 * other sessions and look like it worked, which on this screen means somebody
 * believing they have removed an intruder who is still typing the password they
 * both know.
 *
 * THE POLICY IS REGISTRATION'S, UNCHANGED. Two policies for one password is one
 * policy too many, so `checkPassword` is the same function AUTH-FR-001 uses.
 *
 * NOTHING IS RETAINED. There is no draft, no `SavedStateHandle` and no logging:
 * SEC-028 forbids a password reaching a log, and §39 forbids one reaching
 * SharedPreferences. The fields live in this ViewModel for the life of the
 * screen and nowhere else.
 */
class ChangePasswordViewModel(
    private val settings: SettingsSource,
) : ViewModel() {

    private val _state = MutableStateFlow(ChangePasswordUiState())
    val state: StateFlow<ChangePasswordUiState> = _state.asStateFlow()

    fun onCurrentChanged(value: String) =
        _state.update { it.copy(current = value, failure = null, wrongCurrent = false) }

    fun onNewChanged(value: String) =
        _state.update { it.copy(new = value, failure = null) }

    fun onConfirmChanged(value: String) =
        _state.update { it.copy(confirm = value, failure = null) }

    fun submit(onChanged: () -> Unit) {
        val current = _state.value
        if (!current.canSubmit) return

        _state.update { it.copy(submitting = true, failure = null, wrongCurrent = false) }

        viewModelScope.launch {
            when (val result = settings.changePassword(current.current, current.new)) {
                is ApiResult.Ok -> {
                    // Cleared the moment it succeeds, so the values do not sit
                    // in memory behind a screen that is about to be popped.
                    _state.value = ChangePasswordUiState(changed = true)
                    onChanged()
                }

                is ApiResult.Err -> _state.update {
                    it.copy(
                        submitting = false,
                        // A 400 on this route means one thing: the current
                        // password was wrong. Named, because the reader needs to
                        // know WHICH field to correct — and it discloses nothing
                        // they did not just type themselves.
                        wrongCurrent = result.failure is ApiFailure.Validation,
                        failure = result.failure,
                    )
                }
            }
        }
    }

    class Factory(
        private val settings: SettingsSource,
    ) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T =
            ChangePasswordViewModel(settings) as T
    }
}

data class ChangePasswordUiState(
    val current: String = "",
    val new: String = "",
    val confirm: String = "",

    val submitting: Boolean = false,
    val changed: Boolean = false,

    val wrongCurrent: Boolean = false,
    val failure: ApiFailure? = null,
) {
    /** Registration's policy, unchanged (§12). */
    val newPasswordProblem: PasswordProblem? get() = checkPassword(new).takeIf { new.isNotEmpty() }

    val confirmMismatch: Boolean get() = confirm.isNotEmpty() && confirm != new

    /**
     * SET-FR-002 — "the new password must differ from the current one".
     *
     * Checked on the device as well as the server, because re-entering the same
     * password would still invalidate the other sessions and would still look
     * like it worked — leaving somebody believing they had removed an intruder
     * who knows the password they just re-entered.
     */
    val newSameAsCurrent: Boolean get() = new.isNotEmpty() && new == current

    val canSubmit: Boolean
        get() = !submitting && current.isNotEmpty() && new.isNotEmpty() &&
            newPasswordProblem == null && !confirmMismatch && confirm == new &&
            !newSameAsCurrent
}
