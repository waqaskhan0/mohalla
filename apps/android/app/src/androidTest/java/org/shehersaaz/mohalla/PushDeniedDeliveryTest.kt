package org.shehersaaz.mohalla

import android.app.NotificationManager
import android.content.Context
import android.content.ContextWrapper
import android.content.pm.PackageManager
import androidx.core.content.ContextCompat
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.google.firebase.messaging.RemoteMessage
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.shehersaaz.mohalla.core.push.MohallaMessagingService
import org.shehersaaz.mohalla.core.push.notificationsPermitted

/**
 * QA-009 — a push that arrives while POST_NOTIFICATIONS is refused.
 *
 * RUN SEPARATELY, AFTER `pm revoke`. Kept out of [PushMessageDeliveryTest]
 * because a test that revokes its own runtime permission has the platform kill
 * the process underneath it; the precondition belongs to the harness, and this
 * class asserts the precondition rather than assuming it.
 *
 * The message still arrives — FCM delivers to the process regardless — so the
 * question is what the app does with it. PRIV-015: nothing the reader refused.
 * Not a silent throw either, which on some OEM builds is what an unguarded
 * `notify` produces.
 *
 * WHAT THE MUTATION RUN SHOWED, RECORDED RATHER THAN QUIETLY DROPPED. Deleting
 * the service's own `if (!granted) return` did NOT fail
 * [aPushArrivingWithoutPermissionPostsNothingAndDoesNotThrow]: on this build
 * (API 36) the platform drops the post itself, so that assertion cannot
 * distinguish an app that checks from one that does not. It still asserts the
 * behaviour the reader experiences, which is worth having, but it is not
 * evidence that the guard works — the guard is there for the OEM builds that
 * throw instead, and this device cannot prove it either way.
 * [theAppAgreesWithTheOsAboutThePermission] IS mutation-proven: making
 * `notificationsPermitted` return a constant fails it.
 */
@RunWith(AndroidJUnit4::class)
class PushDeniedDeliveryTest {

    private val context: Context =
        InstrumentationRegistry.getInstrumentation().targetContext

    private val manager: NotificationManager =
        context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

    @Before
    fun permissionIsActuallyRefused() {
        manager.cancelAll()
        val granted = ContextCompat.checkSelfPermission(
            context,
            android.Manifest.permission.POST_NOTIFICATIONS,
        ) == PackageManager.PERMISSION_GRANTED
        assertTrue(
            "precondition not met: POST_NOTIFICATIONS is still granted, so this " +
                "class would pass without testing anything",
            !granted,
        )
    }

    @Test
    fun theAppAgreesWithTheOsAboutThePermission() {
        assertEquals(false, notificationsPermitted(context))
    }

    @Test
    fun aPushArrivingWithoutPermissionPostsNothingAndDoesNotThrow() {
        val s = MohallaMessagingService()
        val attach = ContextWrapper::class.java
            .getDeclaredMethod("attachBaseContext", Context::class.java)
        attach.isAccessible = true
        attach.invoke(s, context)

        s.onMessageReceived(
            RemoteMessage.Builder("qa@fcm.googleapis.com")
                .addData("title", "Should never appear")
                .addData("body", "The reader refused notifications")
                .addData("deepLink", "/posts/p-denied")
                .build(),
        )
        Thread.sleep(800)

        assertTrue(
            "a refused permission still produced ${manager.activeNotifications.size} notification(s)",
            manager.activeNotifications.isEmpty(),
        )
    }
}
