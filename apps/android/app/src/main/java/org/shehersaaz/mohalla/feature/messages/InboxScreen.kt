package org.shehersaaz.mohalla.feature.messages

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import org.shehersaaz.mohalla.R
import org.shehersaaz.mohalla.core.design.MohallaTheme
import org.shehersaaz.mohalla.core.design.MohallaType
import org.shehersaaz.mohalla.core.network.ApiFailure
import org.shehersaaz.mohalla.core.network.ConversationResponse
import org.shehersaaz.mohalla.core.network.PublicProfileResponse
import org.shehersaaz.mohalla.core.ui.MohallaAvatar
import org.shehersaaz.mohalla.core.ui.MohallaButton
import org.shehersaaz.mohalla.core.ui.MohallaSecondaryButton
import org.shehersaaz.mohalla.core.ui.MohallaTopBar
import org.shehersaaz.mohalla.core.ui.OfflineState
import org.shehersaaz.mohalla.core.ui.ServerErrorState

/**
 * The inbox and the request list — UX-MSG-001 · UX-MSG-002
 * (MSG-FR-003/005 · BR-027).
 *
 * TWO SEGMENTS, AND THE REQUEST COUNT LIVES ON THE SECOND ONE AND NOWHERE ELSE.
 * §14 is explicit: requests "are counted separately inside the screen and never
 * contribute to this badge — a stranger must not be able to make the user's
 * navigation demand attention." So the bottom bar's badge is fed from accepted
 * conversations alone, and the number of strangers waiting is something the
 * reader finds when they choose to look. The SRS calls this "the platform's
 * principal defence against unsolicited contact" and notes it "matters most for
 * women users".
 *
 * THE EMPTY INBOX STATES THE PRIVACY BENEFIT RATHER THAN THE ABSENCE. §21's
 * copy is "You can message anyone here without sharing your phone number" —
 * because that IS the feature (PRIV-003, "the platform's single most important
 * privacy improvement over the WhatsApp-group status quo"), and an empty inbox
 * is the one screen every new user reads.
 *
 * THE EMPTY REQUEST LIST OFFERS NO ACTION. §21: "this is a good state to be in —
 * offering an action would imply something is wrong."
 */
@Composable
fun InboxScreen(
    state: InboxUiState,
    onSelectTab: (InboxSection) -> Unit,
    onOpenConversation: (ConversationResponse) -> Unit,
    onAccept: (String) -> Unit,
    onDecline: (String) -> Unit,
    onRefresh: () -> Unit,
    onLoadMore: () -> Unit,
    onFindPeople: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .background(MohallaTheme.colors.BgPrimary),
    ) {
        MohallaTopBar(title = stringResource(R.string.nav_messages))

        SectionTabs(
            selected = state.section,
            requestCount = state.unreadRequests,
            onSelect = onSelectTab,
        )

        val list = state.current

        when {
            state.firstPageFailure != null && list.conversations.isEmpty() ->
                InboxFailure(failure = state.firstPageFailure, onRetry = onRefresh)

            state.loadingFirst && list.conversations.isEmpty() -> InboxSkeleton()

            state.isEmpty -> when (state.section) {
                InboxSection.CONVERSATIONS -> EmptyInbox(
                    title = stringResource(R.string.inbox_empty_title),
                    body = stringResource(R.string.inbox_empty_body),
                    action = stringResource(R.string.feed_find_people) to onFindPeople,
                )

                // No action. See the doc comment.
                InboxSection.REQUESTS -> EmptyInbox(
                    title = stringResource(R.string.requests_empty_title),
                    body = stringResource(R.string.requests_empty_body),
                    action = null,
                )
            }

            else -> ConversationList(
                state = state,
                list = list,
                onOpenConversation = onOpenConversation,
                onAccept = onAccept,
                onDecline = onDecline,
                onLoadMore = onLoadMore,
            )
        }
    }
}

/**
 * Inbox · Requests (§18.5 — "two or three segments only").
 *
 * The count sits ON THE SEGMENT, as a number rather than a red dot: a dot
 * demands attention, and a number is information the reader can weigh. That
 * distinction is the whole of BR-027's intent applied to one control.
 */
@Composable
private fun SectionTabs(
    selected: InboxSection,
    requestCount: Int,
    onSelect: (InboxSection) -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(MohallaTheme.colors.SurfacePrimary)
            .padding(horizontal = MohallaTheme.screenMargin),
    ) {
        InboxSection.entries.forEach { section ->
            val isSelected = section == selected
            Box(
                modifier = Modifier
                    .weight(1f)
                    .defaultMinSize(minHeight = MohallaTheme.spacing.Space12)
                    .selectable(
                        selected = isSelected,
                        role = Role.Tab,
                        onClick = { onSelect(section) },
                    ),
                contentAlignment = Alignment.Center,
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space1),
                ) {
                    Text(
                        text = stringResource(
                            when (section) {
                                InboxSection.CONVERSATIONS -> R.string.inbox_tab_messages
                                InboxSection.REQUESTS -> R.string.inbox_tab_requests
                            },
                        ),
                        style = MohallaTheme.text(MohallaType.Button),
                        color = if (isSelected) {
                            MohallaTheme.colors.BrandPrimary
                        } else {
                            MohallaTheme.colors.TextSecondary
                        },
                    )

                    // BR-027's count, here and on no other surface.
                    if (section == InboxSection.REQUESTS && requestCount > 0) {
                        Text(
                            text = requestCount.toString(),
                            style = MohallaTheme.text(MohallaType.Label),
                            color = MohallaTheme.colors.TextInverse,
                            modifier = Modifier
                                .background(
                                    MohallaTheme.colors.TextTertiary,
                                    MohallaTheme.radius.ShapeFull,
                                )
                                .padding(
                                    horizontal = MohallaTheme.spacing.Space2,
                                    vertical = MohallaTheme.spacing.Space1,
                                ),
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun ConversationList(
    state: InboxUiState,
    list: InboxList,
    onOpenConversation: (ConversationResponse) -> Unit,
    onAccept: (String) -> Unit,
    onDecline: (String) -> Unit,
    onLoadMore: () -> Unit,
) {
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(
            horizontal = MohallaTheme.screenMargin,
            vertical = MohallaTheme.spacing.Space2,
        ),
    ) {
        items(list.conversations, key = { it.conversationId }) { conversation ->
            ConversationRow(
                conversation = conversation,
                other = state.participants[conversation.otherUserId],
                viewerId = state.participants.keys.firstOrNull(),
                isRequest = state.section == InboxSection.REQUESTS,
                acting = conversation.conversationId in state.acting,
                onOpen = { onOpenConversation(conversation) },
                onAccept = { onAccept(conversation.conversationId) },
                onDecline = { onDecline(conversation.conversationId) },
            )
        }

        if (list.nextBefore != null) {
            item(key = "more") {
                MohallaSecondaryButton(
                    text = stringResource(R.string.inbox_load_more),
                    onClick = onLoadMore,
                    enabled = !list.loadingMore,
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(vertical = MohallaTheme.spacing.Space3),
                )
            }
        }
    }
}

/**
 * One conversation (§18 — "conversation row" · "request row").
 *
 * MSG-FR-003 names what it shows: "the other user, their badge, a message
 * preview, time and unread count".
 *
 * A REQUEST ROW CARRIES ACCEPT AND DECLINE INLINE. Opening a request to decide
 * is fine — MSG-FR-005 permits reading one without the sender learning — but
 * making somebody open a stranger's message to get rid of it is the opposite of
 * a defence against unsolicited contact. So both actions are on the row.
 */
@Composable
private fun ConversationRow(
    conversation: ConversationResponse,
    other: PublicProfileResponse?,
    viewerId: String?,
    isRequest: Boolean,
    acting: Boolean,
    onOpen: () -> Unit,
    onAccept: () -> Unit,
    onDecline: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(role = Role.Button, onClick = onOpen)
            .padding(vertical = MohallaTheme.spacing.Space3),
        verticalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space2),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space3),
        ) {
            MohallaAvatar(
                mediaId = other?.photoMediaId,
                contentDescription = null,
                size = MohallaTheme.spacing.Space12,
            )

            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space1),
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space1),
                ) {
                    Text(
                        // Blank rather than a placeholder while the profile
                        // resolves: a name that appears is less jarring than
                        // "Loading…" replaced by a person.
                        text = other?.displayName.orEmpty(),
                        style = MohallaTheme.text(MohallaType.Title),
                        color = MohallaTheme.colors.TextPrimary,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )

                    if (other?.verifiedBadge == true) {
                        Text(
                            text = stringResource(R.string.badge_verified),
                            style = MohallaTheme.text(MohallaType.Label),
                            color = MohallaTheme.colors.BrandPrimary,
                        )
                    }

                    // EDGE-022 — banned or deleted. MARKED, not hidden: the
                    // history is the reader's record too.
                    if (conversation.readOnly) {
                        Text(
                            text = stringResource(R.string.conversation_read_only_tag),
                            style = MohallaTheme.text(MohallaType.Label),
                            color = MohallaTheme.colors.TextTertiary,
                        )
                    }
                }

                Text(
                    text = previewText(conversation, viewerId),
                    style = MohallaTheme.text(MohallaType.BodySm),
                    color = if (conversation.unreadCount > 0) {
                        MohallaTheme.colors.TextPrimary
                    } else {
                        MohallaTheme.colors.TextSecondary
                    },
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }

            Column(
                horizontalAlignment = Alignment.End,
                verticalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space1),
            ) {
                conversation.lastMessageAt?.let {
                    Text(
                        text = it.take(TIME_PREFIX),
                        style = MohallaTheme.text(MohallaType.Caption),
                        color = MohallaTheme.colors.TextTertiary,
                    )
                }

                // The unread dot, on an accepted conversation only. A request
                // showing one would be a stranger making the screen demand
                // attention, which BR-027 exists to prevent.
                if (conversation.unreadCount > 0 && !isRequest) {
                    Box(
                        Modifier
                            .size(MohallaTheme.spacing.Space2)
                            .background(MohallaTheme.colors.BrandPrimary, CircleShape),
                    )
                }
            }
        }

        if (isRequest) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space2),
            ) {
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
}

/**
 * The preview line (MSG-FR-003).
 *
 * "You: …" when the last message was the reader's own, so a thread where they
 * spoke last is distinguishable from one waiting on them. An image-only message
 * says so rather than showing a blank line — the row could not fetch the image
 * anyway, since message media is served only through the conversation route.
 */
@Composable
private fun previewText(conversation: ConversationResponse, viewerId: String?): String {
    val preview = conversation.preview
    val body = preview?.body

    val text = when {
        !body.isNullOrBlank() -> body
        preview?.hasMedia == true -> stringResource(R.string.inbox_preview_photo)
        // A thread that exists with nothing in it: BR-024 lets a conversation
        // be opened without sending, and it appears in neither inbox until
        // something is sent — so this is only reachable for a thread whose
        // messages were all removed with a deleted account (BR-046).
        else -> stringResource(R.string.inbox_preview_empty)
    }

    return if (viewerId != null && preview?.senderId == viewerId) {
        stringResource(R.string.inbox_preview_own, text)
    } else {
        text
    }
}

@Composable
private fun EmptyInbox(
    title: String,
    body: String,
    action: Pair<String, () -> Unit>?,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = MohallaTheme.screenMargin),
        verticalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space3),
    ) {
        Spacer(Modifier.height(MohallaTheme.spacing.Space10))

        Text(
            text = title,
            style = MohallaTheme.text(MohallaType.H3),
            color = MohallaTheme.colors.TextPrimary,
            modifier = Modifier.semantics { heading() },
        )
        Text(
            text = body,
            style = MohallaTheme.text(MohallaType.Body),
            color = MohallaTheme.colors.TextSecondary,
        )

        action?.let { (label, onClick) ->
            MohallaButton(
                text = label,
                onClick = onClick,
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

@Composable
private fun InboxFailure(failure: ApiFailure, onRetry: () -> Unit) {
    when (failure) {
        ApiFailure.Offline -> OfflineState(onRetry = onRetry)
        is ApiFailure.Server -> ServerErrorState(
            correlationId = failure.correlationId,
            onRetry = onRetry,
        )
        else -> ServerErrorState(onRetry = onRetry)
    }
}

@Composable
private fun InboxSkeleton() {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = MohallaTheme.screenMargin)
            .padding(top = MohallaTheme.spacing.Space3),
        verticalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space4),
    ) {
        repeat(SKELETON_ROWS) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space3),
            ) {
                Box(
                    Modifier
                        .size(MohallaTheme.spacing.Space12)
                        .background(MohallaTheme.colors.SurfaceSunken, CircleShape),
                )
                Column(
                    modifier = Modifier.weight(1f),
                    verticalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space1),
                ) {
                    Box(
                        Modifier
                            .fillMaxWidth(0.4f)
                            .height(MohallaTheme.spacing.Space3)
                            .background(
                                MohallaTheme.colors.SurfaceSunken,
                                MohallaTheme.radius.ShapeSm,
                            ),
                    )
                    Box(
                        Modifier
                            .fillMaxWidth(0.75f)
                            .height(MohallaTheme.spacing.Space3)
                            .background(
                                MohallaTheme.colors.SurfaceSunken,
                                MohallaTheme.radius.ShapeSm,
                            ),
                    )
                }
            }
        }
    }
}

/**
 * The date part of an ISO timestamp.
 *
 * TODO(group 13): a localised relative formatter, shared with the post card and
 * the comment row. Deliberately not hand-rolled per screen — pluralisation
 * differs between Urdu and English, and three copies of "3h ago" is three
 * places to get it wrong.
 */
private const val TIME_PREFIX = 10

private const val SKELETON_ROWS = 5
