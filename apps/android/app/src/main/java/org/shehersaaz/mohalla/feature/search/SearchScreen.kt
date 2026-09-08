package org.shehersaaz.mohalla.feature.search

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
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import java.time.ZoneId
import java.util.Locale
import org.shehersaaz.mohalla.R
import org.shehersaaz.mohalla.core.design.MohallaTheme
import org.shehersaaz.mohalla.core.design.MohallaType
import org.shehersaaz.mohalla.core.network.EventResponse
import org.shehersaaz.mohalla.core.network.FeedItemResponse
import org.shehersaaz.mohalla.core.ui.EventCard
import org.shehersaaz.mohalla.core.ui.MohallaSecondaryButton
import org.shehersaaz.mohalla.core.ui.PostCard
import org.shehersaaz.mohalla.core.ui.UserRow

/**
 * Search — UX-SEARCH-001 · UX-SEARCH-002 · UX-SEARCH-003
 * (SEARCH-FR-001…005 · PRIV-011).
 *
 * ONE SCREEN FOR THREE SPEC ENTRIES. UX-SEARCH-001 is the field plus the recent
 * searches, UX-SEARCH-002 is the People results and UX-SEARCH-003 is Posts and
 * Events — but they are one surface with one query field, and a reader moving
 * between them is refining a search rather than navigating. Splitting them would
 * mean the field's contents crossing a navigation boundary.
 *
 * THE MOST IMPORTANT BRANCH ON THIS SCREEN IS FAILED-VERSUS-EMPTY, and
 * SEARCH-FR-003 spells out why in its own acceptance criterion: "GIVEN the
 * search service is unavailable WHEN a query is submitted THEN an explicit
 * service-unavailable state is shown and NEVER an empty-results state." A zero
 * results page after an outage tells somebody the content does not exist — and
 * this is the screen people use to ask "did anyone raise this before?", so that
 * answer can convince a person nobody did when in fact they did.
 *
 * THE EMPTY STATE SUGGESTS ALTERNATIVE SPELLINGS, which §21 asks for and which
 * only makes sense once the search has actually run: on a platform where the
 * same word is written in two scripts, "try the other spelling" is good advice
 * after a successful empty search and useless advice after a failure.
 */
@Composable
fun SearchScreen(
    state: SearchUiState,
    locale: Locale,
    zone: ZoneId,
    onQueryChanged: (String) -> Unit,
    onSubmit: () -> Unit,
    onSelectTab: (SearchTab) -> Unit,
    onLoadMore: () -> Unit,
    onRetry: () -> Unit,
    onPickRecent: (String) -> Unit,
    onRemoveRecent: (String) -> Unit,
    onClearRecents: () -> Unit,
    onOpenPerson: (String) -> Unit,
    onOpenPost: (String) -> Unit,
    onOpenEvent: (String) -> Unit,
    onBack: () -> Unit,
    isUrdu: Boolean,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .background(MohallaTheme.colors.BgPrimary)
            .imePadding(),
    ) {
        SearchField(
            query = state.query,
            onQueryChanged = onQueryChanged,
            onSubmit = onSubmit,
            onClear = { onQueryChanged("") },
            onBack = onBack,
            isUrdu = isUrdu,
        )

        // UX-SEARCH-001. A query too short to run has nothing to show but the
        // history, which is where a one-character query belongs.
        if (state.showingRecents) {
            RecentSearchList(
                recents = state.recents,
                onPick = onPickRecent,
                onRemove = onRemoveRecent,
                onClearAll = onClearRecents,
            )
            return@Column
        }

        SearchTabRow(selected = state.tab, onSelect = onSelectTab)

        val tabState = state.current

        when {
            // NEVER an empty-results state. SEARCH-FR-003's acceptance
            // criterion, and the first branch for that reason.
            tabState.failure != null && !tabState.hasResults ->
                SearchFailureState(failure = tabState.failure, onRetry = onRetry)

            tabState.loading && !tabState.hasResults -> SearchSkeleton()

            tabState.isEmpty -> NoResults(tab = state.tab)

            else -> Results(
                state = state,
                tabState = tabState,
                locale = locale,
                zone = zone,
                onLoadMore = onLoadMore,
                onOpenPerson = onOpenPerson,
                onOpenPost = onOpenPost,
                onOpenEvent = onOpenEvent,
            )
        }
    }
}

/**
 * The query field (§18 — "search input").
 *
 * AUTO-FOCUSED, because the only reason to be on this screen is to type. §14
 * puts search in the Home top bar as an action rather than a tab precisely
 * because "search is an action performed against feed content, not a place" —
 * so arriving here and having to tap the field would be a wasted step.
 *
 * `ImeAction.Search` rather than `Done`, so the keyboard's action key says what
 * it does — and submitting from the keyboard is what records the query in the
 * on-device history.
 */
@Composable
private fun SearchField(
    query: String,
    onQueryChanged: (String) -> Unit,
    onSubmit: () -> Unit,
    onClear: () -> Unit,
    onBack: () -> Unit,
    isUrdu: Boolean,
) {
    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) { focus.requestFocus() }

    Column {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(MohallaTheme.colors.SurfacePrimary)
                .defaultMinSize(minHeight = FIELD_HEIGHT)
                .padding(horizontal = MohallaTheme.spacing.Space2),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space2),
        ) {
            Box(
                modifier = Modifier
                    .size(MohallaTheme.spacing.Space12)
                    .clickable(role = Role.Button, onClick = onBack),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    // Back IS directional, so the auto-mirrored variant: in
                    // Urdu, back is to the right.
                    imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                    contentDescription = stringResource(R.string.action_back),
                    tint = MohallaTheme.colors.TextSecondary,
                    modifier = Modifier.size(MohallaTheme.spacing.Space6),
                )
            }

            Icon(
                // A magnifier is not directional — it means the same thing in
                // both scripts — so it is not mirrored.
                imageVector = Icons.Filled.Search,
                contentDescription = null,
                tint = MohallaTheme.colors.TextTertiary,
                modifier = Modifier.size(MohallaTheme.spacing.Space5),
            )

            Box(modifier = Modifier.weight(1f)) {
                if (query.isEmpty()) {
                    Text(
                        text = stringResource(R.string.search_placeholder),
                        style = MohallaTheme.text(MohallaType.Body, display = isUrdu),
                        color = MohallaTheme.colors.TextSecondary,
                    )
                }
                BasicTextField(
                    value = query,
                    onValueChange = onQueryChanged,
                    singleLine = true,
                    textStyle = MohallaTheme.text(MohallaType.Body, display = isUrdu)
                        .copy(color = MohallaTheme.colors.TextPrimary),
                    cursorBrush = SolidColor(MohallaTheme.colors.BrandPrimary),
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                    keyboardActions = KeyboardActions(onSearch = { onSubmit() }),
                    modifier = Modifier
                        .fillMaxWidth()
                        .focusRequester(focus),
                )
            }

            if (query.isNotEmpty()) {
                Box(
                    modifier = Modifier
                        .size(MohallaTheme.spacing.Space12)
                        .clickable(role = Role.Button, onClick = onClear),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        imageVector = Icons.Filled.Close,
                        contentDescription = stringResource(R.string.search_clear),
                        tint = MohallaTheme.colors.TextTertiary,
                        modifier = Modifier.size(MohallaTheme.spacing.Space5),
                    )
                }
            }
        }

        Box(
            Modifier
                .fillMaxWidth()
                .height(HAIRLINE)
                .background(MohallaTheme.colors.BorderDefault),
        )
    }
}

/**
 * People · Posts · Events (§18.5 — "two or three segments only").
 *
 * Three, and the order is deliberate: People first because SEARCH-FR-001 is the
 * only *Must* of the three, and because "find the person who posted about this"
 * is the commonest reason to open search on a platform whose premise is that
 * neighbours speak under their own names.
 */
@Composable
private fun SearchTabRow(selected: SearchTab, onSelect: (SearchTab) -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(MohallaTheme.colors.SurfacePrimary)
            .padding(horizontal = MohallaTheme.screenMargin),
    ) {
        SearchTab.entries.forEach { tab ->
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
                            SearchTab.PEOPLE -> R.string.search_tab_people
                            SearchTab.POSTS -> R.string.search_tab_posts
                            SearchTab.EVENTS -> R.string.search_tab_events
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

@Composable
private fun Results(
    state: SearchUiState,
    tabState: SearchTabState,
    locale: Locale,
    zone: ZoneId,
    onLoadMore: () -> Unit,
    onOpenPerson: (String) -> Unit,
    onOpenPost: (String) -> Unit,
    onOpenEvent: (String) -> Unit,
) {
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(
            horizontal = MohallaTheme.screenMargin,
            vertical = MohallaTheme.spacing.Space3,
        ),
        verticalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space3),
    ) {
        when (state.tab) {
            SearchTab.PEOPLE -> items(tabState.people, key = { it.userId }) { person ->
                UserRow(user = person, onClick = { onOpenPerson(person.userId) })
            }

            SearchTab.POSTS -> items(tabState.posts, key = { it.id }) { post ->
                SearchPostCard(post = post, onOpen = { onOpenPost(post.id) })
            }

            SearchTab.EVENTS -> items(tabState.events, key = { it.id }) { event ->
                EventCard(
                    event = event,
                    onOpen = { onOpenEvent(event.id) },
                    locale = locale,
                    zone = zone,
                    // No RSVP controls in a search result. SEARCH-FR-004 ranks
                    // past events down rather than excluding them ("the
                    // upcoming list is a schedule, but search is a memory"), so
                    // half the rows here cannot be responded to — and a control
                    // that works on some rows and not others is worse than one
                    // that lives on the detail screen.
                    rsvpRow = null,
                )
            }
        }

        // A failure on a LATER page. What was already found stays on screen.
        if (tabState.failure != null && tabState.hasResults) {
            item(key = "page-error") {
                Column(
                    modifier = Modifier.fillMaxWidth(),
                    verticalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space2),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Text(
                        text = stringResource(R.string.search_more_failed),
                        style = MohallaTheme.text(MohallaType.BodySm),
                        color = MohallaTheme.colors.TextSecondary,
                    )
                    MohallaSecondaryButton(
                        text = stringResource(R.string.action_retry),
                        onClick = onLoadMore,
                    )
                }
            }
        }

        if (tabState.nextOffset != null) {
            item(key = "more") {
                MohallaSecondaryButton(
                    text = stringResource(R.string.search_load_more),
                    onClick = onLoadMore,
                    enabled = !tabState.loadingMore,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }
    }
}

/**
 * A post, as a search result.
 *
 * The full [PostCard] with its engagement controls disabled, rather than a
 * cut-down row: a result the reader recognises is one they can judge, and
 * SEARCH-FR-002 is "the platform's single largest advantage over WhatsApp,
 * where nothing is findable after the fact" — so a result needs to show enough
 * of the post to be recognisable as the thing being looked for.
 *
 * THE LIKE CONTROL IS INERT HERE. Liking from a search result would need the
 * optimistic-and-revert machinery of a feed, for an action nobody performs from
 * a list of search hits; tapping the card opens the post, where it works.
 */
@Composable
private fun SearchPostCard(post: FeedItemResponse, onOpen: () -> Unit) {
    PostCard(
        post = post,
        onOpen = onOpen,
        // Engagement from a search result opens the post instead of acting.
        onToggleLike = onOpen,
        onOpenAuthor = onOpen,
        onShare = onOpen,
        likePending = true,
    )
}

/**
 * UX-SEARCH-001 — the recent searches (SEARCH-FR-005 · PRIV-011).
 *
 * ON THE DEVICE ONLY, and the screen says so. PRIV-011 is absolute: "never
 * transmitted to or retained on the server", and telling the reader that is
 * worth a line — a search history is a list of what somebody is worried about
 * and who they are checking on, and on a civic platform the reassurance is the
 * feature.
 *
 * EACH ROW CAN BE REMOVED INDIVIDUALLY as well as in bulk. Somebody who looked
 * up a name they would rather not leave on the screen of a shared phone should
 * not have to discard the whole history to remove it.
 */
@Composable
private fun RecentSearchList(
    recents: List<String>,
    onPick: (String) -> Unit,
    onRemove: (String) -> Unit,
    onClearAll: () -> Unit,
) {
    if (recents.isEmpty()) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = MohallaTheme.screenMargin)
                .padding(top = MohallaTheme.spacing.Space10),
            verticalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space2),
        ) {
            Text(
                text = stringResource(R.string.search_hint_title),
                style = MohallaTheme.text(MohallaType.H3),
                color = MohallaTheme.colors.TextPrimary,
                modifier = Modifier.semantics { heading() },
            )
            Text(
                // The cross-script promise, stated where somebody about to type
                // can act on it (SEARCH-FR-003).
                text = stringResource(R.string.search_hint_body),
                style = MohallaTheme.text(MohallaType.Body),
                color = MohallaTheme.colors.TextSecondary,
            )
        }
        return
    }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(
            horizontal = MohallaTheme.screenMargin,
            vertical = MohallaTheme.spacing.Space3,
        ),
    ) {
        item(key = "recents-header") {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = stringResource(R.string.search_recent_title),
                    style = MohallaTheme.text(MohallaType.Label),
                    color = MohallaTheme.colors.TextSecondary,
                    modifier = Modifier
                        .weight(1f)
                        .semantics { heading() },
                )
                Text(
                    text = stringResource(R.string.search_recent_clear),
                    style = MohallaTheme.text(MohallaType.Label),
                    color = MohallaTheme.colors.BrandPrimary,
                    modifier = Modifier
                        .defaultMinSize(minHeight = MohallaTheme.spacing.Space12)
                        .clickable(role = Role.Button, onClick = onClearAll)
                        .padding(vertical = MohallaTheme.spacing.Space3),
                )
            }
        }

        items(recents, key = { it }) { query ->
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .defaultMinSize(minHeight = MohallaTheme.spacing.Space12),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space2),
            ) {
                Icon(
                    imageVector = Icons.Filled.Search,
                    contentDescription = null,
                    tint = MohallaTheme.colors.TextTertiary,
                    modifier = Modifier.size(MohallaTheme.spacing.Space5),
                )
                Text(
                    text = query,
                    style = MohallaTheme.text(MohallaType.Body),
                    color = MohallaTheme.colors.TextPrimary,
                    modifier = Modifier
                        .weight(1f)
                        .clickable(role = Role.Button, onClick = { onPick(query) })
                        .padding(vertical = MohallaTheme.spacing.Space3),
                )
                Box(
                    modifier = Modifier
                        .size(MohallaTheme.spacing.Space12)
                        .clickable(role = Role.Button, onClick = { onRemove(query) }),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        imageVector = Icons.Filled.Close,
                        contentDescription = stringResource(R.string.search_recent_remove, query),
                        tint = MohallaTheme.colors.TextTertiary,
                        modifier = Modifier.size(MohallaTheme.spacing.Space4),
                    )
                }
            }
        }

        item(key = "privacy") {
            Text(
                // PRIV-011, stated to the person it protects.
                text = stringResource(R.string.search_recent_device_only),
                style = MohallaTheme.text(MohallaType.Caption),
                color = MohallaTheme.colors.TextSecondary,
                modifier = Modifier.padding(top = MohallaTheme.spacing.Space3),
            )
        }
    }
}

/**
 * §21's copy: "no search results suggests alternative spellings
 * (Roman ↔ Urdu script)".
 *
 * ONLY REACHABLE AFTER A SUCCESSFUL SEARCH. That is what makes the advice
 * sound: on a platform where the same word is written in two scripts, "try the
 * other spelling" is genuinely the next thing to do — and after an outage it
 * would be advice for a problem the reader does not have.
 */
@Composable
private fun NoResults(tab: SearchTab) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = MohallaTheme.screenMargin)
            .padding(top = MohallaTheme.spacing.Space10),
        verticalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space2),
    ) {
        Text(
            text = stringResource(
                when (tab) {
                    SearchTab.PEOPLE -> R.string.search_empty_people
                    SearchTab.POSTS -> R.string.search_empty_posts
                    SearchTab.EVENTS -> R.string.search_empty_events
                },
            ),
            style = MohallaTheme.text(MohallaType.H3),
            color = MohallaTheme.colors.TextPrimary,
            modifier = Modifier.semantics { heading() },
        )
        Text(
            text = stringResource(R.string.search_empty_spelling_hint),
            style = MohallaTheme.text(MohallaType.Body),
            color = MohallaTheme.colors.TextSecondary,
        )
    }
}

/**
 * The state SEARCH-FR-003 requires instead of zero results.
 *
 * Its acceptance criterion is that an outage produces "an explicit
 * service-unavailable state… and never an empty-results state". The server's own
 * message is shown where it sent one — for a too-short query it STATES THE
 * MINIMUM, which the requirement asks for by name and which the client would
 * otherwise have to compose.
 */
@Composable
private fun SearchFailureState(failure: SearchFailure, onRetry: () -> Unit) {
    val (text, retryable) = when (failure) {
        is SearchFailure.Unavailable ->
            (failure.message ?: stringResource(R.string.search_unavailable)) to true

        SearchFailure.Offline -> stringResource(R.string.search_offline) to true

        // Not retryable as-is: the query itself is the problem, and a Try
        // again button would repeat the same refusal.
        is SearchFailure.QueryRefused ->
            (failure.message ?: stringResource(R.string.search_query_too_short)) to false

        is SearchFailure.Other ->
            (failure.failure.message ?: stringResource(R.string.state_error_body)) to true
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = MohallaTheme.screenMargin)
            .padding(top = MohallaTheme.spacing.Space10),
        verticalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space3),
    ) {
        Text(
            text = text,
            style = MohallaTheme.text(MohallaType.Body),
            color = MohallaTheme.colors.TextPrimary,
            modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
        )

        if (retryable) {
            MohallaSecondaryButton(
                text = stringResource(R.string.action_retry),
                onClick = onRetry,
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

/** Rows at the height of a user row, so nothing shifts when results land. */
@Composable
private fun SearchSkeleton() {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = MohallaTheme.screenMargin)
            .padding(top = MohallaTheme.spacing.Space3),
        verticalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space3),
    ) {
        repeat(SKELETON_ROWS) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .defaultMinSize(minHeight = MohallaTheme.spacing.Space16),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space3),
            ) {
                Box(
                    Modifier
                        .size(MohallaTheme.spacing.Space12)
                        .background(
                            MohallaTheme.colors.SurfaceSunken,
                            androidx.compose.foundation.shape.CircleShape,
                        ),
                )
                Column(
                    modifier = Modifier.weight(1f),
                    verticalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space1),
                ) {
                    Box(
                        Modifier
                            .fillMaxWidth(0.45f)
                            .height(MohallaTheme.spacing.Space3)
                            .background(
                                MohallaTheme.colors.SurfaceSunken,
                                MohallaTheme.radius.ShapeSm,
                            ),
                    )
                    Box(
                        Modifier
                            .fillMaxWidth(0.3f)
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

/** The same 56dp as the app bar it replaces. */
private val FIELD_HEIGHT: Dp = 56.dp

/** A drawn rule, not a gap — so not on the 4dp spacing scale. */
private val HAIRLINE: Dp = 1.dp

/** Four rows is about one screenful on the 720×1280 baseline. */
private const val SKELETON_ROWS = 4
