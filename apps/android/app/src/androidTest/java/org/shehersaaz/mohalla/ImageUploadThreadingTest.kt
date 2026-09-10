package org.shehersaaz.mohalla

import java.lang.reflect.Proxy
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import java.util.concurrent.atomic.AtomicReference
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNotEquals
import org.junit.Test
import org.shehersaaz.mohalla.core.media.ImageUploader
import org.shehersaaz.mohalla.core.media.UploadResult
import org.shehersaaz.mohalla.core.network.MohallaApi
import org.shehersaaz.mohalla.core.network.UploadSlotResponse
import org.shehersaaz.mohalla.core.network.UploadTarget
import retrofit2.Response

/**
 * INTEGRATION-007, second half — the upload must not do network on the main
 * thread.
 *
 * `execute()` is OkHttp's BLOCKING call and the uploader runs inside
 * `viewModelScope`, which is `Dispatchers.Main`. Android's StrictMode answers
 * that with `NetworkOnMainThreadException`, which is not an `IOException`, so
 * it escaped the catch and killed the process — the same way the relative URL
 * had a moment earlier. Fixing the URL only moved the crash a few lines down.
 *
 * WHY THIS TEST IS ON A DEVICE AND NOT ON THE JVM. StrictMode is an Android
 * runtime policy; a JVM unit test will happily open a socket on any thread it
 * likes and would pass against the defect. `ImageUploadTargetTest` covers the
 * URL half on the JVM because that half is pure OkHttp; this half cannot be
 * covered there at all.
 *
 * WHAT THIS ASSERTS, AND WHY NOT SIMPLY "IT DID NOT CRASH". The first version
 * of this test did assert that, and it PASSED against the restored defect —
 * because the uploader's deliberately broad catch turns the StrictMode
 * violation into the same `UploadResult.Failed` a refused connection produces.
 * A test that cannot tell a fixed call from a swallowed crash is worth nothing,
 * so this asserts the invariant itself through an interceptor: the thread the
 * request is actually issued on. That is immune to whatever the catch does with
 * the outcome.
 *
 * No server, and nothing leaves the machine: the target is a reserved
 * `.invalid` host, so the call fails to connect after the interceptor has
 * already recorded what it needed.
 */
class ImageUploadThreadingTest {

    private val callThread = AtomicReference<String?>(null)

    private fun uploader(): ImageUploader {
        val api = Proxy.newProxyInstance(
            MohallaApi::class.java.classLoader,
            arrayOf(MohallaApi::class.java),
        ) { _, method, _ ->
            when (method.name) {
                "requestUploadSlot" -> Response.success(
                    UploadSlotResponse(
                        mediaId = "22222222-2222-4222-8222-222222222222",
                        upload = UploadTarget(
                            url = "/media/upload/threading-check",
                            method = "PUT",
                            headers = mapOf("content-type" to "application/octet-stream"),
                            expiresAt = "2026-12-31T00:00:00Z",
                        ),
                    ),
                )
                else -> error("the upload should never get past the PUT in this test")
            }
        } as MohallaApi

        // Records the thread the PUT is issued on, BEFORE the socket work
        // that StrictMode would object to.
        val http = OkHttpClient.Builder()
            .addInterceptor(
                Interceptor { chain ->
                    callThread.set(Thread.currentThread().name)
                    chain.proceed(chain.request())
                },
            )
            .build()

        return ImageUploader(api, http, apiBaseUrl = "http://api.invalid:3000")
    }

    @Test fun uploadingFromTheMainThreadDoesNotThrowNetworkOnMainThread() = runBlocking {
        // FROM Dispatchers.Main, deliberately — that is where the composer
        // calls this from, and it is the only place the defect appears.
        val result = withContext(Dispatchers.Main) {
            uploader().upload(ByteArray(16) { 0x7f })
        }

        // The connection could not be made, which is the honest outcome for a
        // reserved host — but that is not what this test is about.
        assertEquals(UploadResult.Failed, result)

        val thread = callThread.get()
        assertNotNull("the PUT was never issued, so there is nothing to assert", thread)
        // BEFORE THE FIX this is "main", and on a device that is a dead process
        // rather than a failed upload.
        assertNotEquals("the upload must not be issued on the main thread", "main", thread)
    }
}
