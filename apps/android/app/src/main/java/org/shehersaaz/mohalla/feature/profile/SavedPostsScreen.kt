package org.shehersaaz.mohalla.feature.profile

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import org.shehersaaz.mohalla.core.ui.MohallaBackHeader
import org.shehersaaz.mohalla.core.ui.OfflineState
import org.shehersaaz.mohalla.core.ui.PostCard
import org.shehersaaz.mohalla.core.ui.ServerErrorState

/**
 * Saved posts — UX-PROFILE-006 (FEED-FR-007).
 *
 * PRIVATE, AND NOTHING ON THIS SCREEN SAYS OTHERWISE. "Saving is private and
 * generates no notification to the author" — there is no route that reveals who
 * saved a post, so nothing here can leak and nothing needs to be hidden. The
 * empty state says so out loud, because a reader deciding whether to save
 * somebody's post deserves to know the author will not be told.
 *
 * MARKED "COULD" AND "CUTTABLE IF THE SCHEDULE TIGHTENS" by the UX spec, and
 * built anyway because the server side is complete: the list, the save and the
 * unsave are all live routes, and a shipped app with a Saved entry that opens
 * nothing would be worse than one without the entry.
 *
 * UNSAVE IS OFFERED HERE AND NOWHERE ELSE IS CERTAIN. Every row in this list is
 * saved by definition, so the control's state is known — which is the opposite
 * of the post detail screen, where nothing in the response says whether the post
 * is saved (GAP-M-012) and the toggle's resting position is a guess.
 */
@Composable
fun SavedPostsScreen(
    state: SavedPostsUiState,
    onBack: () -> Unit,
    onOpenPost: (String) -> Unit,
    onOpenAuthor: (String) -> Unit,
    onToggleLike: (String) -> Unit,
    onShare: (String) -> Unit,
    onOpenMedia: (List<String>, Int) -> Unit,
    onUnsave: (String) -> Unit,
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
            title = stringResource(R.string.profile_saved),
            onBack = onBack,
        )

        if (state.actionFailed) {
            Text(
                text = stringResource(R.string.saved_remove_failed),
                style = MohallaTheme.text(MohallaType.BodySm),
                color = MohallaTheme.colors.Error,
                modifier = Modifier.padding(
                    horizontal = MohallaTheme.screenMargin,
                    vertical = MohallaTheme.spacing.Space2,
                ),
            )
        }

        when {
            state.firstPageFailure != null && state.posts.isEmpty() ->
                SavedFailure(failure = state.firstPageFailure, onRetry = onRetry)

            state.loadingFirst && state.posts.isEmpty() -> SavedSkeleton()

            state.isEmpty -> EmptySaved()

            else -> LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(bottom = MohallaTheme.spacing.Space8),
            ) {
                items(state.posts, key = { it.id }) { post ->
                    Column {
                        PostCard(
                            post = post,
                            onOpen = { onOpenPost(post.id) },
                            onToggleLike = { onToggleLike(post.id) },
                            onOpenAuthor = { onOpenAuthor(post.author.userId) },
                            onShare = { onShare(post.id) },
                            onOpenMedia = { index -> onOpenMedia(post.mediaIds, index) },
                        )

                        // Under the card rather than inside it: `PostCard` is
                        // shared with the feed, the profile and search, and none
                        // of those can offer this control honestly.
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(horizontal = MohallaTheme.screenMargin),
                            horizontalArrangement = Arrangement.End,
                        ) {
                            TextButton(onClick = { onUnsave(post.id) }) {
                                Text(
                                    text = stringResource(R.string.saved_remove),
                                    style = MohallaTheme.text(MohallaType.Button),
                                    color = MohallaTheme.colors.TextSecondary,
                                )
                            }
                        }
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
    }
}

@Composable
private fun EmptySaved() {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = MohallaTheme.screenMargin),
        verticalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space3),
    ) {
        Spacer(Modifier.height(MohallaTheme.spacing.Space10))

        Text(
            text = stringResource(R.string.saved_empty_title),
            style = MohallaTheme.text(MohallaType.H3),
            color = MohallaTheme.colors.TextPrimary,
            modifier = Modifier.semantics { heading() },
        )
        Text(
            text = stringResource(R.string.saved_empty_body),
            style = MohallaTheme.text(MohallaType.Body),
            color = MohallaTheme.colors.TextSecondary,
        )
    }
}

@Composable
private fun SavedFailure(failure: ApiFailure, onRetry: () -> Unit) {
    when (failure) {
        ApiFailure.Offline -> OfflineState(onRetry = onRetry)
        else -> ServerErrorState(
            correlationId = (failure as? ApiFailure.Server)?.correlationId,
            onRetry = onRetry,
        )
    }
}

@Composable
private fun SavedSkeleton() {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(MohallaTheme.screenMargin),
        verticalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space4),
    ) {
        repeat(SKELETON_CARDS) {
            Box(
                Modifier
                    .fillMaxWidth()
                    .height(MohallaTheme.spacing.Space16)
                    .background(MohallaTheme.colors.SurfaceSunken, MohallaTheme.radius.ShapeMd),
            )
        }
    }
}

private const val SKELETON_CARDS = 3
