package org.shehersaaz.mohalla

import android.content.Context
import android.content.ContextWrapper
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.shehersaaz.mohalla.core.di.AppContainer
import org.shehersaaz.mohalla.core.push.MohallaMessagingService

/**
 * QA-009 — Firebase rotated the token, and the backend has to hear about it.
 *
 * REQUIRES A SIGNED-IN DEVICE. The harness logs in first and this asserts that
 * precondition rather than assuming it — a rotation test run signed out would
 * pass by taking the "dropped, nobody is signed in" branch and prove nothing.
 *
 * WHY THIS IS ON THE DEVICE AND NOT A UNIT TEST. `PushTokenRegistrarTest`
 * already covers the registrar against a fake API. What is unproven there is
 * the WIRING: that `onNewToken` finds the same container `MainActivity` built,
 * sees the live session, and reaches the real endpoint. This drives the real
 * service against the real backend; the harness then reads `device_tokens` to
 * confirm the row actually moved. Neither half is sufficient alone.
 *
 * The token it announces is a synthetic string, not a real FCM credential —
 * the client cannot make Firebase rotate on demand, and inventing a plausible
 * looking real token would be inventing a credential.
 */
@RunWith(AndroidJUnit4::class)
class PushTokenRotationTest {

    private val context: Context =
        InstrumentationRegistry.getInstrumentation().targetContext

    private val container by lazy { AppContainer.create(context.applicationContext) }

    @Before
    fun someoneIsSignedIn() {
        assertTrue(
            "precondition not met: no session on this device, so onNewToken would " +
                "correctly drop the rotation and this class would pass vacuously",
            container.sessionRepository.hasToken(),
        )
    }

    @Test
    fun aRotatedTokenIsRegisteredWithTheBackend() {
        val rotated = "qa-rotated-" + System.currentTimeMillis()
        val before = container.pushTokenRegistrar.registeredToken()

        val service = MohallaMessagingService()
        val attach = ContextWrapper::class.java
            .getDeclaredMethod("attachBaseContext", Context::class.java)
        attach.isAccessible = true
        attach.invoke(service, context)

        service.onNewToken(rotated)

        // onNewToken hands off to a coroutine; poll rather than sleep a guessed
        // interval, and fail with what was actually held.
        val deadline = System.currentTimeMillis() + 20_000
        while (System.currentTimeMillis() < deadline) {
            if (container.pushTokenRegistrar.registeredToken() == rotated) break
            Thread.sleep(400)
        }

        assertEquals(
            "rotation was not registered (held $before before, " +
                "${container.pushTokenRegistrar.registeredToken()} after)",
            rotated,
            container.pushTokenRegistrar.registeredToken(),
        )
        // Written where the harness can read it, so the database assertion in
        // the driver names the same string this test announced.
        context.getSharedPreferences("qa009", Context.MODE_PRIVATE)
            .edit().putString("rotated_token", rotated).commit()
    }
}
