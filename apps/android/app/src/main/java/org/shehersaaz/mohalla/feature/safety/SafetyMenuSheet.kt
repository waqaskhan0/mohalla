package org.shehersaaz.mohalla.feature.safety

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import org.shehersaaz.mohalla.R
import org.shehersaaz.mohalla.core.design.MohallaTheme
import org.shehersaaz.mohalla.core.design.MohallaType

/**
 * The `⋯` menu — "Report · Block" (§14's navigation tree).
 *
 * TWO ITEMS, AND IT EXISTS BECAUSE THE HEADER CANNOT HOLD BOTH. §18.5 caps a top
 * app bar at two actions, and a profile's second slot is not free once the back
 * chevron is there. More importantly, the spec puts both behind one `⋯` on a
 * profile and on a conversation — the two places where the person, rather than
 * one of their items, is the subject.
 *
 * NEITHER ITEM IS DESTRUCTIVE BY ITSELF. Report opens the reason sheet and Block
 * opens the confirmation; nothing happens from this menu directly, which is why
 * it has no cancel row of its own — dismissing it is tapping outside, and
 * "reporting is never a trap" applies to getting here by accident too.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SafetyMenuSheet(
    onDismiss: () -> Unit,
    onReport: () -> Unit,
    onBlock: () -> Unit,
) {
    val sheetState = rememberModalBottomSheetState()

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = MohallaTheme.colors.SurfacePrimary,
        shape = MohallaTheme.radius.ShapeSheet,
    ) {
        Column(
            modifier = Modifier
                .padding(horizontal = MohallaTheme.screenMargin)
                .padding(bottom = MohallaTheme.spacing.Space6)
                .navigationBarsPadding(),
            verticalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space1),
        ) {
            MenuRow(text = stringResource(R.string.action_report), onClick = onReport)
            MenuRow(text = stringResource(R.string.block_action), onClick = onBlock)
        }
    }
}

@Composable
private fun MenuRow(text: String, onClick: () -> Unit) {
    Text(
        text = text,
        style = MohallaTheme.text(MohallaType.Body),
        color = MohallaTheme.colors.TextPrimary,
        modifier = Modifier
            .fillMaxWidth()
            .clickable(role = Role.Button, onClick = onClick)
            .defaultMinSize(minHeight = MohallaTheme.spacing.Space12)
            .padding(vertical = MohallaTheme.spacing.Space3),
    )
}
