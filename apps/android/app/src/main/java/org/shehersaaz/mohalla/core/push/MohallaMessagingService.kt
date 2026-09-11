package org.shehersaaz.mohalla.core.push

import android.app.PendingIntent
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import org.shehersaaz.mohalla.MainActivity
import org.shehersaaz.mohalla.R
import org.shehersaaz.mohalla.core.di.AppContainer

/**
 * Incoming push, and token rotation (QA-009 · NOTIF-FR-001 · ADR-014).
 *
 * THE PAYLOAD SHAPE IS THE BACKEND'S, NOT AN INVENTION. `PushSender.PushMessage`
 * defines exactly four fields — `title`, `body`, `deepLink`, `correlationId` —
 * and this reads those and nothing else. ADR-014: *"push payloads carry the
 * minimum needed for the deep link"*, because the body already shows on a lock
 * screen and anything more widens that exposure for no gain.
 *
 * DATA MESSAGES, NOT NOTIFICATION MESSAGES. A `notification` payload is drawn by
 * the system when the app is backgrounded and never reaches this class, which
 * would mean the deep link is handled in one place when the app is open and
 * another when it is not. Reading `data` keeps one code path and one behaviour.
 */
class MohallaMessagingService : FirebaseMessagingService() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    /**
     * Firebase issued a new token.
     *
     * Registered only when somebody is signed in. A rotation that arrives while
     * signed out is dropped: the endpoint needs a session, and the next sign-in
     * registers whatever the current token is by then.
     */
    override fun onNewToken(token: String) {
        // `create` returns the existing singleton — this Service shares the
        // app's process, so it is the same container MainActivity built.
        val container = AppContainer.create(applicationContext)
        if (!container.sessionRepository.hasToken()) return
        scope.launch { container.pushTokenRegistrar.onTokenRotated(token) }
    }

    override fun onMessageReceived(message: RemoteMessage) {
        // EVERYTHING BELOW IS DEFENSIVE. A malformed payload must not take the
        // app down (§14): this runs in the app's own process, and an uncaught
        // exception here is a crash the user sees with no action of their own.
        try {
            val data = message.data
            val title = data["title"]?.takeIf { it.isNotBlank() }
            val body = data["body"]?.takeIf { it.isNotBlank() }

            // A push with nothing to say is dropped rather than shown as an
            // empty notification. The in-app centre already holds the record.
            if (title == null && body == null) return

            show(
                title = title ?: getString(R.string.app_name),
                body = body.orEmpty(),
                deepLink = data["deepLink"],
            )
        } catch (e: Exception) {
            // Deliberately broad, and deliberately not rethrown. Nothing about a
            // bad notification justifies killing the process.
            AppContainer.create(applicationContext).logger.warn(TAG, "push_render_failed", e)
        }
    }

    private fun show(title: String, body: String, deepLink: String?) {
        NotificationChannels.ensureCreated(this)

        // POST_NOTIFICATIONS may have been refused or revoked at any moment,
        // including between delivery and here. Posting without it throws on some
        // OEM builds and silently no-ops on others; checking is the only
        // behaviour that is the same everywhere.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            val granted = ContextCompat.checkSelfPermission(
                this,
                android.Manifest.permission.POST_NOTIFICATIONS,
            ) == PackageManager.PERMISSION_GRANTED
            if (!granted) return
        }

        val intent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            // The PATH, not a URL. `MainActivity` resolves it through the same
            // allowlist every other link goes through, so an unexpected or
            // unrouteable target lands on the normal start destination instead
            // of a screen that would say something about content the reader may
            // not be allowed to know exists (§15).
            if (!deepLink.isNullOrBlank()) putExtra(EXTRA_DEEP_LINK_PATH, deepLink)
        }

        val pending = PendingIntent.getActivity(
            this,
            // A stable request code would make every notification reuse one
            // intent, so the second push would open the first one's target.
            deepLink?.hashCode() ?: 0,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        val notification = NotificationCompat.Builder(this, NotificationChannels.DEFAULT_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setContentIntent(pending)
            .build()

        try {
            NotificationManagerCompat.from(this)
                .notify(deepLink?.hashCode() ?: NOTIFICATION_ID, notification)
        } catch (e: SecurityException) {
            // Permission was revoked between the check above and here.
            AppContainer.create(applicationContext).logger.debug(TAG, "push_post_denied")
        }
    }

    companion object {
        const val EXTRA_DEEP_LINK_PATH = "org.shehersaaz.mohalla.DEEP_LINK_PATH"
        private const val NOTIFICATION_ID = 1
        private const val TAG = "push"
    }
}
