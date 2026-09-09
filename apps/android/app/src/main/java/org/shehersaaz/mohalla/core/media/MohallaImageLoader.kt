package org.shehersaaz.mohalla.core.media

import android.content.Context
import coil.ImageLoader
import coil.disk.DiskCache
import coil.memory.MemoryCache
import okhttp3.OkHttpClient

/**
 * The one image loader, and the reason it cannot be Coil's default.
 *
 * `GET /media/{id}` IS AN AUTHENTICATED ROUTE. It serves READY, PUBLIC media
 * only, but it still requires a session — so a loader built on Coil's own
 * OkHttp instance would fetch every image without a bearer token and every
 * attachment in the product would render as a broken box. Passing the app's
 * configured client is what makes the `AuthInterceptor` apply.
 *
 * THAT ALSO MEANS THE CORRELATION AND LANGUAGE INTERCEPTORS APPLY, which is
 * wanted: an image fetch that fails is traceable to the same correlation id as
 * the request that produced the post.
 *
 * CACHE SIZES ARE SET FOR A 2GB DEVICE (NFR-COMP-002), not for a developer's
 * phone. Coil's memory default is a percentage of available heap, which on a
 * 720×1280 device with 2GB of RAM is small enough to thrash a feed of image
 * posts and large enough to matter if it is not bounded. The disk cache is the
 * one that earns its keep here: `GET /media/{id}` is served with
 * `Cache-Control: private, max-age=31536000, immutable`, because a promoted
 * media object never changes — so a re-read of yesterday's feed costs no data
 * at all, which on Pakistani mobile pricing is the difference between a usable
 * product and an expensive one.
 *
 * `respectCacheHeaders` is left at its default of `true` deliberately. Coil can
 * be told to ignore server cache headers; doing so here would discard exactly
 * the immutability the API went out of its way to declare.
 */
object MohallaImageLoader {

    fun create(context: Context, http: OkHttpClient): ImageLoader = ImageLoader.Builder(context)
        // The app's client, with the auth, correlation and language
        // interceptors already on it.
        .okHttpClient(http)
        .memoryCache {
            MemoryCache.Builder(context)
                .maxSizePercent(MEMORY_CACHE_FRACTION)
                .build()
        }
        .diskCache {
            DiskCache.Builder()
                .directory(context.cacheDir.resolve(DISK_CACHE_DIR))
                .maxSizeBytes(DISK_CACHE_BYTES)
                .build()
        }
        // Crossfade over the `base` motion token (180ms), which is what §34
        // asks for: "then a 180ms fade-in". A slow image never blocks the
        // surrounding card.
        .crossfade(FADE_IN_MILLIS)
        .build()

    /**
     * A tenth of the available heap.
     *
     * Coil's default is 20% (25% on low-memory devices). Halved because the
     * feed's images are already capped at 1600px on the longest edge by
     * [ImageUploader], so the bitmaps are small — and because on a 2GB device
     * the heap is shared with a scrolling `LazyColumn` that has its own
     * retention. A bigger cache here buys a few fewer disk reads and costs
     * evictions somewhere that matters more.
     */
    private const val MEMORY_CACHE_FRACTION = 0.10

    /**
     * 64 MB on disk.
     *
     * Roughly two hundred feed images at the 500KB ceiling NFR-PERF-005 sets,
     * which is several days of ordinary reading. Bounded rather than generous
     * because it lives in `cacheDir`, which Android reclaims under pressure —
     * an unbounded cache on a 16GB phone is a support problem, not a feature.
     */
    private const val DISK_CACHE_BYTES = 64L * 1024 * 1024

    /** Its own directory, so clearing image cache cannot touch anything else. */
    private const val DISK_CACHE_DIR = "media_image_cache"

    /** The `base` motion token. */
    private const val FADE_IN_MILLIS = 180
}
