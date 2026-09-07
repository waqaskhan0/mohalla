package org.shehersaaz.mohalla.feature.auth

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import org.shehersaaz.mohalla.R
import org.shehersaaz.mohalla.core.network.ApiFailure
import org.shehersaaz.mohalla.core.network.ApiResult
import org.shehersaaz.mohalla.core.ui.AuthNotice
import org.shehersaaz.mohalla.core.ui.AuthNoticeTone
import org.shehersaaz.mohalla.core.ui.AuthScaffold
import org.shehersaaz.mohalla.core.ui.MohallaButton
import org.shehersaaz.mohalla.core.ui.MohallaSecondaryButton

/**
 * UX-AUTH-012 — Restore account (SET-FR-005 · EDGE-003).
 *
 * REACHED BY LOGGING IN, NOT FROM SETTINGS. A user in `PENDING_DELETION` who
 * signs in gets a `RESTORE_ONLY` session, and the startup router sends them
 * here. That is deliberate: their sessions were revoked when they deleted, so
 * there is no authenticated place to put a "restore" button — logging in *is*
 * the restore gesture, and SET-FR-005 requires the account's own credentials
 * with **no administrator involvement**.
 *
 * The offer is stated warmly and completely. Somebody who deleted their account
 * at 2am and changed their mind by morning is exactly who this screen is for
 * (S2-CR-004), and the copy tells them what comes back — profile, followers,
 * posts — because "restore" alone does not say whether their eleven years of
 * neighbourhood posts survived.
 *
 * WHAT IS NOT ON THIS SCREEN: a way to decline and browse anyway. A
 * `RESTORE_ONLY` session can do exactly one thing, so offering a "maybe later"
 * that leads to a shell where every action fails would be worse than not
 * offering it. Signing out is the alternative, and it is offered plainly.
 */
@Composable
fun RestoreAccountScreen(
    state: RestoreUiState,
    onRestore: () -> Unit,
    onSignOut: () -> Unit,
    onRestored: () -> Unit,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(state.restored) { if (state.restored) onRestored() }

    AuthScaffold(
        modifier = modifier,
        title = stringResource(R.string.restore_title),
        body = stringResource(R.string.restore_body),
        notice = when {
            state.restored -> AuthNotice(
                stringResource(R.string.restore_done),
                AuthNoticeTone.SUCCESS,
            )

            // SET-FR-005's error case: past the grace period the account
            // "genuinely no longer exists and a neutral not-found response is
            // returned". So the message is the neutral one — this screen does
            // not get to say "you were too late", because by then there is
            // nothing to be too late for.
            state.graceExpired -> AuthNotice(
                stringResource(R.string.state_unavailable_title),
                AuthNoticeTone.ERROR,
            )

            state.failure is ApiFailure.Offline -> AuthNotice(
                stringResource(R.string.state_offline_banner),
                AuthNoticeTone.WARNING,
            )

            state.failure is ApiFailure.Server -> AuthNotice(
                stringResource(R.string.state_error_body),
                AuthNoticeTone.ERROR,
            )

            else -> null
        },
        action = {
            MohallaButton(
                text = stringResource(R.string.restore_submit),
                onClick = onRestore,
                enabled = !state.graceExpired,
                loading = state.restoring,
                modifier = Modifier.fillMaxWidth(),
            )
            MohallaSecondaryButton(
                text = stringResource(R.string.restore_sign_out),
                onClick = onSignOut,
                modifier = Modifier.fillMaxWidth(),
            )
        },
    ) {
        // Nothing else. The decision is one tap and the explanation is the body
        // — adding a form here would put friction on the recovery path, which
        // is the opposite of what S2-CR-004 added the grace period for.
    }
}

class RestoreAccountViewModel(
    private val auth: AuthRepository,
) : ViewModel() {

    private val _state = MutableStateFlow(RestoreUiState())
    val state: StateFlow<RestoreUiState> = _state.asStateFlow()

    fun restore() {
        if (_state.value.restoring) return
        _state.update { it.copy(restoring = true, failure = null) }

        viewModelScope.launch {
            when (val result = auth.restoreAccount()) {
                is ApiResult.Ok -> _state.update { it.copy(restoring = false, restored = true) }

                is ApiResult.Err -> _state.update {
                    when (result.failure) {
                        // The neutral not-found SET-FR-005 specifies. Past the
                        // grace period the account is gone, and the client
                        // reports that as unavailability rather than as a
                        // missed deadline.
                        is ApiFailure.Unavailable ->
                            it.copy(restoring = false, graceExpired = true)

                        else -> it.copy(restoring = false, failure = result.failure)
                    }
                }
            }
        }
    }

    fun signOut() {
        viewModelScope.launch { auth.logout() }
    }

    class Factory(private val auth: AuthRepository) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T =
            RestoreAccountViewModel(auth) as T
    }
}

data class RestoreUiState(
    val restoring: Boolean = false,
    val restored: Boolean = false,
    /** The grace period has passed, or the erasure already ran. */
    val graceExpired: Boolean = false,
    val failure: ApiFailure? = null,
)
