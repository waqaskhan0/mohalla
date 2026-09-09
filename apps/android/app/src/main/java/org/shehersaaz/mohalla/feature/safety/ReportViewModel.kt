package org.shehersaaz.mohalla.feature.safety

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
import org.shehersaaz.mohalla.feature.setup.graphemeLength

/**
 * Reporting, and the block that usually follows it — UX-SAFE-001 · UX-SAFE-002 ·
 * UX-SAFE-003 (SAFETY-FR-001/002/003/005 · EDGE-023 · BR-025/030).
 *
 * "USED UNDER STRESS", says the wireframe, and every decision here follows from
 * it. Two taps to make something stop. Dismissible at any point — "reporting is
 * never a trap". Plain sentences rather than policy language. And a block
 * offered the moment the report is acknowledged, "because in practice the two go
 * together".
 *
 * THE ACKNOWLEDGEMENT IS IDENTICAL EVERY TIME, AND THIS FILE CANNOT MAKE IT
 * OTHERWISE. A first report, a fourth from the same account, and the one that
 * crossed the auto-hide threshold all return the same 202 with no body.
 * SAFETY-FR-001: the reporter must not be able to "infer the current tally",
 * because the tally is what tells a coordinated group how many more accounts
 * they need — and RSK-010 names that as this platform's characteristic abuse.
 * EDGE-023 is the same rule from the other end: three reports from one person
 * leave the distinct count at one.
 *
 * SO THERE IS NO SUCCESS STATE THAT VARIES. One screen, one sentence, whatever
 * happened.
 *
 * A FAILED REPORT KEEPS EVERYTHING. The reason and the note stay exactly where
 * they were, and the sheet stays open — somebody who has just typed three
 * sentences about being harassed must not have to type them again because a
 * train went into a tunnel. What the app does NOT do is claim the report was
 * queued: see GAP-M-014.
 */
class ReportViewModel(
    private val safety: SafetySource,
    private val target: ReportTarget,
    private val targetId: String,
    /** Null when the target has no single person behind it. */
    private val subjectUserId: String?,
) : ViewModel() {

    private val _state = MutableStateFlow(
        ReportUiState(target = target, canBlockAfterwards = subjectUserId != null),
    )
    val state: StateFlow<ReportUiState> = _state.asStateFlow()

    /**
     * Step one: a reason.
     *
     * Choosing one moves to the note step rather than submitting, because
     * SAFETY-FR-001 offers the note and a sheet that submitted on the first tap
     * would never show it. Two taps to send, one tap to change your mind.
     */
    fun chooseReason(reason: ReportReason) {
        _state.update { it.copy(reason = reason, failure = null) }
    }

    /** Back to the reasons. The note survives, in case the choice was the slip. */
    fun clearReason() {
        _state.update { it.copy(reason = null, failure = null) }
    }

    fun onNoteChanged(value: String) {
        _state.update { it.copy(note = value, failure = null) }
    }

    fun submit() {
        val current = _state.value
        val reason = current.reason ?: return
        if (!current.canSubmit) return

        _state.update { it.copy(submitting = true, failure = null) }

        viewModelScope.launch {
            // NULL RATHER THAN BLANK. The note is optional, and "no note" is
            // what an untouched field means — sending "" would put an empty
            // line in front of the one person who reads these. The repository
            // trims defensively too; this is so the source's own contract is
            // honest about what was written.
            val note = current.note.trim().takeIf { it.isNotEmpty() }

            when (val result = safety.report(target, targetId, reason, note)) {
                // ONE OUTCOME. Not "reported", not "already reported", not "this
                // is now hidden" — the three things an organised reporter would
                // want are the three things absent.
                is ApiResult.Ok -> _state.update {
                    it.copy(submitting = false, acknowledged = true)
                }

                is ApiResult.Err -> _state.update {
                    it.copy(
                        submitting = false,
                        // The reason and the note are untouched. See the class
                        // comment.
                        failure = result.failure,
                    )
                }
            }
        }
    }

    /**
     * SAFETY-FR-005 — block, offered right after the acknowledgement.
     *
     * IDEMPOTENT AND SILENT. The blocked party is never told, and the response
     * says nothing about whether the target existed — so there is one outcome
     * here too, and a failure is the only thing worth reporting back.
     */
    fun block(onBlocked: () -> Unit) {
        val userId = subjectUserId ?: return
        if (_state.value.blocking) return

        _state.update { it.copy(blocking = true, blockFailed = false) }

        viewModelScope.launch {
            when (safety.block(userId)) {
                is ApiResult.Ok -> {
                    _state.update { it.copy(blocking = false, blocked = true) }
                    onBlocked()
                }

                is ApiResult.Err -> _state.update {
                    it.copy(blocking = false, blockFailed = true)
                }
            }
        }
    }

    class Factory(
        private val safety: SafetySource,
        private val target: ReportTarget,
        private val targetId: String,
        private val subjectUserId: String?,
    ) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T =
            ReportViewModel(safety, target, targetId, subjectUserId) as T
    }
}

data class ReportUiState(
    val target: ReportTarget,

    /** Null until step one is done. Non-null puts the sheet on the note step. */
    val reason: ReportReason? = null,

    val note: String = "",

    val submitting: Boolean = false,

    /**
     * The one and only success state.
     *
     * Named for what the reader is told rather than for what happened, because
     * what happened is deliberately not disclosed: "Thank you. Our team will
     * review this."
     */
    val acknowledged: Boolean = false,

    val failure: ApiFailure? = null,

    /** Offered after the acknowledgement, never before it. */
    val canBlockAfterwards: Boolean = false,
    val blocking: Boolean = false,
    val blocked: Boolean = false,
    val blockFailed: Boolean = false,
) {
    /** Counted in graphemes (BR-012), so an Urdu note gets its full 500. */
    val noteLength: Int get() = graphemeLength(note.trim())

    val noteTooLong: Boolean get() = noteLength > REPORT_NOTE_MAX_GRAPHEMES

    /**
     * The note is OPTIONAL, so an empty one submits.
     *
     * SAFETY-FR-001 says "optionally adds a note", and requiring one would make
     * the fastest path through this sheet — the one somebody uses while
     * distressed — the one that asks them to write about it.
     */
    val canSubmit: Boolean get() = reason != null && !submitting && !noteTooLong
}
