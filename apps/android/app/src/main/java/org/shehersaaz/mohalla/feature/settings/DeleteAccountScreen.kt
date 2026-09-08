package org.shehersaaz.mohalla.feature.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import org.shehersaaz.mohalla.R
import org.shehersaaz.mohalla.core.design.MohallaTheme
import org.shehersaaz.mohalla.core.design.MohallaType
import org.shehersaaz.mohalla.core.network.ApiFailure
import org.shehersaaz.mohalla.core.ui.FailureState
import org.shehersaaz.mohalla.core.ui.MohallaBackHeader
import org.shehersaaz.mohalla.core.ui.MohallaButton
import org.shehersaaz.mohalla.core.ui.MohallaSecondaryButton
import org.shehersaaz.mohalla.core.ui.MohallaTextField

/**
 * Delete account — UX-SET-009 (SET-FR-004 · PRIV-006 · BR-008/009).
 *
 * "NOT A BOTTOM SHEET. A screen, a password, and an enumerated list," says the
 * wireframe, and the enumerated list is named as "the critical element" because
 * "BR-009 does something users won't expect".
 *
 * WHAT USERS DO NOT EXPECT is that their posts and comments STAY, shown as
 * "Deleted User", because other people replied to them. The server puts that
 * line SECOND in the list — "where it is read, rather than last where it is
 * skipped" — and this screen renders the list in the order it arrives for
 * exactly that reason. Sorting it, grouping it or moving the alarming line to
 * the bottom would undo a decision PRIV-006 made deliberately.
 *
 * CANCEL IS THE PRIMARY BUTTON AND IT SITS ABOVE DELETE. §6.7 for a Tier-3
 * action: "Primary — Cancel, deliberately NOT delete", and "the destructive
 * control is not pre-focused and sits BELOW cancel". A thumb reaching for the
 * bottom of a long scrolling screen finds Cancel.
 *
 * AND NOTHING HAPPENS WITHOUT THE PASSWORD. The phone is already unlocked and in
 * somebody's hand; the password is what distinguishes the owner from whoever is
 * holding it, on the only irreversible action in the product.
 *
 * A SUSPENDED ACCOUNT CAN STILL DELETE (BR-008). There is no capability check on
 * this screen and there must not be one — an account that cannot leave while it
 * is being punished is a hostage.
 */
@Composable
fun DeleteAccountScreen(
    state: DeleteAccountUiState,
    onBack: () -> Unit,
    onPasswordChanged: (String) -> Unit,
    onDelete: () -> Unit,
    onRetryLoad: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .background(MohallaTheme.colors.BgPrimary)
            .imePadding(),
    ) {
        MohallaBackHeader(
            title = stringResource(R.string.settings_delete_account),
            onBack = onBack,
        )

        when {
            // PRIV-006 is a claim about what the reader was TOLD, so the screen
            // does not render a password field beside a list it could not load.
            state.loadFailure != null && !state.loaded ->
                LoadFailure(state.loadFailure, onRetryLoad)

            !state.loaded -> ConsequencesSkeleton()

            else -> DeleteForm(
                state = state,
                onBack = onBack,
                onPasswordChanged = onPasswordChanged,
                onDelete = onDelete,
            )
        }
    }
}

@Composable
private fun DeleteForm(
    state: DeleteAccountUiState,
    onBack: () -> Unit,
    onPasswordChanged: (String) -> Unit,
    onDelete: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = MohallaTheme.screenMargin)
            .padding(bottom = MohallaTheme.spacing.Space8),
        verticalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space4),
    ) {
        Spacer(Modifier.height(MohallaTheme.spacing.Space2))

        Text(
            text = stringResource(R.string.delete_warning, state.graceDays),
            style = MohallaTheme.text(MohallaType.H3),
            color = MohallaTheme.colors.TextPrimary,
            modifier = Modifier.semantics { heading() },
        )

        Text(
            text = stringResource(R.string.delete_here_is_what_happens),
            style = MohallaTheme.text(MohallaType.Body),
            color = MohallaTheme.colors.TextSecondary,
        )

        Column(verticalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space3)) {
            // IN THE SERVER'S ORDER. Never sorted, never reordered — the
            // position of the line about posts remaining is a decision PRIV-006
            // made, not a rendering detail.
            state.consequenceKeys.forEach { key ->
                Consequence(key = key)
            }
        }

        // A key this build has no copy for. NOT silently dropped: PRIV-006 says
        // the user must be told, and quietly omitting a consequence would be
        // exactly the failure this screen exists to prevent. Deletion is still
        // allowed — refusing it would trap somebody in the product over an app
        // version, which BR-008's reasoning rules out just as firmly.
        if (state.consequenceKeys.any { it !in KNOWN_CONSEQUENCES }) {
            Text(
                text = stringResource(R.string.delete_consequences_incomplete),
                style = MohallaTheme.text(MohallaType.BodySm),
                color = MohallaTheme.colors.Warning,
            )
        }

        MohallaTextField(
            value = state.password,
            onValueChange = onPasswordChanged,
            label = stringResource(R.string.delete_password_label),
            isPassword = true,
            imeAction = ImeAction.Done,
            error = stringResource(R.string.delete_password_wrong)
                .takeIf { state.wrongPassword },
        )

        state.failure?.takeIf { !state.wrongPassword }?.let { failure ->
            Text(
                text = when (failure) {
                    ApiFailure.Offline -> stringResource(R.string.delete_offline)
                    is ApiFailure.RateLimited ->
                        failure.message ?: stringResource(R.string.state_rate_limited_body)
                    // "This account is already scheduled for deletion" — told
                    // plainly, because somebody who taps twice should learn
                    // their account IS being deleted rather than that something
                    // failed.
                    is ApiFailure.Conflict -> failure.message
                        ?: stringResource(R.string.delete_failed)
                    else -> stringResource(R.string.delete_failed)
                },
                style = MohallaTheme.text(MohallaType.BodySm),
                color = MohallaTheme.colors.Error,
            )
        }

        // §6.7 — Cancel is the primary path and sits ABOVE the destructive
        // control, which is outlined rather than filled and is never
        // pre-focused.
        MohallaButton(
            text = stringResource(R.string.action_cancel),
            onClick = onBack,
            modifier = Modifier.fillMaxWidth(),
        )
        MohallaSecondaryButton(
            text = stringResource(R.string.delete_submit),
            onClick = onDelete,
            enabled = state.canSubmit,
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

/**
 * One consequence.
 *
 * A BULLET AND A SENTENCE. §35 keeps meaning out of shape and colour alone, and
 * these six lines are the entire basis on which somebody takes an irreversible
 * decision — so none of them is an icon, and none is abbreviated.
 */
@Composable
private fun Consequence(key: String) {
    val text = consequenceText(key) ?: return

    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.Top,
        horizontalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space2),
    ) {
        Text(
            text = "•",
            style = MohallaTheme.text(MohallaType.Body),
            color = MohallaTheme.colors.TextTertiary,
        )
        Text(
            text = text,
            style = MohallaTheme.text(MohallaType.Body),
            color = MohallaTheme.colors.TextPrimary,
        )
    }
}

@Composable
private fun LoadFailure(failure: ApiFailure, onRetry: () -> Unit) {
    FailureState(failure = failure, onRetry = onRetry)
}

@Composable
private fun ConsequencesSkeleton() {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(MohallaTheme.screenMargin),
        verticalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space4),
    ) {
        repeat(SKELETON_LINES) {
            Spacer(
                Modifier
                    .fillMaxWidth()
                    .height(MohallaTheme.spacing.Space6)
                    .background(MohallaTheme.colors.SurfaceSunken, MohallaTheme.radius.ShapeSm),
            )
        }
    }
}

/**
 * The server's key, in the reader's language.
 *
 * THE SERVER SENDS KEYS AND NOT SENTENCES, so that "readable in the user's
 * chosen language" holds without the server carrying two copies of six
 * paragraphs — and so that the client cannot quietly reword what deletion does.
 * The mapping is a `when` over the six keys the contract defines.
 */
@Composable
private fun consequenceText(key: String): String? = when (key) {
    "deletion.consequence.profileRemoved" ->
        stringResource(R.string.delete_consequence_profile)

    "deletion.consequence.postsRemainAnonymised" ->
        stringResource(R.string.delete_consequence_posts)

    "deletion.consequence.messagesRemainForTheOtherPerson" ->
        stringResource(R.string.delete_consequence_messages)

    "deletion.consequence.sessionsEndImmediately" ->
        stringResource(R.string.delete_consequence_sessions)

    "deletion.consequence.restorableForThirtyDays" ->
        stringResource(R.string.delete_consequence_restorable)

    "deletion.consequence.permanentAfterThirtyDays" ->
        stringResource(R.string.delete_consequence_permanent)

    // Rendered as nothing HERE, and announced by the warning above — see the
    // comment at that call site for why it is neither hidden nor blocking.
    else -> null
}

/** The six the contract defines. Used only to notice when a seventh arrives. */
private val KNOWN_CONSEQUENCES = setOf(
    "deletion.consequence.profileRemoved",
    "deletion.consequence.postsRemainAnonymised",
    "deletion.consequence.messagesRemainForTheOtherPerson",
    "deletion.consequence.sessionsEndImmediately",
    "deletion.consequence.restorableForThirtyDays",
    "deletion.consequence.permanentAfterThirtyDays",
)

private const val SKELETON_LINES = 6
