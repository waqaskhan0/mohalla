package org.shehersaaz.mohalla.core.push

import com.google.firebase.messaging.FirebaseMessaging
import kotlinx.coroutines.suspendCancellableCoroutine
import org.shehersaaz.mohalla.core.logging.Logger
import kotlin.coroutines.resume

/**
 * The real [PushTokenSource]: Firebase.
 *
 * SEPARATED FROM THE REGISTRAR so the token lifecycle can be tested without
 * Google Play Services present. The registrar owns when to register; this owns
 * only where the string comes from — the same split the backend uses for SMS
 * and push.
 *
 * RETURNS `null` RATHER THAN THROWING. `getToken()` fails for ordinary,
 * non-exceptional reasons: no Play Services on the device, no network at first
 * launch, a Firebase project misconfiguration. None of those should propagate
 * into a sign-in, because NOTIF-FR-001 is explicit that losing notifications
 * degrades notifications and nothing else. A caller that gets `null` simply has
 * nothing to register yet, and the next sign-in tries again.
 */
class FirebasePushTokenSource(private val logger: Logger) : PushTokenSource {

    override suspend fun currentToken(): String? = suspendCancellableCoroutine { cont ->
        try {
            FirebaseMessaging.getInstance().token
                .addOnCompleteListener { task ->
                    if (!cont.isActive) return@addOnCompleteListener
                    if (task.isSuccessful) {
                        // The value itself is never logged — it addresses one
                        // handset and is treated like a session token.
                        cont.resume(task.result?.takeIf { it.isNotBlank() })
                    } else {
                        logger.debug(TAG, "fcm_token_unavailable")
                        cont.resume(null)
                    }
                }
        } catch (e: Exception) {
            // Play Services missing entirely throws rather than failing the
            // task. An emulator image without Google APIs is the common case.
            logger.debug(TAG, "fcm_unavailable")
            if (cont.isActive) cont.resume(null)
        }
    }

    private companion object {
        const val TAG = "push"
    }
}
