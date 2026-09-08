package org.shehersaaz.mohalla.feature.auth

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.createSavedStateHandle
import androidx.lifecycle.viewmodel.CreationExtras
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
 * Registration — UX-AUTH-005 · 006 · 007 · 008 (AUTH-FR-001/002 · BR-001…004).
 *
 * ONE VIEWMODEL FOR FOUR SCREENS, and that is deliberate rather than lazy.
 * Registration is a single transaction split across four steps for readability:
 * nothing is sent until the last one, the whole payload has to arrive together,
 * and a user who reaches the password step and goes back must find their number
 * still there. Four ViewModels would mean lifting that state into navigation
 * arguments, which puts a password in a back-stack entry.
 *
 * §37 warns against "giant God ViewModels" — the line drawn here is that this
 * owns ONE user intent (create an account) across its steps, and hands off
 * completely at the OTP screen, which has its own.
 *
 * STATE SURVIVES `recreate()`. A language switch recreates the activity
 * (`04-mobile-architecture.md` §3 rule 2), and somebody realising mid-signup
 * that they would rather read Urdu is a case the product should handle without
 * losing their typing. `SavedStateHandle` carries the phone and date of birth.
 * **The password is deliberately NOT saved** — see [PASSWORD_NOT_PERSISTED].
 */
class RegisterViewModel(
    private val auth: AuthRepository,
    private val savedState: SavedStateHandle,
    private val termsVersion: String,
) : ViewModel() {

    private val _state = MutableStateFlow(
        RegisterUiState(
            phoneInput = savedState[KEY_PHONE] ?: "",
            dateOfBirth = savedState[KEY_DOB],
        ),
    )
    val state: StateFlow<RegisterUiState> = _state.asStateFlow()

    // ------------------------------------------------------------- step 1
    fun onPhoneChanged(input: String) {
        savedState[KEY_PHONE] = input
        _state.update {
            it.copy(
                phoneInput = input,
                phoneCheck = checkPhone(input),
                // Clearing on edit rather than on submit: a message that
                // persists while the user fixes the thing it complains about
                // reads as the app not noticing.
                phoneError = null,
                submitFailure = null,
            )
        }
    }

    val phoneStepValid: Boolean get() = _state.value.phoneCheck is PhoneCheck.Valid

    // ------------------------------------------------------------- step 2
    /**
     * BR-002 — at least 13, decided by the SERVER clock.
     *
     * A too-young date is flagged but does not block submission: the client
     * cannot be trusted with the age rule (a device clock is user-settable), so
     * refusing here would be a client enforcing something it cannot enforce.
     * The warning spares an honest mistake a round trip; the server refuses a
     * dishonest one.
     */
    fun onDateOfBirthChanged(year: Int, monthZeroBased: Int, day: Int) {
        val iso = formatDateOfBirth(year, monthZeroBased, day)
        savedState[KEY_DOB] = iso
        _state.update {
            it.copy(
                dateOfBirth = iso,
                looksUnderage = !isAtLeastMinimumAge(year, monthZeroBased, day),
                submitFailure = null,
            )
        }
    }

    // ------------------------------------------------------------- step 3
    fun onPasswordChanged(password: String) {
        // NOT written to savedState. See PASSWORD_NOT_PERSISTED.
        _state.update {
            it.copy(
                password = password,
                passwordProblem = if (password.isEmpty()) null else checkPassword(password),
                submitFailure = null,
            )
        }
    }

    val passwordStepValid: Boolean
        get() = _state.value.password.isNotEmpty() && _state.value.passwordProblem == null

    // ------------------------------------------------------------- step 4
    /** BR-004 — an explicit affirmative, never a pre-ticked box. */
    /** PROFILE-FR-006 - see [RegisterUiState.accountType]. */
    fun onAccountTypeChanged(type: AccountType) {
        _state.update { it.copy(accountType = type) }
    }

    fun onTermsAcceptedChanged(accepted: Boolean) {
        _state.update { it.copy(termsAccepted = accepted, submitFailure = null) }
    }

    fun submit() {
        val current = _state.value
        val phone = (current.phoneCheck as? PhoneCheck.Valid)?.e164 ?: return
        if (!current.termsAccepted || current.password.isEmpty()) return
        val dob = current.dateOfBirth ?: return

        // OD-015 — no published Terms document, so no version to record.
        //
        // FAILS CLOSED, and this is the one place in the app that does. What is
        // being written here is a compliance record: "this user accepted this
        // version of these terms on this date". Sending an empty or invented
        // version would put a record in the database asserting an acceptance of
        // a document nobody has written, which is worse than not registering
        // the user at all — the record cannot be corrected later, because
        // nobody will know what they were shown.
        if (termsVersion.isBlank()) {
            _state.update { it.copy(termsUnavailable = true) }
            return
        }

        _state.update { it.copy(submitting = true, submitFailure = null) }

        viewModelScope.launch {
            val result = auth.register(
                e164Phone = phone,
                password = current.password,
                dateOfBirth = dob,
                termsVersion = termsVersion,
                accountType = current.accountType,
            )
            when (result) {
                is ApiResult.Ok -> _state.update {
                    // SEC-006: `202` says nothing about whether the number was
                    // free. The ONLY next step is the OTP screen, for every
                    // case — which is exactly why there is nothing to branch on
                    // here.
                    it.copy(submitting = false, registered = true)
                }

                is ApiResult.Err -> _state.update {
                    it.copy(
                        submitting = false,
                        // EVERY FIELD IS PRESERVED. §13: "Preserve entered
                        // fields on transient errors." Losing a password and a
                        // date of birth to a dropped connection is how somebody
                        // abandons signing up.
                        submitFailure = result.failure,
                        phoneError = result.failure.fieldError("phone"),
                        passwordServerError = result.failure.fieldError("password"),
                        dobServerError = result.failure.fieldError("dateOfBirth"),
                    )
                }
            }
        }
    }

    /** The E.164 number to hand to the OTP screen. */
    fun normalisedPhone(): String? = (_state.value.phoneCheck as? PhoneCheck.Valid)?.e164

    /**
     * Takes the [SavedStateHandle] from `CreationExtras`.
     *
     * NOT a handle passed in by the caller. A hand-constructed
     * `SavedStateHandle()` compiles, runs, and silently saves nothing — the
     * handle has to come from the owner's own saved-state registry to survive
     * process death, which is the entire reason the phone number and date of
     * birth are kept in one. A registration that loses four steps of input when
     * Android reclaims the process is the failure §13 is written against, and it
     * is invisible in testing unless process death is forced.
     *
     * The unit-test overload below takes an explicit handle, so tests stay
     * plain JVM tests.
     */
    class Factory(
        private val auth: AuthRepository,
        private val termsVersion: String,
    ) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(
            modelClass: Class<T>,
            extras: CreationExtras,
        ): T = RegisterViewModel(auth, extras.createSavedStateHandle(), termsVersion) as T
    }

    private companion object {
        const val KEY_PHONE = "register.phone"
        const val KEY_DOB = "register.dob"
    }
}

/**
 * WHY THE PASSWORD IS NOT IN `SavedStateHandle`.
 *
 * `SavedStateHandle` is backed by the saved-instance-state `Bundle`, which
 * Android writes to disk when the process is killed and which can appear in a
 * bug report or an ANR trace. SEC-028 forbids a password reaching any of those.
 *
 * The cost is real and accepted: if the process is killed mid-signup the user
 * re-types their password. The alternative is a plaintext password persisted by
 * the platform in a place the app does not control, to save one field of typing.
 */
private const val PASSWORD_NOT_PERSISTED = true

data class RegisterUiState(
    val phoneInput: String = "",
    val phoneCheck: PhoneCheck = PhoneCheck.Incomplete,
    val phoneError: String? = null,

    val dateOfBirth: String? = null,
    val looksUnderage: Boolean = false,
    val dobServerError: String? = null,

    val password: String = "",
    val passwordProblem: PasswordProblem? = null,
    val passwordServerError: String? = null,

    /**
     * PROFILE-FR-006. Defaults to INDIVIDUAL because that is what almost
     * everybody is and what the server would have assumed anyway - but the
     * control is on the screen, because BR-011 makes the value permanent and
     * OD-020 means no administrator exists to correct it.
     */
    val accountType: AccountType = AccountType.INDIVIDUAL,

    val termsAccepted: Boolean = false,

    /**
     * Set when the build carries no Terms version (OD-015).
     *
     * Distinct from every other failure because it is not the user's problem
     * and no retry helps: the screen says registration is unavailable rather
     * than blaming the network or the input.
     */
    val termsUnavailable: Boolean = false,

    val submitting: Boolean = false,
    val registered: Boolean = false,
    val submitFailure: ApiFailure? = null,
)

/** The server's message for one field, when it named one. */
fun ApiFailure.fieldError(path: String): String? =
    (this as? ApiFailure.Validation)?.fieldErrors?.get(path)
