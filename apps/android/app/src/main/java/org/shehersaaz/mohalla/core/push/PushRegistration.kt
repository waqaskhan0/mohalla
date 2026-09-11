package org.shehersaaz.mohalla.core.push

import android.Manifest
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import org.shehersaaz.mohalla.core.di.AppContainer

/**
 * Whether this device may post notifications right now.
 *
 * Before Android 13 the permission is granted at install and there is nothing
 * to ask for, so this is always true there.
 */
fun notificationsPermitted(context: Context): Boolean =
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
        true
    } else {
        ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.POST_NOTIFICATIONS,
        ) == PackageManager.PERMISSION_GRANTED
    }

/**
 * Open this app's notification settings in Android Settings.
 *
 * THE ONLY WAY BACK once the reader has refused. Android will not show the
 * permission dialog again after a refusal, so an in-app button that "asks" a
 * second time would do nothing at all and look broken — the honest control
 * sends them to the screen that can actually change the answer.
 *
 * Falls back to the app's own details page, which exists on every build, if the
 * notification-specific screen is unavailable.
 */
fun openAppNotificationSettings(context: Context) {
    val intents = buildList {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            add(
                Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                    .putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName),
            )
        }
        add(
            Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
                .setData(Uri.fromParts("package", context.packageName, null)),
        )
    }
    for (intent in intents) {
        try {
            context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            return
        } catch (_: ActivityNotFoundException) {
            // Try the next one. A device with neither is a device with no
            // Settings app, and there is nothing useful to do about that.
        }
    }
}

/**
 * Register this device for push, and ask for the permission if it is needed
 * (QA-009 · NOTIF-FR-001 · PRIV-015).
 *
 * PLACED ON THE SIGNED-IN SHELL, which is the contextual moment the requirement
 * describes and the earliest point at which every entry path has converged —
 * a fresh sign-up, a returning login, and a relaunch that already had a session
 * all arrive here, so none of them needs its own copy of this.
 *
 * NOT AT LAUNCH. `04-mobile-architecture.md` says the permission is "requested
 * contextually", and a prompt on the splash screen — before the reader has seen
 * a single neighbour, post or message — asks them to value something they have
 * not been shown. It is also the request most likely to be refused permanently.
 *
 * DECLINING COSTS NOTIFICATIONS AND NOTHING ELSE. The registration below still
 * runs: a token without permission is still worth holding, because the reader
 * may grant it later from Settings and the server should not need to be told
 * again. Every other feature is untouched, which is the requirement verbatim.
 *
 * RE-CHECKED ON RESUME, because the permission can be granted or revoked in
 * Android Settings while the app is in the background, and the app has to
 * reconcile with what the OS says rather than what it last remembered.
 *
 * ASKED ONCE PER INSTALL, NOT ONCE PER LAUNCH. The refusal is remembered in
 * [PushPromptStore] — see the note there for what QA-009 saw on the device when
 * it was only remembered in memory. Somebody who changes their mind later has
 * the row on the notification-preferences screen, which is a place they went to
 * on purpose rather than a dialog that arrived on top of the feed.
 */
@Composable
fun RegisterForPushEffect(container: AppContainer) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current

    val prompts = remember(context) { PushPromptStore(context.applicationContext) }
    // `rememberSaveable` still guards the within-process case: the store is
    // written when the launcher fires, and this stops a recomposition racing it.
    var asked by rememberSaveable { mutableStateOf(false) }
    var permitted by remember { mutableStateOf(notificationsPermitted(context)) }

    val launcher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted ->
        permitted = granted
        // Registered either way — see the note above on why declining does not
        // stop the token being useful.
        container.pushTokenRegistrar.registerInBackground(container.applicationScope)
    }

    LaunchedEffect(Unit) {
        NotificationChannels.ensureCreated(context)

        val needsPrompt = Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            !notificationsPermitted(context)

        if (needsPrompt && !asked && !prompts.hasAsked()) {
            asked = true
            prompts.markAsked()
            launcher.launch(Manifest.permission.POST_NOTIFICATIONS)
        } else {
            container.pushTokenRegistrar.onAuthenticated()
        }
    }

    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            if (event != Lifecycle.Event.ON_RESUME) return@LifecycleEventObserver
            val now = notificationsPermitted(context)
            if (now == permitted) return@LifecycleEventObserver
            // Changed in Android Settings while we were away. Granting is the
            // case that matters: the server may never have been told about this
            // device, and now there is a reason to.
            permitted = now
            if (now) container.pushTokenRegistrar.registerInBackground(container.applicationScope)
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }
}
