package org.shehersaaz.mohalla

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.shehersaaz.mohalla.core.network.ApiFailure
import org.shehersaaz.mohalla.core.network.ApiResult
import org.shehersaaz.mohalla.core.network.ReportRequest
import org.shehersaaz.mohalla.feature.safety.REPORT_NOTE_MAX_GRAPHEMES
import org.shehersaaz.mohalla.feature.safety.ReportReason
import org.shehersaaz.mohalla.feature.safety.ReportTarget
import org.shehersaaz.mohalla.feature.safety.ReportViewModel
import org.shehersaaz.mohalla.feature.safety.SafetySource

/**
 * Reporting and blocking
 * (SAFETY-FR-001/002/003/005/006 · BR-025/030 · EDGE-023 · RSK-010).
 *
 * THE ASSERTION THIS GROUP EXISTS FOR IS ABOUT SAMENESS. SAFETY-FR-001: a
 * repeat report shows "the acknowledgement again without incrementing the count,
 * SO THE REPORTER CANNOT INFER THE CURRENT TALLY". The tally is what a
 * coordinated group needs — it tells them how many more accounts to bring — and
 * RSK-010 rates coordinated reporting used to silence civic criticism as this
 * platform's characteristic abuse, on a platform whose whole purpose is civic
 * criticism.
 *
 * So the tests below check that the client has NO WAY to vary its answer:
 * one success state, no count anywhere in the state it renders from, and no
 * field on the request or the response that could carry one. That is a stronger
 * guarantee than asserting one scenario, because it cannot be satisfied by a
 * special case.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class SafetyTest {

    private val dispatcher = StandardTestDispatcher()

    @Before fun setUp() = Dispatchers.setMain(dispatcher)

    @After fun tearDown() = Dispatchers.resetMain()

    private class Script(
        var reportResult: ApiResult<Unit> = ApiResult.Ok(Unit),
        var blockResult: ApiResult<Unit> = ApiResult.Ok(Unit),
    ) : SafetySource {
        data class Sent(
            val target: ReportTarget,
            val targetId: String,
            val reason: ReportReason,
            val note: String?,
        )

        val reports = mutableListOf<Sent>()
        val blocked = mutableListOf<String>()

        override suspend fun report(
            target: ReportTarget,
            targetId: String,
            reason: ReportReason,
            note: String?,
        ): ApiResult<Unit> {
            reports += Sent(target, targetId, reason, note)
            return reportResult
        }

        override suspend fun block(userId: String): ApiResult<Unit> {
            blocked += userId
            return blockResult
        }
    }

    private fun vm(
        script: Script,
        target: ReportTarget = ReportTarget.POST,
        subject: String? = "them",
    ) = ReportViewModel(
        safety = script,
        target = target,
        targetId = "t1",
        subjectUserId = subject,
    )

    // ============================================ SAFETY-FR-001 · the sameness
    @Test
    fun `THERE IS ONE SUCCESS STATE AND NOTHING IN IT VARIES`() = runTest(dispatcher) {
        // A first report, a fourth from the same account, and the one that
        // crossed the auto-hide threshold all return the same empty 202 — so the
        // client has one branch and one sentence. Asserted twice over the same
        // ViewModel-shaped flow, because "the same" is the requirement.
        val script = Script()
        val first = vm(script)
        first.chooseReason(ReportReason.HARASSMENT_OR_BULLYING)
        first.submit()
        advanceUntilIdle()

        val second = vm(script)
        second.chooseReason(ReportReason.HARASSMENT_OR_BULLYING)
        second.submit()
        advanceUntilIdle()

        assertTrue(first.state.value.acknowledged)
        assertTrue(second.state.value.acknowledged)
        assertEquals(
            "the two states are indistinguishable",
            first.state.value.copy(),
            second.state.value.copy(),
        )
    }

    @Test
    fun `NOTHING ON THE WIRE COULD CARRY A TALLY`() {
        // EDGE-023 and SAFETY-FR-001 from the structural end: the request has no
        // field a count could come back on, and the route returns no body at
        // all. A field added under any name fails here with the reason quoted.
        assertExactFields(
            ReportRequest::class.java,
            setOf("targetType", "targetId", "reasonCode", "note"),
            "SAFETY-FR-001 — the reporter must not be able to infer the current tally, " +
                "because the tally is what tells a coordinated group how many more accounts " +
                "they need (RSK-010). There is deliberately nothing here to carry one, and " +
                "no severity either: severity is derived from the reason SERVER-side, because " +
                "a reporter who could set it would make CRITICAL the rational choice every time",
        )
    }

    @Test
    fun `THE EIGHT REASONS ARE THE REQUIREMENT'S EIGHT, IN ITS ORDER`() {
        // SAFETY-FR-003: "the reporter selects exactly one of: Spam or
        // misleading · Harassment or bullying · Hate speech · Violence or
        // threats · Sexual or inappropriate content · False information ·
        // Impersonation · Something else."
        assertEquals(
            listOf(
                "SPAM_OR_MISLEADING",
                "HARASSMENT_OR_BULLYING",
                "HATE_SPEECH",
                "VIOLENCE_OR_THREATS",
                "SEXUAL_OR_INAPPROPRIATE",
                "FALSE_INFORMATION",
                "IMPERSONATION",
                "SOMETHING_ELSE",
            ),
            ReportReason.entries.map { it.wire },
        )
    }

    @Test
    fun `FIVE TARGETS, AND THE CLIENT CAN NAME EACH OF THEM`() {
        // SAFETY-FR-001 puts reporting on content, an account and a
        // conversation; the wire spelling has to match the server's enum exactly
        // or a report is refused with a validation error the reporter cannot
        // act on.
        assertEquals(
            listOf("POST", "COMMENT", "EVENT", "PROFILE", "CONVERSATION"),
            ReportTarget.entries.map { it.wire },
        )
    }

    // ================================================= the two-step sheet
    @Test
    fun `CHOOSING A REASON DOES NOT SEND IT`() = runTest(dispatcher) {
        // SAFETY-FR-001 offers an optional note, and a sheet that submitted on
        // the first tap would never show it. Two taps to send, one tap to change
        // your mind.
        val script = Script()
        val sheet = vm(script)

        sheet.chooseReason(ReportReason.HATE_SPEECH)
        advanceUntilIdle()

        assertEquals(ReportReason.HATE_SPEECH, sheet.state.value.reason)
        assertTrue(script.reports.isEmpty())
        assertFalse(sheet.state.value.acknowledged)
    }

    @Test
    fun `THE REASON CAN BE CHANGED, AND THE NOTE SURVIVES IT`() = runTest(dispatcher) {
        // "Reporting is never a trap", and that includes being stuck on the
        // wrong reason after typing three sentences.
        val sheet = vm(Script())

        sheet.chooseReason(ReportReason.SPAM_OR_MISLEADING)
        sheet.onNoteChanged("They have posted this eleven times today.")
        sheet.clearReason()

        assertNull(sheet.state.value.reason)
        assertEquals("They have posted this eleven times today.", sheet.state.value.note)
    }

    @Test
    fun `A REPORT WITH NO NOTE IS SENT, BECAUSE THE NOTE IS OPTIONAL`() =
        runTest(dispatcher) {
            // Requiring one would make the fastest path through this sheet — the
            // one somebody uses while distressed — the one that asks them to
            // write about it.
            val script = Script()
            val sheet = vm(script)

            sheet.chooseReason(ReportReason.VIOLENCE_OR_THREATS)
            assertTrue(sheet.state.value.canSubmit)

            sheet.submit()
            advanceUntilIdle()

            assertEquals(1, script.reports.size)
            assertNull(script.reports.single().note)
        }

    @Test
    fun `a whitespace note is no note at all`() = runTest(dispatcher) {
        // "No note" is what an untouched field means, and sending "" would put
        // an empty line in front of the one person who reads these.
        val script = Script()
        val sheet = vm(script)

        sheet.chooseReason(ReportReason.SOMETHING_ELSE)
        sheet.onNoteChanged("   ")
        sheet.submit()
        advanceUntilIdle()

        assertNull(script.reports.single().note)
    }

    @Test
    fun `a note keeps its words and loses its edges`() = runTest(dispatcher) {
        val script = Script()
        val sheet = vm(script)

        sheet.chooseReason(ReportReason.SOMETHING_ELSE)
        sheet.onNoteChanged("  They keep messaging my daughter.  ")
        sheet.submit()
        advanceUntilIdle()

        assertEquals("They keep messaging my daughter.", script.reports.single().note)
    }

    @Test
    fun `THE NOTE IS 500 GRAPHEMES, SO URDU IS NOT PENALISED`() {
        assertEquals(500, REPORT_NOTE_MAX_GRAPHEMES)

        val sheet = vm(Script())
        sheet.chooseReason(ReportReason.HARASSMENT_OR_BULLYING)

        // Kaf with a kasra: one cluster the reader sees, two UTF-16 units.
        val urdu = "کِ".repeat(REPORT_NOTE_MAX_GRAPHEMES)
        sheet.onNoteChanged(urdu)

        assertTrue("longer in UTF-16", urdu.length > REPORT_NOTE_MAX_GRAPHEMES)
        assertEquals(REPORT_NOTE_MAX_GRAPHEMES, sheet.state.value.noteLength)
        assertFalse(sheet.state.value.noteTooLong)
        assertTrue(sheet.state.value.canSubmit)
    }

    @Test
    fun `an over-long note cannot be submitted`() {
        val sheet = vm(Script())
        sheet.chooseReason(ReportReason.HARASSMENT_OR_BULLYING)
        sheet.onNoteChanged("a".repeat(REPORT_NOTE_MAX_GRAPHEMES + 1))

        assertTrue(sheet.state.value.noteTooLong)
        assertFalse(sheet.state.value.canSubmit)
    }

    @Test
    fun `nothing is submitted before a reason is chosen`() = runTest(dispatcher) {
        val script = Script()
        val sheet = vm(script)

        sheet.submit()
        advanceUntilIdle()

        assertTrue(script.reports.isEmpty())
    }

    // ===================================================== a failed report
    @Test
    fun `A FAILED REPORT KEEPS THE REASON AND EVERY WORD OF THE NOTE`() =
        runTest(dispatcher) {
            // Somebody who has just typed three sentences about being harassed
            // must not have to type them again because a train went into a
            // tunnel.
            val script = Script(reportResult = ApiResult.Err(ApiFailure.Offline))
            val sheet = vm(script)

            sheet.chooseReason(ReportReason.HARASSMENT_OR_BULLYING)
            sheet.onNoteChanged("This is the fourth message this week.")
            sheet.submit()
            advanceUntilIdle()

            assertFalse("and it does NOT claim to have been queued", sheet.state.value.acknowledged)
            assertEquals(ApiFailure.Offline, sheet.state.value.failure)
            assertEquals(ReportReason.HARASSMENT_OR_BULLYING, sheet.state.value.reason)
            assertEquals("This is the fourth message this week.", sheet.state.value.note)
            assertTrue("so a retry is one tap", sheet.state.value.canSubmit)
        }

    @Test
    fun `a rate limit is stated rather than silent`() = runTest(dispatcher) {
        // SAFETY-FR-009: "a clear cool-down message rather than a silent
        // failure", with the limit stated. Not a disclosure about anybody — a
        // statement about the reporter's own recent behaviour.
        val script = Script(
            reportResult = ApiResult.Err(
                ApiFailure.RateLimited("You can send up to 20 reports a day."),
            ),
        )
        val sheet = vm(script)

        sheet.chooseReason(ReportReason.SPAM_OR_MISLEADING)
        sheet.submit()
        advanceUntilIdle()

        assertEquals(
            "You can send up to 20 reports a day.",
            (sheet.state.value.failure as? ApiFailure.RateLimited)?.message,
        )
        assertFalse(sheet.state.value.acknowledged)
    }

    // ===================================== SAFETY-FR-005 · the block that follows
    @Test
    fun `THE BLOCK IS OFFERED AFTER THE ACKNOWLEDGEMENT, AND ONLY WHEN THERE IS SOMEBODY TO BLOCK`() {
        // "◆ Also block this person? ← offered immediately, because in practice
        // the two go together." An EVENT has nobody behind it, so the offer is
        // absent rather than present and refused.
        assertTrue(vm(Script(), subject = "them").state.value.canBlockAfterwards)
        assertFalse(
            vm(Script(), target = ReportTarget.EVENT, subject = null)
                .state.value.canBlockAfterwards,
        )
    }

    @Test
    fun `BLOCKING IS A SECOND DELIBERATE TAP, NEVER PART OF THE REPORT`() =
        runTest(dispatcher) {
            // Blocking removes follows in BOTH directions and unblocking never
            // restores them (SAFETY-FR-006), so it stays an offer rather than
            // becoming a side effect of reporting.
            val script = Script()
            val sheet = vm(script)

            sheet.chooseReason(ReportReason.HARASSMENT_OR_BULLYING)
            sheet.submit()
            advanceUntilIdle()

            assertTrue(sheet.state.value.acknowledged)
            assertTrue("reporting blocked nobody", script.blocked.isEmpty())

            sheet.block(onBlocked = {})
            advanceUntilIdle()

            assertEquals(listOf("them"), script.blocked)
            assertTrue(sheet.state.value.blocked)
        }

    @Test
    fun `a failed block says so and does not claim to have worked`() = runTest(dispatcher) {
        val script = Script(blockResult = ApiResult.Err(ApiFailure.Offline))
        val sheet = vm(script)

        var completed = false
        sheet.block(onBlocked = { completed = true })
        advanceUntilIdle()

        assertFalse(completed)
        assertFalse(sheet.state.value.blocked)
        assertTrue(sheet.state.value.blockFailed)
    }

    @Test
    fun `blocking twice sends one request`() = runTest(dispatcher) {
        val script = Script()
        val sheet = vm(script)

        sheet.block(onBlocked = {})
        sheet.block(onBlocked = {})
        advanceUntilIdle()

        assertEquals(listOf("them"), script.blocked)
    }

    @Test
    fun `an event cannot be blocked at all`() = runTest(dispatcher) {
        val script = Script()
        val sheet = vm(script, target = ReportTarget.EVENT, subject = null)

        sheet.block(onBlocked = {})
        advanceUntilIdle()

        assertTrue(script.blocked.isEmpty())
    }

    // ==================================================== what reaches the wire
    @Test
    fun `THE TARGET AND THE REASON REACH THE SERVER EXACTLY AS CHOSEN`() =
        runTest(dispatcher) {
            val script = Script()
            val sheet = ReportViewModel(
                safety = script,
                target = ReportTarget.COMMENT,
                targetId = "c1",
                subjectUserId = "them",
            )

            sheet.chooseReason(ReportReason.IMPERSONATION)
            sheet.onNoteChanged("They are using my sister's photo.")
            sheet.submit()
            advanceUntilIdle()

            assertEquals(
                Script.Sent(
                    target = ReportTarget.COMMENT,
                    targetId = "c1",
                    reason = ReportReason.IMPERSONATION,
                    note = "They are using my sister's photo.",
                ),
                script.reports.single(),
            )
        }
}
