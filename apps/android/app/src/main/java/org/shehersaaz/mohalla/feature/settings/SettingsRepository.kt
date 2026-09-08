package org.shehersaaz.mohalla.feature.settings

import org.shehersaaz.mohalla.core.locale.AppLocale
import org.shehersaaz.mohalla.core.network.ApiResult
import org.shehersaaz.mohalla.core.network.ChangePasswordRequest
import org.shehersaaz.mohalla.core.network.DeleteAccountRequest
import org.shehersaaz.mohalla.core.network.LanguageRequest
import org.shehersaaz.mohalla.core.network.MohallaApi
import org.shehersaaz.mohalla.core.network.apiCall
import org.shehersaaz.mohalla.core.network.map

/**
 * Settings (SET-FR-001…010 · SAFETY-FR-006/007 · AUTH-FR-006/007).
 *
 * THE SCREEN IS ONE REQUEST, BY THE SERVER'S DESIGN. `GET /me/settings` returns
 * the language, the notification preferences and the blocked count together, so
 * that a client "cannot render a partial screen when one of them is slow". The
 * client honours that by making one call and by treating a failure as a failure
 * of the screen rather than of a row.
 *
 * THE LANGUAGE LIVES IN TWO PLACES AND BOTH ARE NECESSARY. The ACCOUNT's copy is
 * what makes SET-FR-001's criterion true — "GIVEN Urdu is selected on one
 * device, WHEN the user logs in on another device, THEN Urdu is applied there
 * too" — and the DEVICE's copy is what makes the first frame of a cold start
 * render in the right direction, before any request could have answered. So a
 * change writes the device first and the account second, and a failed request
 * does not undo the local switch: LOCALE-FR-002 promises the interface changes
 * immediately, and it did.
 */
interface SettingsSource : DeletionSource {
    suspend fun screen(): ApiResult<SettingsScreen>

    suspend fun setLanguage(locale: AppLocale): ApiResult<Unit>

    suspend fun changePassword(current: String, new: String): ApiResult<Unit>

    suspend fun blocks(before: String? = null): ApiResult<BlockPage>

    suspend fun unblock(userId: String): ApiResult<Unit>
}

class SettingsRepository(
    private val api: MohallaApi,
) : SettingsSource {

    override suspend fun screen(): ApiResult<SettingsScreen> =
        apiCall { api.settings() }.map { response ->
            SettingsScreen(
                // Null is a real answer (BR-040) and is passed through as one.
                language = AppLocale.fromTag(response.language),
                blockedCount = response.blockedCount,
            )
        }

    override suspend fun setLanguage(locale: AppLocale): ApiResult<Unit> =
        apiCall { api.setLanguage(LanguageRequest(locale.tag)) }.map { }

    /**
     * SET-FR-002 — change the password.
     *
     * EVERY OTHER SESSION IS INVALIDATED AND THIS ONE IS NOT: "GIVEN a password
     * change on device A, WHEN device B makes its next request, THEN device B is
     * signed out." That is the server's doing, and it is the reason this screen
     * exists at all — it is how somebody who thinks their account is compromised
     * removes whoever else is signed in.
     */
    override suspend fun changePassword(current: String, new: String): ApiResult<Unit> =
        apiCall { api.changePassword(ChangePasswordRequest(current, new)) }.map { }

    /**
     * The blocked list (SAFETY-FR-007).
     *
     * PAGED BY A SHORT PAGE, NOT BY A NULL CURSOR. The server sets `nextBefore`
     * to the last row's timestamp whenever the page has rows — so it is non-null
     * on the FINAL page too, and a client that paged until it went null would
     * re-fetch that page forever. A page shorter than the limit is the end.
     */
    override suspend fun blocks(before: String?): ApiResult<BlockPage> =
        apiCall { api.blocks(limit = PAGE_SIZE, before = before) }.map { response ->
            BlockPage(
                blocks = response.blocks,
                nextBefore = response.nextBefore.takeIf { response.blocks.size >= PAGE_SIZE },
            )
        }

    override suspend fun unblock(userId: String): ApiResult<Unit> =
        apiCall { api.unblock(userId) }.map { }

    /**
     * What deletion does (PRIV-006).
     *
     * PASSED THROUGH UNCHANGED, keys and order alike. The order is a decision
     * the requirement made about what gets read — the surprising line is SECOND
     * — and a repository that sorted or filtered here would undo it silently.
     */
    override suspend fun deletionConsequences(): ApiResult<DeletionConsequences> =
        apiCall { api.deletionConsequences() }.map {
            DeletionConsequences(
                keys = it.keys,
                graceDays = it.graceDays,
                scheduledErasureAt = it.scheduledErasureAt,
            )
        }

    override suspend fun deleteAccount(password: String): ApiResult<Unit> =
        apiCall { api.deleteAccount(DeleteAccountRequest(password)) }.map { }

    companion object {
        const val PAGE_SIZE = 20
    }
}

/**
 * What the index shows.
 *
 * NOTIFICATION PREFERENCES ARE DELIBERATELY NOT HERE even though the response
 * carries them: UX-SET-003 owns those seven switches and reads them itself, and
 * a second copy on this screen would be a second thing to keep in step. What the
 * index needs from this call is the language and one number.
 */
data class SettingsScreen(
    val language: AppLocale?,
    val blockedCount: Int,
)

data class BlockPage(
    val blocks: List<org.shehersaaz.mohalla.core.network.BlockEntryResponse>,
    /** `null` means the end — derived from a short page, not from the server. */
    val nextBefore: String?,
)
