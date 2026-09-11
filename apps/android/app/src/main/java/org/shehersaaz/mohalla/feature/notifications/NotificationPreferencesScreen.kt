package org.shehersaaz.mohalla.feature.notifications

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import org.shehersaaz.mohalla.R
import org.shehersaaz.mohalla.core.design.MohallaTheme
import org.shehersaaz.mohalla.core.design.MohallaType
import org.shehersaaz.mohalla.core.network.ApiFailure
import org.shehersaaz.mohalla.core.ui.FailureState
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import org.shehersaaz.mohalla.core.push.notificationsPermitted
import org.shehersaaz.mohalla.core.push.openAppNotificationSettings
import org.shehersaaz.mohalla.core.ui.MohallaBackHeader
import org.shehersaaz.mohalla.core.ui.MohallaSecondaryButton

/**
 * Push preferences — UX-SET-003 (NOTIF-FR-007 · SET-FR-007).
 *
 * THE SENTENCE ABOVE THE SWITCHES IS THE MOST IMPORTANT THING ON THIS SCREEN.
 * NOTIF-FR-007's rule is that "preferences apply to push only; the in-app centre
 * always records everything, so disabling push never loses information" — and a
 * reader cannot deduce that from a switch labelled "Likes". Without the
 * sentence, somebody who turns everything off to stop the buzzing either
 * believes they have stopped being notified at all, or opens the centre later
 * and thinks it is broken. Both are worse than one extra line of text.
 *
 * SEVEN SWITCHES FOR EIGHT CATEGORIES. A reply answers to the Comments switch,
 * because somebody who silenced comment notifications wants their thread to stop
 * buzzing and a reply is part of that thread. Honouring the letter of the
 * setting while still sending replies would be technically defensible and
 * obviously wrong.
 *
 * THE OS PERMISSION IS SHOWN WHEN IT IS OFF, and only then (QA-009). Seven
 * switches offering to control alerts that the operating system is dropping
 * before they reach the reader would be a screen making a promise it cannot
 * keep — and the reader would conclude the app is broken rather than that they
 * refused a dialog weeks ago. When the permission is granted there is nothing to
 * say, so nothing is said.
 *
 * THE BUTTON OPENS SETTINGS RATHER THAN ASKING AGAIN. Android does not show the
 * permission dialog a second time after a refusal, so a button that re-requested
 * would silently do nothing. See `openAppNotificationSettings`.
 *
 * The switches themselves remain usable either way: they are the account's
 * server-side preferences, they are what will apply the moment the permission is
 * turned on, and disabling them was never what stopped the phone buzzing here.
 */
@Composable
fun NotificationPreferencesScreen(
    state: NotificationPreferencesUiState,
    onBack: () -> Unit,
    onToggle: (PushCategory) -> Unit,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .background(MohallaTheme.colors.BgPrimary),
    ) {
        MohallaBackHeader(
            title = stringResource(R.string.settings_notifications_title),
            onBack = onBack,
        )

        when {
            // NOT seven switches in their default position. A settings screen
            // showing everything ON after a failed read is stating something
            // about the account it never learned, and the reader would act on
            // it.
            state.failure != null -> PreferencesFailure(state.failure, onRetry)

            state.loading && !state.loaded -> PreferencesSkeleton()

            else -> PreferenceList(state = state, onToggle = onToggle)
        }
    }
}

/**
 * Shown only while the operating system is refusing this app's notifications.
 *
 * RE-READ ON RESUME, because the reader leaves via the button below and comes
 * back having changed the answer. A banner that stayed up after they granted it
 * would be telling them something false about their own phone.
 */
@Composable
private fun SystemNotificationsOffNotice() {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    var permitted by remember { mutableStateOf(notificationsPermitted(context)) }

    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) permitted = notificationsPermitted(context)
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }

    if (permitted) return

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(
                horizontal = MohallaTheme.screenMargin,
                vertical = MohallaTheme.spacing.Space3,
            ),
        verticalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space3),
    ) {
        Text(
            text = stringResource(R.string.notification_permission_rationale),
            style = MohallaTheme.text(MohallaType.Body),
            color = MohallaTheme.colors.TextSecondary,
        )
        MohallaSecondaryButton(
            text = stringResource(R.string.notification_permission_enable),
            onClick = { openAppNotificationSettings(context) },
        )
    }
}

@Composable
private fun PreferenceList(
    state: NotificationPreferencesUiState,
    onToggle: (PushCategory) -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(bottom = MohallaTheme.spacing.Space8),
    ) {
        SystemNotificationsOffNotice()

        Text(
            text = stringResource(R.string.settings_notifications_explainer),
            style = MohallaTheme.text(MohallaType.Body),
            color = MohallaTheme.colors.TextSecondary,
            modifier = Modifier.padding(
                horizontal = MohallaTheme.screenMargin,
                vertical = MohallaTheme.spacing.Space4,
            ),
        )

        // The failure is stated where the switch is, not as a toast: the switch
        // has already moved back, and a message that disappears leaves somebody
        // believing they changed a setting they did not.
        if (state.saveFailed) {
            Text(
                text = stringResource(R.string.settings_notifications_save_failed),
                style = MohallaTheme.text(MohallaType.BodySm),
                color = MohallaTheme.colors.Error,
                modifier = Modifier.padding(
                    horizontal = MohallaTheme.screenMargin,
                    vertical = MohallaTheme.spacing.Space2,
                ),
            )
        }

        // ENUMERATED FROM THE ENUM, so the seven the requirement names are the
        // seven shown, in its order, and one added to the enum cannot be
        // forgotten here.
        PushCategory.entries.forEach { category ->
            PreferenceRow(
                label = stringResource(category.labelRes),
                enabled = state.isEnabled(category),
                saving = category in state.saving,
                onToggle = { onToggle(category) },
            )
            Box(
                Modifier
                    .fillMaxWidth()
                    .padding(start = MohallaTheme.screenMargin)
                    .height(HAIRLINE)
                    .background(MohallaTheme.colors.BorderDefault),
            )
        }
    }
}

/**
 * One switch.
 *
 * THE WHOLE ROW IS THE TARGET, not just the switch. `toggleable` on the row with
 * `Role.Switch` gives a 48dp target (§26) and one accessibility node that says
 * both the label and the state — where a bare `Switch` beside a `Text` reads as
 * two nodes, and the second one announces "on" with no idea what is on.
 */
@Composable
private fun PreferenceRow(
    label: String,
    enabled: Boolean,
    saving: Boolean,
    onToggle: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .defaultMinSize(minHeight = MohallaTheme.spacing.Space12)
            .toggleable(
                value = enabled,
                // Disabled only while ITS OWN request is in flight, so a slow
                // network cannot leave the reader tapping the same switch three
                // times and sending three conflicting writes.
                enabled = !saving,
                role = Role.Switch,
                onValueChange = { onToggle() },
            )
            .padding(
                horizontal = MohallaTheme.screenMargin,
                vertical = MohallaTheme.spacing.Space3,
            ),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space3),
    ) {
        Text(
            text = label,
            style = MohallaTheme.text(MohallaType.Body),
            color = MohallaTheme.colors.TextPrimary,
            modifier = Modifier.weight(1f),
        )

        Switch(
            checked = enabled,
            // Null: the row owns the gesture and the semantics. A switch with
            // its own callback would be a second focus stop announcing a state
            // with no name attached to it.
            onCheckedChange = null,
            enabled = !saving,
        )
    }
}

@Composable
private fun PreferencesFailure(failure: ApiFailure, onRetry: () -> Unit) {
    FailureState(failure = failure, onRetry = onRetry)
}

@Composable
private fun PreferencesSkeleton() {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(top = MohallaTheme.spacing.Space4),
        verticalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space4),
    ) {
        repeat(PushCategory.entries.size) {
            Box(
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = MohallaTheme.screenMargin)
                    .height(MohallaTheme.spacing.Space6)
                    .background(MohallaTheme.colors.SurfaceSunken, MohallaTheme.radius.ShapeSm),
            )
        }
    }
}

/**
 * The label for one switch.
 *
 * NOTIF-FR-007 names all seven — "likes, comments, follows, mentions, messages,
 * events, announcements" — and these are those words. The `when` is exhaustive,
 * so a category added to the enum without a label is a compile error rather than
 * a blank row.
 */
private val PushCategory.labelRes: Int
    get() = when (this) {
        PushCategory.LIKE -> R.string.settings_notifications_likes
        PushCategory.COMMENT -> R.string.settings_notifications_comments
        PushCategory.FOLLOW -> R.string.settings_notifications_follows
        PushCategory.MENTION -> R.string.settings_notifications_mentions
        PushCategory.MESSAGE -> R.string.settings_notifications_messages
        PushCategory.EVENT -> R.string.settings_notifications_events
        PushCategory.ANNOUNCEMENT -> R.string.settings_notifications_announcements
    }

/** A drawn line, not a spacing decision — see the centre's own divider. */
private val HAIRLINE = 1.dp
