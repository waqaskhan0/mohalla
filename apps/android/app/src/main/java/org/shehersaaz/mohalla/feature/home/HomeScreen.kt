package org.shehersaaz.mohalla.feature.home

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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.CircleShape
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
import androidx.compose.ui.text.style.TextOverflow
import org.shehersaaz.mohalla.R
import org.shehersaaz.mohalla.core.design.MohallaTheme
import org.shehersaaz.mohalla.core.design.MohallaType
import org.shehersaaz.mohalla.core.network.ApiFailure
import org.shehersaaz.mohalla.core.network.FeaturedItemResponse
import org.shehersaaz.mohalla.core.network.FeedItemResponse
import org.shehersaaz.mohalla.core.ui.MohallaButton
import org.shehersaaz.mohalla.core.ui.MohallaSecondaryButton
import org.shehersaaz.mohalla.core.ui.MohallaTopBar
import org.shehersaaz.mohalla.core.ui.homeActions
import org.shehersaaz.mohalla.core.ui.OfflineState
import org.shehersaaz.mohalla.core.ui.PostCard
import org.shehersaaz.mohalla.core.ui.RateLimitedState
import org.shehersaaz.mohalla.core.ui.ServerErrorState

/**
 * Home — UX-HOME-001 (Following) · UX-HOME-002 (Discover).
 *
 * THE ORDER OF THE BRANCHES IN [HomeScreen] IS THE REQUIREMENT, not an
 * implementation detail:
 *
 *   1. A failed FIRST page renders an error with a retry.
 *   2. A first page still in flight renders skeletons.
 *   3. An EMPTY Following feed renders an invitation.
 *   4. Otherwise, the list.
 *
 * Putting 3 before 1 is the single most damaging bug this screen can have: it
 * tells a new user their neighbourhood is empty when the app merely could not
 * reach it. RSK-001 is that a cold start with nothing on it is why people do not
 * come back, and the state machine in [FeedUiState] is shaped to make the two
 * cases impossible to conflate — `isEmptyFollowing` is false whenever a failure
 * is present.
 *
 * FEATURED RENDERS ABOVE ALL OF IT AND IS NEVER GATED on the feed's state
 * (FEED-FR-002), including on the empty and skeleton screens, so there is always
 * something to read (REL-005).
 */
@Composable
fun HomeScreen(
    state: FeedUiState,
    onSelectTab: (FeedTab) -> Unit,
    onRefresh: () -> Unit,
    onLoadMore: () -> Unit,
    onOpenPost: (String) -> Unit,
    onOpenAuthor: (String) -> Unit,
    onToggleLike: (FeedItemResponse) -> Unit,
    onShare: (String) -> Unit,
    onOpenAnnouncement: (String) -> Unit,
    onFindPeople: () -> Unit,
    onSearch: () -> Unit,
    onOpenNotifications: () -> Unit,
    /** NOTIF-FR-002 — a dot on the bell, and the count only in semantics. */
    unreadNotifications: Int = 0,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .background(MohallaTheme.colors.BgPrimary),
    ) {
        // §19's first content item, and §14's placement decision: "Home carries
        // Search and Notifications". Both are ACTIONS rather than tabs —
        // "search is an action performed against feed content, not a place",
        // and notifications are "an interrupt, not a place… users go there
        // because something happened, not because they chose to". Putting
        // either in the bottom bar would spend one of five slots on a screen
        // visited reactively.
        MohallaTopBar(
            title = stringResource(R.string.app_name),
            actions = homeActions(
                onSearch = onSearch,
                onNotifications = onOpenNotifications,
                unreadNotifications = unreadNotifications,
            ),
        )

        // Sticky under the top bar (§19), which falls out of both sitting above
        // the LazyColumn rather than inside it.
        FeedTabRow(selected = state.tab, onSelect = onSelectTab)

        val page = state.current

        when {
            // 1 — a failed FIRST page. Never "no posts".
            state.firstPageFailure != null && page.items.isEmpty() ->
                FirstPageFailure(failure = state.firstPageFailure, onRetry = onRefresh)

            // 2 — still arriving.
            state.loadingFirstPage && page.items.isEmpty() ->
                FeedSkeleton(featured = state.featured, onOpenAnnouncement = onOpenAnnouncement)

            // 3 — genuinely empty, and an invitation rather than an error.
            state.isEmptyFollowing -> EmptyFeed(
                featured = state.featured,
                title = stringResource(R.string.feed_empty_following_title),
                body = stringResource(R.string.feed_empty_following_body),
                onOpenAnnouncement = onOpenAnnouncement,
            ) {
                // Two ways out, and Discover needs no follows at all.
                MohallaButton(
                    text = stringResource(R.string.feed_find_people),
                    onClick = onFindPeople,
                    modifier = Modifier.fillMaxWidth(),
                )
                MohallaSecondaryButton(
                    text = stringResource(R.string.feed_see_discover),
                    onClick = { onSelectTab(FeedTab.DISCOVER) },
                    modifier = Modifier.fillMaxWidth(),
                )
            }

            // An empty DISCOVER feed gets different copy and NO actions: there
            // is nothing the reader can do about it, and offering "follow
            // people" here would be advice that does not help.
            state.isEmptyDiscover -> EmptyFeed(
                featured = state.featured,
                title = stringResource(R.string.feed_empty_discover_title),
                body = stringResource(R.string.feed_empty_discover_body),
                onOpenAnnouncement = onOpenAnnouncement,
            )

            // 4 — the list.
            else -> FeedItems(
                state = state,
                page = page,
                onLoadMore = onLoadMore,
                onOpenPost = onOpenPost,
                onOpenAuthor = onOpenAuthor,
                onToggleLike = onToggleLike,
                onShare = onShare,
                onOpenAnnouncement = onOpenAnnouncement,
            )
        }
    }
}

@Composable
private fun FeedItems(
    state: FeedUiState,
    page: FeedList,
    onLoadMore: () -> Unit,
    onOpenPost: (String) -> Unit,
    onOpenAuthor: (String) -> Unit,
    onToggleLike: (FeedItemResponse) -> Unit,
    onShare: (String) -> Unit,
    onOpenAnnouncement: (String) -> Unit,
) {
    val listState = rememberLazyListState()

    // Requests the next page THREE items early rather than at the last one, so
    // on a slow connection the page is usually there before the reader arrives.
    // Asking at the final item guarantees a visible wait every time.
    val shouldLoadMore by remember(listState) {
        derivedStateOf {
            val info = listState.layoutInfo
            val last = info.visibleItemsInfo.lastOrNull()?.index
            last != null && info.totalItemsCount > 0 &&
                last >= info.totalItemsCount - PREFETCH_DISTANCE
        }
    }

    LaunchedEffect(shouldLoadMore) {
        if (shouldLoadMore) onLoadMore()
    }

    LazyColumn(
        state = listState,
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(
            horizontal = MohallaTheme.screenMargin,
            vertical = MohallaTheme.spacing.Space3,
        ),
        verticalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space3),
    ) {
        if (state.featured.isNotEmpty()) {
            item(key = "featured") { FeaturedStrip(state.featured, onOpenAnnouncement) }
        }

        items(page.items, key = { it.id }) { post ->
            PostCard(
                post = post,
                onOpen = { onOpenPost(post.id) },
                onToggleLike = { onToggleLike(post) },
                onOpenAuthor = { onOpenAuthor(post.author.userId) },
                onShare = { onShare(post.id) },
                likePending = post.id in state.pendingLikes,
            )
        }

        // §15's "error at page end, retry". Everything already read stays where
        // it is — a failed second page must never clear the first.
        if (page.pageFailure != null) {
            item(key = "page-error") { PageEndRetry(onRetry = onLoadMore) }
        }

        if (page.loadingMore) {
            item(key = "page-loading") { PostSkeleton() }
        }

        if (page.atEnd && page.items.isNotEmpty()) {
            item(key = "end") {
                Text(
                    text = stringResource(R.string.feed_end),
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
 * FEED-FR-001/004 — two tabs, and no third.
 *
 * There is no "For you". The feed is reverse chronological with no ranking
 * anywhere in the product, and a tab implying otherwise would advertise a
 * product decision that was deliberately not taken.
 *
 * `selectable` with [Role.Tab] rather than a clickable Box, so a screen reader
 * announces "selected" — which is the only thing distinguishing the two tabs for
 * a reader who cannot see the colour (§35).
 */
@Composable
private fun FeedTabRow(selected: FeedTab, onSelect: (FeedTab) -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(MohallaTheme.colors.SurfacePrimary)
            .padding(horizontal = MohallaTheme.screenMargin),
    ) {
        FeedTab.entries.forEach { tab ->
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
                            FeedTab.FOLLOWING -> R.string.feed_following
                            FeedTab.DISCOVER -> R.string.feed_discover
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

/** FEED-FR-002 · NOTIF-FR-005 — announcements, above everything. */
@Composable
private fun FeaturedStrip(
    featured: List<FeaturedItemResponse>,
    onOpen: (String) -> Unit,
) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space2),
    ) {
        Text(
            text = stringResource(R.string.feed_featured),
            style = MohallaTheme.text(MohallaType.Label),
            color = MohallaTheme.colors.TextTertiary,
            modifier = Modifier.semantics { heading() },
        )

        featured.forEach { item ->
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(
                        MohallaTheme.colors.BrandPrimarySubtle,
                        MohallaTheme.radius.ShapeMd,
                    )
                    .defaultMinSize(minHeight = MohallaTheme.spacing.Space12)
                    .selectable(selected = false, onClick = { onOpen(item.id) })
                    .padding(MohallaTheme.spacing.Space3),
                verticalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space1),
            ) {
                Text(
                    text = item.title,
                    style = MohallaTheme.text(MohallaType.Title),
                    color = MohallaTheme.colors.BrandPrimary,
                )
                Text(
                    text = item.body,
                    style = MohallaTheme.text(MohallaType.BodySm),
                    color = MohallaTheme.colors.TextSecondary,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}

/**
 * An empty feed — one composable for both tabs, differing only in copy and in
 * whether there is anything useful to offer.
 *
 * Featured still renders above it, so even this screen is not blank.
 */
@Composable
private fun EmptyFeed(
    featured: List<FeaturedItemResponse>,
    title: String,
    body: String,
    onOpenAnnouncement: (String) -> Unit,
    actions: @Composable (() -> Unit)? = null,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = MohallaTheme.screenMargin)
            .padding(top = MohallaTheme.spacing.Space3),
        verticalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space3),
    ) {
        if (featured.isNotEmpty()) FeaturedStrip(featured, onOpenAnnouncement)

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

        actions?.invoke()
    }
}

/**
 * The first page failed.
 *
 * Each failure gets the state that names what the reader can do about it —
 * offline says so, rate-limited says wait — but they all offer the same retry,
 * and none reveals anything about the request beyond that (UX-STATE-001).
 */
@Composable
private fun FirstPageFailure(failure: ApiFailure, onRetry: () -> Unit) {
    when (failure) {
        ApiFailure.Offline -> OfflineState(onRetry = onRetry)
        is ApiFailure.RateLimited -> RateLimitedState(onRetry = onRetry)
        is ApiFailure.Server -> ServerErrorState(
            correlationId = failure.correlationId,
            onRetry = onRetry,
        )
        // Validation, Unauthenticated, Restricted, Conflict and Unavailable
        // cannot describe a feed request in any way the reader could act on, so
        // they get the generic recoverable error rather than five variations of
        // "something went wrong".
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
            text = stringResource(R.string.feed_page_failed),
            style = MohallaTheme.text(MohallaType.BodySm),
            color = MohallaTheme.colors.TextSecondary,
        )
        MohallaSecondaryButton(
            text = stringResource(R.string.action_retry),
            onClick = onRetry,
        )
    }
}

/**
 * The first-page skeleton (UI/UX §34: skeletons, never spinners, for anything
 * whose shape is already known).
 *
 * A skeleton says what is coming and does not reflow when it arrives. Featured
 * renders above it whenever it has already loaded, because the two requests are
 * independent — a skeleton that hid a ready announcement would be a spinner
 * wearing a better costume.
 */
@Composable
private fun FeedSkeleton(
    featured: List<FeaturedItemResponse>,
    onOpenAnnouncement: (String) -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = MohallaTheme.screenMargin)
            .padding(top = MohallaTheme.spacing.Space3),
        verticalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space3),
    ) {
        if (featured.isNotEmpty()) FeaturedStrip(featured, onOpenAnnouncement)
        repeat(SKELETON_CARDS) { PostSkeleton() }
    }
}

/**
 * One skeleton card, built from the same tokens as the real one.
 *
 * The bars are sized by FRACTION rather than by width. A skeleton needs bars of
 * unequal length to read as text, and the obvious way to get that is `140.dp`
 * and `90.dp` — but those are not on the 4dp scale (§17: "any value not on this
 * scale is a defect"), and a fixed width would also not adapt to a wider screen.
 * A fraction of the available width is direction-agnostic and scale-free.
 */
@Composable
private fun PostSkeleton() {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(MohallaTheme.colors.SurfacePrimary, MohallaTheme.radius.ShapeLg)
            .padding(MohallaTheme.spacing.Space4),
        verticalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space3),
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space2),
        ) {
            // The same 48dp as the real avatar, so nothing shifts on arrival.
            Box(
                Modifier
                    .size(MohallaTheme.spacing.Space12)
                    .background(MohallaTheme.colors.SurfaceSunken, CircleShape),
            )
            Column(
                modifier = Modifier.fillMaxWidth(),
                verticalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space1),
            ) {
                SkeletonBar(fraction = 0.45f)
                SkeletonBar(fraction = 0.3f)
            }
        }
        SkeletonBar(fraction = 1f)
        SkeletonBar(fraction = 1f)
        SkeletonBar(fraction = 0.6f)
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
 * How many items from the end the next page is requested.
 *
 * Three, not one. NFR-PERF-001 budgets 3 seconds for a feed page on 3G, and a
 * card is roughly a third of a 720×1280 screen — so three items of runway is
 * about one screen of scrolling, which is the most time the request can be given
 * without fetching pages the reader never reaches.
 */
private const val PREFETCH_DISTANCE = 3

/** Three cards is about one screenful on the 720×1280 baseline (NFR-COMP-002). */
private const val SKELETON_CARDS = 3
