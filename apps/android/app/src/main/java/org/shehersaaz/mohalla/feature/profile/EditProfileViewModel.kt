package org.shehersaaz.mohalla.feature.profile

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import org.shehersaaz.mohalla.core.media.ImageUploader
import org.shehersaaz.mohalla.core.media.UploadResult
import org.shehersaaz.mohalla.core.network.ApiFailure
import org.shehersaaz.mohalla.core.network.ApiResult
import org.shehersaaz.mohalla.core.network.Patch
import org.shehersaaz.mohalla.core.network.changedTo
import org.shehersaaz.mohalla.feature.setup.BIO_MAX
import org.shehersaaz.mohalla.feature.setup.CITY_MAX
import org.shehersaaz.mohalla.feature.setup.DISPLAY_NAME_MAX
import org.shehersaaz.mohalla.feature.setup.graphemeLength

/**
 * Edit profile — UX-PROFILE-003 (PROFILE-FR-003 · BR-005).
 *
 * THE USERNAME IS SHOWN AND LOCKED, and that is a requirement rather than a
 * simplification. BR-005 makes a handle permanent; the server REJECTS a
 * `username` in this body rather than ignoring it, and there is no field in the
 * request that could carry one. Showing it greyed out with a line saying it
 * cannot change is better than hiding it — somebody who came here to change it
 * gets an answer instead of hunting for the control.
 *
 * ONLY WHAT CHANGED IS SENT, AND EMPTYING A FIELD IS A CHANGE. Those are two
 * different requests — an absent key means "leave it alone" and an explicit null
 * means "clear it" — and until this group the client could send only the first,
 * so nobody could remove their bio, their city or their photo. See
 * `PatchBody.kt`.
 *
 * THE LIMITS ARE THE ONBOARDING SCREEN'S, COUNTED THE SAME WAY. A display name
 * and a bio are the same fields PROFILE-FR-001 created, so they are counted in
 * GRAPHEME CLUSTERS (BR-012) rather than UTF-16 units — otherwise an Urdu name
 * would exhaust a limit at half the visible length.
 */
class EditProfileViewModel(
    private val profiles: ProfileSource,
    private val uploader: ImageUploader,
) : ViewModel() {

    private val _state = MutableStateFlow(EditProfileUiState())
    val state: StateFlow<EditProfileUiState> = _state.asStateFlow()

    init {
        load()
    }

    fun load() {
        _state.update { it.copy(loading = true, loadFailure = null) }

        viewModelScope.launch {
            when (val result = profiles.own()) {
                is ApiResult.Ok -> {
                    val profile = result.value
                    _state.update {
                        it.copy(
                            username = profile.username,
                            // The server's values are kept SEPARATELY from the
                            // editable ones, because "what changed" is the whole
                            // question this screen answers and it cannot be
                            // asked without both.
                            original = EditableProfile(
                                displayName = profile.displayName.orEmpty(),
                                city = profile.city.orEmpty(),
                                bio = profile.bio.orEmpty(),
                                photoMediaId = profile.photoMediaId,
                            ),
                            displayName = profile.displayName.orEmpty(),
                            city = profile.city.orEmpty(),
                            bio = profile.bio.orEmpty(),
                            photoMediaId = profile.photoMediaId,
                            loading = false,
                            loaded = true,
                        )
                    }
                }

                is ApiResult.Err -> _state.update {
                    it.copy(loading = false, loadFailure = result.failure)
                }
            }
        }
    }

    fun onDisplayNameChanged(value: String) =
        _state.update { it.copy(displayName = value, saveFailure = null, fieldError = null) }

    fun onCityChanged(value: String) =
        _state.update { it.copy(city = value, saveFailure = null, fieldError = null) }

    fun onBioChanged(value: String) =
        _state.update { it.copy(bio = value, saveFailure = null, fieldError = null) }

    /**
     * A photo was picked (PROFILE-FR-010 · MEDIA-FR-001).
     *
     * UPLOADED IMMEDIATELY AND ON ITS OWN, exactly as onboarding does it.
     * ADR-013's upload is three steps — slot, bytes, inspect-and-promote — any
     * of which can fail on a 3G connection, and `photoMediaId` cannot be sent
     * until the last one succeeds. Uploading on selection rather than on Save
     * means a failed upload leaves the typed fields untouched and offers a retry
     * for the photo alone (EDGE-013).
     *
     * WHICH IS ALSO WHY THE REQUIREMENT HOLDS FOR FREE: "GIVEN an upload
     * interrupted mid-transfer, WHEN the user returns to their profile, THEN the
     * previous photo is intact." A failed upload produces no media id, so
     * nothing partial can be saved and the old photo is never replaced.
     */
    fun onPhotoSelected(bytes: ByteArray) {
        _state.update {
            it.copy(uploading = true, uploadFailed = false, pendingPhoto = bytes)
        }

        viewModelScope.launch {
            when (val result = uploader.upload(bytes)) {
                is UploadResult.Ok -> _state.update {
                    it.copy(uploading = false, photoMediaId = result.mediaId, pendingPhoto = null)
                }

                // The server refused these bytes; retrying them cannot succeed,
                // so they are dropped and a different image is asked for.
                is UploadResult.Rejected -> _state.update {
                    it.copy(
                        uploading = false,
                        uploadFailed = true,
                        uploadRejectedReason = result.reason,
                        pendingPhoto = null,
                    )
                }

                // Transient. The BYTES ARE KEPT so a retry does not make the
                // user find the photo again (EDGE-013).
                UploadResult.Failed -> _state.update {
                    it.copy(uploading = false, uploadFailed = true)
                }
            }
        }
    }

    /** The picked file could not be read or compressed at all. */
    fun onPhotoUnusable() {
        _state.update {
            it.copy(
                uploading = false,
                uploadFailed = true,
                uploadRejectedReason = null,
                pendingPhoto = null,
            )
        }
    }

    /** EDGE-013 — retries the photo alone, using the bytes already held. */
    fun retryPhotoUpload() {
        val bytes = _state.value.pendingPhoto ?: return
        onPhotoSelected(bytes)
    }

    /**
     * Remove the photo.
     *
     * A CLEAR, not an omission — the difference the rest of this file exists to
     * preserve. Setting it to null here makes `changes` emit an explicit null,
     * which is what the server reads as "remove the photo".
     */
    fun removePhoto() {
        _state.update {
            it.copy(photoMediaId = null, pendingPhoto = null, uploadFailed = false)
        }
    }

    fun save(onSaved: () -> Unit) {
        val current = _state.value
        if (!current.canSave) return

        val changes = current.changes
        if (changes.isEmpty) {
            // Nothing to send. Leaving without a request is the honest outcome
            // and is also what the reader expects: they changed nothing.
            onSaved()
            return
        }

        _state.update { it.copy(saving = true, saveFailure = null, fieldError = null) }

        viewModelScope.launch {
            when (val result = profiles.updateProfile(changes)) {
                is ApiResult.Ok -> {
                    val saved = result.value
                    _state.update {
                        it.copy(
                            saving = false,
                            original = EditableProfile(
                                displayName = saved.displayName.orEmpty(),
                                city = saved.city.orEmpty(),
                                bio = saved.bio.orEmpty(),
                                photoMediaId = saved.photoMediaId,
                            ),
                        )
                    }
                    onSaved()
                }

                is ApiResult.Err -> _state.update {
                    it.copy(
                        saving = false,
                        // The server names the field it refused, so the message
                        // goes under the input rather than in a banner the
                        // reader has to map back onto a form.
                        fieldError = (result.failure as? ApiFailure.Validation)
                            ?.fieldErrors
                            ?.entries
                            ?.firstOrNull()
                            ?.let { entry -> entry.key to entry.value },
                        saveFailure = result.failure,
                    )
                }
            }
        }
    }

    class Factory(
        private val profiles: ProfileSource,
        private val uploader: ImageUploader,
    ) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T =
            EditProfileViewModel(profiles, uploader) as T
    }
}

/** What the server holds, so "what changed" can be asked. */
data class EditableProfile(
    val displayName: String = "",
    val city: String = "",
    val bio: String = "",
    val photoMediaId: String? = null,
)

data class EditProfileUiState(
    /** BR-005 — shown, never editable. */
    val username: String? = null,

    val original: EditableProfile? = null,

    val displayName: String = "",
    val city: String = "",
    val bio: String = "",
    val photoMediaId: String? = null,

    val loading: Boolean = true,
    val loaded: Boolean = false,
    val saving: Boolean = false,

    val uploading: Boolean = false,
    val uploadFailed: Boolean = false,
    val uploadRejectedReason: String? = null,
    /** Kept so EDGE-013's retry does not send the user back to the picker. */
    val pendingPhoto: ByteArray? = null,

    val loadFailure: ApiFailure? = null,
    val saveFailure: ApiFailure? = null,
    /** `path to message`, as the server named it. */
    val fieldError: Pair<String, String>? = null,
) {
    val displayNameLength: Int get() = graphemeLength(displayName.trim())
    val bioLength: Int get() = graphemeLength(bio.trim())

    val cityLength: Int get() = graphemeLength(city.trim())

    val displayNameTooLong: Boolean get() = displayNameLength > DISPLAY_NAME_MAX
    val cityTooLong: Boolean get() = cityLength > CITY_MAX
    val bioTooLong: Boolean get() = bioLength > BIO_MAX

    /**
     * A display name is REQUIRED and the other three are not.
     *
     * PROFILE-FR-001 makes the name the one mandatory field, so an empty one is
     * refused here rather than sent and refused there — but city, bio and photo
     * may all legitimately be emptied, and doing so is a save worth making.
     */
    val canSave: Boolean
        get() = loaded && !saving && !uploading && displayName.isNotBlank() &&
            !displayNameTooLong && !cityTooLong && !bioTooLong

    /**
     * What to send.
     *
     * UNCHANGED FIELDS ARE ABSENT and emptied ones are explicit nulls. A field
     * the reader never opened must not be re-sent — "last write wins" on the
     * server, so re-sending a stale value would quietly overwrite a change made
     * on another device between this screen loading and saving.
     */
    val changes: ProfileChanges
        get() {
            val before = original ?: EditableProfile()
            return ProfileChanges(
                displayName = displayName.trim().takeIf { it != before.displayName },
                city = changedTo(before.city, city),
                bio = changedTo(before.bio, bio),
                photoMediaId = when {
                    photoMediaId == before.photoMediaId -> Patch.Unchanged
                    photoMediaId == null -> Patch.Clear
                    else -> Patch.Set(photoMediaId)
                },
            )
        }

    val hasUnsavedChanges: Boolean get() = loaded && !changes.isEmpty
}
