package org.shehersaaz.mohalla.core.ui

import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.TimePicker
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.material3.rememberTimePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.window.Dialog
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.ZoneId
import org.shehersaaz.mohalla.R
import org.shehersaaz.mohalla.core.design.MohallaTheme

/**
 * Pick a date and then a time (UX-EVENT-004 · UI/UX §18 "Date picker").
 *
 * THE PLATFORM'S PICKERS, NOT HAND-ROLLED ONES, and the reason is localisation
 * rather than effort. A typed date has to be parsed against a locale: in Urdu,
 * with different month names and a calendar the user may or may not think in,
 * that is a guessing game with somebody's event on the other end. Material's
 * pickers are already localised, already handle month lengths and leap years,
 * and already announce themselves to a screen reader.
 *
 * TWO STEPS, DATE THEN TIME, rather than one combined control. Material offers
 * no combined picker, and the sequence matches how people decide: the day is
 * chosen first and the hour follows from it.
 *
 * THE RESULT IS ASSEMBLED IN THE DISPLAY ZONE AND CONVERTED TO UTC ONCE. This
 * is the conversion that goes wrong most easily. `DatePicker` reports a
 * UTC-midnight millisecond value for the chosen day, and `TimePicker` reports a
 * wall-clock hour and minute with no zone at all — so combining them naively
 * produces a moment that is off by the device's offset. Pakistan is UTC+5, so
 * "9:00 AM on the 14th" would be stored as 09:00Z and shown back as 2:00 PM.
 * The date is therefore taken as a LOCAL DATE, joined to the local time, and
 * only then resolved through the zone.
 *
 * A PAST SELECTION IS NOT PREVENTED HERE. `selectableDates` could grey out
 * yesterday, and deliberately does not: the caller's validation is what refuses
 * a past start (EVENT-FR-001 E1) and it does so with a message, where a
 * silently unselectable day leaves somebody tapping a date that does nothing.
 * The one exception is that the picker OPENS on today rather than on the epoch.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MohallaDateTimePicker(
    /** The current value, so reopening the picker starts where it left off. */
    initialEpochMillis: Long?,
    zone: ZoneId,
    onDismiss: () -> Unit,
    onPicked: (epochMillis: Long) -> Unit,
) {
    val initial = remember(initialEpochMillis, zone) {
        initialEpochMillis
            ?.let { Instant.ofEpochMilli(it).atZone(zone).toLocalDateTime() }
            // Opens on today at the top of the next hour: an events picker
            // that opened at 00:00 would make everybody scroll past midnight.
            ?: LocalDateTime.now(zone).plusHours(1).withMinute(0)
    }

    var chosenDate by remember { mutableStateOf<LocalDate?>(null) }

    if (chosenDate == null) {
        val dateState = rememberDatePickerState(
            // `DatePicker` works in UTC-midnight millis for a calendar day, so
            // the initial value is converted through UTC rather than the
            // display zone — passing a zoned millisecond here selects the wrong
            // day for anybody more than a few hours from Greenwich.
            initialSelectedDateMillis = initial.toLocalDate()
                .atStartOfDay(ZoneId.of("UTC"))
                .toInstant()
                .toEpochMilli(),
        )

        DatePickerDialog(
            onDismissRequest = onDismiss,
            confirmButton = {
                MohallaButton(
                    text = stringResource(R.string.action_next),
                    onClick = {
                        val millis = dateState.selectedDateMillis
                        if (millis != null) {
                            // Read back as a UTC date, matching how it was
                            // written. The day is what was chosen; the zone is
                            // applied when the time joins it.
                            chosenDate = Instant.ofEpochMilli(millis)
                                .atZone(ZoneId.of("UTC"))
                                .toLocalDate()
                        }
                    },
                    enabled = dateState.selectedDateMillis != null,
                )
            },
            dismissButton = {
                MohallaSecondaryButton(
                    text = stringResource(R.string.action_cancel),
                    onClick = onDismiss,
                )
            },
            colors = androidx.compose.material3.DatePickerDefaults.colors(
                containerColor = MohallaTheme.colors.SurfacePrimary,
            ),
        ) {
            DatePicker(state = dateState)
        }
        return
    }

    val timeState = rememberTimePickerState(
        initialHour = initial.hour,
        initialMinute = initial.minute,
        // 12-hour, because §19's mock renders "9:00 AM" and both English and
        // Urdu copy in this product use a 12-hour clock.
        is24Hour = false,
    )

    // `TimePicker` has no dialog wrapper of its own in Material3, so this is a
    // plain `Dialog` with the same two-button footer the date step uses —
    // keeping the two steps visually one control rather than two conventions.
    Dialog(onDismissRequest = onDismiss) {
        Column(
            modifier = Modifier
                .background(MohallaTheme.colors.SurfacePrimary, MohallaTheme.radius.ShapeXl)
                .padding(MohallaTheme.spacing.Space4),
            verticalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space4),
        ) {
            TimePicker(state = timeState)

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(MohallaTheme.spacing.Space2),
            ) {
                MohallaSecondaryButton(
                    text = stringResource(R.string.action_back),
                    // Back to the date step rather than out of the flow, so a
                    // wrong day does not mean starting again.
                    onClick = { chosenDate = null },
                    modifier = Modifier.weight(1f),
                )
                MohallaButton(
                    text = stringResource(R.string.action_done),
                    onClick = {
                        val date = chosenDate ?: return@MohallaButton
                        // THE ONE CONVERSION. A local date plus a local time,
                        // resolved through the display zone exactly once.
                        val moment = LocalDateTime.of(
                            date,
                            LocalTime.of(timeState.hour, timeState.minute),
                        ).atZone(zone).toInstant().toEpochMilli()
                        onPicked(moment)
                    },
                    modifier = Modifier.weight(1f),
                )
            }
        }
    }
}
