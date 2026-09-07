package org.shehersaaz.mohalla.core.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import org.shehersaaz.mohalla.R
import org.shehersaaz.mohalla.core.design.MohallaTheme
import org.shehersaaz.mohalla.core.design.MohallaType

/**
 * The shape every authentication step shares: a mirroring back arrow, a
 * heading, an explanation, the fields, and one primary action pinned low.
 *
 * ONE SCAFFOLD RATHER THAN TEN LAYOUTS, for the same reason the state
 * components are shared: consistency here is a requirement, not a preference.
 * §36 asks that every screen be verified in both directions, and ten
 * hand-built layouts is ten chances for one to use a physical padding or
 * forget `imePadding`. This one is verified once.
 *
 * THE BACK ARROW MIRRORS AND THE OTHERS DO NOT.
 * `Icons.AutoMirrored.Filled.ArrowBack` flips under `LayoutDirection.Rtl`,
 * which is correct — "back" in Urdu points right. That is the one directional
 * icon in the auth flow; the tab icons are explicitly excluded from mirroring
 * for the opposite reason (`04-mobile-architecture.md` §3 rule 3).
 */
@Composable
fun AuthScaffold(
    title: String,
    modifier: Modifier = Modifier,
    body: String? = null,
    onBack: (() -> Unit)? = null,
    /** Announced when it appears, so a screen reader is not left behind (§35). */
    notice: AuthNotice? = null,
    action: @Composable (() -> Unit)? = null,
    content: @Composable () -> Unit,
) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .background(MohallaTheme.colors.BgPrimary)
            // Without this the keyboard covers the field on the 720x1280 screen
            // NFR-COMP-002 targets — which is most of the audience's hardware.
            .imePadding(),
    ) {
        if (onBack != null) {
            IconButton(
                onClick = onBack,
                modifier = Modifier
                    .padding(start = MohallaTheme.spacing.Space1)
                    .defaultMinSize(
                        minWidth = MohallaTheme.spacing.Space12,
                        minHeight = MohallaTheme.spacing.Space12,
                    ),
            ) {
                Icon(
                    imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                    contentDescription = stringResource(R.string.action_back),
                    tint = MohallaTheme.colors.TextPrimary,
                )
            }
        } else {
            Spacer(Modifier.height(MohallaTheme.spacing.Space12))
        }

        Column(
            modifier = Modifier
                .weight(1f)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = MohallaTheme.screenMargin),
            verticalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space4),
        ) {
            Spacer(Modifier.height(MohallaTheme.spacing.Space4))

            Text(
                text = title,
                style = MohallaTheme.text(MohallaType.H1),
                color = MohallaTheme.colors.TextPrimary,
                modifier = Modifier.semantics { heading() },
            )

            if (body != null) {
                Text(
                    text = body,
                    style = MohallaTheme.text(MohallaType.Body),
                    color = MohallaTheme.colors.TextSecondary,
                )
            }

            Spacer(Modifier.height(MohallaTheme.spacing.Space1))

            content()

            if (notice != null) {
                Text(
                    text = notice.text,
                    style = MohallaTheme.text(MohallaType.BodySm),
                    color = when (notice.tone) {
                        AuthNoticeTone.ERROR -> MohallaTheme.colors.Error
                        AuthNoticeTone.WARNING -> MohallaTheme.colors.Warning
                        AuthNoticeTone.SUCCESS -> MohallaTheme.colors.Success
                    },
                    modifier = Modifier.semantics {
                        liveRegion = when (notice.tone) {
                            // An error needs interrupting; a condition does not.
                            AuthNoticeTone.ERROR -> LiveRegionMode.Assertive
                            else -> LiveRegionMode.Polite
                        }
                    },
                )
            }
        }

        if (action != null) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(
                        horizontal = MohallaTheme.screenMargin,
                        vertical = MohallaTheme.spacing.Space4,
                    ),
                verticalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space2),
            ) {
                action()
            }
        }
    }
}

data class AuthNotice(val text: String, val tone: AuthNoticeTone)

enum class AuthNoticeTone { ERROR, WARNING, SUCCESS }

/**
 * The Terms checkbox (BR-004 — an explicit affirmative).
 *
 * NEVER PRE-TICKED, and this component makes that awkward to get wrong: it has
 * no default for `checked`, so a caller has to pass one and cannot omit it into
 * `true`. BR-004 requires an affirmative act and PRIV-014 requires the version
 * and timestamp to be recorded against it, so a box ticked on the user's behalf
 * would make the record a lie.
 *
 * The whole row is the target, not the box, which gives a 48dp hit area on a
 * control whose glyph is 20dp (§35).
 */
@Composable
fun MohallaCheckbox(
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
    label: String,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .defaultMinSize(minHeight = MohallaTheme.spacing.Space12)
            .toggleable(
                value = checked,
                enabled = enabled,
                role = Role.Checkbox,
                onValueChange = onCheckedChange,
            )
            .padding(vertical = MohallaTheme.spacing.Space2),
        verticalAlignment = Alignment.Top,
        horizontalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space3),
    ) {
        // Shape and fill both change, so the state is not carried by colour
        // alone (§35).
        Row(
            modifier = Modifier
                .padding(top = 2.dp)
                .size(MohallaTheme.spacing.Space5)
                .background(
                    color = if (checked) {
                        MohallaTheme.colors.BrandPrimary
                    } else {
                        MohallaTheme.colors.SurfacePrimary
                    },
                    shape = RoundedCornerShape(MohallaTheme.radius.Sm),
                ),
        ) {}

        Text(
            text = label,
            style = MohallaTheme.text(MohallaType.Body),
            color = MohallaTheme.colors.TextPrimary,
        )
    }
}
