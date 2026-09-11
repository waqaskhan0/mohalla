package org.shehersaaz.mohalla.core.media

import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.shehersaaz.mohalla.core.network.ApiResult
import org.shehersaaz.mohalla.core.network.MohallaApi
import org.shehersaaz.mohalla.core.network.UploadSlotRequest
import org.shehersaaz.mohalla.core.network.apiCall
import java.io.IOException

/**
 * ADR-013's upload, in the three steps the architecture specifies.
 *
 *   1. `POST /media/upload-slot` — the server chooses a quarantine key and
 *      returns an upload target. The client does not choose where bytes go.
 *   2. `PUT` the bytes to that target. They land in **private quarantine** and
 *      are not servable by anything.
 *   3. `POST /media/{id}/complete` — the server INSPECTS the bytes and promotes
 *      them, or deletes them. This is what makes the object usable.
 *
 * THE CLIENT CANNOT SHORTCUT ANY OF IT, and that is the point of the design:
 * step 3 is where SEC-012's content inspection happens, so a `mediaId` from
 * step 1 is worthless until the server has looked at what actually arrived. A
 * client that attached the id after step 2 would be attaching an uninspected
 * file.
 *
 * WHY FAILURE IS THREE OUTCOMES AND NOT ONE. A network drop and a refused file
 * need opposite responses: the first should keep the bytes and offer a retry
 * (EDGE-013), the second must not, because retrying the same rejected image
 * will be rejected again and the user needs to pick a different one. Collapsing
 * them into "upload failed" produces a retry button that can never work.
 */
class ImageUploader(
    private val api: MohallaApi,
    private val http: OkHttpClient,
    /**
     * What a RELATIVE upload target is resolved against.
     *
     * ADR-013's port is explicit that the two adapters answer differently: S3
     * presigns an absolute URL, and the local adapter — which cannot presign —
     * returns an API path, `/media/upload/{key}`. Both are valid targets and
     * the client's code path is meant to be otherwise identical.
     *
     * It was not. `Request.Builder().url()` throws `IllegalArgumentException`
     * on a path, that is not an `IOException`, and the catch below only held
     * `IOException` — so attaching ANY image killed the process on the main
     * thread (INTEGRATION-007). Media had never worked from the app.
     */
    private val apiBaseUrl: String,
) {

    suspend fun upload(bytes: ByteArray, visibility: String? = null): UploadResult {
        // NFR-PERF-005 is a CEILING, not a target. `04-mobile-architecture.md`
        // §7: "If compression fails, the upload is refused rather than sending
        // the original." Checked here as well as at the compression step,
        // because this is the last point before bytes leave the device.
        if (bytes.size > MAX_UPLOAD_BYTES) {
            return UploadResult.Rejected("TOO_LARGE")
        }
        if (bytes.isEmpty()) {
            return UploadResult.Rejected("EMPTY")
        }

        // ---- 1 · ask for a slot ------------------------------------------
        val slot = apiCall {
            api.requestUploadSlot(
                UploadSlotRequest(
                    kind = "IMAGE",
                    declaredBytes = bytes.size.toLong(),
                    visibility = visibility,
                ),
            )
        }

        val target = when (slot) {
            is ApiResult.Ok -> slot.value
            // A refused slot is the server saying no before any bytes moved —
            // usually the declared size. Not retryable as-is.
            is ApiResult.Err -> return failureFor(slot, rejectable = true)
        }

        // ---- 2 · put the bytes into quarantine ---------------------------
        //
        // RESOLVED, NOT ASSUMED ABSOLUTE. See `apiBaseUrl`: a relative target
        // is a documented answer from a storage adapter that cannot presign,
        // not a malformed one.
        val uploadUrl = resolveUploadUrl(target.upload.url)
            ?: return UploadResult.Failed

        // OFF THE MAIN THREAD, like every other network call in the app.
        //
        // `execute()` is OkHttp's BLOCKING call, and this runs inside
        // `viewModelScope` — which is `Dispatchers.Main`. So the second half of
        // INTEGRATION-007 was `NetworkOnMainThreadException`, which is not an
        // `IOException` either: fixing the URL only moved the crash a few lines
        // down. Every other network path in this app already does this —
        // `apiCall`, `ImagePicker.read`, `UrlConnectionHttpClient` — and this
        // one place did not, which is exactly why only media crashed.
        val put = try {
            withContext(Dispatchers.IO) {
                val request = Request.Builder()
                    .url(uploadUrl)
                    .method(
                        target.upload.method,
                        bytes.toRequestBody("image/jpeg".toMediaType()),
                    )
                    .apply {
                        // Whatever the server said to send. The client does not
                        // invent headers for a presigned target.
                        target.upload.headers.forEach { (name, value) -> header(name, value) }
                    }
                    .build()

                http.newCall(request).execute().use { it.isSuccessful }
            }
        } catch (e: IOException) {
            // Transient. The caller keeps the bytes and can retry.
            return UploadResult.Failed
        } catch (e: CancellationException) {
            // The composer was closed. Not a failure to report — let it
            // propagate so the coroutine actually cancels.
            throw e
        } catch (e: Exception) {
            // A DELIBERATELY BROAD NET, and only here.
            //
            // This upload crashed the app twice, both times because something
            // that was not an `IOException` escaped: first
            // `IllegalArgumentException` from the URL, then
            // `NetworkOnMainThreadException`. Both are now fixed at the cause,
            // but the lesson is that "the bytes did not get there" is a state
            // this function can already express, and taking the process down
            // while somebody is writing a post is never the better answer to
            // it. Cancellation is re-thrown above so this does not swallow it.
            return UploadResult.Failed
        }

        if (!put) return UploadResult.Failed

        // ---- 3 · inspect and promote -------------------------------------
        //
        // Until this succeeds the object is quarantined and the id is not
        // usable. A client that skipped this would attach an uninspected file.
        val complete = apiCall { api.completeUpload(target.mediaId) }

        return when (complete) {
            is ApiResult.Ok -> UploadResult.Ok(target.mediaId)
            // The server looked at the bytes and refused them (SEC-012) — a
            // file whose declared type did not match its content, an image that
            // failed inspection. Retrying the same file cannot help.
            is ApiResult.Err -> failureFor(complete, rejectable = true)
        }
    }

    /**
     * The absolute URL to PUT to, or `null` if the target cannot be one.
     *
     * `null` RATHER THAN A THROW, and the reason is the crash this replaces: a
     * target the client cannot use is a failed upload, which is a thing the UI
     * already knows how to say. It is not a reason to take the app down while
     * somebody is writing a post.
     */
    private fun resolveUploadUrl(target: String): HttpUrl? {
        val absolute = target.toHttpUrlOrNull()
        if (absolute != null) return absolute
        // Relative: resolve against the API base, which is where this adapter's
        // upload endpoint lives.
        return apiBaseUrl.toHttpUrlOrNull()?.resolve(target)
    }

    private fun failureFor(err: ApiResult.Err, rejectable: Boolean): UploadResult {
        val failure = err.failure
        return when {
            // Offline and server errors are worth retrying.
            failure is org.shehersaaz.mohalla.core.network.ApiFailure.Offline -> UploadResult.Failed
            failure is org.shehersaaz.mohalla.core.network.ApiFailure.Server -> UploadResult.Failed

            rejectable -> UploadResult.Rejected(
                (failure as? org.shehersaaz.mohalla.core.network.ApiFailure.Validation)
                    ?.fieldErrors?.values?.firstOrNull()
                    ?: failure.message,
            )

            else -> UploadResult.Failed
        }
    }

    companion object {
        /** NFR-PERF-005 — nothing above 500 KB is transmitted. */
        const val MAX_UPLOAD_BYTES = 500 * 1024

        /** `04-mobile-architecture.md` §7 — longest edge. */
        const val MAX_LONGEST_EDGE_PX = 1600
    }
}

sealed interface UploadResult {
    data class Ok(val mediaId: String) : UploadResult

    /** Transient. The caller KEEPS the bytes and may retry (EDGE-013). */
    data object Failed : UploadResult

    /**
     * The server refused these bytes. Retrying the same file cannot succeed, so
     * the caller must drop them and ask for a different image.
     */
    data class Rejected(val reason: String?) : UploadResult
}
