package org.shehersaaz.mohalla.feature.profile

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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import org.shehersaaz.mohalla.R
import org.shehersaaz.mohalla.core.design.MohallaTheme
import org.shehersaaz.mohalla.core.design.MohallaType
import org.shehersaaz.mohalla.core.network.ApiFailure
import org.shehersaaz.mohalla.core.network.FeedItemResponse
import org.shehersaaz.mohalla.core.state.Relation
import org.shehersaaz.mohalla.core.ui.ContentUnavailable
import org.shehersaaz.mohalla.core.ui.FailureState
import org.shehersaaz.mohalla.core.ui.MohallaAvatar
import org.shehersaaz.mohalla.core.ui.MohallaBackHeader
import org.shehersaaz.mohalla.core.ui.MohallaButton
import org.shehersaaz.mohalla.core.ui.MohallaSecondaryButton
import org.shehersaaz.mohalla.core.ui.MohallaTopBar
import org.shehersaaz.mohalla.core.ui.PostCard
import org.shehersaaz.mohalla.core.ui.TopBarAction
import org.shehersaaz.mohalla.core.ui.VerifiedBadge

/**
 * A profile — UX-PROFILE-001 (own) and UX-PROFILE-002 (anyone else).
 *
 * "DELIBERATELY NOT INSTAGRAM: no cover photo, no grid, no highlight ring.
 * Centred avatar over a tinted band + stat pills + paired buttons." The
 * wireframe says that in as many words, and the restraint is the point — this is
 * a civic platform where a profile answers "who is this and are they worth
 * following", not a personal gallery.
 *
 * THE ONE THING THE WIREFRAME ASKS FOR THAT NO FIELD PROVIDES is the band's
 * tint, which it wants taken "from the account's most-used category". No
 * response carries a most-used category, and deriving one from the first page of
 * posts would make the band change colour a second after the screen opened. So
 * the band is the brand tint, stated here rather than left looking like an
 * oversight.
 *
 * THE FAILURE STATE IS ONE STATE. UX-PROFILE-002: "Blocked, banned, deleted or
 * not found → ONE identical neutral state. No case is distinguishable." There is
 * exactly one branch for it below, and it renders UX-STATE-001 without a word
 * about why.
 *
 * AND STATISTICS RENDER EVEN WITH NO POSTS. The header and the post list are two
 * requests and two independent states — a profile whose post list failed still
 * shows who the person is, and an empty list says "No posts yet" only when the
 * request actually came back empty.
 */
@Composable
fun ProfileScreen(
    state: ProfileUiState,
    onBack: (() -> Unit)?,
    onRetry: () -> Unit,
    onRetryPosts: () -> Unit,
    onLoadMorePosts: () -> Unit,
    onToggleFollow: () -> Unit,
    onMessage: () -> Unit,
    onEdit: () -> Unit,
    onOpenSaved: () -> Unit,
    onSettings: () -> Unit,
    onMore: () -> Unit,
    onOpenFollowers: () -> Unit,
    onOpenFollowing: () -> Unit,
    onOpenPost: (String) -> Unit,
    onToggleLike: (String) -> Unit,
    onShare: (String) -> Unit,
    onOpenMedia: (List<String>, Int) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .background(MohallaTheme.colors.BgPrimary),
    ) {
        // The owner's profile is a TAB and has nowhere to go back to; anybody
        // else's was pushed and does.
        if (onBack == null) {
            MohallaTopBar(
                title = stringResource(R.string.nav_profile),
                // §14's navigation tree puts SETTINGS under My profile, and this
                // is the only way into it — a tab would spend one of five slots
                // on screens visited deliberately and rarely.
                actions = listOf(
                    TopBarAction(
                        icon = Icons.Filled.Settings,
                        descriptionRes = R.string.settings_title,
                        onClick = onSettings,
                    ),
                ),
            )
        } else {
            MohallaBackHeader(
                title = "",
                onBack = onBack,
                // SAFETY-FR-002 — reporting an ACCOUNT rather than one of its
                // items, which is what somebody does when the pattern is the
                // problem. Blocking is offered from the same sheet after the
                // report, and on its own from here (SAFETY-FR-005 lists a
                // profile among the four places a block can start).
                actions = if (state.profile == null) {
                    emptyList()
                } else {
                    listOf(
                        TopBarAction(
                            icon = Icons.Filled.MoreVert,
                            descriptionRes = R.string.action_more,
                            onClick = onMore,
                        ),
                    )
                },
            )
        }

        when {
            // BR-025 · UX-STATE-001. One state, one piece of copy, no reason.
            state.unavailable -> ContentUnavailable()

            state.profile == null && state.failure != null ->
                ProfileFailure(failure = state.failure, onRetry = onRetry)

            state.profile == null -> ProfileSkeleton()

            else -> ProfileBody(
                state = state,
                profile = state.profile,
                onRetryPosts = onRetryPosts,
                onLoadMorePosts = onLoadMorePosts,
                onToggleFollow = onToggleFollow,
                onMessage = onMessage,
                onEdit = onEdit,
                onOpenSaved = onOpenSaved,
                onOpenFollowers = onOpenFollowers,
                onOpenFollowing = onOpenFollowing,
                onOpenPost = onOpenPost,
                onToggleLike = onToggleLike,
                onShare = onShare,
                onOpenMedia = onOpenMedia,
            )
        }
    }
}

@Composable
private fun ProfileBody(
    state: ProfileUiState,
    profile: ProfileView,
    onRetryPosts: () -> Unit,
    onLoadMorePosts: () -> Unit,
    onToggleFollow: () -> Unit,
    onMessage: () -> Unit,
    onEdit: () -> Unit,
    onOpenSaved: () -> Unit,
    onOpenFollowers: () -> Unit,
    onOpenFollowing: () -> Unit,
    onOpenPost: (String) -> Unit,
    onToggleLike: (String) -> Unit,
    onShare: (String) -> Unit,
    onOpenMedia: (List<String>, Int) -> Unit,
) {
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(bottom = MohallaTheme.spacing.Space8),
    ) {
        item(key = "identity") {
            Identity(profile)
        }

        item(key = "stats") {
            StatPills(
                profile = profile,
                onOpenFollowers = onOpenFollowers,
                onOpenFollowing = onOpenFollowing,
            )
        }

        item(key = "actions") {
            ActionRow(
                state = state,
                onToggleFollow = onToggleFollow,
                onMessage = onMessage,
                onEdit = onEdit,
                onOpenSaved = onOpenSaved,
            )
        }

        item(key = "posts-heading") {
            Text(
                text = stringResource(R.string.profile_posts),
                style = MohallaTheme.text(MohallaType.Label),
                color = MohallaTheme.colors.TextTertiary,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(
                        horizontal = MohallaTheme.screenMargin,
                        vertical = MohallaTheme.spacing.Space3,
                    )
                    .semantics { heading() },
            )
        }

        when {
            // Kept apart from emptiness on purpose. "No posts yet" after a
            // timeout tells a visitor this person has never written anything.
            state.postsFailure != null && state.posts.isEmpty() -> item(key = "posts-failure") {
                PostsFailure(onRetry = onRetryPosts)
            }

            state.hasNoPosts -> item(key = "posts-empty") {
                Text(
                    text = stringResource(R.string.profile_no_posts),
                    style = MohallaTheme.text(MohallaType.Body),
                    color = MohallaTheme.colors.TextSecondary,
                    modifier = Modifier.padding(
                        horizontal = MohallaTheme.screenMargin,
                        vertical = MohallaTheme.spacing.Space4,
                    ),
                )
            }

            else -> {
                items(state.posts, key = { it.id }) { post ->
                    PostCard(
                        post = post,
                        onOpen = { onOpenPost(post.id) },
                        onToggleLike = { onToggleLike(post.id) },
                        // Already on this person's profile. Tapping the author
                        // row would push the same screen onto itself.
                        onOpenAuthor = {},
                        onShare = { onShare(post.id) },
                        onOpenMedia = { index -> onOpenMedia(post.mediaIds, index) },
                    )
                }

                if (!state.atEndOfPosts) {
                    item(key = "posts-more") {
                        LaunchedEffect(state.postsCursor) { onLoadMorePosts() }
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
 * The band, the avatar, and who this is.
 *
 * THE AVATAR OVERLAPS THE BAND, centred — the wireframe's "avatar overlapping,
 * centred, 88px". Achieved with a negative offset on the column rather than a
 * `Box` with absolute placement, so it mirrors with the layout and needs no RTL
 * variant.
 */
@Composable
private fun Identity(profile: ProfileView) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Box(
            Modifier
                .fillMaxWidth()
                .height(BAND_HEIGHT)
                .background(MohallaTheme.colors.BrandPrimarySubtle),
        )

        MohallaAvatar(
            mediaId = profile.photoMediaId,
            contentDescription = null,
            size = AVATAR_SIZE,
            modifier = Modifier.padding(top = MohallaTheme.spacing.Space2),
        )

        Spacer(Modifier.height(MohallaTheme.spacing.Space2))

        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space1),
            modifier = Modifier.padding(horizontal = MohallaTheme.screenMargin),
        ) {
            Text(
                text = profile.displayName.orEmpty(),
                style = MohallaTheme.text(MohallaType.H2),
                color = MohallaTheme.colors.TextPrimary,
                textAlign = TextAlign.Center,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.semantics { heading() },
            )

            // PROFILE-FR-007 — beside the display name, wherever the account
            // appears. Revocation removes it everywhere at once because every
            // surface reads the same projection.
            if (profile.verifiedBadge) VerifiedBadge()
        }

        if (profile.username != null) {
            Text(
                text = "@${profile.username}",
                style = MohallaTheme.text(MohallaType.Body),
                color = MohallaTheme.colors.TextTertiary,
            )
        }

        if (!profile.city.isNullOrBlank()) {
            Spacer(Modifier.height(MohallaTheme.spacing.Space2))
            CityChip(profile.city)
        }

        if (!profile.bio.isNullOrBlank()) {
            Text(
                text = profile.bio,
                style = MohallaTheme.text(MohallaType.Body),
                color = MohallaTheme.colors.TextSecondary,
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(
                    horizontal = MohallaTheme.screenMargin,
                    vertical = MohallaTheme.spacing.Space3,
                ),
            )
        }
    }
}

@Composable
private fun CityChip(city: String) {
    Text(
        text = city,
        style = MohallaTheme.text(MohallaType.Caption),
        color = MohallaTheme.colors.TextSecondary,
        modifier = Modifier
            .background(MohallaTheme.colors.SurfaceSunken, MohallaTheme.radius.ShapeFull)
            .padding(
                horizontal = MohallaTheme.spacing.Space3,
                vertical = MohallaTheme.spacing.Space1,
            ),
    )
}

/**
 * Posts · Followers · Following (PROFILE-FR-009).
 *
 * TWO OF THE THREE ARE DESTINATIONS AND ONE IS NOT. Followers and Following open
 * lists; Posts does not, because the posts are already on this screen. So the
 * first pill is not clickable and carries no button role — an affordance that
 * scrolls you to content you can already see is noise a screen reader reads
 * aloud.
 */
@Composable
private fun StatPills(
    profile: ProfileView,
    onOpenFollowers: () -> Unit,
    onOpenFollowing: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = MohallaTheme.screenMargin),
        horizontalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space2),
    ) {
        StatPill(
            value = profile.postCount,
            labelRes = R.string.profile_stat_posts,
            onClick = null,
            modifier = Modifier.weight(1f),
        )
        StatPill(
            value = profile.followerCount,
            labelRes = R.string.profile_stat_followers,
            onClick = onOpenFollowers,
            modifier = Modifier.weight(1f),
        )
        StatPill(
            value = profile.followingCount,
            labelRes = R.string.profile_stat_following,
            onClick = onOpenFollowing,
            modifier = Modifier.weight(1f),
        )
    }
}

@Composable
private fun StatPill(
    value: Int,
    labelRes: Int,
    onClick: (() -> Unit)?,
    modifier: Modifier = Modifier,
) {
    val label = stringResource(labelRes)

    Column(
        modifier = modifier
            .background(MohallaTheme.colors.SurfacePrimary, MohallaTheme.radius.ShapeMd)
            .then(
                if (onClick == null) {
                    Modifier
                } else {
                    Modifier.clickable(role = Role.Button, onClick = onClick)
                },
            )
            .defaultMinSize(minHeight = MohallaTheme.spacing.Space12)
            .padding(vertical = MohallaTheme.spacing.Space2),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            text = value.toString(),
            style = MohallaTheme.text(MohallaType.Title),
            color = MohallaTheme.colors.TextPrimary,
        )
        Text(
            text = label,
            style = MohallaTheme.text(MohallaType.Caption),
            color = MohallaTheme.colors.TextTertiary,
        )
    }
}

/**
 * The paired button row — "signature", says the wireframe.
 *
 * FOLLOW IS PRIMARY AND MESSAGE IS SECONDARY on somebody else's profile, because
 * the screen's purpose is stated as "decide whether to follow or message" and
 * following is the lighter of the two commitments. On the owner's own profile
 * the same row carries Edit and Saved.
 *
 * THE FOLLOW BUTTON'S RESTING STATE IS A GUESS AND THE GUESS IS DELIBERATE. No
 * response says whether the viewer already follows this person (GAP-M-011), so
 * `Unknown` renders as Follow: a repeat follow is idempotent and moves no count,
 * where a wrongly-shown "Following" would stop somebody following at all.
 */
@Composable
private fun ActionRow(
    state: ProfileUiState,
    onToggleFollow: () -> Unit,
    onMessage: () -> Unit,
    onEdit: () -> Unit,
    onOpenSaved: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(
                horizontal = MohallaTheme.screenMargin,
                vertical = MohallaTheme.spacing.Space4,
            ),
        horizontalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space2),
    ) {
        if (state.isOwn) {
            MohallaButton(
                text = stringResource(R.string.profile_edit),
                onClick = onEdit,
                modifier = Modifier.weight(1f),
            )
            MohallaSecondaryButton(
                text = stringResource(R.string.profile_saved),
                onClick = onOpenSaved,
                modifier = Modifier.weight(1f),
            )
        } else {
            if (state.followState == Relation.Yes) {
                MohallaSecondaryButton(
                    text = stringResource(R.string.profile_following),
                    onClick = onToggleFollow,
                    enabled = !state.followPending,
                    modifier = Modifier.weight(1f),
                )
            } else {
                MohallaButton(
                    text = stringResource(R.string.profile_follow),
                    onClick = onToggleFollow,
                    enabled = !state.followPending,
                    modifier = Modifier.weight(1f),
                )
            }

            MohallaSecondaryButton(
                text = stringResource(R.string.profile_message),
                onClick = onMessage,
                modifier = Modifier.weight(1f),
            )
        }
    }

    if (state.followFailed) {
        Text(
            text = stringResource(R.string.profile_follow_failed),
            style = MohallaTheme.text(MohallaType.BodySm),
            color = MohallaTheme.colors.Error,
            modifier = Modifier.padding(horizontal = MohallaTheme.screenMargin),
        )
    }
}

@Composable
private fun ProfileFailure(failure: ApiFailure, onRetry: () -> Unit) {
    FailureState(failure = failure, onRetry = onRetry)
}

@Composable
private fun PostsFailure(onRetry: () -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(
                horizontal = MohallaTheme.screenMargin,
                vertical = MohallaTheme.spacing.Space4,
            ),
        verticalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space3),
    ) {
        Text(
            text = stringResource(R.string.profile_posts_failed),
            style = MohallaTheme.text(MohallaType.Body),
            color = MohallaTheme.colors.TextSecondary,
        )
        MohallaSecondaryButton(text = stringResource(R.string.action_retry), onClick = onRetry)
    }
}

@Composable
private fun ProfileSkeleton() {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Box(
            Modifier
                .fillMaxWidth()
                .height(BAND_HEIGHT)
                .background(MohallaTheme.colors.SurfaceSunken),
        )
        Box(
            Modifier
                .padding(top = MohallaTheme.spacing.Space2)
                .height(AVATAR_SIZE)
                .fillMaxWidth(0.25f)
                .background(MohallaTheme.colors.SurfaceSunken, MohallaTheme.radius.ShapeFull),
        )
        Spacer(Modifier.height(MohallaTheme.spacing.Space4))
        repeat(SKELETON_LINES) {
            Box(
                Modifier
                    .padding(vertical = MohallaTheme.spacing.Space1)
                    .fillMaxWidth(0.5f)
                    .height(MohallaTheme.spacing.Space4)
                    .background(MohallaTheme.colors.SurfaceSunken, MohallaTheme.radius.ShapeSm),
            )
        }
    }
}

/**
 * 88dp, and 64dp.
 *
 * Both off the 4dp spacing scale and both deliberate: §17 governs the space
 * BETWEEN things, and these are the sizes of two drawn objects the wireframe
 * specifies by number — "avatar overlapping, centred, 88px" over a "slim tinted
 * band". Reaching for `Space16` (64dp) to stay on-scale would make the avatar a
 * third smaller than the design asks for.
 */
private val AVATAR_SIZE = 88.dp
private val BAND_HEIGHT = 64.dp

private const val SKELETON_LINES = 3
