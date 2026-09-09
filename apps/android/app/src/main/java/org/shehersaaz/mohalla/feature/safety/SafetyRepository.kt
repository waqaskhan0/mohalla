package org.shehersaaz.mohalla.feature.safety

import org.shehersaaz.mohalla.core.network.ApiResult
import org.shehersaaz.mohalla.core.network.MohallaApi
import org.shehersaaz.mohalla.core.network.ReportRequest
import org.shehersaaz.mohalla.core.network.apiCall
import org.shehersaaz.mohalla.core.network.map

/**
 * Reporting and blocking (SAFETY-FR-001…006 · BR-025/030 · EDGE-023).
 *
 * THE RESPONSE IS DELIBERATELY UNINFORMATIVE AND THAT IS THE FEATURE. Every
 * successful report returns the same 202 with no count and no state, whether it
 * was the first report, the one that crossed the threshold, or the third from
 * the same account. SAFETY-FR-001 requires it in as many words: a repeat shows
 * "the acknowledgement again without incrementing the count, SO THE REPORTER
 * CANNOT INFER THE CURRENT TALLY."
 *
 * WHY THE TALLY MATTERS SO MUCH. It is what a coordinated group needs — it tells
 * them how many more accounts to bring — and RSK-010 rates coordinated reporting
 * used to silence civic criticism as this platform's characteristic abuse, on a
 * platform whose whole purpose is civic criticism. So there is no field here
 * that could carry a count, and no branch that could distinguish a first report
 * from a fourth.
 *
 * BLOCKING IS SILENT, UNILATERAL AND MUTUAL IN EFFECT (BR-025). Neither route
 * tells the blocked party anything, and neither confirms whether the target
 * exists — probing account existence through the block endpoint would defeat the
 * neutral 404 that every other route maintains.
 */
interface SafetySource {
    suspend fun report(
        target: ReportTarget,
        targetId: String,
        reason: ReportReason,
        note: String?,
    ): ApiResult<Unit>

    suspend fun block(userId: String): ApiResult<Unit>
}

class SafetyRepository(
    private val api: MohallaApi,
) : SafetySource {

    override suspend fun report(
        target: ReportTarget,
        targetId: String,
        reason: ReportReason,
        note: String?,
    ): ApiResult<Unit> = apiCall {
        api.report(
            ReportRequest(
                targetType = target.wire,
                targetId = targetId,
                reasonCode = reason.wire,
                // Trimmed, and null rather than blank: an empty note is the
                // absence of a note, and sending "" would put a blank line in
                // front of the one person who reads these.
                note = note?.trim()?.takeIf { it.isNotEmpty() },
            ),
        )
    }.map { }

    override suspend fun block(userId: String): ApiResult<Unit> =
        apiCall { api.block(userId) }.map { }
}

/**
 * What is being reported.
 *
 * FIVE TARGETS, AND TWO OF THEM NEVER AUTO-HIDE. Posts and comments hide at
 * three distinct reporters and events at two (BR-044); a PROFILE never does,
 * "because hiding a whole person on a report count would be trivially
 * weaponised" (SAFETY-FR-002), and a CONVERSATION never does, because a
 * threshold between two people is meaningless (MSG-FR-007). None of that is the
 * client's decision — it is recorded here because the difference is invisible
 * from this side and somebody will eventually wonder why the sheet says the same
 * thing for all five.
 */
enum class ReportTarget {
    POST,
    COMMENT,
    EVENT,
    PROFILE,
    CONVERSATION,
    ;

    val wire: String get() = name
}

/**
 * The eight reasons (SAFETY-FR-003).
 *
 * "The reporter selects EXACTLY ONE of: Spam or misleading · Harassment or
 * bullying · Hate speech · Violence or threats · Sexual or inappropriate content
 * · False information · Impersonation · Something else."
 *
 * AN ENUM, AND THE ORDER IS THE REQUIREMENT'S. Each reason carries a severity
 * that orders the moderation queue, and the mapping is the SERVER'S — a reporter
 * who could set severity would make CRITICAL the rational choice every time, and
 * the ordering would stop carrying information for the one reviewer who depends
 * on it. So this enum carries no severity and there is no field on the request
 * that could.
 */
enum class ReportReason {
    SPAM_OR_MISLEADING,
    HARASSMENT_OR_BULLYING,
    HATE_SPEECH,
    VIOLENCE_OR_THREATS,
    SEXUAL_OR_INAPPROPRIATE,
    FALSE_INFORMATION,
    IMPERSONATION,
    SOMETHING_ELSE,
    ;

    val wire: String get() = name
}

/** SAFETY-FR-001 — "optionally adds a note of up to 500 characters". */
const val REPORT_NOTE_MAX_GRAPHEMES = 500
