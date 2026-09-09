package org.shehersaaz.mohalla.core.util

import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

/**
 * An ISO instant as a reader would write the date — "14 September 2026".
 *
 * `null` RATHER THAN THE RAW STRING when the input cannot be parsed.
 * `2026-09-14T00:00:00Z` in the middle of a sentence about a suspension would
 * be worse than the indefinite wording its callers fall back to.
 *
 * SHARED BY TWO CALLERS, which is why it is here rather than in either of them.
 * `AppContainer.formatDate` had it, and it was reachable only through the DI
 * container — so `FailureNotice`, which is a composable with no container,
 * could not say *until when* an account is limited and had to fall back to the
 * server's bare "Account is limited." (RUNTIME-010). A second copy of this
 * formatter is how the banner and the notice would come to disagree about the
 * same date.
 */
fun formatLongDate(iso: String, locale: Locale): String? = runCatching {
    DateTimeFormatter
        .ofLocalizedDate(FormatStyle.LONG)
        .withLocale(locale)
        .withZone(ZoneId.systemDefault())
        .format(Instant.parse(iso))
}.getOrNull()
