package org.shehersaaz.mohalla

import android.app.Application
import coil.ImageLoader
import coil.ImageLoaderFactory
import org.shehersaaz.mohalla.core.di.AppContainer
import org.shehersaaz.mohalla.core.media.MohallaImageLoader

/**
 * The application class, which exists for exactly one reason.
 *
 * COIL'S SINGLETON HAS TO BE SET HERE, and Coil says so in the deprecation
 * notice on the alternative: providing an `ImageLoader` through
 * `LocalImageLoader` does **not** replace the singleton, so any composable
 * reached through `AsyncImage` without the local in scope — or any code path
 * using `context.imageLoader` — quietly builds a second loader. Two loaders
 * means two memory caches, two disk caches on the same directory, and an
 * authenticated route fetched by the one that has no auth interceptor. The
 * symptom would be images that load on some screens and not others.
 *
 * `ImageLoaderFactory` is the supported mechanism: Coil calls it lazily, once,
 * and every entry point in the app gets the same instance.
 *
 * NOTHING ELSE LIVES HERE. `AppContainer` is still constructed by the activity
 * and is still the only dependency graph — an `Application` that eagerly built
 * repositories, HTTP clients and a Keystore-backed store would move all of that
 * onto the cold-start path, and NFR-PERF-003 budgets that path. The container's
 * `create` is idempotent and the loader is built from it lazily, so the first
 * image request is what pays for it rather than the launcher icon tap.
 */
class MohallaApplication : Application(), ImageLoaderFactory {

    /**
     * Built on the app's own OkHttp client.
     *
     * `GET /media/{id}` is an authenticated route, so a loader on Coil's
     * default client would fetch every image without a bearer token and every
     * attachment in the product would render as a broken box.
     */
    override fun newImageLoader(): ImageLoader = MohallaImageLoader.create(
        context = this,
        http = AppContainer.create(this).httpClient,
    )
}
