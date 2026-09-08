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
import org.shehersaaz.mohalla.core.network.DeleteAccountRequest
import org.shehersaaz.mohalla.core.network.DeletionConsequencesResponse
import org.shehersaaz.mohalla.feature.settings.DeleteAccountViewModel
import org.shehersaaz.mohalla.feature.settings.DeletionConsequences
import org.shehersaaz.mohalla.feature.settings.DeletionSource

/**
 * Delete account — UX-SET-009 (SET-FR-004 · PRIV-006 · BR-008/009).
 *
 * PRIV-006 IS A CLAIM ABOUT WHAT THE USER WAS TOLD, and that is what these tests
 * check. Users "MUST BE TOLD THIS CLEARLY BEFORE CONFIRMING, because it differs
 * from the erasure many will assume" — what differs is BR-009: posts and
 * comments STAY, attributed to "Deleted User", because other people replied to
 * them.
 *
 * So the two assertions that matter most are that nothing is confirmable before
 * the consequences are on screen, and that their ORDER is never touched — the
 * surprising line is second by the server's decision, "where it is read, rather
 * than last where it is skipped", and a client that sorted or filtered would
 * undo that silently.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class DeleteAccountTest {

    private val dispatcher = StandardTestDispatcher()

    @Before fun setUp() = Dispatchers.setMain(dispatcher)

    @After fun tearDown() = Dispatchers.resetMain()

    /** The six the contract defines, in the server's order. */
    private val serverKeys = listOf(
        "deletion.consequence.profileRemoved",
        "deletion.consequence.postsRemainAnonymised",
        "deletion.consequence.messagesRemainForTheOtherPerson",
        "deletion.consequence.sessionsEndImmediately",
        "deletion.consequence.restorableForThirtyDays",
        "deletion.consequence.permanentAfterThirtyDays",
    )

    private class Script(
        var consequences: ApiResult<DeletionConsequences> = ApiResult.Ok(
            DeletionConsequences(keys = emptyList(), graceDays = 30, scheduledErasureAt = null),
        ),
        var deleteResult: ApiResult<Unit> = ApiResult.Ok(Unit),
    ) : DeletionSource {
        val passwords = mutableListOf<String>()

        override suspend fun deletionConsequences(): ApiResult<DeletionConsequences> = consequences

        override suspend fun deleteAccount(password: String): ApiResult<Unit> {
            passwords += password
            return deleteResult
        }
    }

    private fun script(keys: List<String> = serverKeys, graceDays: Int = 30) = Script(
        consequences = ApiResult.Ok(
            DeletionConsequences(keys = keys, graceDays = graceDays, scheduledErasureAt = null),
        ),
    )

    // ==================================================== PRIV-006 · being told
    @Test
    fun `NOTHING IS CONFIRMABLE UNTIL THE CONSEQUENCES ARE ON SCREEN`() =
        runTest(dispatcher) {
            // PRIV-006 is a claim about what the user was TOLD. A screen that
            // accepted a password while the list was still failing to load would
            // be making that claim falsely — so the control is disabled rather
            // than the list being treated as optional detail.
            val vm = DeleteAccountViewModel(
                Script(consequences = ApiResult.Err(ApiFailure.Offline)),
            )
            advanceUntilIdle()

            vm.onPasswordChanged("Correct1horse")

            assertFalse(vm.state.value.loaded)
            assertFalse("the only irreversible action stays locked", vm.state.value.canSubmit)
            assertEquals(ApiFailure.Offline, vm.state.value.loadFailure)
        }

    @Test
    fun `a failed load does not delete anything even if submit is called`() =
        runTest(dispatcher) {
            val script = Script(consequences = ApiResult.Err(ApiFailure.Server(message = null)))
            val vm = DeleteAccountViewModel(script)
            advanceUntilIdle()

            vm.onPasswordChanged("Correct1horse")
            vm.submit(onDeleted = {})
            advanceUntilIdle()

            assertTrue(script.passwords.isEmpty())
        }

    @Test
    fun `THE CONSEQUENCES ARRIVE IN THE SERVER'S ORDER AND KEEP IT`() =
        runTest(dispatcher) {
            // "The surprising line — that posts remain, attributed to 'Deleted
            // User' — is SECOND in the list, where it is read, rather than last
            // where it is skipped." Sorting, grouping or filtering here would
            // undo a decision PRIV-006 made about what gets read.
            val vm = DeleteAccountViewModel(script())
            advanceUntilIdle()

            assertEquals(serverKeys, vm.state.value.consequenceKeys)
            assertEquals(
                "BR-009's surprise is second",
                "deletion.consequence.postsRemainAnonymised",
                vm.state.value.consequenceKeys[1],
            )
        }

    @Test
    fun `THE GRACE PERIOD COMES FROM THE SERVER, NOT FROM A CONSTANT HERE`() =
        runTest(dispatcher) {
            // The screen states the number in its heading. A client constant
            // would go on saying 30 the day the policy changed.
            val vm = DeleteAccountViewModel(script(graceDays = 14))
            advanceUntilIdle()

            assertEquals(14, vm.state.value.graceDays)
        }

    @Test
    fun `A CONSEQUENCE THIS BUILD CANNOT TRANSLATE IS STILL COUNTED`() =
        runTest(dispatcher) {
            // A seventh key would be silently dropped by a client that only
            // rendered what it recognised — and quietly omitting a consequence
            // is exactly the failure PRIV-006 exists to prevent. The key stays
            // in the state so the screen can say the list is incomplete.
            val extra = serverKeys + "deletion.consequence.somethingNew"
            val vm = DeleteAccountViewModel(script(keys = extra))
            advanceUntilIdle()

            assertEquals(extra, vm.state.value.consequenceKeys)
            assertTrue(
                "and deletion is still possible — an app version must not trap somebody",
                vm.state.value.copy(password = "x").canSubmit,
            )
        }

    // ==================================================== SET-FR-004 · the password
    @Test
    fun `THE PASSWORD IS REQUIRED, AND IT IS WHAT REACHES THE SERVER`() =
        runTest(dispatcher) {
            // "The phone is already unlocked and in somebody's hand — a friend,
            // a relative, a partner. The password is the one thing that
            // distinguishes the account's owner from whoever is holding the
            // device."
            val script = script()
            val vm = DeleteAccountViewModel(script)
            advanceUntilIdle()

            assertFalse("an empty password submits nothing", vm.state.value.canSubmit)

            vm.onPasswordChanged("Correct1horse")
            assertTrue(vm.state.value.canSubmit)

            vm.submit(onDeleted = {})
            advanceUntilIdle()

            assertEquals(listOf("Correct1horse"), script.passwords)
        }

    @Test
    fun `A WRONG PASSWORD IS NOT A SIGN-OUT`() = runTest(dispatcher) {
        // The server returns 400 rather than 401 deliberately, "because a 401
        // would sign a confused user out of an account they were trying not to
        // lose". So this must not be treated as a session failure either.
        val script = script()
        script.deleteResult = ApiResult.Err(ApiFailure.Validation(message = null))
        val vm = DeleteAccountViewModel(script)
        advanceUntilIdle()

        vm.onPasswordChanged("Wrong1password")
        vm.submit(onDeleted = {})
        advanceUntilIdle()

        assertTrue(vm.state.value.wrongPassword)
        assertFalse("nothing was deleted", vm.state.value.deleted)
        // And the consequences are still on screen, so a retry is one field.
        assertTrue(vm.state.value.loaded)
    }

    @Test
    fun `A SUCCESSFUL DELETION LEAVES NO PASSWORD IN MEMORY`() = runTest(dispatcher) {
        // §39 and SEC-028 both forbid retaining one, and this screen is about to
        // be torn down with the whole graph behind it.
        val script = script()
        val vm = DeleteAccountViewModel(script)
        advanceUntilIdle()

        var deleted = false
        vm.onPasswordChanged("Correct1horse")
        vm.submit(onDeleted = { deleted = true })
        advanceUntilIdle()

        assertTrue(deleted)
        assertTrue(vm.state.value.deleted)
        assertEquals("", vm.state.value.password)
    }

    @Test
    fun `an offline attempt changes nothing and says so`() = runTest(dispatcher) {
        val script = script()
        script.deleteResult = ApiResult.Err(ApiFailure.Offline)
        val vm = DeleteAccountViewModel(script)
        advanceUntilIdle()

        vm.onPasswordChanged("Correct1horse")
        vm.submit(onDeleted = {})
        advanceUntilIdle()

        assertFalse(vm.state.value.deleted)
        assertFalse(vm.state.value.wrongPassword)
        assertEquals(ApiFailure.Offline, vm.state.value.failure)
        // The typed password survives, so a retry does not start over.
        assertEquals("Correct1horse", vm.state.value.password)
    }

    @Test
    fun `an already-pending account is told plainly rather than shown a failure`() =
        runTest(dispatcher) {
            // "Somebody who taps twice should learn their account IS being
            // deleted rather than that something failed." The server's own
            // message carries that, so the client keeps it rather than
            // substituting a generic one.
            val script = script()
            script.deleteResult = ApiResult.Err(
                ApiFailure.Conflict("This account is already scheduled for deletion."),
            )
            val vm = DeleteAccountViewModel(script)
            advanceUntilIdle()

            vm.onPasswordChanged("Correct1horse")
            vm.submit(onDeleted = {})
            advanceUntilIdle()

            assertFalse(vm.state.value.wrongPassword)
            assertEquals(
                "This account is already scheduled for deletion.",
                vm.state.value.failure?.message,
            )
        }

    @Test
    fun `submitting twice sends one request`() = runTest(dispatcher) {
        val script = script()
        val vm = DeleteAccountViewModel(script)
        advanceUntilIdle()

        vm.onPasswordChanged("Correct1horse")
        vm.submit(onDeleted = {})
        vm.submit(onDeleted = {})
        advanceUntilIdle()

        assertEquals(1, script.passwords.size)
    }

    // ============================================================ the wire
    @Test
    fun `THE CONSEQUENCES COME AS KEYS, WITH NOWHERE TO PUT A SENTENCE`() {
        // Keys rather than text, so "readable in the user's chosen language"
        // holds without the server carrying two copies of six paragraphs — and
        // so the client cannot quietly reword what deletion does.
        assertExactFields(
            DeletionConsequencesResponse::class.java,
            setOf("keys", "graceDays", "scheduledErasureAt"),
            "PRIV-006 — the consequences are localisation KEYS in the server's order; the " +
                "client translates them and never composes its own",
        )
    }

    @Test
    fun `THE DELETE REQUEST CARRIES A PASSWORD AND NOTHING ELSE`() {
        // SET-FR-004 asks for one confirmation and one only. A "reason" or a
        // "confirm" flag would be a second thing to get wrong on the product's
        // only irreversible action.
        assertExactFields(
            DeleteAccountRequest::class.java,
            setOf("password"),
            "SET-FR-004 — the password is re-entered, and it is the whole of the confirmation",
        )
    }

    @Test
    fun `a null erasure date is a real answer for anybody not already deleting`() {
        // The consequences endpoint serves the restore screen too, and returns
        // `scheduledErasureAt` only for an account that has one — "null for
        // everybody else, because there is no deletion to count down to".
        val none = DeletionConsequencesResponse(keys = serverKeys, graceDays = 30)
        assertNull(none.scheduledErasureAt)
    }
}
