package org.shehersaaz.mohalla

import java.lang.reflect.Proxy
import kotlinx.coroutines.test.runTest
import okhttp3.OkHttpClient
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.shehersaaz.mohalla.core.media.ImageUploader
import org.shehersaaz.mohalla.core.media.UploadResult
import org.shehersaaz.mohalla.core.network.MohallaApi
import org.shehersaaz.mohalla.core.network.UploadSlotResponse
import org.shehersaaz.mohalla.core.network.UploadTarget
import retrofit2.Response

/**
 * INTEGRATION-007 — a RELATIVE upload target must not take the app down.
 *
 * `media-storage.port.ts` is explicit that its two adapters answer differently:
 * S3 presigns an absolute URL, and the local adapter — which cannot presign —
 * returns the API path `/media/upload/{key}`. Both are valid, and the client's
 * code path is meant to be otherwise identical.
 *
 * It was not. `Request.Builder().url()` throws `IllegalArgumentException` on a
 * path, that is not an `IOException`, and the upload's catch only held
 * `IOException` — so attaching any image killed the process on the main thread.
 * Measured on a device: `POST /media/upload-slot` 201, then
 * `FATAL EXCEPTION: main … Expected URL scheme 'http' or 'https'`.
 *
 * These tests do not need a server. The point is not what the PUT returns — it
 * is that building the request survives the answer the running backend actually
 * gives, and that an unusable target degrades to a retryable failure rather
 * than a crash. Both targets are pointed at a reserved `.invalid` host so
 * nothing leaves the machine; the connection failure that follows is the
 * `IOException` the uploader already handles.
 */
class ImageUploadTargetTest {

    private fun uploaderReturning(targetUrl: String): ImageUploader {
        val api = Proxy.newProxyInstance(
            MohallaApi::class.java.classLoader,
            arrayOf(MohallaApi::class.java),
        ) { _, method, _ ->
            when (method.name) {
                "requestUploadSlot" -> Response.success(
                    UploadSlotResponse(
                        mediaId = "11111111-1111-4111-8111-111111111111",
                        upload = UploadTarget(
                            url = targetUrl,
                            method = "PUT",
                            headers = mapOf("content-type" to "application/octet-stream"),
                            expiresAt = "2026-12-31T00:00:00Z",
                        ),
                    ),
                )
                else -> error("the upload should never get past the PUT in this test")
            }
        } as MohallaApi

        return ImageUploader(api, OkHttpClient(), apiBaseUrl = "http://api.invalid:3000")
    }

    /** One byte is enough: nothing here depends on the content. */
    private val bytes = ByteArray(16) { 0x7f }

    @Test fun aRelativeTargetIsResolvedRatherThanCrashing() = runTest {
        // BEFORE THE FIX this call throws IllegalArgumentException out of the
        // uploader — which on a device is a dead process, not a failed upload.
        val result = uploaderReturning("/media/upload/abc123").upload(bytes)

        // The host cannot resolve, so the honest outcome is a retryable
        // failure. What matters is that it is an outcome at all.
        assertEquals(UploadResult.Failed, result)
    }

    @Test fun anAbsoluteTargetStillWorksTheSameWay() = runTest {
        // The S3 adapter's answer must keep behaving exactly as before.
        val result = uploaderReturning("https://storage.invalid/bucket/abc123?sig=x").upload(bytes)

        assertEquals(UploadResult.Failed, result)
    }

    @Test fun anUnusableTargetIsAFailureAndNotAThrow() = runTest {
        // Neither absolute nor resolvable — a target no adapter should send,
        // which is precisely when the old code took the app down.
        val result = uploaderReturning("::not a url::").upload(bytes)

        assertTrue("an unusable target must be reported, not thrown", result is UploadResult.Failed)
    }
}
