package org.shehersaaz.mohalla.feature.auth

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import org.shehersaaz.mohalla.R
import org.shehersaaz.mohalla.core.design.MohallaTheme
import org.shehersaaz.mohalla.core.design.MohallaType
import org.shehersaaz.mohalla.core.ui.MohallaButton
import org.shehersaaz.mohalla.core.ui.MohallaSecondaryButton

/**
 * UX-AUTH-003 — Welcome.
 *
 * The destination for no session, a rejected session, and a BANNED or DELETED
 * account. That last part is the design: SEC-006 requires a banned account to
 * be indistinguishable from no account, so there is no banner here, no
 * explanation, and nothing that differs from a first-ever launch. A screen that
 * said "your account has been suspended" would undo the whole uniform-response
 * design the backend was built around.
 *
 * TWO ACTIONS ONLY. Phone identity is mandatory in V1 (§11), so there is no
 * social sign-in, no email path, and no "continue as guest" — reading the feed
 * still requires an account.
 */
@Composable
fun WelcomeScreen(
    onCreateAccount: () -> Unit,
    onLogIn: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .background(MohallaTheme.colors.BgPrimary)
            .padding(horizontal = MohallaTheme.screenMargin)
            .padding(top = MohallaTheme.spacing.Space16, bottom = MohallaTheme.spacing.Space8),
        verticalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space3),
    ) {
        Text(
            text = stringResource(R.string.app_name),
            // `display = true` selects Nastaliq in Urdu — one of the four
            // approved display placements, and comfortably above the 18sp floor
            // (04-mobile-architecture §3).
            style = MohallaTheme.text(MohallaType.Display, display = true),
            color = MohallaTheme.colors.BrandPrimary,
            modifier = Modifier.semantics { heading() },
        )
        Text(
            text = stringResource(R.string.welcome_tagline),
            style = MohallaTheme.text(MohallaType.H2),
            color = MohallaTheme.colors.TextPrimary,
        )
        Text(
            text = stringResource(R.string.welcome_body),
            style = MohallaTheme.text(MohallaType.BodyLg),
            color = MohallaTheme.colors.TextSecondary,
        )

        // Pushes the actions to the bottom without a fixed height, so the
        // layout survives 130% font scale by shrinking this gap rather than
        // clipping the buttons.
        Spacer(Modifier.weight(1f))

        MohallaButton(
            text = stringResource(R.string.welcome_create_account),
            onClick = onCreateAccount,
            modifier = Modifier.fillMaxWidth(),
        )
        MohallaSecondaryButton(
            text = stringResource(R.string.welcome_log_in),
            onClick = onLogIn,
            modifier = Modifier.fillMaxWidth(),
        )
    }
}
