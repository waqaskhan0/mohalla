package org.shehersaaz.mohalla.core.media

import android.content.Context
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.IOException

/**
 * Choosing an image from the device (MEDIA-FR-001 · UX-CREATE-002).
 *
 * THE PHOTO PICKER, NOT A STORAGE PERMISSION. `PickVisualMedia` grants access
 * to the one file the user chose and nothing else — no runtime prompt, no
 * gallery-wide read, and it works back to API 19 through the support fallback.
 * Asking for `READ_MEDIA_IMAGES` would request the entire photo library to
 * obtain one picture, which PRIV-001's data-minimisation rule rules out as
 * plainly as it rules out an unnecessary column. It is also the difference
 * between a permission dialog a cautious user declines and no dialog at all.
 *
 * THERE IS NO CROP STEP, and that is a decision rather than an omission.
 * UX-CREATE-002 names "crop" alongside select and compress. Android's own
 * picker offers no crop, and a hand-rolled cropper is a gesture surface that
 * has to work under RTL mirroring, at a 130% font scale, and on a 720×1280
 * screen — for an outcome the compression step already delivers, since every
 * image is scaled to a 1600px longest edge and re-encoded regardless. Recorded
 * in `20-mobile-open-issues.md` as a known reduction rather than shipped as a
 * half-working gesture.
 *
 * BYTES ARE READ AND COMPRESSED OFF THE MAIN THREAD. A 12-megapixel photo is
 * tens of megabytes; decoding it on the UI thread drops a visible number of
 * frames on the 2GB device NFR-COMP-002 targets.
 */
/**
 * Reading a chosen image, as a dependency a ViewModel can hold.
 *
 * SPEAKS IN STRINGS, NOT `Uri`. The composer's state machine is where EDGE-013
 * lives — four independent uploads, one failure, a retry that must not re-send
 * the other three — and that is a claim about a SEQUENCE, so it has to be
 * exercised through the real ViewModel rather than a reimplementation. A
 * ViewModel that held an `ImagePicker` could not be constructed off a device,
 * because the picker needs a `Context`; one that holds this interface can.
 *
 * The `Uri` is parsed back at the implementation, which is the boundary where
 * the Android type belongs.
 */
interface ImageSource {
    /** `null` when the file cannot be read or cannot be compressed under the ceiling. */
    suspend fun read(uriString: String): PickedImage?
}

class ImagePicker(
    private val context: Context,
) : ImageSource {

    override suspend fun read(uriString: String): PickedImage? =
        read(Uri.parse(uriString))

    /**
     * Read the chosen file and compress it to something transmittable.
     *
     * THE FULL FILE IS NEVER BUFFERED. A STREAM FACTORY is handed to
     * [ImageCompressor], which opens it twice — once for the header alone with
     * `inJustDecodeBounds`, allocating nothing, and once for the pixels with a
     * sample size already chosen. Reading a 12-megapixel photo into a
     * `ByteArray` first would commit tens of megabytes of heap on the 2GB
     * device NFR-COMP-002 targets, just to hand it to something that was going
     * to downsample it anyway.
     *
     * Returns `null` when the file cannot be read or cannot be compressed under
     * the ceiling — and those two collapse deliberately: from the composer's
     * side both mean "this image cannot be used, choose another", and neither
     * is retryable, because retrying the same unreadable or oversized file
     * produces the same answer.
     */
    suspend fun read(uri: Uri): PickedImage? = withContext(Dispatchers.IO) {
        // NFR-PERF-005's 500KB ceiling is applied HERE, before anything reaches
        // the composer's state. `compress` returns null when no quality step
        // gets under it, and the uploader refuses rather than sending the
        // original — "if compression fails, the upload is refused"
        // (`04-mobile-architecture.md` §7).
        val compressed = try {
            ImageCompressor.compress(
                openStream = {
                    context.contentResolver.openInputStream(uri)
                        ?: throw IOException("no stream for $uri")
                },
            )
        } catch (e: IOException) {
            // A URI whose grant has lapsed, or a file on removed storage.
            null
        } catch (e: SecurityException) {
            // The picker's one-file grant is scoped to the activity result, so a
            // URI held across a process death can outlive its permission.
            null
        } catch (e: OutOfMemoryError) {
            // Decoding is bounded by `inSampleSize`, but a malformed header can
            // still report dimensions that defeat it. Caught rather than
            // allowed to take the process down over one bad photo.
            null
        } ?: return@withContext null

        PickedImage(thumbnailUri = uri.toString(), bytes = compressed)
    }
}

/**
 * An image chosen and compressed, ready to upload.
 *
 * THE THUMBNAIL SOURCE IS KEPT so the preview can be drawn from the device's
 * own copy rather than from the compressed buffer. Decoding the compressed
 * bytes again for a preview would spend heap on a 500KB array the uploader is
 * about to consume, and the picker's URI is already a cheap thumbnail source
 * Coil reads directly.
 *
 * IT IS A `String`, NOT AN `android.net.Uri`, AND THAT IS DELIBERATE. This type
 * travels into the composer's `StateFlow`, and a state that holds an Android
 * type cannot be asserted in a plain JVM test — `Uri.parse` throws outside a
 * device, so every rule in the attachment state machine would need Robolectric
 * to check. `Uri.toString()` round-trips exactly and Coil accepts a String
 * model, so the Android type stays at the boundary where it belongs and the
 * rules stay testable.
 *
 * `equals`/`hashCode` are written by hand because [bytes] is a `ByteArray`, and
 * an array compares by identity — a data class would report two identical
 * images as different and, worse, recompose on every state read.
 */
class PickedImage(
    val thumbnailUri: String,
    val bytes: ByteArray,
) {
    val byteSize: Int get() = bytes.size

    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (other !is PickedImage) return false
        return thumbnailUri == other.thumbnailUri && bytes.contentEquals(other.bytes)
    }

    override fun hashCode(): Int = 31 * thumbnailUri.hashCode() + bytes.contentHashCode()
}

/**
 * A launcher for one or more images, capped at what remains of the four.
 *
 * THE CAP IS PASSED IN RATHER THAN FIXED AT FOUR. BR-013 allows four per post,
 * and a composer that already holds two must offer at most two more —
 * otherwise the picker lets somebody select four, and the app throws away half
 * their choice after they made it. POST-FR-001's acceptance criterion is that
 * "the selection is refused and the limit is stated", which is a worse
 * experience than not offering the extra slots at all.
 *
 * `remaining == 1` uses the SINGLE-item contract, because the multi-item picker
 * with a limit of one is a selection UI that makes the user tap twice for one
 * photo.
 */
@Composable
fun rememberImagePickerLauncher(
    remaining: Int,
    onPicked: (List<Uri>) -> Unit,
): () -> Unit {
    val capped = remaining.coerceAtLeast(0)

    val single = rememberLauncherForActivityResult(
        ActivityResultContracts.PickVisualMedia(),
    ) { uri -> if (uri != null) onPicked(listOf(uri)) }

    val multiple = rememberLauncherForActivityResult(
        // `coerceAtLeast(2)` because the multi contract rejects a maximum of
        // one at construction; the branch below never uses it in that case.
        ActivityResultContracts.PickMultipleVisualMedia(capped.coerceAtLeast(2)),
    ) { uris -> if (uris.isNotEmpty()) onPicked(uris) }

    val request = remember {
        PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)
    }

    return {
        when {
            // Nothing to pick. The caller disables the control, so this is the
            // belt to that braces — and it does nothing rather than opening a
            // picker whose result would be discarded.
            capped <= 0 -> Unit
            capped == 1 -> single.launch(request)
            else -> multiple.launch(request)
        }
    }
}
