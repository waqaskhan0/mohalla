package org.shehersaaz.mohalla.feature.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import org.shehersaaz.mohalla.R
import org.shehersaaz.mohalla.core.config.BuildEnvironment
import org.shehersaaz.mohalla.core.design.MohallaTheme
import org.shehersaaz.mohalla.core.design.MohallaType
import org.shehersaaz.mohalla.core.locale.AppLocale
import org.shehersaaz.mohalla.core.ui.MohallaBackHeader

/**
 * The settings index — UX-SET-001 (SET-FR-001…010).
 *
 * A LIST OF DESTINATIONS, AND IT RENDERS WITHOUT ITS REQUEST. Every row here is
 * a place that exists whether or not `GET /me/settings` came back; the request
 * supplies two SUBTITLES — the current language and the number of blocked
 * accounts. A settings screen replaced by an error page would strand somebody
 * who came here to sign out, which is exactly what they do when something is
 * wrong.
 *
 * THE ORDER IS THE SPEC'S NAVIGATION TREE, not alphabetical and not grouped by
 * how the code is organised: Language · Notifications · Change password ·
 * Blocked users · Community Guidelines · Terms and Privacy · Help · About ·
 * Log out · Delete account. Delete is last and visually separated, and Log out
 * sits above it — §6.7 puts a destructive Tier-3 action at the bottom, alone,
 * where it cannot be hit while reaching for the row above.
 */
@Composable
fun SettingsScreen(
    state: SettingsUiState,
    onBack: () -> Unit,
    onLanguage: () -> Unit,
    onNotifications: () -> Unit,
    onChangePassword: () -> Unit,
    onBlockedUsers: () -> Unit,
    onGuidelines: () -> Unit,
    onTerms: () -> Unit,
    onHelp: () -> Unit,
    onAbout: () -> Unit,
    onSignOut: () -> Unit,
    onDeleteAccount: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .background(MohallaTheme.colors.BgPrimary),
    ) {
        MohallaBackHeader(title = stringResource(R.string.settings_title), onBack = onBack)

        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(bottom = MohallaTheme.spacing.Space8),
        ) {
            SettingsRow(
                label = stringResource(R.string.settings_language),
                // The account's, then the device's — see `effectiveLanguage`.
                // A failed request leaves this null and the row still works.
                value = state.effectiveLanguage?.let { stringResource(it.labelRes) },
                onClick = onLanguage,
            )
            SettingsRow(
                label = stringResource(R.string.settings_notifications_title),
                value = null,
                onClick = onNotifications,
            )
            SettingsRow(
                label = stringResource(R.string.settings_change_password),
                value = null,
                onClick = onChangePassword,
            )
            SettingsRow(
                label = stringResource(R.string.settings_blocked_users),
                // A number the request did not supply is ABSENT, never zero:
                // "0 blocked" on a screen whose request failed is the most
                // alarming thing this row could say untruthfully.
                value = state.blockedCount.toString().takeIf { state.blockedCountKnown },
                onClick = onBlockedUsers,
            )

            SectionGap()

            SettingsRow(
                label = stringResource(R.string.settings_guidelines),
                value = null,
                onClick = onGuidelines,
            )
            SettingsRow(
                label = stringResource(R.string.settings_terms),
                value = null,
                onClick = onTerms,
            )
            SettingsRow(
                label = stringResource(R.string.settings_help),
                value = null,
                onClick = onHelp,
            )
            SettingsRow(
                label = stringResource(R.string.settings_about),
                value = BuildEnvironment.versionName,
                onClick = onAbout,
            )

            SectionGap()

            SettingsRow(
                label = stringResource(R.string.settings_sign_out),
                value = null,
                onClick = onSignOut,
                destructive = true,
            )

            // UX-SET-009 — "Settings, bottom of list, visually separated". §6.7
            // puts a Tier-3 destructive action alone at the end, where it cannot
            // be hit while reaching for the row above it.
            SectionGap()

            SettingsRow(
                label = stringResource(R.string.settings_delete_account),
                value = null,
                onClick = onDeleteAccount,
                destructive = true,
            )
        }
    }
}

@Composable
private fun SettingsRow(
    label: String,
    value: String?,
    onClick: () -> Unit,
    destructive: Boolean = false,
) {
    Column {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clickable(role = Role.Button, onClick = onClick)
                .defaultMinSize(minHeight = MohallaTheme.spacing.Space12)
                .padding(
                    horizontal = MohallaTheme.screenMargin,
                    vertical = MohallaTheme.spacing.Space3,
                ),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space3),
        ) {
            Text(
                text = label,
                style = MohallaTheme.text(MohallaType.Body),
                color = if (destructive) {
                    MohallaTheme.colors.Error
                } else {
                    MohallaTheme.colors.TextPrimary
                },
                modifier = Modifier.weight(1f),
            )

            if (value != null) {
                Text(
                    text = value,
                    style = MohallaTheme.text(MohallaType.Body),
                    color = MohallaTheme.colors.TextTertiary,
                )
            }
        }

        Box(
            Modifier
                .fillMaxWidth()
                .padding(start = MohallaTheme.screenMargin)
                .height(HAIRLINE)
                .background(MohallaTheme.colors.BorderDefault),
        )
    }
}

@Composable
private fun SectionGap() {
    Spacer(Modifier.height(MohallaTheme.spacing.Space6))
}

/**
 * Language — UX-SET-002 (SET-FR-001 · LOCALE-FR-002).
 *
 * TWO PEERS, NOT A LANGUAGE AND A FALLBACK. Each option is written IN ITS OWN
 * LANGUAGE — "English" and "اردو" — so somebody who cannot read the current
 * interface can still find the one they want. That is the same reasoning the
 * first-launch screen uses, and it is the whole reason this screen is not a
 * two-line list of translated names.
 *
 * CHOOSING RECREATES THE ACTIVITY. `04-mobile-architecture.md` §3 rule 2 picks
 * the platform's own mechanism, which re-resolves every layout direction, string
 * and configuration-dependent resource in one step — where doing it by hand
 * leaves whatever the app forgot in the old direction, and RSK-004 is precisely
 * the risk of "whatever we forgot".
 */
@Composable
fun LanguageSettingsScreen(
    current: AppLocale?,
    onBack: () -> Unit,
    onChoose: (AppLocale) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .background(MohallaTheme.colors.BgPrimary),
    ) {
        MohallaBackHeader(title = stringResource(R.string.settings_language), onBack = onBack)

        Column(Modifier.padding(top = MohallaTheme.spacing.Space2)) {
            AppLocale.entries.forEach { locale ->
                LanguageOption(
                    locale = locale,
                    selected = locale == current,
                    onSelect = { onChoose(locale) },
                )
            }
        }

        Text(
            text = stringResource(R.string.settings_language_note),
            style = MohallaTheme.text(MohallaType.Caption),
            color = MohallaTheme.colors.TextTertiary,
            modifier = Modifier.padding(
                horizontal = MohallaTheme.screenMargin,
                vertical = MohallaTheme.spacing.Space4,
            ),
        )
    }
}

@Composable
private fun LanguageOption(
    locale: AppLocale,
    selected: Boolean,
    onSelect: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            // `Role.RadioButton` and `selectable`, so a screen reader announces
            // "selected" rather than reading a tick it cannot see.
            .selectable(selected = selected, role = Role.RadioButton, onClick = onSelect)
            .defaultMinSize(minHeight = MohallaTheme.spacing.Space12)
            .padding(
                horizontal = MohallaTheme.screenMargin,
                vertical = MohallaTheme.spacing.Space3,
            ),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space3),
    ) {
        Text(
            // NOT `stringResource`. Each option is written in its own language
            // whichever language the interface is in, so somebody who cannot
            // read the current one can still find theirs.
            text = locale.ownName,
            style = MohallaTheme.text(MohallaType.BodyLg, display = locale.isRtl),
            color = MohallaTheme.colors.TextPrimary,
            modifier = Modifier.weight(1f),
        )

        if (selected) {
            Icon(
                imageVector = Icons.Filled.Check,
                // The row's `selectable` already announces the state; a second
                // announcement here would repeat it.
                contentDescription = null,
                tint = MohallaTheme.colors.BrandPrimary,
                modifier = Modifier.size(MohallaTheme.spacing.Space6),
            )
        }
    }
}

/**
 * Legal documents — UX-SET-006 (SET-FR-008 · OD-015).
 *
 * THERE IS NOTHING TO SHOW, AND THE SCREEN SAYS SO. The Terms of Service,
 * Privacy Policy and Community Guidelines do not exist: OD-015 is unresolved,
 * and PRIV-017 makes a publicly reachable Privacy Policy a Google Play
 * submission requirement, so this is a release blocker rather than a gap in the
 * app.
 *
 * WHAT IT DOES NOT DO IS FABRICATE. There is no placeholder text, no lorem, and
 * no link to a URL nobody has published — a document that looked real would be
 * worse than an absent one, because these are the stated basis for every
 * enforcement action on the platform (PRIV-018) and a user who read an invented
 * version would have been told the rules wrongly.
 */
@Composable
fun LegalDocumentScreen(
    titleRes: Int,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .background(MohallaTheme.colors.BgPrimary),
    ) {
        MohallaBackHeader(title = stringResource(titleRes), onBack = onBack)

        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = MohallaTheme.screenMargin),
            verticalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space3),
        ) {
            Spacer(Modifier.height(MohallaTheme.spacing.Space10))

            Text(
                text = stringResource(R.string.legal_unavailable),
                style = MohallaTheme.text(MohallaType.H3),
                color = MohallaTheme.colors.TextPrimary,
                modifier = Modifier.semantics { heading() },
            )
            Text(
                text = stringResource(R.string.legal_unavailable_body),
                style = MohallaTheme.text(MohallaType.Body),
                color = MohallaTheme.colors.TextSecondary,
            )
        }
    }
}

/**
 * Help and support — UX-SET-007 (SET-FR-009).
 *
 * "A SUPPORT CONTACT ROUTE, WHICH IS EMAIL IN V1", and no address has been
 * published. So this screen states that rather than opening a mail composer
 * addressed to somewhere invented: a message sent to an address nobody reads is
 * worse than being told where things stand, and this is also the appeals channel
 * for a suspension (SAFETY-014 deferred, OD-020) — the one place where sending
 * into a void has a real cost.
 *
 * THE ADDRESS IS A BUILD FIELD, empty until Shehersaaz publishes one, exactly as
 * `TERMS_VERSION` is. When it is set this screen offers the mail intent and
 * nothing else about it changes.
 */
@Composable
fun HelpScreen(
    onBack: () -> Unit,
    onEmail: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val address = BuildEnvironment.supportEmail

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(MohallaTheme.colors.BgPrimary),
    ) {
        MohallaBackHeader(title = stringResource(R.string.settings_help), onBack = onBack)

        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = MohallaTheme.screenMargin),
            verticalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space3),
        ) {
            Spacer(Modifier.height(MohallaTheme.spacing.Space10))

            Text(
                text = stringResource(R.string.settings_help),
                style = MohallaTheme.text(MohallaType.H3),
                color = MohallaTheme.colors.TextPrimary,
                modifier = Modifier.semantics { heading() },
            )

            if (address.isBlank()) {
                Text(
                    text = stringResource(R.string.help_unavailable),
                    style = MohallaTheme.text(MohallaType.Body),
                    color = MohallaTheme.colors.TextSecondary,
                )
            } else {
                Text(
                    text = stringResource(R.string.help_body),
                    style = MohallaTheme.text(MohallaType.Body),
                    color = MohallaTheme.colors.TextSecondary,
                )
                Text(
                    text = address,
                    style = MohallaTheme.text(MohallaType.Body),
                    color = MohallaTheme.colors.BrandPrimary,
                    modifier = Modifier
                        .clickable(role = Role.Button) { onEmail(address) }
                        .defaultMinSize(minHeight = MohallaTheme.spacing.Space12),
                )
            }
        }
    }
}

/**
 * About — UX-SET-008 (SET-FR-010).
 *
 * "The app version and build number, which support uses to diagnose reports."
 * Both come from `BuildConfig` rather than from a constant somebody would
 * remember to update, and both are shown because a version alone does not
 * distinguish two builds of the same release.
 */
@Composable
fun AboutScreen(
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .background(MohallaTheme.colors.BgPrimary),
    ) {
        MohallaBackHeader(title = stringResource(R.string.settings_about), onBack = onBack)

        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = MohallaTheme.screenMargin),
            verticalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space2),
        ) {
            Spacer(Modifier.height(MohallaTheme.spacing.Space10))

            Text(
                text = stringResource(R.string.app_name),
                style = MohallaTheme.text(MohallaType.H3),
                color = MohallaTheme.colors.TextPrimary,
                modifier = Modifier.semantics { heading() },
            )
            Text(
                text = stringResource(
                    R.string.about_version,
                    BuildEnvironment.versionName,
                    BuildEnvironment.versionCode,
                ),
                style = MohallaTheme.text(MohallaType.Body),
                color = MohallaTheme.colors.TextSecondary,
            )
        }
    }
}

/** Each language names itself, in itself. See [LanguageOption]. */
private val AppLocale.ownName: String
    get() = when (this) {
        AppLocale.ENGLISH -> "English"
        AppLocale.URDU -> "اردو"
    }

/** For the index's subtitle, which is read in whatever language is current. */
private val AppLocale.labelRes: Int
    get() = when (this) {
        AppLocale.ENGLISH -> R.string.language_english
        AppLocale.URDU -> R.string.language_urdu
    }

/** A drawn line, not a spacing decision. */
private val HAIRLINE = 1.dp
