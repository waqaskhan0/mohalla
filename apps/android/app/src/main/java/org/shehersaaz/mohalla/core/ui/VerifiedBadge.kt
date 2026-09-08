package org.shehersaaz.mohalla.core.ui

import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import org.shehersaaz.mohalla.R
import org.shehersaaz.mohalla.core.design.MohallaTheme
import org.shehersaaz.mohalla.core.design.MohallaType

/**
 * The verified badge (PROFILE-FR-007 · ADMIN-FR-010).
 *
 * ONE COMPONENT, BECAUSE THE REQUIREMENT IS ABOUT CONSISTENCY ACROSS SURFACES.
 * PROFILE-FR-007: a granted badge "appears beside the display name on the
 * profile, on every post and comment, in search results and in the message
 * inbox", and "revocation removes it everywhere immediately". The removal half
 * is the server's — every surface renders the same projection — but the
 * appearance half is this file's, and it was previously three copies of the same
 * six lines drifting independently.
 *
 * TEXT, NOT ONLY A COLOURED MARK. §35: colour is never the only carrier of
 * meaning, so a reader who cannot distinguish the brand blue still reads the
 * word.
 *
 * GRANTED BY AN ADMINISTRATOR, NEVER IMPLIED BY ACCOUNT TYPE. PROFILE-FR-006:
 * "GIVEN an Organization account without a granted badge, WHEN it is viewed,
 * THEN no verified badge appears." Which is why every call site passes
 * `verifiedBadge` and none passes `accountType`.
 */
@Composable
fun VerifiedBadge(modifier: Modifier = Modifier) {
    Text(
        text = stringResource(R.string.badge_verified),
        style = MohallaTheme.text(MohallaType.Label),
        color = MohallaTheme.colors.BrandPrimary,
        modifier = modifier,
    )
}
