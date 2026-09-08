package org.shehersaaz.mohalla.feature.notifications

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import org.shehersaaz.mohalla.R
import org.shehersaaz.mohalla.core.design.MohallaTheme
import org.shehersaaz.mohalla.core.design.MohallaType
import org.shehersaaz.mohalla.core.format.Ago
import org.shehersaaz.mohalla.core.format.NotificationDay
import org.shehersaaz.mohalla.core.format.RelativeTime
import org.shehersaaz.mohalla.core.network.ApiFailure
import org.shehersaaz.mohalla.core.ui.FailureState
import org.shehersaaz.mohalla.core.ui.MohallaBackHeader
import org.shehersaaz.mohalla.core.ui.MohallaButton
import org.shehersaaz.mohalla.core.ui.NotificationMark
import org.shehersaaz.mohalla.core.ui.NotificationRow
import java.time.ZoneId

/**
 * The notification centre — UX-HOME-007 (NOTIF-FR-002/003).
 *
 * REACHED FROM THE TOP BAR, NOT FROM A TAB. §14 is explicit about why:
 * notifications are "an interrupt, not a place… users go there because
 * something happened, not because they chose to". A bottom-bar slot would spend
 * one of five on a screen visited reactively, and would put a red badge in the
 * navigation permanently.
 *
 * EVERY SENTENCE ON THIS SCREEN CAME FROM THE SERVER. There is not one
 * notification string in `strings.xml`, and that is LOCALE-FR-002 holding: the
 * text is rendered at read time in the language this request named, so switching
 * language re-renders the whole centre rather than leaving yesterday's Urdu
 * behind. What the client owns is the chrome — the day headings, the relative
 * times, and the empty state.
 *
 * THE RELATIVE TIMES GO THROUGH PLURAL TABLES. Urdu and English do not share
 * pluralisation rules, so `"$n hours ago"` is wrong in both; `plurals.xml` is
 * the platform's mechanism for it and it only works if the formatter hands over
 * a number rather than a sentence.
 */
@Composable
fun NotificationsScreen(
    state: NotificationsUiState,
    sections: List<NotificationSection>,
    onBack: () -> Unit,
    onOpen: (AppNotification) -> Unit,
    onRetry: () -> Unit,
    onLoadMore: () -> Unit,
    onFindPeople: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .background(MohallaTheme.colors.BgPrimary),
    ) {
        MohallaBackHeader(
            title = stringResource(R.string.action_notifications),
            onBack = onBack,
        )

        when {
            // Kept apart from emptiness. "Nothing yet — when people interact
            // with your posts, you'll see it here" after a timeout tells
            // somebody that nobody has engaged with them, which is a
            // discouraging thing to say untruthfully.
            state.firstPageFailure != null && state.notifications.isEmpty() ->
                NotificationsFailure(failure = state.firstPageFailure, onRetry = onRetry)

            state.loadingFirst && state.notifications.isEmpty() -> NotificationsSkeleton()

            // §21's copy states the consequence rather than the absence, and
            // offers the next step: an empty centre on a new account is not a
            // problem to report but a sign of having posted nothing yet.
            state.isEmpty -> EmptyNotifications(onFindPeople = onFindPeople)

            else -> NotificationList(
                state = state,
                sections = sections,
                onOpen = onOpen,
                onLoadMore = onLoadMore,
            )
        }
    }
}

@Composable
private fun NotificationList(
    state: NotificationsUiState,
    sections: List<NotificationSection>,
    onOpen: (AppNotification) -> Unit,
    onLoadMore: () -> Unit,
) {
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(bottom = MohallaTheme.spacing.Space8),
    ) {
        sections.forEach { section ->
            item(key = "day-${section.day.name}") {
                DayHeading(section.day)
            }

            items(section.notifications, key = { it.id }) { notification ->
                NotificationRow(
                    text = notification.text,
                    timeLabel = agoLabel(notification.createdAt),
                    mark = notification.mark,
                    unread = notification.isUnread,
                    // Null where there is nowhere to go, which leaves the row
                    // inert rather than inviting a tap that does nothing.
                    onClick = if (notification.isActionable) {
                        { onOpen(notification) }
                    } else {
                        null
                    },
                    actorPhotoMediaId = notification.actorId
                        ?.let { state.actors[it] }
                        ?.photoMediaId,
                )
                RowDivider()
            }
        }

        if (!state.atEnd) {
            item(key = "more") {
                LaunchedEffect(state.nextCursor) { onLoadMore() }
                Box(
                    Modifier
                        .fillMaxWidth()
                        .height(MohallaTheme.spacing.Space16),
                )
            }
        }
    }
}

/**
 * TODAY · YESTERDAY · EARLIER (§ UX-HOME-007 — "grouping without clutter").
 *
 * A heading for accessibility, so a screen reader can jump between days rather
 * than reading a hundred rows to find where yesterday started.
 */
@Composable
private fun DayHeading(day: NotificationDay) {
    Text(
        text = stringResource(
            when (day) {
                NotificationDay.TODAY -> R.string.notifications_day_today
                NotificationDay.YESTERDAY -> R.string.notifications_day_yesterday
                NotificationDay.EARLIER -> R.string.notifications_day_earlier
            },
        ),
        style = MohallaTheme.text(MohallaType.Label),
        color = MohallaTheme.colors.TextSecondary,
        modifier = Modifier
            .fillMaxWidth()
            .background(MohallaTheme.colors.BgPrimary)
            .padding(
                horizontal = MohallaTheme.screenMargin,
                vertical = MohallaTheme.spacing.Space2,
            )
            .semantics { heading() },
    )
}

@Composable
private fun RowDivider() {
    Box(
        Modifier
            .fillMaxWidth()
            // Indented from the logical start so the rule runs under the text
            // and not under the avatar — which mirrors with the layout, because
            // `start` is logical.
            .padding(start = MohallaTheme.screenMargin)
            .height(HAIRLINE)
            .background(MohallaTheme.colors.BorderDefault),
    )
}

/**
 * §21 — "Nothing yet — when people interact with your posts, you'll see it
 * here", with a route into Discover.
 *
 * THE ACTION IS THE POINT. An empty notification centre is the most common
 * screen a new account sees, and the honest next step is not to wait but to go
 * and find people.
 */
@Composable
private fun EmptyNotifications(onFindPeople: () -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = MohallaTheme.screenMargin),
        verticalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space3),
    ) {
        Spacer(Modifier.height(MohallaTheme.spacing.Space10))

        Text(
            text = stringResource(R.string.notifications_empty_title),
            style = MohallaTheme.text(MohallaType.H3),
            color = MohallaTheme.colors.TextPrimary,
            modifier = Modifier.semantics { heading() },
        )
        Text(
            text = stringResource(R.string.notifications_empty_body),
            style = MohallaTheme.text(MohallaType.Body),
            color = MohallaTheme.colors.TextSecondary,
        )

        MohallaButton(
            text = stringResource(R.string.feed_find_people),
            onClick = onFindPeople,
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

@Composable
private fun NotificationsFailure(failure: ApiFailure, onRetry: () -> Unit) {
    FailureState(failure = failure, onRetry = onRetry)
}

@Composable
private fun NotificationsSkeleton() {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(top = MohallaTheme.spacing.Space2),
        verticalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space1),
    ) {
        repeat(SKELETON_ROWS) {
            Box(
                Modifier
                    .fillMaxWidth()
                    .padding(
                        horizontal = MohallaTheme.screenMargin,
                        vertical = MohallaTheme.spacing.Space3,
                    )
                    .height(MohallaTheme.spacing.Space10)
                    .background(MohallaTheme.colors.SurfaceSunken, MohallaTheme.radius.ShapeMd),
            )
        }
    }
}

/**
 * Which mark fills the row's circle.
 *
 * MAPPED HERE rather than in `core/ui`, so the component stays independent of
 * this feature's categories — the same split `MessageBubble` uses.
 */
private val AppNotification.mark: NotificationMark
    get() = when {
        actorId != null -> NotificationMark.ACTOR
        category == NotificationCategory.ANNOUNCEMENT -> NotificationMark.PLATFORM
        // An event that CHANGED or was CANCELLED has no actor by design: the
        // server records it as the event changing rather than a person acting.
        else -> NotificationMark.EVENT
    }

/**
 * "2h" · "Yesterday" · "2 days ago".
 *
 * THE CLOCK IS READ IN COMPOSITION AND THAT IS ACCEPTABLE HERE, unlike in the
 * ViewModel's day grouping. This is a label on a row that is redrawn when the
 * screen is opened; a notification that says "2h" for three minutes longer than
 * it should is not a defect worth a ticking timer and the recompositions it
 * would cost on a long list.
 */
@Composable
private fun agoLabel(iso: String): String? {
    val ago = RelativeTime.ago(iso, System.currentTimeMillis(), ZoneId.systemDefault())

    return when (ago) {
        null -> null
        Ago.JustNow -> stringResource(R.string.notifications_just_now)

        is Ago.Minutes -> pluralStringResource(
            R.plurals.notifications_minutes_ago,
            ago.count,
            ago.count,
        )

        is Ago.Hours -> pluralStringResource(
            R.plurals.notifications_hours_ago,
            ago.count,
            ago.count,
        )

        is Ago.Days -> pluralStringResource(
            R.plurals.notifications_days_ago,
            ago.count,
            ago.count,
        )
    }
}

/**
 * 1dp.
 *
 * Off the 4dp scale deliberately and for the same reason the top bar's hairline
 * is: §17 governs space BETWEEN things, and a hairline is a drawn line whose
 * whole purpose is to be the thinnest the display can render.
 */
private val HAIRLINE = 1.dp

private const val SKELETON_ROWS = 6
