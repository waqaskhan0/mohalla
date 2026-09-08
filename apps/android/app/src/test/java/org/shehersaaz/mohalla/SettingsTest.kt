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
import org.shehersaaz.mohalla.core.locale.AppLocale
import org.shehersaaz.mohalla.core.network.ApiFailure
import org.shehersaaz.mohalla.core.network.ApiResult
import org.shehersaaz.mohalla.core.network.BlockEntryResponse
import org.shehersaaz.mohalla.feature.auth.PasswordProblem
import org.shehersaaz.mohalla.feature.settings.BlockPage
import org.shehersaaz.mohalla.feature.settings.BlockedUsersViewModel
import org.shehersaaz.mohalla.feature.settings.ChangePasswordViewModel
import org.shehersaaz.mohalla.feature.settings.DeletionConsequences
import org.shehersaaz.mohalla.feature.settings.SettingsScreen
import org.shehersaaz.mohalla.feature.settings.SettingsSource
import org.shehersaaz.mohalla.feature.settings.SettingsViewModel

/**
 * Settings (SET-FR-001…010 · SAFETY-FR-006/007 · AUTH-FR-006/007 · BR-040).
 *
 * THE TWO ASSERTIONS THAT MATTER MOST ARE BOTH ABOUT WHAT HAPPENS WHEN A
 * REQUEST FAILS, because this is the screen people reach for when something is
 * already wrong.
 *
 *   SIGNING OUT MUST WORK OFFLINE. SET-FR-006's criterion is about what this
 *   device shows afterwards — "the welcome screen is shown and no cached
 *   personal content is visible" — and that is satisfied locally. A sign-out
 *   that failed because a train went into a tunnel, on a shared phone, is the
 *   worst possible time to leave somebody signed in.
 *
 *   AND THE INDEX MUST STILL RENDER. Every row is a destination that exists
 *   whether or not `GET /me/settings` came back; a settings screen replaced by
 *   an error page strands the person who came to use it.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class SettingsTest {

    private val dispatcher = StandardTestDispatcher()

    @Before fun setUp() = Dispatchers.setMain(dispatcher)

    @After fun tearDown() = Dispatchers.resetMain()

    private class Script(
        var screenResult: ApiResult<SettingsScreen> =
            ApiResult.Ok(SettingsScreen(language = AppLocale.ENGLISH, blockedCount = 0)),
        var languageResult: ApiResult<Unit> = ApiResult.Ok(Unit),
        var passwordResult: ApiResult<Unit> = ApiResult.Ok(Unit),
        val blockPages: MutableList<ApiResult<BlockPage>> = mutableListOf(),
        var unblockResult: ApiResult<Unit> = ApiResult.Ok(Unit),
    ) : SettingsSource {
        val languagesSent = mutableListOf<AppLocale>()
        val passwordsSent = mutableListOf<Pair<String, String>>()
        val unblocked = mutableListOf<String>()

        override suspend fun screen(): ApiResult<SettingsScreen> = screenResult

        override suspend fun setLanguage(locale: AppLocale): ApiResult<Unit> {
            languagesSent += locale
            return languageResult
        }

        override suspend fun changePassword(current: String, new: String): ApiResult<Unit> {
            passwordsSent += current to new
            return passwordResult
        }

        override suspend fun blocks(before: String?): ApiResult<BlockPage> =
            blockPages.removeFirstOrNull() ?: ApiResult.Ok(BlockPage(emptyList(), null))

        override suspend fun unblock(userId: String): ApiResult<Unit> {
            unblocked += userId
            return unblockResult
        }

        // The deletion half of the same source. Exercised in `DeleteAccountTest`
        // against its own narrower interface; present here because the settings
        // repository implements both.
        override suspend fun deletionConsequences(): ApiResult<DeletionConsequences> =
            ApiResult.Ok(
                DeletionConsequences(keys = emptyList(), graceDays = 30, scheduledErasureAt = null),
            )

        override suspend fun deleteAccount(password: String): ApiResult<Unit> =
            ApiResult.Ok(Unit)
    }

    private class Harness(
        val script: Script = Script(),
        var device: AppLocale? = AppLocale.ENGLISH,
        var remoteSignOut: ApiResult<Unit> = ApiResult.Ok(Unit),
    ) {
        val stored = mutableListOf<AppLocale>()
        var localClears = 0
        var remoteCalls = 0

        fun viewModel() = SettingsViewModel(
            settings = script,
            storedLocale = { device },
            storeLocale = { stored += it; device = it },
            signOutLocally = { localClears++ },
            signOutRemotely = { remoteCalls++; remoteSignOut },
        )
    }

    private fun block(id: String, at: String = "2026-09-01T10:00:00Z") =
        BlockEntryResponse(blockedUserId = id, createdAt = at)

    // ================================================== SET-FR-006 · sign out
    @Test
    fun `SIGNING OUT CLEARS THIS DEVICE EVEN WHEN THE SERVER CANNOT BE REACHED`() =
        runTest(dispatcher) {
            // "GIVEN logout completes, WHEN the app reopens, THEN the welcome
            // screen is shown and no cached personal content is visible." That
            // is a claim about this device, and the local clear is what makes it
            // true. On a shared phone, a sign-out that failed because the
            // network did is the worst possible time to stay signed in.
            val harness = Harness(remoteSignOut = ApiResult.Err(ApiFailure.Offline))
            val vm = harness.viewModel()
            advanceUntilIdle()

            var signedOut = false
            vm.signOut { signedOut = true }
            advanceUntilIdle()

            assertEquals("the revocation is still attempted", 1, harness.remoteCalls)
            assertEquals("and the local clear happens regardless", 1, harness.localClears)
            assertTrue(signedOut)
        }

    @Test
    fun `signing out twice does not clear twice`() = runTest(dispatcher) {
        val harness = Harness()
        val vm = harness.viewModel()
        advanceUntilIdle()

        vm.signOut {}
        vm.signOut {}
        advanceUntilIdle()

        assertEquals(1, harness.remoteCalls)
        assertEquals(1, harness.localClears)
    }

    // ============================================== SET-FR-001 · the language
    @Test
    fun `THE DEVICE IS WRITTEN BEFORE THE REQUEST, NOT AFTER IT`() = runTest(dispatcher) {
        // The caller recreates the activity the moment this returns, and the new
        // activity reads the stored value to decide its layout direction. A
        // write that lost that race would compose the whole app in the old
        // direction — asserted synchronously, before the scheduler runs.
        val harness = Harness(device = AppLocale.ENGLISH)
        val vm = harness.viewModel()
        advanceUntilIdle()

        vm.chooseLanguage(AppLocale.URDU)

        assertEquals(listOf(AppLocale.URDU), harness.stored)
        assertEquals(AppLocale.URDU, vm.state.value.effectiveLanguage)
        assertTrue("the request has not run yet", harness.script.languagesSent.isEmpty())

        advanceUntilIdle()
        assertEquals(listOf(AppLocale.URDU), harness.script.languagesSent)
    }

    @Test
    fun `A FAILED LANGUAGE SYNC DOES NOT UNDO THE SWITCH`() = runTest(dispatcher) {
        // LOCALE-FR-002 promises the interface changes immediately, and it did.
        // What failed is the ACCOUNT's copy — the thing that carries the choice
        // to another device (SET-FR-001) — and choosing again is the retry.
        // Reverting would flip the whole app back under somebody who is reading
        // it.
        val harness = Harness(
            script = Script(languageResult = ApiResult.Err(ApiFailure.Offline)),
            device = AppLocale.ENGLISH,
        )
        val vm = harness.viewModel()
        advanceUntilIdle()

        vm.chooseLanguage(AppLocale.URDU)
        advanceUntilIdle()

        assertEquals(AppLocale.URDU, vm.state.value.effectiveLanguage)
        assertEquals(listOf(AppLocale.URDU), harness.stored)
        assertTrue(vm.state.value.languageSyncFailed)
    }

    @Test
    fun `choosing the language already in use does nothing at all`() = runTest(dispatcher) {
        val harness = Harness(device = AppLocale.URDU)
        harness.script.screenResult =
            ApiResult.Ok(SettingsScreen(language = AppLocale.URDU, blockedCount = 0))
        val vm = harness.viewModel()
        advanceUntilIdle()

        vm.chooseLanguage(AppLocale.URDU)
        advanceUntilIdle()

        assertTrue(harness.stored.isEmpty())
        assertTrue(harness.script.languagesSent.isEmpty())
    }

    @Test
    fun `BR-040's NULL IS A REAL ANSWER, AND THE DEVICE'S CHOICE STANDS IN`() =
        runTest(dispatcher) {
            // No default is pre-selected, so an account that has never chosen
            // has no stored language. Showing "not set" on a screen the reader
            // is looking at in Urdu would be true and useless.
            val harness = Harness(
                script = Script(
                    screenResult = ApiResult.Ok(SettingsScreen(language = null, blockedCount = 0)),
                ),
                device = AppLocale.URDU,
            )
            val vm = harness.viewModel()
            advanceUntilIdle()

            assertNull(vm.state.value.accountLanguage)
            assertEquals(AppLocale.URDU, vm.state.value.effectiveLanguage)
        }

    @Test
    fun `an unrecognised language tag is not a language`() {
        // A tag this build cannot render is not one it can claim is selected.
        assertEquals(AppLocale.URDU, AppLocale.fromTag("ur"))
        assertEquals(AppLocale.ENGLISH, AppLocale.fromTag("en"))
        assertNull(AppLocale.fromTag("fr"))
        assertNull(AppLocale.fromTag(null))
    }

    // ================================================= SET-FR-001 · the index
    @Test
    fun `A FAILED SETTINGS REQUEST GREYS OUT TWO SUBTITLES AND NOTHING ELSE`() =
        runTest(dispatcher) {
            // Every row is a destination that exists whether or not this request
            // came back. Replacing a navigation screen with an error page would
            // strand somebody who came here to sign out — which is exactly what
            // people do when something is wrong.
            val harness = Harness(
                script = Script(screenResult = ApiResult.Err(ApiFailure.Offline)),
                device = AppLocale.ENGLISH,
            )
            val vm = harness.viewModel()
            advanceUntilIdle()

            assertEquals(ApiFailure.Offline, vm.state.value.failure)
            assertFalse("so the count is NOT rendered", vm.state.value.blockedCountKnown)
            // The device's own choice still answers the language row.
            assertEquals(AppLocale.ENGLISH, vm.state.value.effectiveLanguage)

            // And signing out still works.
            vm.signOut {}
            advanceUntilIdle()
            assertEquals(1, harness.localClears)
        }

    @Test
    fun `a blocked count of zero is only shown once it is known`() = runTest(dispatcher) {
        val harness = Harness(
            script = Script(
                screenResult = ApiResult.Ok(
                    SettingsScreen(language = AppLocale.ENGLISH, blockedCount = 0),
                ),
            ),
        )
        val vm = harness.viewModel()
        advanceUntilIdle()

        assertTrue(vm.state.value.blockedCountKnown)
        assertEquals(0, vm.state.value.blockedCount)
    }

    // ============================================ SET-FR-002 · change password
    @Test
    fun `THE NEW PASSWORD MUST DIFFER FROM THE CURRENT ONE`() {
        // Re-entering the same password would still invalidate every other
        // session and would still look like it worked — leaving somebody
        // believing they had removed an intruder who knows the password they
        // just re-entered.
        val vm = ChangePasswordViewModel(Script())
        vm.onCurrentChanged("Correct1horse")
        vm.onNewChanged("Correct1horse")
        vm.onConfirmChanged("Correct1horse")

        assertTrue(vm.state.value.newSameAsCurrent)
        assertFalse(vm.state.value.canSubmit)
    }

    @Test
    fun `THE CONFIRMATION IS NOT CEREMONY ON THIS SCREEN`() {
        // A mistyped new password here locks the owner out of their own account
        // with every other session already dead.
        val vm = ChangePasswordViewModel(Script())
        vm.onCurrentChanged("Old1password")
        vm.onNewChanged("New1password")
        vm.onConfirmChanged("New1passwrod")

        assertTrue(vm.state.value.confirmMismatch)
        assertFalse(vm.state.value.canSubmit)
    }

    @Test
    fun `THE POLICY IS REGISTRATION'S, UNCHANGED`() {
        // Two policies for one password is one policy too many.
        val vm = ChangePasswordViewModel(Script())
        vm.onCurrentChanged("Old1password")

        vm.onNewChanged("short1")
        assertEquals(PasswordProblem.TOO_SHORT, vm.state.value.newPasswordProblem)

        vm.onNewChanged("nodigitshere")
        assertEquals(PasswordProblem.NEEDS_DIGIT, vm.state.value.newPasswordProblem)

        vm.onNewChanged("12345678")
        assertEquals(PasswordProblem.NEEDS_LETTER, vm.state.value.newPasswordProblem)

        vm.onNewChanged("New1password")
        assertNull(vm.state.value.newPasswordProblem)
    }

    @Test
    fun `A WRONG CURRENT PASSWORD IS NAMED AT ITS OWN FIELD`() = runTest(dispatcher) {
        // It discloses nothing the reader did not just type themselves, and
        // saying only "invalid" would leave them correcting the wrong field.
        val script = Script(
            passwordResult = ApiResult.Err(ApiFailure.Validation(message = null)),
        )
        val vm = ChangePasswordViewModel(script)
        vm.onCurrentChanged("Wrong1password")
        vm.onNewChanged("New1password")
        vm.onConfirmChanged("New1password")

        vm.submit(onChanged = {})
        advanceUntilIdle()

        assertTrue(vm.state.value.wrongCurrent)
        assertFalse(vm.state.value.changed)
    }

    @Test
    fun `A SUCCESSFUL CHANGE LEAVES NOTHING IN MEMORY`() = runTest(dispatcher) {
        // SEC-028 and §39 both forbid a password being retained. There is no
        // draft and no SavedStateHandle on this screen; the fields are cleared
        // the moment the change succeeds.
        val script = Script()
        val vm = ChangePasswordViewModel(script)
        vm.onCurrentChanged("Old1password")
        vm.onNewChanged("New1password")
        vm.onConfirmChanged("New1password")

        var changed = false
        vm.submit(onChanged = { changed = true })
        advanceUntilIdle()

        assertTrue(changed)
        assertEquals(listOf("Old1password" to "New1password"), script.passwordsSent)
        assertEquals("", vm.state.value.current)
        assertEquals("", vm.state.value.new)
        assertEquals("", vm.state.value.confirm)
    }

    @Test
    fun `an incomplete form is not submitted`() = runTest(dispatcher) {
        val script = Script()
        val vm = ChangePasswordViewModel(script)
        vm.onCurrentChanged("Old1password")

        vm.submit(onChanged = {})
        advanceUntilIdle()

        assertTrue(script.passwordsSent.isEmpty())
    }

    // ============================================ SAFETY-FR-007 · the blocked list
    @Test
    fun `THE LIST ENDS ON A SHORT PAGE, NOT ON A NULL CURSOR`() = runTest(dispatcher) {
        // The server sets `nextBefore` to the last row's timestamp whenever the
        // page has rows — so it is non-null on the FINAL page too, and a client
        // that paged until it went null would re-fetch that page forever. The
        // repository derives the end from a page shorter than the limit; this
        // asserts the state that derivation produces.
        val script = Script(
            blockPages = mutableListOf(
                ApiResult.Ok(BlockPage(listOf(block("a"), block("b")), nextBefore = null)),
            ),
        )
        val vm = BlockedUsersViewModel(script)
        advanceUntilIdle()

        assertTrue(vm.state.value.atEnd)

        vm.loadMore()
        advanceUntilIdle()

        assertEquals(listOf("a", "b"), vm.state.value.blocks.map { it.blockedUserId })
    }

    @Test
    fun `UNBLOCKING REMOVES THE ROW AND PUTS IT BACK IF IT FAILED`() = runTest(dispatcher) {
        // SET-FR-003: "GIVEN an account is unblocked from this list, WHEN the
        // list reloads, THEN it is no longer present." The row leaving is the
        // only feedback there is — and on a list whose rows carry no names, one
        // that came back at the bottom would look like a different person.
        val script = Script(
            blockPages = mutableListOf(
                ApiResult.Ok(BlockPage(listOf(block("a"), block("b"), block("c")), null)),
            ),
            unblockResult = ApiResult.Err(ApiFailure.Offline),
        )
        val vm = BlockedUsersViewModel(script)
        advanceUntilIdle()

        vm.unblock("b")
        assertEquals(listOf("a", "c"), vm.state.value.blocks.map { it.blockedUserId })

        advanceUntilIdle()

        assertEquals(listOf("a", "b", "c"), vm.state.value.blocks.map { it.blockedUserId })
        assertTrue(vm.state.value.actionFailed)
        assertEquals(listOf("b"), script.unblocked)
    }

    @Test
    fun `a successful unblock leaves the row out`() = runTest(dispatcher) {
        val script = Script(
            blockPages = mutableListOf(ApiResult.Ok(BlockPage(listOf(block("a"), block("b")), null))),
        )
        val vm = BlockedUsersViewModel(script)
        advanceUntilIdle()

        vm.unblock("a")
        advanceUntilIdle()

        assertEquals(listOf("b"), vm.state.value.blocks.map { it.blockedUserId })
        assertFalse(vm.state.value.actionFailed)
    }

    @Test
    fun `A FAILED BLOCK LIST NEVER READS AS AN EMPTY ONE`() = runTest(dispatcher) {
        // "You haven't blocked anyone" after a timeout tells somebody their
        // blocks are gone, which on a safety screen is the most alarming thing
        // this list could say untruthfully.
        val script = Script(blockPages = mutableListOf(ApiResult.Err(ApiFailure.Offline)))
        val vm = BlockedUsersViewModel(script)
        advanceUntilIdle()

        assertFalse(vm.state.value.isEmpty)
        assertEquals(ApiFailure.Offline, vm.state.value.firstPageFailure)
    }

    @Test
    fun `a genuinely empty block list is empty`() = runTest(dispatcher) {
        val script = Script(blockPages = mutableListOf(ApiResult.Ok(BlockPage(emptyList(), null))))
        val vm = BlockedUsersViewModel(script)
        advanceUntilIdle()

        assertTrue(vm.state.value.isEmpty)
        assertNull(vm.state.value.firstPageFailure)
    }

    @Test
    fun `THE BLOCKED ROW CARRIES AN ID AND A DATE AND NOTHING ELSE`() {
        // GAP-M-013 made structural. `GET /users/{id}` answers the neutral 404
        // for anybody blocked in either direction — every row here — so there is
        // no request that would name these people, and no field on the row that
        // could hold a name if one arrived.
        assertExactFields(
            BlockEntryResponse::class.java,
            setOf("blockedUserId", "createdAt"),
            "SAFETY-FR-007 — the list the server can give; a display name would need a " +
                "route that BR-025 refuses by design",
        )
    }
}
