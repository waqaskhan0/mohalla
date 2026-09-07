package org.shehersaaz.mohalla.feature.setup

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
import org.shehersaaz.mohalla.core.media.ImageUploader
import org.shehersaaz.mohalla.core.media.UploadResult
import org.shehersaaz.mohalla.core.network.ApiFailure
import org.shehersaaz.mohalla.core.network.ApiResult

/**
 * UX-SETUP-002 — profile setup (PROFILE-FR-002/003).
 *
 * ONE REQUIRED FIELD. Display name is the only one; city, bio and photo are all
 * optional, and the screen says so rather than implying a complete profile is
 * expected. An onboarding form that demands a bio is an onboarding form people
 * abandon.
 *
 * THE PHOTO IS A SEPARATE TRANSACTION FROM THE PROFILE, and that ordering
 * matters. ADR-013's upload is three steps — slot, bytes, inspect-and-promote —
 * any of which can fail on a 3G connection, and `photoMediaId` cannot be sent
 * until the last one succeeds. So the photo uploads on selection and the profile
 * is created on Continue: a failed upload leaves the typed fields untouched and
 * offers a retry for the photo alone (§13, EDGE-013), rather than failing the
 * whole form because an image did not land.
 *
 * ACCOUNT TYPE IS NOT ON THIS SCREEN. §13 is explicit that choosing
 * Organization *"does not automatically show a verified badge"* — the badge is
 * ADMIN-FR-010, granted by an administrator. The backend's `createProfileBody`
 * has no `accountType` field at all, so there is nothing here to send: the type
 * is set at registration and the badge is somebody else's decision.
 */
class ProfileSetupViewModel(
    private val setup: SetupRepository,
    private val uploader: ImageUploader,
    private val savedState: SavedStateHandle,
) : ViewModel() {

    private val _state = MutableStateFlow(
        ProfileSetupUiState(
            displayName = savedState[KEY_NAME] ?: "",
            city = savedState[KEY_CITY] ?: "",
            bio = savedState[KEY_BIO] ?: "",
            photoMediaId = savedState[KEY_PHOTO],
        ),
    )
    val state: StateFlow<ProfileSetupUiState> = _state.asStateFlow()

    fun onDisplayNameChanged(value: String) {
        savedState[KEY_NAME] = value
        _state.update {
            it.copy(
                displayName = value,
                displayNameTooLong = !isWithinLimit(value, DISPLAY_NAME_MAX),
                failure = null,
            )
        }
    }

    fun onCityChanged(value: String) {
        savedState[KEY_CITY] = value
        _state.update {
            it.copy(city = value, cityTooLong = !isWithinLimit(value, CITY_MAX), failure = null)
        }
    }

    fun onBioChanged(value: String) {
        savedState[KEY_BIO] = value
        _state.update {
            it.copy(
                bio = value,
                // Counted in GRAPHEMES so Urdu is not cut off early — the same
                // reasoning as BR-012's post counter.
                bioGraphemes = graphemeLength(value),
                bioTooLong = !isWithinLimit(value, BIO_MAX),
                failure = null,
            )
        }
    }

    /**
     * A photo was picked. Uploads immediately, on its own.
     *
     * @param bytes the ALREADY-COMPRESSED image. Compression happens before
     *   this is called, because NFR-PERF-005 caps the transmitted image at
     *   500 KB and `04-mobile-architecture.md` §7 says an image that cannot be
     *   compressed under the ceiling is REFUSED rather than sent at full size.
     */
    fun onPhotoSelected(bytes: ByteArray) {
        _state.update { it.copy(uploading = true, uploadFailed = false, pendingPhoto = bytes) }

        viewModelScope.launch {
            when (val result = uploader.upload(bytes)) {
                is UploadResult.Ok -> {
                    savedState[KEY_PHOTO] = result.mediaId
                    _state.update {
                        it.copy(uploading = false, photoMediaId = result.mediaId, pendingPhoto = null)
                    }
                }

                is UploadResult.Rejected -> _state.update {
                    // The server inspected the bytes and refused them
                    // (SEC-012). Not retryable with the same file, so the
                    // pending bytes are dropped and the reason is shown.
                    it.copy(
                        uploading = false,
                        uploadFailed = true,
                        uploadRejectedReason = result.reason,
                        pendingPhoto = null,
                    )
                }

                is UploadResult.Failed -> _state.update {
                    // Transient. The BYTES ARE KEPT so retry does not ask the
                    // user to find the photo again (EDGE-013).
                    it.copy(uploading = false, uploadFailed = true)
                }
            }
        }
    }

    /**
     * The chosen file cannot be used at all.
     *
     * Reached when the picker could not read it, or when no compression step
     * got under NFR-PERF-005's 500KB ceiling — and both mean the same thing to
     * the person choosing: pick another one. Recorded as a REJECTION rather
     * than a failure, because a retry offer here would re-read the same file
     * and reach the same answer, and no bytes are held to retry with.
     */
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

    fun removePhoto() {
        savedState[KEY_PHOTO] = null
        _state.update {
            it.copy(photoMediaId = null, pendingPhoto = null, uploadFailed = false)
        }
    }

    val canSubmit: Boolean
        get() = _state.value.let { s ->
            s.displayName.isNotBlank() &&
                !s.displayNameTooLong &&
                !s.cityTooLong &&
                !s.bioTooLong &&
                // A photo still uploading blocks submission, because sending
                // the profile now would create it without the photo and there
                // is no second chance in onboarding.
                !s.uploading &&
                !s.submitting
        }

    fun submit() {
        val current = _state.value
        if (current.displayName.isBlank() || current.submitting) return

        _state.update { it.copy(submitting = true, failure = null) }

        viewModelScope.launch {
            val result = setup.createProfile(
                displayName = current.displayName.trim(),
                city = current.city,
                bio = current.bio,
                photoMediaId = current.photoMediaId,
            )

            when (result) {
                is ApiResult.Ok -> _state.update { it.copy(submitting = false, created = true) }

                is ApiResult.Err -> _state.update {
                    it.copy(
                        submitting = false,
                        // Every field preserved (§13). Losing a bio somebody
                        // just wrote to a dropped connection is unforgivable on
                        // a screen they only see once.
                        failure = result.failure,
                        displayNameServerError = (result.failure as? ApiFailure.Validation)
                            ?.fieldErrors?.get("displayName"),
                    )
                }
            }
        }
    }

    /** The handle comes from `CreationExtras`; see `RegisterViewModel.Factory`. */
    class Factory(
        private val setup: SetupRepository,
        private val uploader: ImageUploader,
    ) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(
            modelClass: Class<T>,
            extras: CreationExtras,
        ): T = ProfileSetupViewModel(setup, uploader, extras.createSavedStateHandle()) as T
    }

    private companion object {
        const val KEY_NAME = "setup.displayName"
        const val KEY_CITY = "setup.city"
        const val KEY_BIO = "setup.bio"
        // The media ID is safe to persist: it is a server-side handle to an
        // object the account already owns, not a credential.
        const val KEY_PHOTO = "setup.photoMediaId"
    }
}

data class ProfileSetupUiState(
    val displayName: String = "",
    val displayNameTooLong: Boolean = false,
    val displayNameServerError: String? = null,

    val city: String = "",
    val cityTooLong: Boolean = false,

    val bio: String = "",
    val bioGraphemes: Int = 0,
    val bioTooLong: Boolean = false,

    val photoMediaId: String? = null,
    val uploading: Boolean = false,
    val uploadFailed: Boolean = false,
    val uploadRejectedReason: String? = null,
    /**
     * Held so a retry does not make the user find the photo again (EDGE-013).
     * Dropped once the upload succeeds or is refused outright.
     */
    val pendingPhoto: ByteArray? = null,

    val submitting: Boolean = false,
    val created: Boolean = false,
    val failure: ApiFailure? = null,
) {
    val bioRemaining: Int get() = BIO_MAX - bioGraphemes

    // ByteArray in a data class needs these, or `==` compares references and
    // recomposition sees a change on every state read.
    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (other !is ProfileSetupUiState) return false
        return displayName == other.displayName &&
            displayNameTooLong == other.displayNameTooLong &&
            displayNameServerError == other.displayNameServerError &&
            city == other.city &&
            cityTooLong == other.cityTooLong &&
            bio == other.bio &&
            bioGraphemes == other.bioGraphemes &&
            bioTooLong == other.bioTooLong &&
            photoMediaId == other.photoMediaId &&
            uploading == other.uploading &&
            uploadFailed == other.uploadFailed &&
            uploadRejectedReason == other.uploadRejectedReason &&
            pendingPhoto.contentEquals(other.pendingPhoto) &&
            submitting == other.submitting &&
            created == other.created &&
            failure == other.failure
    }

    override fun hashCode(): Int {
        var result = displayName.hashCode()
        result = 31 * result + city.hashCode()
        result = 31 * result + bio.hashCode()
        result = 31 * result + (photoMediaId?.hashCode() ?: 0)
        result = 31 * result + uploading.hashCode()
        result = 31 * result + (pendingPhoto?.contentHashCode() ?: 0)
        result = 31 * result + submitting.hashCode()
        return result
    }
}
