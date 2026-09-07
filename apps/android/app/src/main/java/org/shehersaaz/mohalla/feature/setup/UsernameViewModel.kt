package org.shehersaaz.mohalla.feature.setup

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import org.shehersaaz.mohalla.core.network.ApiFailure
import org.shehersaaz.mohalla.core.network.ApiResult

/**
 * UX-SETUP-001 — username selection (PROFILE-FR-001 · EDGE-007).
 *
 * TWO RULES SHAPE THIS FILE, AND THE FIRST IS THE HARD ONE.
 *
 * **1 · The availability check is a hint, and the claim is the truth.** §13:
 * *"Do not claim a username is reserved until server confirms."* Two people can
 * pick `ayesha` in the same second, and only one gets it. So a green tick means
 * "free a moment ago", never "yours" — the state field is called
 * [UsernameUiState.looksFree] rather than `available`, and losing the race at
 * claim time is a normal outcome with its own copy, not an error state.
 *
 * **2 · The handle is permanent.** PROFILE-FR-001 makes it chosen once and
 * never changed, which is why the input is not silently lowercased. Handing
 * somebody `ayesha` when they typed `Ayesha` would give them a permanent name
 * they did not choose; they are told to use lowercase and they retype it.
 *
 * THE CHECK IS DEBOUNCED, AND THAT IS A COST DECISION AS MUCH AS A SERVER ONE.
 * NFR-PERF-001 assumes 3G and the audience pays for data by the megabyte. A
 * request per keystroke would send a dozen for one handle; 400 ms after typing
 * stops sends one.
 */
class UsernameViewModel(
    private val setup: SetupRepository,
) : ViewModel() {

    private val _state = MutableStateFlow(UsernameUiState())
    val state: StateFlow<UsernameUiState> = _state.asStateFlow()

    private var availabilityCheck: Job? = null

    fun onUsernameChanged(input: String) {
        availabilityCheck?.cancel()

        val shapeProblem = checkUsernameShape(input)
        _state.update {
            it.copy(
                input = input,
                shapeProblem = shapeProblem,
                // Every previous answer is discarded the moment the text
                // changes. Leaving a stale tick under a newly-edited handle is
                // how a user comes to believe a different name was free.
                looksFree = null,
                checking = false,
                takenMessage = null,
                failure = null,
            )
        }

        if (input.isEmpty() || shapeProblem != null) return

        availabilityCheck = viewModelScope.launch {
            delay(AVAILABILITY_DEBOUNCE_MS)
            _state.update { it.copy(checking = true) }

            when (val result = setup.checkAvailable(input)) {
                is ApiResult.Ok -> _state.update { current ->
                    // Guard against a late answer for a handle the user has
                    // since edited. `cancel()` handles most of it; this covers
                    // the response that was already in flight.
                    if (current.input != input) {
                        current
                    } else {
                        current.copy(
                            checking = false,
                            looksFree = result.value is UsernameAvailability.LooksFree,
                        )
                    }
                }

                is ApiResult.Err -> _state.update {
                    // A failed CHECK is not a failed claim. The user can still
                    // try — the claim is what decides — so this stays quiet
                    // rather than showing an error for an advisory request.
                    it.copy(checking = false, looksFree = null)
                }
            }
        }
    }

    /** Enabled on a well-formed handle, NOT on a positive availability check. */
    val canSubmit: Boolean
        get() = _state.value.let { isUsernameShapeValid(it.input) && !it.claiming }

    fun claim() {
        val username = _state.value.input
        if (!isUsernameShapeValid(username) || _state.value.claiming) return

        _state.update { it.copy(claiming = true, takenMessage = null, failure = null) }

        viewModelScope.launch {
            when (val result = setup.claimUsername(username)) {
                is ApiResult.Ok -> when (val outcome = result.value) {
                    is ClaimOutcome.Claimed -> _state.update {
                        it.copy(claiming = false, claimed = true)
                    }

                    // EDGE-007, lost. The input is KEPT so the user can edit
                    // `ayesha` into `ayesha_lhr` rather than start again.
                    is ClaimOutcome.Taken -> _state.update {
                        it.copy(
                            claiming = false,
                            looksFree = false,
                            takenMessage = outcome.message,
                        )
                    }

                    // Onboarding is further along than this screen thought,
                    // usually because it was finished on another device. Moving
                    // on is right; complaining would be wrong.
                    ClaimOutcome.AlreadySetForThisAccount -> _state.update {
                        it.copy(claiming = false, claimed = true)
                    }
                }

                is ApiResult.Err -> _state.update {
                    it.copy(claiming = false, failure = result.failure)
                }
            }
        }
    }

    class Factory(private val setup: SetupRepository) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T =
            UsernameViewModel(setup) as T
    }

    private companion object {
        /** Long enough that typing a handle sends one request, not twelve. */
        const val AVAILABILITY_DEBOUNCE_MS = 400L
    }
}

data class UsernameUiState(
    val input: String = "",
    val shapeProblem: UsernameShapeProblem? = null,

    /**
     * `null` = not asked or discarded · `true` = free a moment ago ·
     * `false` = taken or reserved.
     *
     * NAMED `looksFree`, NOT `available`. It is a snapshot that EDGE-007 can
     * invalidate before the user acts on it, and a field called `available`
     * invites a screen to treat it as a promise.
     */
    val looksFree: Boolean? = null,
    val checking: Boolean = false,

    val claiming: Boolean = false,
    val claimed: Boolean = false,

    /** The server's message when the claim lost the race. */
    val takenMessage: String? = null,
    val failure: ApiFailure? = null,
)
