package org.shehersaaz.mohalla.core.media

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import java.io.ByteArrayOutputStream
import java.io.InputStream

/**
 * On-device compression, before any byte leaves (MEDIA-FR-001 · NFR-PERF-005 ·
 * `04-mobile-architecture.md` §7).
 *
 * THE 500 KB LIMIT IS A CEILING, NOT A TARGET, and the architecture is explicit
 * about the consequence: *"If compression fails, the upload is refused rather
 * than sending the original — the requirement is a ceiling, not a target."* So
 * [compress] returns `null` when it cannot get under the limit, and the caller
 * refuses. Sending a 4 MB camera photo because the loop ran out of quality
 * steps would break the requirement on the connection least able to afford it.
 *
 * WHY IT DECODES AT A SAMPLE SIZE RATHER THAN FULL RESOLUTION. A modern phone
 * camera produces a 12-megapixel image, which is roughly 48 MB as an ARGB
 * bitmap. NFR-COMP-002 targets devices with 2 GB of RAM, where a 48 MB
 * allocation is a plausible OOM — and the whole image is going to be scaled to
 * 1600 px anyway. `inSampleSize` decodes a smaller bitmap directly, so the full
 * one never exists in memory.
 *
 * Quality steps down rather than being computed, because JPEG's size-to-quality
 * curve depends on the image: a photo of a wall compresses differently from a
 * photo of a crowd. Measuring is reliable where predicting is not.
 */
object ImageCompressor {

    private val QUALITY_STEPS = intArrayOf(85, 75, 65, 55, 45, 35)

    /**
     * @return JPEG bytes under [ImageUploader.MAX_UPLOAD_BYTES], or `null` when
     *   no quality step gets there — in which case the caller must refuse.
     */
    fun compress(
        openStream: () -> InputStream,
        maxBytes: Int = ImageUploader.MAX_UPLOAD_BYTES,
        maxEdge: Int = ImageUploader.MAX_LONGEST_EDGE_PX,
    ): ByteArray? {
        // Pass one: bounds only. `inJustDecodeBounds` reads the header and
        // allocates nothing, so the dimensions are known before any memory is
        // committed to pixels.
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        openStream().use { BitmapFactory.decodeStream(it, null, bounds) }

        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null

        val options = BitmapFactory.Options().apply {
            inSampleSize = sampleSizeFor(bounds.outWidth, bounds.outHeight, maxEdge)
            // 565 halves the memory of 8888 and an uploaded JPEG has no alpha
            // channel to preserve anyway.
            inPreferredConfig = Bitmap.Config.RGB_565
        }

        val decoded = openStream().use { BitmapFactory.decodeStream(it, null, options) }
            ?: return null

        val scaled = scaleToMaxEdge(decoded, maxEdge)
        if (scaled !== decoded) decoded.recycle()

        try {
            for (quality in QUALITY_STEPS) {
                val out = ByteArrayOutputStream()
                scaled.compress(Bitmap.CompressFormat.JPEG, quality, out)
                val bytes = out.toByteArray()
                if (bytes.size <= maxBytes) return bytes
            }
            // Every step tried and still too large. REFUSED — see the class
            // comment. Returning the smallest attempt would silently break
            // NFR-PERF-005.
            return null
        } finally {
            scaled.recycle()
        }
    }

    /**
     * The power of two that gets the decoded bitmap at or just above [maxEdge].
     *
     * `inSampleSize` only honours powers of two, so this deliberately
     * under-samples — landing above the target and letting [scaleToMaxEdge] do
     * the exact fit — rather than over-sampling and producing a soft image.
     */
    internal fun sampleSizeFor(width: Int, height: Int, maxEdge: Int): Int {
        var sample = 1
        var longest = maxOf(width, height)
        while (longest / 2 >= maxEdge) {
            longest /= 2
            sample *= 2
        }
        return sample
    }

    private fun scaleToMaxEdge(bitmap: Bitmap, maxEdge: Int): Bitmap {
        val longest = maxOf(bitmap.width, bitmap.height)
        if (longest <= maxEdge) return bitmap

        val ratio = maxEdge.toFloat() / longest
        return Bitmap.createScaledBitmap(
            bitmap,
            (bitmap.width * ratio).toInt().coerceAtLeast(1),
            (bitmap.height * ratio).toInt().coerceAtLeast(1),
            true,
        )
    }
}
