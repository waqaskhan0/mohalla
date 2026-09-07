package org.shehersaaz.mohalla.feature.events

import androidx.compose.foundation.background
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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.selection.selectable
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import java.time.ZoneId
import java.util.Locale
import org.shehersaaz.mohalla.R
import org.shehersaaz.mohalla.core.design.MohallaTheme
import org.shehersaaz.mohalla.core.design.MohallaType
import org.shehersaaz.mohalla.core.network.ApiFailure
import org.shehersaaz.mohalla.core.network.EventResponse
import org.shehersaaz.mohalla.core.network.EventStatus
import org.shehersaaz.mohalla.core.network.RsvpResponse
import org.shehersaaz.mohalla.core.ui.EventCard
import org.shehersaaz.mohalla.core.ui.EventRsvpRow
import org.shehersaaz.mohalla.core.ui.MohallaButton
import org.shehersaaz.mohalla.core.ui.MohallaSecondaryButton
import org.shehersaaz.mohalla.core.ui.OfflineState
import org.shehersaaz.mohalla.core.ui.RateLimitedState
import org.shehersaaz.mohalla.core.ui.ServerErrorState

/**
 * The Events tab — UX-EVENT-001 (Upcoming) · UX-EVENT-002 (Mine).
 *
 * The branch order is the feed's, for the same reason: a failed first page
 * renders an error, an empty list renders an invitation, and confusing the two
 * tells somebody their neighbourhood plans nothing when the app could not ask.
 *
 * EVENTS ARE A TOP-LEVEL TAB and that was a deliberate product decision, not a
 * layout one — §03: "Events are the mobilization layer and the clearest thing
 * this product does that Facebook does not. Burying the differentiator two
 * levels deep would be a strategic error."
 */
@Composable
fun EventsScreen(
    state: EventsUiState,
    locale: Locale,
    zone: ZoneId,
    onSelectTab: (EventsTab) -> Unit,
    onRefresh: () -> Unit,
    onLoadMore: () -> Unit,
    onOpenEvent: (String) -> Unit,
    onRespond: (EventResponse, RsvpResponse) -> Unit,
    onCreateEvent: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .background(MohallaTheme.colors.BgPrimary),
    ) {
        EventsTabRow(selected = state.tab, onSelect = onSelectTab)

        val page = state.current

        when {
            state.firstPageFailure != null && page.events.isEmpty() ->
                FirstPageFailure(failure = state.firstPageFailure, onRetry = onRefresh)

            state.loadingFirstPage && page.events.isEmpty() -> EventsSkeleton()

            state.isEmpty -> when (state.tab) {
                // UX-EVENT-001's copy, verbatim from §21: "Nobody has planned
                // anything yet. Community events start with one person." The
                // action is Create, because on this screen the reader is the
                // one person who can fix it.
                EventsTab.UPCOMING -> EmptyEvents(
                    title = stringResource(R.string.events_empty_upcoming_title),
                    body = stringResource(R.string.events_empty_upcoming_body),
                    primary = stringResource(R.string.events_create) to onCreateEvent,
                )

                EventsTab.MINE -> EmptyEvents(
                    title = stringResource(R.string.events_empty_mine_title),
                    body = stringResource(R.string.events_empty_mine_body),
                    primary = stringResource(R.string.events_browse_upcoming) to {
                        onSelectTab(EventsTab.UPCOMING)
                    },
                )
            }

            else -> EventsList(
                state = state,
                page = page,
                locale = locale,
                zone = zone,
                onLoadMore = onLoadMore,
                onOpenEvent = onOpenEvent,
                onRespond = onRespond,
            )
        }
    }
}

@Composable
private fun EventsList(
    state: EventsUiState,
    page: EventList,
    locale: Locale,
    zone: ZoneId,
    onLoadMore: () -> Unit,
    onOpenEvent: (String) -> Unit,
    onRespond: (EventResponse, RsvpResponse) -> Unit,
) {
    val listState = rememberLazyListState()

    val shouldLoadMore by remember(listState) {
        derivedStateOf {
            val info = listState.layoutInfo
            val last = info.visibleItemsInfo.lastOrNull()?.index
            last != null && info.totalItemsCount > 0 &&
                last >= info.totalItemsCount - PREFETCH_DISTANCE
        }
    }

    LaunchedEffect(shouldLoadMore) { if (shouldLoadMore) onLoadMore() }

    LazyColumn(
        state = listState,
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(
            horizontal = MohallaTheme.screenMargin,
            vertical = MohallaTheme.spacing.Space3,
        ),
        verticalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space3),
    ) {
        // UX-EVENT-002's caveat, stated on the screen rather than buried in a
        // document. The list is honest about being the created-by half only,
        // because a tab labelled "Mine" that silently omits the events somebody
        // said they were going to is worse than one that explains itself.
        if (state.tab == EventsTab.MINE) {
            item(key = "mine-scope") { MineScopeNotice() }
        }

        items(page.events, key = { it.id }) { event ->
            EventCard(
                event = event,
                onOpen = { onOpenEvent(event.id) },
                locale = locale,
                zone = zone,
                rsvpRow = {
                    // Responding from the list is offered only where it can
                    // succeed: a cancelled event takes no responses, and the
                    // creator's own event has nothing to respond to.
                    if (canRespondInList(event)) {
                        EventRsvpRow(
                            myResponse = event.myResponse,
                            onGoing = { onRespond(event, RsvpResponse.GOING) },
                            onInterested = { onRespond(event, RsvpResponse.INTERESTED) },
                            enabled = event.id !in state.pendingRsvps,
                        )
                    }
                },
            )
        }

        if (page.pageFailure != null) {
            item(key = "page-error") { PageEndRetry(onRetry = onLoadMore) }
        }

        if (page.loadingMore) {
            item(key = "page-loading") { EventSkeletonCard() }
        }

        if (page.atEnd && page.events.isNotEmpty()) {
            item(key = "end") {
                Text(
                    text = stringResource(R.string.events_end),
                    style = MohallaTheme.text(MohallaType.Caption),
                    color = MohallaTheme.colors.TextTertiary,
                    textAlign = TextAlign.Center,
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(vertical = MohallaTheme.spacing.Space6),
                )
            }
        }
    }
}

/**
 * Two segments: Upcoming and Mine (§18.5 — "two or three segments only").
 */
@Composable
private fun EventsTabRow(selected: EventsTab, onSelect: (EventsTab) -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(MohallaTheme.colors.SurfacePrimary)
            .padding(horizontal = MohallaTheme.screenMargin),
    ) {
        EventsTab.entries.forEach { tab ->
            val isSelected = tab == selected
            Box(
                modifier = Modifier
                    .weight(1f)
                    .defaultMinSize(minHeight = MohallaTheme.spacing.Space12)
                    .selectable(
                        selected = isSelected,
                        role = Role.Tab,
                        onClick = { onSelect(tab) },
                    ),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    text = stringResource(
                        when (tab) {
                            EventsTab.UPCOMING -> R.string.events_tab_upcoming
                            EventsTab.MINE -> R.string.events_tab_mine
                        },
                    ),
                    style = MohallaTheme.text(MohallaType.Button),
                    color = if (isSelected) {
                        MohallaTheme.colors.BrandPrimary
                    } else {
                        MohallaTheme.colors.TextSecondary
                    },
                )
            }
        }
    }
}

/**
 * The gap between UX-EVENT-002 and the API, said out loud.
 *
 * The requirement asks for events created OR responded to; the backend serves
 * created-by only. Rather than presenting a partial list as complete, the screen
 * names what it contains. When the endpoint exists this notice goes away — and
 * until then a creator looking for an event they said they would attend is told
 * where it is instead of concluding the app lost it.
 */
@Composable
private fun MineScopeNotice() {
    Text(
        text = stringResource(R.string.events_mine_scope_notice),
        style = MohallaTheme.text(MohallaType.Caption),
        color = MohallaTheme.colors.TextSecondary,
        modifier = Modifier
            .fillMaxWidth()
            .background(MohallaTheme.colors.SurfaceSunken, MohallaTheme.radius.ShapeSm)
            .padding(MohallaTheme.spacing.Space3),
    )
}

@Composable
private fun EmptyEvents(
    title: String,
    body: String,
    primary: Pair<String, () -> Unit>,
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

        MohallaButton(
            text = primary.first,
            onClick = primary.second,
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

@Composable
private fun FirstPageFailure(failure: ApiFailure, onRetry: () -> Unit) {
    when (failure) {
        ApiFailure.Offline -> OfflineState(onRetry = onRetry)
        is ApiFailure.RateLimited -> RateLimitedState(onRetry = onRetry)
        is ApiFailure.Server -> ServerErrorState(
            correlationId = failure.correlationId,
            onRetry = onRetry,
        )
        else -> ServerErrorState(onRetry = onRetry)
    }
}

@Composable
private fun PageEndRetry(onRetry: () -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = MohallaTheme.spacing.Space4),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space2),
    ) {
        Text(
            text = stringResource(R.string.events_page_failed),
            style = MohallaTheme.text(MohallaType.BodySm),
            color = MohallaTheme.colors.TextSecondary,
        )
        MohallaSecondaryButton(
            text = stringResource(R.string.action_retry),
            onClick = onRetry,
        )
    }
}

@Composable
private fun EventsSkeleton() {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = MohallaTheme.screenMargin)
            .padding(top = MohallaTheme.spacing.Space3),
        verticalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space3),
    ) {
        repeat(3) { EventSkeletonCard() }
    }
}

/**
 * The skeleton, shaped like the card it stands in for — a date block beside two
 * lines of text, so nothing moves when the content lands.
 */
@Composable
private fun EventSkeletonCard() {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(MohallaTheme.colors.SurfacePrimary, MohallaTheme.radius.ShapeLg)
            .padding(MohallaTheme.spacing.Space4),
        horizontalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space3),
    ) {
        Box(
            Modifier
                .width(MohallaTheme.spacing.Space16)
                .height(MohallaTheme.spacing.Space16)
                .background(MohallaTheme.colors.SurfaceSunken, MohallaTheme.radius.ShapeMd),
        )
        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space2),
        ) {
            SkeletonBar(fraction = 0.9f)
            SkeletonBar(fraction = 0.55f)
            SkeletonBar(fraction = 0.35f)
        }
    }
}

@Composable
private fun SkeletonBar(fraction: Float) {
    Box(
        modifier = Modifier
            .fillMaxWidth(fraction)
            .height(MohallaTheme.spacing.Space3)
            .background(MohallaTheme.colors.SurfaceSunken, MohallaTheme.radius.ShapeSm),
    )
}

/**
 * Whether the list row offers RSVP controls.
 *
 * NOT offered on a cancelled event — the server refuses those, so the buttons
 * would be an invitation to be refused. Nor on an event under review, which only
 * its creator can see and which has nothing to respond to.
 */
private fun canRespondInList(event: EventResponse): Boolean =
    EventStatus.fromWire(event.status) == EventStatus.SCHEDULED && !event.underReview

/** Three items of runway, as on the feed (NFR-PERF-001's 3G budget). */
private const val PREFETCH_DISTANCE = 3
