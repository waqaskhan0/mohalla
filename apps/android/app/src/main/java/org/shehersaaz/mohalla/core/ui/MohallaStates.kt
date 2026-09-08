package org.shehersaaz.mohalla.core.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import org.shehersaaz.mohalla.R
import org.shehersaaz.mohalla.core.design.MohallaTheme
import org.shehersaaz.mohalla.core.design.MohallaType

/**
 * The cross-cutting states, as four components used by every screen.
 *
 * WHY THEY ARE SHARED RATHER THAN PER-SCREEN. UX-STATE-001's whole purpose is
 * that a deleted post, a blocked author, an auto-hidden comment and an id that
 * never existed are INDISTINGUISHABLE. That property survives only if there is
 * one component: fifteen screens each writing their own "not available" copy is
 * fifteen chances for one of them to be more specific than the others, and the
 * more specific one is the leak (SEC-019, mandatory test A).
 *
 * So there is exactly one [ContentUnavailable], it takes no `reason`
 * parameter, and there is nothing to pass it that could distinguish the cases.
 */

/**
 * UX-STATE-001 — the neutral refusal.
 *
 * Takes no reason, and must not grow one. If a future caller needs to explain
 * *why* something is unavailable, that is a different screen with a different
 * requirement behind it, not a parameter here.
 */
@Composable
fun ContentUnavailable(modifier: Modifier = Modifier) {
    StateBlock(
        modifier = modifier,
        title = stringResource(R.string.state_unavailable_title),
        body = stringResource(R.string.state_unavailable_body),
    )
}

/** UX-STATE-002 — offline. Retry is offered because a retry may well work. */
@Composable
fun OfflineState(onRetry: (() -> Unit)? = null, modifier: Modifier = Modifier) {
    StateBlock(
        modifier = modifier,
        title = stringResource(R.string.state_offline_title),
        body = stringResource(R.string.state_offline_body),
        action = onRetry?.let { stringResource(R.string.action_retry) to it },
    )
}

/**
 * UX-STATE-003 — server error.
 *
 * The correlation id is shown when there is one, because SRS §16 lets a user
 * quote it to support. It is the only technical string the product ever puts on
 * screen, and SEC-018 permits exactly this one.
 */
@Composable
fun ServerErrorState(
    correlationId: String? = null,
    onRetry: (() -> Unit)? = null,
    modifier: Modifier = Modifier,
) {
    StateBlock(
        modifier = modifier,
        title = stringResource(R.string.state_error_title),
        body = stringResource(R.string.state_error_body),
        footnote = correlationId?.let { stringResource(R.string.state_error_reference, it) },
        action = onRetry?.let { stringResource(R.string.action_retry) to it },
    )
}

/** UX-STATE-004 — rate limited. */
@Composable
fun RateLimitedState(onRetry: (() -> Unit)? = null, modifier: Modifier = Modifier) {
    StateBlock(
        modifier = modifier,
        title = stringResource(R.string.state_rate_limited_title),
        body = stringResource(R.string.state_rate_limited_body),
        action = onRetry?.let { stringResource(R.string.action_retry) to it },
    )
}

/**
 * The shared shape of all four.
 *
 * `space-16` top offset and `space-10` vertical rhythm are UI/UX §17's
 * empty-state values, not chosen here.
 */
@Composable
private fun StateBlock(
    title: String,
    body: String,
    modifier: Modifier = Modifier,
    footnote: String? = null,
    action: Pair<String, () -> Unit>? = null,
) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .padding(horizontal = MohallaTheme.screenMargin)
            .padding(top = MohallaTheme.spacing.Space16),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space3),
    ) {
        Text(
            text = title,
            style = MohallaTheme.text(MohallaType.H3),
            color = MohallaTheme.colors.TextPrimary,
            textAlign = TextAlign.Center,
            // A heading, so a screen reader can jump to it and announces the
            // state rather than reading the body as loose prose (NFR-ACC-003).
            modifier = Modifier.semantics { heading() },
        )
        Text(
            text = body,
            style = MohallaTheme.text(MohallaType.Body),
            color = MohallaTheme.colors.TextSecondary,
            textAlign = TextAlign.Center,
        )
        if (footnote != null) {
            Spacer(Modifier.height(MohallaTheme.spacing.Space1))
            Text(
                text = footnote,
                style = MohallaTheme.text(MohallaType.Caption),
                color = MohallaTheme.colors.TextSecondary,
                textAlign = TextAlign.Center,
            )
        }
        if (action != null) {
            Spacer(Modifier.height(MohallaTheme.spacing.Space5))
            MohallaButton(text = action.first, onClick = action.second)
        }
    }
}

/**
 * The offline banner (§32) — persistent, above the content, never a toast.
 *
 * A toast would be the obvious choice and the wrong one: connectivity is a
 * CONDITION, not an event, and a message that disappears after three seconds
 * leaves the user wondering why their taps do nothing for the next ten minutes.
 */
@Composable
fun OfflineBanner(modifier: Modifier = Modifier) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .background(MohallaTheme.colors.WarningSubtle)
            .padding(
                horizontal = MohallaTheme.screenMargin,
                vertical = MohallaTheme.spacing.Space2,
            ),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space2),
    ) {
        // Colour is not the only carrier of state (§35): the dot is decorative
        // and the text says it, so a colour-blind user loses nothing.
        Box(
            Modifier
                .size(MohallaTheme.spacing.Space2)
                .background(MohallaTheme.colors.Warning, CircleShape),
        )
        Text(
            text = stringResource(R.string.state_offline_banner),
            style = MohallaTheme.text(MohallaType.Caption),
            color = MohallaTheme.colors.Warning,
        )
    }
}

/**
 * Loading.
 *
 * UI/UX §34 prefers skeletons to spinners for CONTENT — a skeleton says what is
 * coming and does not reflow when it arrives. This spinner is for the cases
 * where nothing about the shape is known yet: a form submitting, a startup
 * resolving. List and card skeletons are their own components.
 */
@Composable
fun LoadingState(modifier: Modifier = Modifier) {
    Box(
        modifier = modifier
            .fillMaxSize()
            // One announcement, not "progress bar, 0 percent" repeated.
            .clearAndSetSemantics {
                contentDescription = "loading"
            },
        contentAlignment = Alignment.Center,
    ) {
        CircularProgressIndicator(color = MohallaTheme.colors.BrandPrimary)
    }
}
