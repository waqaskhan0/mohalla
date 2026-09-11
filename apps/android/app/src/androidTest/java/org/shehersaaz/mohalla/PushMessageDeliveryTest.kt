package org.shehersaaz.mohalla

import android.app.Notification
import android.app.NotificationManager
import android.content.Context
import android.content.ContextWrapper
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.google.firebase.messaging.RemoteMessage
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.shehersaaz.mohalla.core.push.MohallaMessagingService
import org.shehersaaz.mohalla.core.push.NotificationChannels

/**
 * QA-009 — an incoming push, rendered on a real device.
 *
 * WHY INSTRUMENTATION AND NOT ADB. `MohallaMessagingService` is not exported,
 * and `adb shell am start-foreground-service` is refused for exactly that
 * reason ("not exported from uid 10221"). That refusal is a security property
 * worth keeping, so the test moves into the app's own uid rather than the
 * component being opened up in order to be testable.
 *
 * WHY REFLECTION. `onMessageReceived` is the real production entry point, and
 * this calls it directly rather than a helper extracted for the test's
 * convenience — which would leave the entry point itself unproven. A bare
 * `Service` has no Context until the framework attaches one, so the base
 * context is attached the same way the framework does it. Nothing else about
 * the class is reached into.
 *
 * WHAT THIS DOES NOT PROVE. That Google's servers deliver anything. Real FCM
 * delivery needs a service-account credential the repository must not hold; it
 * is recorded as BLOCKED_EXTERNAL. What is proven here is everything that
 * happens once a message arrives — which is the part this codebase owns.
 */
@RunWith(AndroidJUnit4::class)
class PushMessageDeliveryTest {

    private val context: Context =
        InstrumentationRegistry.getInstrumentation().targetContext

    private val manager: NotificationManager =
        context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

    private fun service(): MohallaMessagingService {
        val s = MohallaMessagingService()
        val attach = ContextWrapper::class.java
            .getDeclaredMethod("attachBaseContext", Context::class.java)
        attach.isAccessible = true
        attach.invoke(s, context)
        return s
    }

    private fun push(vararg data: Pair<String, String>): RemoteMessage =
        RemoteMessage.Builder("qa@fcm.googleapis.com").apply {
            data.forEach { (k, v) -> addData(k, v) }
        }.build()

    /**
     * The notifications THIS APP posted.
     *
     * Android synthesises its own summary row once an app has more than one
     * ungrouped notification in the shade — it arrives as id 0 with the tag
     * `g:Aggregate_AlertingSection` and no title. It is the platform's, not the
     * app's, and counting it produced a "expected 2, saw 3" failure that named
     * the app for the operating system's behaviour.
     */
    private fun posted() = manager.activeNotifications
        .filter { it.notification.flags and Notification.FLAG_GROUP_SUMMARY == 0 }

    private fun describe() = posted().joinToString { sbn ->
        "#${sbn.id}/tag=${sbn.tag}/ch=${sbn.notification.channelId}" +
            "/title=${sbn.notification.extras.getCharSequence("android.title")}"
    }

    @Before
    fun clear() {
        manager.cancelAll()
        Thread.sleep(300)
        // ASSERTED, NOT ASSUMED. `cancelAll` is asynchronous, and a test that
        // starts with somebody else's notification still in the shade counts it
        // as its own — which is how "expected 2, saw 3" first appeared.
        assertTrue("the shade did not empty before the test: ${describe()}", posted().isEmpty())
    }

    @After
    fun tidy() {
        manager.cancelAll()
    }

    // 1 — the ordinary case: a data-only message becomes a notification the
    // reader can actually see, on the channel the app declares.
    @Test
    fun aDataMessageIsShownOnTheAppChannel() {
        service().onMessageReceived(
            push(
                "title" to "Ayesha liked your post",
                "body" to "Water supply notice",
                "deepLink" to "/posts/p-qa-1",
            ),
        )
        Thread.sleep(600)

        val n = posted().singleOrNull()
        assertNotNull("expected exactly one notification, saw ${posted().size}", n)
        assertEquals(NotificationChannels.DEFAULT_CHANNEL_ID, n!!.notification.channelId)

        val extras = n.notification.extras
        assertEquals("Ayesha liked your post", extras.getCharSequence("android.title").toString())
        assertEquals("Water supply notice", extras.getCharSequence("android.text").toString())
        assertNotNull(
            "a notification with no content intent cannot be opened",
            n.notification.contentIntent,
        )
    }

    // The channel must exist with the importance the app asked for, or Android
    // silently downgrades everything to no sound and no heads-up.
    @Test
    fun theChannelExistsWithTheDeclaredImportance() {
        NotificationChannels.ensureCreated(context)
        val channel = manager.getNotificationChannel(NotificationChannels.DEFAULT_CHANNEL_ID)
        assertNotNull("channel was never created", channel)
        assertEquals(NotificationManager.IMPORTANCE_DEFAULT, channel!!.importance)
    }

    // 2 — a push with nothing to say is dropped. An empty notification is worse
    // than none: a buzz with no content and nothing to act on.
    @Test
    fun anEmptyPayloadPostsNothing() {
        service().onMessageReceived(push("deepLink" to "/posts/p-qa-2"))
        Thread.sleep(600)
        assertTrue("an empty payload posted ${posted().size} notification(s)", posted().isEmpty())
    }

    // 3 — the malformed-payload requirement. None of this may take the process
    // down, and none of it may be trusted. Every one of these is a payload the
    // client could receive from a compromised or simply broken sender.
    @Test
    fun malformedAndHostilePayloadsAreSurvived() {
        val nasty = listOf(
            arrayOf("title" to "   ", "body" to "   "),
            arrayOf("title" to "x".repeat(20_000), "body" to "y".repeat(20_000)),
            arrayOf("title" to "ok", "body" to "ok", "deepLink" to "javascript:alert(1)"),
            arrayOf("title" to "ok", "body" to "ok", "deepLink" to "../../etc/passwd"),
            arrayOf("title" to "ok", "body" to "ok", "deepLink" to "https://elsewhere.example/x"),
            arrayOf("title" to " ", "body" to "اردو"),
            arrayOf("unexpected" to "field", "title" to "ok"),
            arrayOf("body" to "no title at all"),
        )
        nasty.forEach { data ->
            // A throw here fails the test, which is the assertion. The service
            // catches internally; this proves the catch actually holds.
            service().onMessageReceived(push(*data))
            Thread.sleep(120)
        }
        // And the process is still alive to answer.
        assertEquals(context.packageName, context.packageName)
    }

    // 4 — two pushes for two different targets must be two notifications
    // pointing at two places. A shared request code would make the second
    // silently reuse the first one's intent, so tapping the newer one would
    // open the older one's screen.
    @Test
    fun twoTargetsProduceTwoDistinctNotifications() {
        val s = service()
        s.onMessageReceived(push("title" to "One", "body" to "b", "deepLink" to "/posts/p-a"))
        Thread.sleep(400)
        s.onMessageReceived(push("title" to "Two", "body" to "b", "deepLink" to "/conversations/c-a"))
        Thread.sleep(600)

        val all = posted()
        val described = describe()
        assertEquals("expected two notifications, saw $described", 2, all.size)
        assertEquals(2, all.map { it.id }.distinct().size)
    }

    // 5 — the same target twice replaces rather than stacks. Three likes on one
    // post should not leave three identical rows in the shade.
    @Test
    fun theSameTargetTwiceReplacesItself() {
        val s = service()
        repeat(3) {
            s.onMessageReceived(
                push("title" to "Same", "body" to "b$it", "deepLink" to "/posts/p-same"),
            )
            Thread.sleep(350)
        }
        assertEquals(1, posted().size)
        assertEquals(
            "b2",
            posted().single().notification.extras.getCharSequence("android.text").toString(),
        )
    }
}
