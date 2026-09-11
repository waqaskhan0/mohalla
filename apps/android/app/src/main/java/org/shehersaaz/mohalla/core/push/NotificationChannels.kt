package org.shehersaaz.mohalla.core.push

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.os.Build
import androidx.core.content.getSystemService
import org.shehersaaz.mohalla.R

/**
 * The Android notification channel (QA-009 · NOTIF-FR-001).
 *
 * ONE CHANNEL, NOT SEVEN. It is tempting to mirror the seven preference
 * categories the API exposes, but the two things answer different questions and
 * duplicating them would make the product worse:
 *
 *   - `notification_preferences` is a SERVER-side gate. NOTIF-FR-007 has it
 *     decide whether a push is sent at all, and the in-app centre records the
 *     notification either way. That setting follows the account to every device
 *     the person signs in on.
 *   - An Android channel is a DEVICE-side gate the operating system owns. A
 *     reader who silences a channel silences it here, and the server never
 *     learns.
 *
 * Shipping seven channels would give every category two independent switches
 * that disagree — one in Settings inside the app, one in Android's own
 * notification settings — and no way to explain which one is in force. One
 * channel keeps Android's control coarse and honest, and leaves the per-category
 * decision where the requirement puts it.
 *
 * IMPORTANCE IS DEFAULT, NOT HIGH. `HIGH` produces a heads-up banner over
 * whatever the person is doing. A neighbour liking a post does not earn that,
 * and a channel that interrupts is a channel that gets turned off entirely.
 *
 * Creating a channel is idempotent by platform contract — repeating it updates
 * the name and description but never resurrects one the reader disabled, which
 * is why calling this on every launch is safe.
 */
object NotificationChannels {
    const val DEFAULT_CHANNEL_ID = "mohalla.notifications"

    fun ensureCreated(context: Context) {
        // Channels exist from API 26, which is also this app's minSdk — so the
        // guard is belt and braces rather than a real branch. It stays because
        // `minSdk` is a number somebody can lower.
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return

        val manager = context.getSystemService<NotificationManager>() ?: return
        val channel = NotificationChannel(
            DEFAULT_CHANNEL_ID,
            context.getString(R.string.notification_channel_name),
            NotificationManager.IMPORTANCE_DEFAULT,
        ).apply {
            description = context.getString(R.string.notification_channel_description)
        }
        manager.createNotificationChannel(channel)
    }
}
