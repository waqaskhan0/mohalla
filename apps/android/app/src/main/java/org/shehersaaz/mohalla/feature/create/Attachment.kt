package org.shehersaaz.mohalla.feature.create

import org.shehersaaz.mohalla.core.media.PickedImage

/**
 * One attachment, and its own independent life (POST-FR-003 · EDGE-013).
 *
 * EVERY ATTACHMENT UPLOADS SEPARATELY AND FAILS SEPARATELY. That is the whole
 * shape of this type, and it comes straight from the requirement:
 *
 *   POST-FR-003 — "each is compressed and uploaded independently; the order
 *   chosen is preserved… one upload fails → that image is marked failed and can
 *   be retried or removed without losing the others."
 *
 *   EDGE-013 — "Three of four images upload and the fourth fails. The three
 *   succeeded images are retained. Only the fourth is retried or removed."
 *
 * So there is no single "uploading" flag on the composer and no shared
 * progress. Each attachment carries its own [state], and the acceptance
 * criterion — "GIVEN 4 images where the third fails, WHEN the user retries only
 * the third, THEN the other three are not re-uploaded" — is satisfied
 * structurally: a [Ready] attachment already holds its `mediaId`, and nothing
 * in the retry path can reach it.
 *
 * THE LOCAL ID IS NOT THE MEDIA ID. An attachment exists on the device before
 * the server knows about it, needs a stable identity for `LazyRow` keys from the
 * moment it is picked, and keeps that identity across a failure and a retry that
 * produces a different media id. Keying on the media id would mean an
 * attachment with no key until it succeeded.
 */
data class Attachment(
    /** Stable from the moment of picking. Never the media id. */
    val localId: String,
    /**
     * The device's own copy, for the thumbnail.
     *
     * A `String` rather than an `android.net.Uri` so this whole state machine
     * is assertable in a plain JVM test — see [PickedImage.thumbnailUri].
     */
    val thumbnailUri: String,
    val state: AttachmentState,
    /** Held only until the upload succeeds; see [AttachmentState.Ready]. */
    val image: PickedImage? = null,
) {
    val isReady: Boolean get() = state is AttachmentState.Ready
    val isBusy: Boolean get() = state is AttachmentState.Uploading

    /** Only a transient failure offers a retry. A rejection cannot succeed. */
    val canRetry: Boolean get() = state is AttachmentState.Failed

    val mediaId: String? get() = (state as? AttachmentState.Ready)?.mediaId
}

/**
 * Where one attachment has got to.
 *
 * FAILED AND REJECTED ARE DIFFERENT STATES, and collapsing them is the defect
 * this type exists to prevent. A dropped connection should keep the bytes and
 * offer a retry; a file the server inspected and refused must not, because
 * retrying the same rejected image will be rejected again and the user needs to
 * choose a different one. One "upload failed" state produces a retry button
 * that can never work — which is worse than no button, because the user keeps
 * pressing it.
 */
sealed interface AttachmentState {

    /** Picked and compressed, waiting its turn. */
    data object Pending : AttachmentState

    /**
     * In flight.
     *
     * [percent] is `null` while the slot is being requested, because there is
     * no transfer to report progress on yet — and a bar sitting at 0% for a
     * second on a slow connection reads as a stall. §34 asks for "a thumbnail
     * with a percentage overlay and a 3px progress bar along the bottom edge".
     */
    data class Uploading(val percent: Int? = null) : AttachmentState

    /**
     * Inspected, promoted, and usable in a post.
     *
     * THE BYTES ARE DROPPED once this is reached — [Attachment.image] is
     * cleared. Four 500KB buffers held for the life of a composer is 2MB of
     * heap on a 2GB device for data that has already been transmitted and can
     * never be needed again: a `Ready` attachment is never re-uploaded, because
     * that is exactly what EDGE-013 forbids.
     */
    data class Ready(val mediaId: String) : AttachmentState

    /**
     * Transient. The bytes are kept and a retry is offered.
     *
     * Offline, a 5xx, or a connection that dropped mid-transfer. EDGE-011's
     * case — "upload is interrupted at 80% by loss of network" — lands here,
     * and the requirement's guarantee that "no post is created" holds because
     * publishing is gated on every attachment being [Ready].
     */
    data object Failed : AttachmentState

    /**
     * The server looked at the file and refused it (SEC-012/SEC-013).
     *
     * A wrong type, an executable in disguise (EDGE-014), an image too large in
     * pixels. [reason] is the server's own localised message where it sent one —
     * the media controller returns it deliberately, because "it is the caller's
     * own file, and EDGE-013 needs them to know which attachment failed".
     *
     * NO RETRY. The bytes are dropped along with the offer.
     */
    data class Rejected(val reason: String?) : AttachmentState
}

/**
 * What the composer may publish (POST-FR-001 · BR-013).
 *
 * `mediaIds` in the order the attachments sit in, filtered to the ready ones —
 * POST-FR-003 requires the chosen order be preserved, so this maps rather than
 * collecting into a set.
 */
fun List<Attachment>.readyMediaIds(): List<String> = mapNotNull { it.mediaId }

/** BR-013 — four per post, and the picker is capped at what is left. */
const val MAX_IMAGES_PER_POST = 4

/**
 * `true` when nothing is in flight and nothing has failed.
 *
 * Publishing is gated on this rather than on "at least one succeeded", because
 * a post published while one image was still uploading would silently drop it —
 * and the author would discover their evidence missing after the fact. The
 * server would refuse it anyway (`MEDIA_NOT_READY`, a 409), but being refused
 * after tapping Post is a worse way to learn it.
 */
fun List<Attachment>.allSettledAndReady(): Boolean =
    isEmpty() || all { it.isReady }
