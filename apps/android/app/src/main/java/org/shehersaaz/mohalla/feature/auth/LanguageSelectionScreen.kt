package org.shehersaaz.mohalla.feature.auth

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import org.shehersaaz.mohalla.R
import org.shehersaaz.mohalla.core.design.MohallaFonts
import org.shehersaaz.mohalla.core.design.MohallaTheme
import org.shehersaaz.mohalla.core.design.MohallaType
import org.shehersaaz.mohalla.core.design.style
import org.shehersaaz.mohalla.core.locale.AppLocale
import org.shehersaaz.mohalla.core.ui.MohallaButton

/**
 * UX-AUTH-002 — Language selection. LOCALE-FR-001 · BR-040.
 *
 * THE SCREEN THAT CANNOT BE IN ONE LANGUAGE. Every other screen renders in the
 * chosen language; this one is shown *before* there is a choice, to somebody
 * who may not read the language it would default to. So each option is
 * **written in its own language and its own script** — "English" in Latin,
 * "اردو" in Naskh — rather than "English" and "Urdu" both in English. A user who
 * reads only Urdu can find their option without reading a word of English,
 * which is the entire job of this screen.
 *
 * BR-040: NOTHING IS PRE-SELECTED. The device locale pre-*highlights* a
 * suggestion, and the Continue button is disabled until the user actually
 * picks. A pre-ticked radio button would let somebody tap Continue and be given
 * a language they never chose — and on this product that is the difference
 * between an app they can use and one they cannot.
 */
@Composable
fun LanguageSelectionScreen(
    suggestion: AppLocale,
    onConfirm: (AppLocale) -> Unit,
    modifier: Modifier = Modifier,
) {
    // `rememberSaveable`, because choosing a language recreates the activity
    // (04-mobile-architecture §3 rule 2) and a plain `remember` would lose the
    // highlight mid-decision.
    var selected by rememberSaveable { mutableStateOf<AppLocale?>(null) }

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(MohallaTheme.colors.BgPrimary)
            .padding(horizontal = MohallaTheme.screenMargin)
            .padding(top = MohallaTheme.spacing.Space16),
        verticalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space3),
    ) {
        Text(
            text = stringResource(R.string.language_title),
            style = MohallaTheme.text(MohallaType.H1),
            color = MohallaTheme.colors.TextPrimary,
            modifier = Modifier.semantics { heading() },
        )
        Text(
            text = stringResource(R.string.language_subtitle),
            style = MohallaTheme.text(MohallaType.Body),
            color = MohallaTheme.colors.TextSecondary,
        )

        Spacer(Modifier.height(MohallaTheme.spacing.Space6))

        AppLocale.entries.forEach { locale ->
            LanguageOption(
                locale = locale,
                selected = selected == locale,
                suggested = selected == null && locale == suggestion,
                onSelect = { selected = locale },
            )
        }

        Spacer(Modifier.height(MohallaTheme.spacing.Space8))

        MohallaButton(
            text = stringResource(R.string.language_continue),
            onClick = { selected?.let(onConfirm) },
            // Disabled until a real choice exists. See BR-040 above.
            enabled = selected != null,
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

@Composable
private fun LanguageOption(
    locale: AppLocale,
    selected: Boolean,
    suggested: Boolean,
    onSelect: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val label = when (locale) {
        AppLocale.ENGLISH -> stringResource(R.string.language_english)
        AppLocale.URDU -> stringResource(R.string.language_urdu)
    }

    Row(
        modifier = modifier
            .fillMaxWidth()
            .defaultMinSize(minHeight = MohallaTheme.spacing.Space12)
            .background(
                if (selected) {
                    MohallaTheme.colors.BrandPrimarySubtle
                } else {
                    MohallaTheme.colors.SurfacePrimary
                },
                MohallaTheme.radius.ShapeMd,
            )
            .border(
                width = if (selected || suggested) 2.dp else 1.dp,
                color = when {
                    selected -> MohallaTheme.colors.BrandPrimary
                    suggested -> MohallaTheme.colors.BorderStrong
                    else -> MohallaTheme.colors.BorderDefault
                },
                shape = MohallaTheme.radius.ShapeMd,
            )
            .selectable(selected = selected, role = Role.RadioButton, onClick = onSelect)
            .padding(MohallaTheme.spacing.Space4),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space3),
    ) {
        // A filled dot when chosen. Shape carries the state as well as colour,
        // so it survives a colour-blind reader (§35).
        Row(
            modifier = Modifier
                .size(MohallaTheme.spacing.Space5)
                .background(
                    if (selected) MohallaTheme.colors.BrandPrimary else MohallaTheme.colors.SurfaceSunken,
                    CircleShape,
                ),
        ) {}

        Text(
            text = label,
            // EACH OPTION IN ITS OWN SCRIPT, regardless of the interface
            // language — the point of the screen. Urdu here is Naskh, not
            // Nastaliq: this is a control, and §10 keeps Nastaliq out of
            // controls even when the text is large enough for it.
            style = when (locale) {
                AppLocale.ENGLISH -> MohallaType.Title.style(urdu = false)
                AppLocale.URDU -> MohallaType.Title.style(urdu = true).copy(
                    fontFamily = MohallaFonts.Naskh,
                )
            },
            color = MohallaTheme.colors.TextPrimary,
            textAlign = TextAlign.Start,
        )
    }
}

/**
 * The direction each option's own text runs, independent of the interface.
 *
 * Exposed for the RTL test: "اردو" must lay out RTL even while the interface is
 * still English, which is LOCALE-FR-005's per-run direction rule applied to the
 * one screen where the interface language is not yet decided.
 */
fun localeTextDirection(locale: AppLocale): LayoutDirection =
    if (locale.isRtl) LayoutDirection.Rtl else LayoutDirection.Ltr

/** Kept for the test to assert the title style resolves per language. */
internal fun titleStyleFor(urdu: Boolean): TextStyle = MohallaType.Title.style(urdu = urdu)
