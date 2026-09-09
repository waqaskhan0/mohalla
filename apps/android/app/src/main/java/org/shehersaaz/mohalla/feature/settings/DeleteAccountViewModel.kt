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

/**
 * Delete account — UX-SET-009 (SET-FR-004 · PRIV-006 · BR-008/009).
 *
 * PRIV-006 IS THE WHOLE REASON THIS SCREEN IS NOT A DIALOG. Users "MUST BE TOLD
 * THIS CLEARLY BEFORE CONFIRMING, because it differs from the erasure many will
 * assume" — and what differs is BR-009: posts and comments STAY, attributed to
 * "Deleted User", because other people replied to them. Somebody who deletes
 * expecting their words to vanish and finds them still there under a placeholder
 * name has been misled by an interface, not by a policy.
 *
 * SO THE CONSEQUENCES ARE FETCHED, NOT WRITTEN HERE. They arrive as localisation
 * KEYS in the server's own order, and the surprising line is deliberately SECOND
 * — "where it is read, rather than last where it is skipped". A client that
 * composed its own list could not honour that ordering and would drift from the
 * policy the moment either changed.
 *
 * AND THE SCREEN CANNOT LOAD WITHOUT THEM. There is no path here that reaches
 * the password field with the list unfetched: PRIV-006 is a claim about what the
 * user was told, and a screen that let somebody confirm while the list was
 * failing would make that claim falsely.
 *
 * THE PASSWORD IS RE-ENTERED (SET-FR-004). "The phone is already unlocked and in
 * somebody's hand — a friend, a relative, a partner. The password is the one
 * thing that distinguishes the account's owner from whoever is holding the
 * device, and this is the only irreversible action in the product."
 *
 * A WRONG PASSWORD IS NOT A SIGN-OUT. The server is explicit that it returns 400
 * rather than 401, "because a 401 would sign a confused user out of an account
 * they were trying not to lose" — so this file must not treat it as a session
 * failure either.
 */
class DeleteAccountViewModel(
    private val settings: DeletionSource,
) : ViewModel() {

    private val _state = MutableStateFlow(DeleteAccountUiState())
    val state: StateFlow<DeleteAccountUiState> = _state.asStateFlow()

    init {
        loadConsequences()
    }

    fun loadConsequences() {
        _state.update { it.copy(loading = true, loadFailure = null) }

        viewModelScope.launch {
            when (val result = settings.deletionConsequences()) {
                is ApiResult.Ok -> _state.update {
                    it.copy(
                        consequenceKeys = result.value.keys,
                        graceDays = result.value.graceDays,
                        loaded = true,
                        loading = false,
                    )
                }

                is ApiResult.Err -> _state.update {
                    it.copy(loading = false, loadFailure = result.failure)
                }
            }
        }
    }

    fun onPasswordChanged(value: String) =
        _state.update { it.copy(password = value, wrongPassword = false, failure = null) }

    /**
     * SET-FR-004 — request deletion.
     *
     * ON SUCCESS THE ACCOUNT IS ALREADY GONE FROM THIS DEVICE'S POINT OF VIEW:
     * every session is revoked server-side, so the local clear that follows is
     * not a courtesy but the only way this device can stop showing a signed-in
     * shell for an account that no longer answers.
     */
    fun submit(onDeleted: () -> Unit) {
        val current = _state.value
        if (!current.canSubmit) return

        _state.update { it.copy(submitting = true, failure = null, wrongPassword = false) }

        viewModelScope.launch {
            when (val result = settings.deleteAccount(current.password)) {
                is ApiResult.Ok -> {
                    // Cleared immediately: the password must not sit in memory
                    // behind a screen that is about to be torn down.
                    _state.value = DeleteAccountUiState(deleted = true)
                    onDeleted()
                }

                is ApiResult.Err -> _state.update {
                    it.copy(
                        submitting = false,
                        // 400, deliberately, and never a sign-out. The session
                        // is valid; it is the confirmation that failed.
                        wrongPassword = result.failure is ApiFailure.Validation,
                        failure = result.failure,
                    )
                }
            }
        }
    }

    class Factory(
        private val settings: DeletionSource,
    ) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T =
            DeleteAccountViewModel(settings) as T
    }
}

data class DeleteAccountUiState(
    /**
     * Localisation keys, IN THE SERVER'S ORDER.
     *
     * Never sorted, never filtered, never reordered by what the client happens
     * to have copy for — the ordering is a decision PRIV-006 made about what
     * gets read.
     */
    val consequenceKeys: List<String> = emptyList(),

    /** BR-008's grace period, from the server rather than a constant here. */
    val graceDays: Int = 0,

    val password: String = "",

    val loading: Boolean = true,
    val loaded: Boolean = false,
    val submitting: Boolean = false,
    val deleted: Boolean = false,

    val loadFailure: ApiFailure? = null,
    val wrongPassword: Boolean = false,
    val failure: ApiFailure? = null,
) {
    /**
     * Nothing is confirmable until the consequences are on screen.
     *
     * PRIV-006 is a claim about what the user was TOLD. A screen that accepted a
     * password while the list was still failing to load would be making that
     * claim falsely, so the control is disabled rather than the list being
     * treated as optional detail.
     */
    val canSubmit: Boolean get() = loaded && !submitting && password.isNotEmpty()
}

/** The deletion half of settings, separated so this screen depends on nothing else. */
interface DeletionSource {
    suspend fun deletionConsequences(): ApiResult<DeletionConsequences>

    suspend fun deleteAccount(password: String): ApiResult<Unit>
}

data class DeletionConsequences(
    val keys: List<String>,
    val graceDays: Int,
    /** SET-FR-005 — when the grace period runs out, for the restore screen. */
    val scheduledErasureAt: String?,
)
