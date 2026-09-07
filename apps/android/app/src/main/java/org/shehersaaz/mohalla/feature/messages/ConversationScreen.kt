package org.shehersaaz.mohalla.feature.messages

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.derivedStateOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.SolidColor
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import org.shehersaaz.mohalla.R
import org.shehersaaz.mohalla.core.design.MohallaTheme
import org.shehersaaz.mohalla.core.design.MohallaType
import org.shehersaaz.mohalla.core.network.ApiFailure
import org.shehersaaz.mohalla.core.ui.BubbleState
import org.shehersaaz.mohalla.core.ui.ContentUnavailable
import org.shehersaaz.mohalla.core.ui.LoadingState
import org.shehersaaz.mohalla.core.ui.MessageBubble
import org.shehersaaz.mohalla.core.ui.MohallaBackHeader
import org.shehersaaz.mohalla.core.ui.MohallaButton
import org.shehersaaz.mohalla.core.ui.MohallaSecondaryButton
import org.shehersaaz.mohalla.core.ui.TopBarAction

/**
 * One conversation — UX-MSG-003
 * (MSG-FR-002/004/006/008/009 · EDGE-020/021/022).
 *
 * §19 describes this screen as "optimistic states with honest reconciliation",
 * and the honesty is the harder half: a bubble appears the instant it is typed,
 * and when the send fails it says so and stays put with a retry beside it
 * rather than vanishing or pretending.
 *
 * THE POLL IS TIED TO THE LIFECYCLE, not to composition. Started on RESUME and
 * stopped on PAUSE, so a phone in a pocket or an app in the background makes no
 * requests at all — which matters because the poll is what delivers
 * MSG-FR-004's three seconds and it is not free on Pakistani mobile data.
 *
 * A PENDING REQUEST HAS NO COMPOSE FIELD. MSG-FR-005 lets the recipient read a
 * request without the sender learning; replying is what accepting means, so the
 * screen offers Accept and Decline instead of a field. Typing a reply and only
 * then being told the thread is a request would be the wrong order.
 */
@Composable
fun ConversationScreen(
    state: ConversationUiState,
    onBack: () -> Unit,
    onRetryLoad: () -> Unit,
    onDraftChanged: (String) -> Unit,
    onSend: () -> Unit,
    onRetryMessage: (String) -> Unit,
    onLoadOlder: () -> Unit,
    onAccept: () -> Unit,
    onDecline: () -> Unit,
    onOpenProfile: (String) -> Unit,
    onReport: () -> Unit,
    onStartPolling: () -> Unit,
    onStopPolling: () -> Unit,
    isUrdu: Boolean,
    modifier: Modifier = Modifier,
) {
    // MSG-FR-004's delivery, bounded to the foreground. `DisposableEffect` over
    // the lifecycle rather than `LaunchedEffect(Unit)`, because composition
    // survives the app going to the background and a poll that kept running
    // there would spend data on a screen nobody is looking at.
    val lifecycleOwner = LocalLifecycleOwner.current
    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_RESUME -> onStartPolling()
                Lifecycle.Event.ON_PAUSE -> onStopPolling()
                else -> Unit
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose {
            lifecycleOwner.lifecycle.removeObserver(observer)
            onStopPolling()
        }
    }

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(MohallaTheme.colors.BgPrimary)
            .imePadding(),
    ) {
        MohallaBackHeader(
            title = state.otherUser?.displayName ?: stringResource(R.string.nav_messages),
            onBack = onBack,
            actions = buildList {
                if (state.otherUserId != null) {
                    add(
                        TopBarAction(
                            // MSG-FR-007 — reporting a conversation is UX-SAFE-001,
                            // group 17. The control is present because §19 lists it
                            // among the secondary actions on this screen.
                            icon = Icons.Filled.Warning,
                            descriptionRes = R.string.action_report,
                            onClick = onReport,
                        ),
                    )
                }
            },
        )

        when {
            // MSG-FR-006 · BR-025. Blocked either way, not a participant, the
            // other account banned, or no such conversation — one answer, and
            // the screen says nothing about which.
            state.failure is ApiFailure.Unavailable -> ContentUnavailable()

            state.loading && state.messages.isEmpty() -> LoadingState()

            state.failure != null && state.messages.isEmpty() ->
                ThreadFailure(failure = state.failure, onRetry = onRetryLoad)

            else -> {
                Box(modifier = Modifier.weight(1f)) {
                    Thread(
                        state = state,
                        onRetryMessage = onRetryMessage,
                        onLoadOlder = onLoadOlder,
                        onOpenProfile = onOpenProfile,
                        isUrdu = isUrdu,
                    )
                }

                state.sendRefusal?.let { SendRefusalNotice(it) }

                when {
                    // BR-027 — a request offers a decision, not a field.
                    state.isPendingRequest -> RequestActions(
                        acting = state.acting,
                        onAccept = onAccept,
                        onDecline = onDecline,
                    )

                    // EDGE-022 — readable, and marked. The field is gone rather
                    // than present-and-refusing.
                    state.readOnly -> ReadOnlyNotice()

                    else -> Composer(
                        state = state,
                        onDraftChanged = onDraftChanged,
                        onSend = onSend,
                        isUrdu = isUrdu,
                    )
                }
            }
        }
    }
}

@Composable
private fun Thread(
    state: ConversationUiState,
    onRetryMessage: (String) -> Unit,
    onLoadOlder: () -> Unit,
    onOpenProfile: (String) -> Unit,
    isUrdu: Boolean,
) {
    val listState = rememberLazyListState()

    // A conversation is read from the bottom, so a new message scrolls into
    // view. Keyed on the newest message's identity rather than on the count, so
    // an optimistic bubble being REPLACED by the server's copy — which leaves
    // the count unchanged — still settles the list at the end.
    LaunchedEffect(state.messages.lastOrNull()?.key) {
        if (state.messages.isNotEmpty()) {
            listState.animateScrollToItem(state.messages.lastIndex)
        }
    }

    // Older messages load when the reader reaches the top, which is the
    // direction this list grows in.
    val atTop by remember(listState) {
        derivedStateOf { listState.firstVisibleItemIndex == 0 }
    }
    LaunchedEffect(atTop) { if (atTop) onLoadOlder() }

    LazyColumn(
        state = listState,
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(
            horizontal = MohallaTheme.screenMargin,
            vertical = MohallaTheme.spacing.Space3,
        ),
        verticalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space2),
    ) {
        if (state.olderCursor != null) {
            item(key = "older") {
                MohallaSecondaryButton(
                    text = stringResource(R.string.conversation_load_older),
                    onClick = onLoadOlder,
                    enabled = !state.loadingOlder,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }

        if (state.isEmptyThread) {
            item(key = "empty") { EmptyThread(state = state, onOpenProfile = onOpenProfile) }
        }

        items(state.messages, key = { it.key }) { message ->
            MessageBubble(
                body = message.body,
                mediaId = message.mediaId,
                isMine = message.isMine,
                state = message.state.toBubbleState(),
                timeLabel = message.createdAt.takeLast(TIME_SUFFIX).take(TIME_LENGTH),
                onRetry = message.clientMessageId
                    ?.takeIf { message.canRetry }
                    ?.let { id -> { onRetryMessage(id) } },
                isUrdu = isUrdu,
            )
        }
    }
}

/**
 * An empty thread.
 *
 * Reachable because BR-024 lets a conversation be OPENED without anything being
 * sent — tapping Message on a profile resolves the thread and notifies nobody.
 * So this is the state of a conversation somebody is about to start, and the
 * copy says the thing that makes it safe to start: PRIV-003 means the other
 * person never sees a phone number.
 */
@Composable
private fun EmptyThread(state: ConversationUiState, onOpenProfile: (String) -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = MohallaTheme.spacing.Space10),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space2),
    ) {
        Text(
            text = stringResource(R.string.conversation_empty_title),
            style = MohallaTheme.text(MohallaType.Title),
            color = MohallaTheme.colors.TextPrimary,
        )
        Text(
            text = stringResource(R.string.conversation_empty_body),
            style = MohallaTheme.text(MohallaType.BodySm),
            color = MohallaTheme.colors.TextSecondary,
        )
        state.otherUserId?.let { id ->
            Text(
                text = stringResource(R.string.conversation_view_profile),
                style = MohallaTheme.text(MohallaType.Button),
                color = MohallaTheme.colors.BrandPrimary,
                modifier = Modifier
                    .defaultMinSize(minHeight = MohallaTheme.spacing.Space12)
                    .clickable(role = Role.Button, onClick = { onOpenProfile(id) })
                    .padding(vertical = MohallaTheme.spacing.Space3),
            )
        }
    }
}

/**
 * The compose row (§19 — sticky, above the keyboard).
 *
 * The counter appears only near the limit, as on the comment composer: a
 * message is usually a sentence, and 2,000 graphemes is an allowance almost
 * nobody approaches.
 */
@Composable
private fun Composer(
    state: ConversationUiState,
    onDraftChanged: (String) -> Unit,
    onSend: () -> Unit,
    isUrdu: Boolean,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(MohallaTheme.colors.SurfacePrimary),
    ) {
        Box(
            Modifier
                .fillMaxWidth()
                .height(HAIRLINE)
                .background(MohallaTheme.colors.BorderDefault),
        )

        Row(
            modifier = Modifier
                .fillMaxWidth()
                .defaultMinSize(minHeight = COMPOSER_HEIGHT)
                .padding(
                    horizontal = MohallaTheme.screenMargin,
                    vertical = MohallaTheme.spacing.Space2,
                ),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space2),
        ) {
            Box(modifier = Modifier.weight(1f)) {
                if (state.draft.isEmpty()) {
                    Text(
                        text = stringResource(R.string.conversation_placeholder),
                        style = MohallaTheme.text(MohallaType.Body, display = isUrdu),
                        color = MohallaTheme.colors.TextTertiary,
                    )
                }
                BasicTextField(
                    value = state.draft,
                    onValueChange = onDraftChanged,
                    textStyle = MohallaTheme.text(MohallaType.Body, display = isUrdu)
                        .copy(color = MohallaTheme.colors.TextPrimary),
                    cursorBrush = SolidColor(MohallaTheme.colors.BrandPrimary),
                    modifier = Modifier.fillMaxWidth(),
                )
            }

            if (state.draftLength > MESSAGE_BODY_MAX_GRAPHEMES - COUNTER_THRESHOLD) {
                Text(
                    text = (MESSAGE_BODY_MAX_GRAPHEMES - state.draftLength).toString(),
                    style = MohallaTheme.text(MohallaType.Caption),
                    color = if (state.draftOverLimit) {
                        MohallaTheme.colors.Error
                    } else {
                        MohallaTheme.colors.TextTertiary
                    },
                )
            }

            Box(
                modifier = Modifier
                    .size(MohallaTheme.spacing.Space12)
                    .clickable(enabled = state.canSend, role = Role.Button, onClick = onSend),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    // Send IS directional: an arrow pointing right means
                    // forward in English and backward in Urdu.
                    imageVector = Icons.AutoMirrored.Filled.Send,
                    contentDescription = stringResource(R.string.comment_send),
                    tint = if (state.canSend) {
                        MohallaTheme.colors.BrandPrimary
                    } else {
                        MohallaTheme.colors.TextTertiary
                    },
                    modifier = Modifier.size(MohallaTheme.spacing.Space6),
                )
            }
        }
    }
}

/**
 * BR-027 — Accept or Decline, instead of a compose field.
 *
 * DECLINE IS NOT DESTRUCTIVE-STYLED and gets no confirmation. It is reversible
 * in effect — later messages from that sender land in the same suppressed thread
 * and remain available if the reader changes their mind — and BR-028 means it
 * costs the sender nothing observable. A confirmation dialog would make
 * declining a stranger feel like a serious act, which is exactly the friction
 * this feature exists to remove.
 */
@Composable
private fun RequestActions(acting: Boolean, onAccept: () -> Unit, onDecline: () -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(MohallaTheme.colors.SurfacePrimary)
            .padding(MohallaTheme.screenMargin),
        verticalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space2),
    ) {
        Text(
            text = stringResource(R.string.request_explainer),
            style = MohallaTheme.text(MohallaType.BodySm),
            color = MohallaTheme.colors.TextSecondary,
        )
        Row(horizontalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space2)) {
            MohallaButton(
                text = stringResource(R.string.request_accept),
                onClick = onAccept,
                enabled = !acting,
                modifier = Modifier.weight(1f),
            )
            MohallaSecondaryButton(
                text = stringResource(R.string.request_decline),
                onClick = onDecline,
                enabled = !acting,
                modifier = Modifier.weight(1f),
            )
        }
    }
}

/** EDGE-022 — the thread is readable and says why it is not writable. */
@Composable
private fun ReadOnlyNotice() {
    Text(
        text = stringResource(R.string.conversation_read_only),
        style = MohallaTheme.text(MohallaType.BodySm),
        color = MohallaTheme.colors.TextSecondary,
        modifier = Modifier
            .fillMaxWidth()
            .background(MohallaTheme.colors.SurfaceSunken)
            .padding(MohallaTheme.screenMargin),
    )
}

/**
 * Why a send was refused.
 *
 * [SendRefusal.Unavailable] gets the NEUTRAL copy and says nothing about a
 * block. MSG-FR-006's acceptance criterion is that the send "is refused without
 * disclosing the block", and from the blocked side "the conversation simply
 * receives no replies" — so this says the message could not be sent and stops.
 */
@Composable
private fun SendRefusalNotice(refusal: SendRefusal) {
    val text = when (refusal) {
        SendRefusal.ReadOnly -> stringResource(R.string.conversation_read_only)
        SendRefusal.Unavailable -> stringResource(R.string.message_send_unavailable)
        is SendRefusal.RateLimited -> refusal.message
            ?: stringResource(R.string.message_request_limit, MAX_NEW_REQUESTS_PER_DAY)
        is SendRefusal.Restricted -> refusal.message
            ?: stringResource(R.string.state_restricted_body)
        SendRefusal.Retryable -> stringResource(R.string.message_send_retryable)
    }

    Text(
        text = text,
        style = MohallaTheme.text(MohallaType.Caption),
        color = MohallaTheme.colors.Error,
        modifier = Modifier
            .fillMaxWidth()
            .background(MohallaTheme.colors.ErrorSubtle)
            .padding(
                horizontal = MohallaTheme.screenMargin,
                vertical = MohallaTheme.spacing.Space2,
            )
            .semantics { liveRegion = LiveRegionMode.Polite },
    )
}

@Composable
private fun ThreadFailure(failure: ApiFailure, onRetry: () -> Unit) {
    when (failure) {
        ApiFailure.Offline -> org.shehersaaz.mohalla.core.ui.OfflineState(onRetry = onRetry)
        is ApiFailure.Server -> org.shehersaaz.mohalla.core.ui.ServerErrorState(
            correlationId = failure.correlationId,
            onRetry = onRetry,
        )
        else -> org.shehersaaz.mohalla.core.ui.ServerErrorState(onRetry = onRetry)
    }
}

private fun MessageState.toBubbleState(): BubbleState = when (this) {
    MessageState.Sending -> BubbleState.Sending
    MessageState.Sent -> BubbleState.Sent
    MessageState.Read -> BubbleState.Read
    MessageState.Failed -> BubbleState.Failed
}

/** "2026-09-01T10:00:00Z" → the `10:00` part, until the shared formatter lands. */
private const val TIME_SUFFIX = 9
private const val TIME_LENGTH = 5

/** §19 — a sticky composer at the platform's 56dp. */
private val COMPOSER_HEIGHT: Dp = 56.dp

/** A drawn rule, not a gap. */
private val HAIRLINE: Dp = 1.dp

/** A twentieth of the allowance — 2,000 is a limit almost nobody approaches. */
private const val COUNTER_THRESHOLD = MESSAGE_BODY_MAX_GRAPHEMES / 20
