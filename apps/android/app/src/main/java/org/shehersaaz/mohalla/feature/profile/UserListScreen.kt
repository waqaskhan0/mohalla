package org.shehersaaz.mohalla.feature.profile

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import org.shehersaaz.mohalla.R
import org.shehersaaz.mohalla.core.design.MohallaTheme
import org.shehersaaz.mohalla.core.design.MohallaType
import org.shehersaaz.mohalla.core.network.ApiFailure
import org.shehersaaz.mohalla.core.ui.ContentUnavailable
import org.shehersaaz.mohalla.core.ui.MohallaBackHeader
import org.shehersaaz.mohalla.core.ui.OfflineState
import org.shehersaaz.mohalla.core.ui.ServerErrorState
import org.shehersaaz.mohalla.core.ui.UserRow

/**
 * Followers and Following — UX-PROFILE-004 · UX-PROFILE-005
 * (SOCIAL-FR-003/004).
 *
 * ONE SCREEN FOR TWO LISTS. They differ in a title and an endpoint; everything
 * else — the row, the page size, the `before` cursor, the empty state, the
 * failure state — is identical.
 *
 * THE ROW IS THE SHARED `UserRow`, which is the point of having one. §18 lists
 * it once as a component because the same four facts appear in five places, and
 * PROFILE-FR-007 makes that structural rather than tidy: a badge revoked by an
 * administrator disappears from search, followers, the inbox and a profile at
 * the same moment, because all five read one projection through one component.
 *
 * NO FOLLOW BUTTON ON THESE ROWS, and that is a decision rather than an
 * omission. Nothing in the API says whether the viewer already follows any of
 * these people (GAP-M-011), so twenty rows would each carry a control whose
 * resting state is a guess — twenty guesses on one screen, where a profile shows
 * one. Tapping through to the profile gives the same action with the same
 * accuracy and without the wall of maybe-wrong buttons.
 */
@Composable
fun UserListScreen(
    state: UserListUiState,
    onBack: () -> Unit,
    onOpenUser: (String) -> Unit,
    onRetry: () -> Unit,
    onLoadMore: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .background(MohallaTheme.colors.BgPrimary),
    ) {
        MohallaBackHeader(
            title = stringResource(
                when (state.kind) {
                    UserListKind.FOLLOWERS -> R.string.profile_stat_followers
                    UserListKind.FOLLOWING -> R.string.profile_stat_following
                },
            ),
            onBack = onBack,
        )

        when {
            // BR-025 — the profile itself is unavailable, so its lists are too,
            // and the answer is the same neutral one.
            state.firstPageFailure is ApiFailure.Unavailable -> ContentUnavailable()

            state.firstPageFailure != null && state.users.isEmpty() ->
                ListFailure(failure = state.firstPageFailure, onRetry = onRetry)

            state.loadingFirst && state.users.isEmpty() -> ListSkeleton()

            state.isEmpty -> EmptyList(kind = state.kind)

            else -> LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(
                    horizontal = MohallaTheme.screenMargin,
                    vertical = MohallaTheme.spacing.Space2,
                ),
            ) {
                items(state.users, key = { it.userId }) { user ->
                    UserRow(user = user, onClick = { onOpenUser(user.userId) })
                }

                if (!state.atEnd) {
                    item(key = "more") {
                        LaunchedEffect(state.nextBefore) { onLoadMore() }
                        Box(
                            Modifier
                                .fillMaxWidth()
                                .height(MohallaTheme.spacing.Space16),
                        )
                    }
                }
            }
        }
    }
}

/**
 * Nobody here — and only when the request actually said so.
 *
 * "No followers yet" after a timeout is a statement about somebody's standing in
 * their neighbourhood that the request never established, which is why
 * `isEmpty` requires a loaded page and no failure.
 */
@Composable
private fun EmptyList(kind: UserListKind) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = MohallaTheme.screenMargin),
        verticalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space3),
    ) {
        Spacer(Modifier.height(MohallaTheme.spacing.Space10))

        Text(
            text = stringResource(
                when (kind) {
                    UserListKind.FOLLOWERS -> R.string.profile_no_followers
                    UserListKind.FOLLOWING -> R.string.profile_no_following
                },
            ),
            style = MohallaTheme.text(MohallaType.H3),
            color = MohallaTheme.colors.TextPrimary,
            modifier = Modifier.semantics { heading() },
        )
    }
}

@Composable
private fun ListFailure(failure: ApiFailure, onRetry: () -> Unit) {
    when (failure) {
        ApiFailure.Offline -> OfflineState(onRetry = onRetry)
        else -> ServerErrorState(
            correlationId = (failure as? ApiFailure.Server)?.correlationId,
            onRetry = onRetry,
        )
    }
}

@Composable
private fun ListSkeleton() {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(MohallaTheme.screenMargin),
        verticalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space4),
    ) {
        repeat(SKELETON_ROWS) {
            Box(
                Modifier
                    .fillMaxWidth()
                    .height(MohallaTheme.spacing.Space12)
                    .background(MohallaTheme.colors.SurfaceSunken, MohallaTheme.radius.ShapeMd),
            )
        }
    }
}

private const val SKELETON_ROWS = 8
