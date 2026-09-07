package org.shehersaaz.mohalla.feature.events

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.createSavedStateHandle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.CreationExtras
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import org.shehersaaz.mohalla.core.format.EventTimes
import org.shehersaaz.mohalla.core.network.ApiFailure
import org.shehersaaz.mohalla.core.network.ApiResult
import org.shehersaaz.mohalla.core.network.EventResponse
import org.shehersaaz.mohalla.core.network.EventType

/**
 * Create and edit an event — UX-EVENT-004 · UX-EVENT-005
 * (EVENT-FR-001/002/007 · BR-043).
 *
 * ONE VIEWMODEL FOR BOTH, because the form is the same form. What differs is
 * where the initial values come from and which request the save makes — and
 * splitting it would duplicate seven fields of validation to change one function
 * reference.
 *
 * BR-043 — NO ROLE CHECK ANYWHERE IN THIS FILE. "Any active user may create
 * events"; creation is not restricted to verified organizations. There is no
 * account-type condition here and there must not be one, because the whole
 * mobilization layer would otherwise belong to whoever holds a badge.
 *
 * A SUSPENDED ACCOUNT NEVER REACHES THIS SCREEN. BR-034 and §6.2 put the check
 * at the Create control, which opens the suspension explainer instead — so this
 * ViewModel does not test for it. A composer that opens and then refuses on
 * submit is the defect the requirement is written against.
 *
 * DRAFT FIELDS ARE IN `SavedStateHandle`. An event description can be several
 * hundred words typed on a phone, and losing it to a process death — or to the
 * language switch that recreates the activity — is unrecoverable. The handle
 * comes from `CreationExtras`, not hand-constructed, because a
 * `SavedStateHandle()` built by hand compiles, runs and saves nothing.
 */
class EventComposerViewModel(
    private val events: EventSource,
    private val savedState: SavedStateHandle,
    /** Null when creating; the event being edited otherwise. */
    private val editingEventId: String?,
    private val now: () -> Long,
) : ViewModel() {

    private val _state = MutableStateFlow(
        EventComposerUiState(
            mode = if (editingEventId == null) ComposerMode.CREATE else ComposerMode.EDIT,
            title = savedState[KEY_TITLE] ?: "",
            description = savedState[KEY_DESCRIPTION] ?: "",
            startsAtMillis = savedState[KEY_STARTS_AT],
            type = EventType.fromWire(savedState[KEY_TYPE]),
            meetingUrl = savedState[KEY_MEETING_URL] ?: "",
            locationText = savedState[KEY_LOCATION] ?: "",
            categorySlug = savedState[KEY_CATEGORY],
            // An edit has to load before its fields mean anything; a create
            // starts empty and ready.
            loading = editingEventId != null,
        ),
    )
    val state: StateFlow<EventComposerUiState> = _state.asStateFlow()

    init {
        if (editingEventId != null) loadForEdit(editingEventId)
    }

    private fun loadForEdit(eventId: String) {
        viewModelScope.launch {
            when (val result = events.detail(eventId)) {
                is ApiResult.Ok -> {
                    val event = result.value
                    // A draft already in the handle WINS over the server's
                    // values: if the process died mid-edit, what the creator
                    // had typed is more valuable than what is stored, and
                    // overwriting it would silently discard their work.
                    _state.update { s ->
                        s.copy(
                            loading = false,
                            original = event,
                            title = s.title.ifEmpty { event.title },
                            description = s.description.ifEmpty { event.description },
                            startsAtMillis = s.startsAtMillis
                                ?: EventTimes.toEpochMillis(event.startsAt),
                            type = s.type ?: EventType.fromWire(event.eventType),
                            locationText = s.locationText.ifEmpty {
                                event.locationText.orEmpty()
                            },
                            // The meeting URL is NOT prefilled and cannot be:
                            // no response body carries it (EVENT-FR-003). An
                            // online event being edited therefore shows an
                            // empty link field, and the screen says that
                            // leaving it empty keeps the existing link.
                            categorySlug = s.categorySlug ?: event.categorySlug,
                            typeFrozen = event.goingCount + event.interestedCount > 0,
                        )
                    }
                }

                is ApiResult.Err -> _state.update {
                    it.copy(loading = false, failure = result.failure)
                }
            }
        }
    }

    fun onTitleChanged(value: String) {
        savedState[KEY_TITLE] = value
        _state.update { it.copy(title = value, fieldErrors = emptyMap(), failure = null) }
    }

    fun onDescriptionChanged(value: String) {
        savedState[KEY_DESCRIPTION] = value
        _state.update { it.copy(description = value, fieldErrors = emptyMap(), failure = null) }
    }

    fun onStartsAtChanged(epochMillis: Long) {
        savedState[KEY_STARTS_AT] = epochMillis
        _state.update {
            it.copy(startsAtMillis = epochMillis, fieldErrors = emptyMap(), failure = null)
        }
    }

    /**
     * EVENT-FR-002 — the type decides which field is required.
     *
     * Refused outright once anybody has responded: "somebody who agreed to walk
     * to a park has not agreed to join a video call". The server refuses it too
     * (`EVENT_TYPE_FROZEN`), but refusing here means the control is disabled
     * rather than tappable-then-rejected.
     *
     * SWITCHING TYPE CLEARS THE OTHER FIELD, because the two are mutually
     * exclusive (A1) and leaving a stale location on an event that became online
     * would send both and be refused.
     */
    fun onTypeChanged(type: EventType) {
        if (_state.value.typeFrozen) {
            _state.update { it.copy(typeFrozenAttempted = true) }
            return
        }

        savedState[KEY_TYPE] = type.wire
        _state.update {
            when (type) {
                EventType.ONLINE -> {
                    savedState[KEY_LOCATION] = ""
                    it.copy(type = type, locationText = "", fieldErrors = emptyMap())
                }
                EventType.PHYSICAL -> {
                    savedState[KEY_MEETING_URL] = ""
                    it.copy(type = type, meetingUrl = "", fieldErrors = emptyMap())
                }
            }
        }
    }

    fun onMeetingUrlChanged(value: String) {
        savedState[KEY_MEETING_URL] = value
        _state.update { it.copy(meetingUrl = value, fieldErrors = emptyMap(), failure = null) }
    }

    fun onLocationChanged(value: String) {
        savedState[KEY_LOCATION] = value
        _state.update { it.copy(locationText = value, fieldErrors = emptyMap(), failure = null) }
    }

    fun onCategoryChanged(slug: String?) {
        savedState[KEY_CATEGORY] = slug
        _state.update { it.copy(categorySlug = slug) }
    }

    fun onTypeFrozenAcknowledged() = _state.update { it.copy(typeFrozenAttempted = false) }

    fun submit() {
        val current = _state.value
        if (current.submitting) return

        val problems = checkEventDraft(
            title = current.title,
            description = current.description,
            startsAtMillis = current.startsAtMillis,
            nowMillis = now(),
            type = current.type,
            meetingUrl = current.meetingUrl,
            locationText = current.locationText,
        )

        // On an EDIT, an empty meeting URL is not a problem: no response body
        // carries the existing link, so leaving the field blank means "keep it".
        // On a CREATE it is required, because there is nothing to keep.
        val filtered = if (current.mode == ComposerMode.EDIT &&
            problems["meetingUrl"] == EventFieldProblem.MISSING_FOR_ONLINE
        ) {
            problems - "meetingUrl"
        } else {
            problems
        }

        if (filtered.isNotEmpty()) {
            _state.update { it.copy(fieldErrors = filtered) }
            return
        }

        val type = current.type ?: return
        val startsAt = current.startsAtMillis ?: return

        _state.update { it.copy(submitting = true, failure = null, fieldErrors = emptyMap()) }

        viewModelScope.launch {
            val result = if (editingEventId == null) {
                events.create(
                    EventDraft(
                        title = current.title,
                        description = current.description,
                        startsAtIso = EventTimes.toIso(startsAt),
                        type = type,
                        meetingUrl = current.meetingUrl.takeIf { type == EventType.ONLINE },
                        locationText = current.locationText.takeIf { type == EventType.PHYSICAL },
                        categorySlug = current.categorySlug,
                    ),
                )
            } else {
                events.update(editingEventId, current.changes(startsAt, type))
            }

            _state.update { s ->
                when (result) {
                    is ApiResult.Ok -> {
                        clearDraft()
                        s.copy(submitting = false, saved = result.value)
                    }

                    is ApiResult.Err -> s.copy(
                        submitting = false,
                        // EVERY FIELD IS PRESERVED. §13: a refused submit must
                        // not empty a form somebody spent five minutes on, on a
                        // connection where the refusal may have been transient.
                        failure = result.failure,
                        fieldErrors = serverFieldErrors(result.failure),
                        typeFrozenAttempted =
                        (result.failure as? ApiFailure.Validation)?.code == "EVENT_TYPE_FROZEN",
                    )
                }
            }
        }
    }

    /**
     * Cancel, or delete when nobody has responded (EVENT-FR-007).
     *
     * ONE INTENTION, AND THE OUTCOME IS NOT THE CREATOR'S CHOICE. The server
     * deletes an event nobody committed to and marks one somebody did — because
     * "deletion outright is not offered once RSVPs exist", so attendees who
     * never open the notification still find the event with a cancelled label.
     * The screen reports which happened rather than offering two buttons.
     */
    fun cancel() {
        val id = editingEventId ?: return
        if (_state.value.cancelling) return

        _state.update { it.copy(cancelling = true, failure = null) }

        viewModelScope.launch {
            when (val result = events.cancel(id)) {
                is ApiResult.Ok -> {
                    clearDraft()
                    _state.update { it.copy(cancelling = false, cancelled = result.value) }
                }

                is ApiResult.Err -> _state.update {
                    it.copy(cancelling = false, failure = result.failure)
                }
            }
        }
    }

    private fun clearDraft() {
        savedState.remove<String>(KEY_TITLE)
        savedState.remove<String>(KEY_DESCRIPTION)
        savedState.remove<Long>(KEY_STARTS_AT)
        savedState.remove<String>(KEY_TYPE)
        savedState.remove<String>(KEY_MEETING_URL)
        savedState.remove<String>(KEY_LOCATION)
        savedState.remove<String>(KEY_CATEGORY)
    }

    class Factory(
        private val events: EventSource,
        private val editingEventId: String?,
        private val now: () -> Long = { System.currentTimeMillis() },
    ) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(
            modelClass: Class<T>,
            extras: CreationExtras,
        ): T = EventComposerViewModel(
            events,
            extras.createSavedStateHandle(),
            editingEventId,
            now,
        ) as T
    }

    private companion object {
        const val KEY_TITLE = "event.title"
        const val KEY_DESCRIPTION = "event.description"
        const val KEY_STARTS_AT = "event.startsAt"
        const val KEY_TYPE = "event.type"
        const val KEY_MEETING_URL = "event.meetingUrl"
        const val KEY_LOCATION = "event.locationText"
        const val KEY_CATEGORY = "event.categorySlug"
    }
}

enum class ComposerMode { CREATE, EDIT }

data class EventComposerUiState(
    val mode: ComposerMode = ComposerMode.CREATE,

    val title: String = "",
    val description: String = "",
    val startsAtMillis: Long? = null,
    val type: EventType? = null,
    val meetingUrl: String = "",
    val locationText: String = "",
    val categorySlug: String? = null,

    /** The event as the server holds it. Null while creating. */
    val original: EventResponse? = null,

    /** EVENT-FR-002 — somebody has responded, so the type is fixed. */
    val typeFrozen: Boolean = false,
    val typeFrozenAttempted: Boolean = false,

    val loading: Boolean = false,
    val submitting: Boolean = false,
    val cancelling: Boolean = false,

    /** Keyed by the server's field paths, so one and the same render path works. */
    val fieldErrors: Map<String, EventFieldProblem> = emptyMap(),
    val failure: ApiFailure? = null,

    val saved: EventResponse? = null,
    val cancelled: CancelOutcome? = null,
) {
    /**
     * Whether Publish is offered.
     *
     * Enabled on a WELL-FORMED draft rather than on a validated one, and never
     * gated on a server round trip. §13's reasoning for the username field
     * applies here too: a control disabled by a stale answer is a control the
     * user cannot get past.
     */
    val canSubmit: Boolean
        get() = !submitting && !loading && title.isNotBlank() &&
            description.isNotBlank() && startsAtMillis != null && type != null

    /** Only what the creator actually touched (EVENT-FR-007). */
    fun changes(startsAtMillis: Long, type: EventType): EventChanges {
        val before = original
        return EventChanges(
            title = title.trim().takeIf { it != before?.title },
            description = description.trim().takeIf { it != before?.description },
            startsAtIso = EventTimes.toIso(startsAtMillis)
                .takeIf { EventTimes.toEpochMillis(before?.startsAt ?: "") != startsAtMillis },
            type = type.takeIf { it != EventType.fromWire(before?.eventType) },
            // Sent only when the creator typed a NEW link. Blank means "keep
            // the existing one", which is the only thing it can mean — no
            // response body carries the current link to compare against.
            meetingUrl = meetingUrl.trim().takeIf {
                it.isNotEmpty() && type == EventType.ONLINE
            },
            locationText = locationText.trim().takeIf {
                type == EventType.PHYSICAL && it != before?.locationText
            },
            categorySlug = categorySlug.takeIf { it != before?.categorySlug },
        )
    }
}

/**
 * The server's field problems, translated into the client's cases.
 *
 * MAPPED RATHER THAN DISPLAYED RAW. The server sends reasons like `TOO_SHORT`
 * as machine codes in `details[].message`, not as sentences — so showing them
 * would put `TOO_SHORT` under a text field. An unrecognised reason falls back to
 * the generic banner instead of being invented into a specific field error.
 */
private fun serverFieldErrors(failure: ApiFailure): Map<String, EventFieldProblem> {
    val validation = failure as? ApiFailure.Validation ?: return emptyMap()
    return validation.fieldErrors.mapNotNull { (path, reason) ->
        val problem = when (reason) {
            "EMPTY" -> EventFieldProblem.EMPTY
            "TOO_SHORT" -> EventFieldProblem.TOO_SHORT
            "TOO_LONG" -> EventFieldProblem.TOO_LONG
            "MUST_BE_IN_THE_FUTURE" -> EventFieldProblem.NOT_IN_THE_FUTURE
            "NOT_A_URL", "INVALID_SCHEME", "NOT_A_WEB_LINK" -> EventFieldProblem.NOT_A_WEB_LINK
            "REQUIRED_FOR_ONLINE" -> EventFieldProblem.MISSING_FOR_ONLINE
            "REQUIRED_FOR_PHYSICAL" -> EventFieldProblem.MISSING_FOR_PHYSICAL
            "BOTH_PROVIDED" -> EventFieldProblem.BOTH_LINK_AND_LOCATION
            else -> null
        }
        problem?.let { path to it }
    }.toMap()
}
