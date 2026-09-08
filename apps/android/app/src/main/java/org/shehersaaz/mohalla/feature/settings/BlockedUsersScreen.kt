package org.shehersaaz.mohalla.feature.settings

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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import java.time.ZoneId
import java.util.Locale
import org.shehersaaz.mohalla.R
import org.shehersaaz.mohalla.core.design.MohallaTheme
import org.shehersaaz.mohalla.core.design.MohallaType
import org.shehersaaz.mohalla.core.format.EventTimes
import org.shehersaaz.mohalla.core.network.ApiFailure
import org.shehersaaz.mohalla.core.ui.FailureState
import org.shehersaaz.mohalla.core.ui.MohallaBackHeader
import org.shehersaaz.mohalla.core.ui.MohallaTextButton

/**
 * Blocked accounts — UX-SET-005 (SET-FR-003 · SAFETY-FR-006/007).
 *
 * THE ROWS CANNOT CARRY NAMES. `GET /me/blocks` returns an id and a date, and
 * `GET /users/{id}` answers the neutral 404 for anybody blocked in either
 * direction — which is every row here. There is no request that would name these
 * people, so the screen shows WHEN each block was made, newest first, and says
 * plainly at the top that names are not shown. GAP-M-013.
 *
 * SAYING SO IS BETTER THAN LOOKING BROKEN. A list of identical unlabelled rows
 * with no explanation reads as a bug; the same list with a line explaining it
 * reads as a limitation, and the reader can still act on the one they blocked
 * most recently.
 *
 * THE EMPTY STATE IS A GOOD STATE AND OFFERS NO ACTION. Nobody blocked is the
 * outcome to hope for, and a screen that suggested blocking somebody would be
 * absurd.
 */
@Composable
fun BlockedUsersScreen(
    state: BlockedUsersUiState,
    onBack: () -> Unit,
    onUnblock: (String) -> Unit,
    onRetry: () -> Unit,
    onLoadMore: () -> Unit,
    locale: Locale,
    zone: ZoneId,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .background(MohallaTheme.colors.BgPrimary),
    ) {
        MohallaBackHeader(
            title = stringResource(R.string.settings_blocked_users),
            onBack = onBack,
        )

        if (state.actionFailed) {
            Text(
                text = stringResource(R.string.blocked_unblock_failed),
                style = MohallaTheme.text(MohallaType.BodySm),
                color = MohallaTheme.colors.Error,
                modifier = Modifier.padding(
                    horizontal = MohallaTheme.screenMargin,
                    vertical = MohallaTheme.spacing.Space2,
                ),
            )
        }

        when {
            state.firstPageFailure != null && state.blocks.isEmpty() ->
                BlockedFailure(failure = state.firstPageFailure, onRetry = onRetry)

            state.loadingFirst && state.blocks.isEmpty() -> BlockedSkeleton()

            state.isEmpty -> EmptyBlocked()

            else -> LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(bottom = MohallaTheme.spacing.Space8),
            ) {
                item(key = "explainer") {
                    Text(
                        text = stringResource(R.string.blocked_no_names),
                        style = MohallaTheme.text(MohallaType.BodySm),
                        color = MohallaTheme.colors.TextSecondary,
                        modifier = Modifier.padding(
                            horizontal = MohallaTheme.screenMargin,
                            vertical = MohallaTheme.spacing.Space3,
                        ),
                    )
                }

                items(state.blocks, key = { it.blockedUserId }) { block ->
                    BlockedRow(
                        blockedAt = EventTimes.dateLine(block.createdAt, locale, zone),
                        acting = block.blockedUserId in state.acting,
                        onUnblock = { onUnblock(block.blockedUserId) },
                    )
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
 * One block.
 *
 * NO ID IS RENDERED. A raw UUID would be the only other distinguishing mark
 * available and it identifies nobody a reader could recognise — it would be
 * technical noise on a safety screen, and on a shared phone it would put a
 * stranger's account identifier on display for no benefit.
 */
@Composable
private fun BlockedRow(
    blockedAt: String?,
    acting: Boolean,
    onUnblock: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .defaultMinSize(minHeight = MohallaTheme.spacing.Space12)
            .padding(
                horizontal = MohallaTheme.screenMargin,
                vertical = MohallaTheme.spacing.Space2,
            ),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space3),
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = stringResource(R.string.blocked_account),
                style = MohallaTheme.text(MohallaType.Body),
                color = MohallaTheme.colors.TextPrimary,
            )
            if (blockedAt != null) {
                Text(
                    text = stringResource(R.string.blocked_since, blockedAt),
                    style = MohallaTheme.text(MohallaType.Caption),
                    color = MohallaTheme.colors.TextSecondary,
                )
            }
        }

        MohallaTextButton(
            text = stringResource(R.string.blocked_unblock),
            onClick = onUnblock,
            enabled = !acting,
        )
    }
}

@Composable
private fun EmptyBlocked() {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = MohallaTheme.screenMargin),
        verticalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space3),
    ) {
        Spacer(Modifier.height(MohallaTheme.spacing.Space10))

        Text(
            text = stringResource(R.string.blocked_empty_title),
            style = MohallaTheme.text(MohallaType.H3),
            color = MohallaTheme.colors.TextPrimary,
            modifier = Modifier.semantics { heading() },
        )
        Text(
            text = stringResource(R.string.blocked_empty_body),
            style = MohallaTheme.text(MohallaType.Body),
            color = MohallaTheme.colors.TextSecondary,
        )
    }
}

@Composable
private fun BlockedFailure(failure: ApiFailure, onRetry: () -> Unit) {
    FailureState(failure = failure, onRetry = onRetry)
}

@Composable
private fun BlockedSkeleton() {
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

private const val SKELETON_ROWS = 5
