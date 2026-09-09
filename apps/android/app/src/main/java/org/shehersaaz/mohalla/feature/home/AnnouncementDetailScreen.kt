package org.shehersaaz.mohalla.feature.home

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import org.shehersaaz.mohalla.R
import org.shehersaaz.mohalla.core.design.MohallaTheme
import org.shehersaaz.mohalla.core.design.MohallaType
import org.shehersaaz.mohalla.core.network.FeaturedItemResponse
import org.shehersaaz.mohalla.core.ui.ContentUnavailable
import org.shehersaaz.mohalla.core.ui.MohallaBackHeader

/**
 * UX-HOME-006 — an administrator's announcement, in full (FEED-FR-002).
 *
 * WHY THIS SCREEN NEEDED BUILDING. `onOpenAnnouncement = {}` — an empty lambda
 * in the navigation graph. So the Featured strip's cards and every ANNOUNCEMENT
 * notification were tappable and inert: the one kind of message the platform
 * sends to everybody had nowhere to open. It is the same shape as group 20's
 * revocation callback and group 23's three uncalled methods, and it is the last
 * of them.
 *
 * IT READS FROM DATA THE CLIENT ALREADY HAS, and that is deliberate rather than
 * a shortcut. `GET /feed/featured` returns each announcement's `id`, `title`,
 * `body` and `expiresAt` — the whole thing. There is no public
 * `GET /announcements/{id}`: the only single-announcement routes Stage 6 serves
 * are under `/admin/`, which the Stage 7 brief and §49 both exclude. So adding a
 * fetch here would mean either calling an admin route from the app or asking
 * Stage 6 for an endpoint whose data is already on the device.
 *
 * WHAT THAT COSTS, AND WHY IT IS ACCEPTABLE. A deep link straight to an
 * announcement whose id is not in the current featured page cannot render it.
 * That is not reachable in practice: FEED-FR-002 caps the strip at five, the
 * notification arrives while the announcement is live, and §42's link shapes do
 * not include announcements. When it does happen the answer is
 * [ContentUnavailable] — BR-025's neutral absence, which is also exactly right
 * for an announcement that has expired between the tap and the read.
 *
 * THE EXPIRY IS NOT SHOWN. FEED-FR-002 makes expiry the mechanism by which an
 * announcement leaves the strip — "expired announcements drop out
 * automatically" — not information for the reader. A date on the card would
 * invite somebody to plan around a deadline the announcement itself may not
 * mention.
 */
@Composable
fun AnnouncementDetailScreen(
    announcement: FeaturedItemResponse?,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .background(MohallaTheme.colors.BgPrimary),
    ) {
        MohallaBackHeader(
            title = stringResource(R.string.announcement_title),
            onBack = onBack,
        )

        if (announcement == null) {
            // Expired between the tap and the read, or an id this page does not
            // hold. Neutral either way — see the class comment.
            ContentUnavailable()
            return@Column
        }

        // SCROLLS, because an announcement has no length limit the client can
        // rely on and RUNTIME-006 was exactly this mistake one screen over: a
        // `Column(fillMaxSize())` silently drops whatever does not fit, and at
        // 130% font scale in Urdu that was two buttons.
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = MohallaTheme.screenMargin)
                .padding(bottom = MohallaTheme.spacing.Space10),
            verticalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space3),
        ) {
            Spacer(Modifier.height(MohallaTheme.spacing.Space6))

            Text(
                text = announcement.title,
                style = MohallaTheme.text(MohallaType.H2),
                color = MohallaTheme.colors.TextPrimary,
                modifier = Modifier.semantics { heading() },
            )

            Text(
                text = announcement.body,
                style = MohallaTheme.text(MohallaType.Body),
                color = MohallaTheme.colors.TextPrimary,
            )
        }
    }
}
