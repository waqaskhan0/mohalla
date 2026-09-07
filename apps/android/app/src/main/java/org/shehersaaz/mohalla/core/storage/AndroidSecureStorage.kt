package org.shehersaaz.mohalla.core.storage

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKeys

/**
 * SEC-004 — session tokens in `EncryptedSharedPreferences`, keyed by Keystore.
 *
 * WHAT THIS REPLACES. The Stage 5 foundation shipped `InMemorySecureStorage`,
 * which was honest about being a stub and had exactly one consequence: the
 * session did not survive the process. Every cold start signed the user out.
 * On the 2 GB devices NFR-COMP-002 targets, Android reclaims a backgrounded
 * process often, so "survives the process" is not an edge case — it is the
 * normal path, and re-entering an OTP because the launcher was opened would
 * have been the product's most frequent interaction.
 *
 * WHY KEYSTORE AND NOT JUST A FILE. The threat is not a remote attacker; it is
 * a shared or lost handset, which is the common case for the audience the
 * product is for. A bearer token in plaintext preferences is readable by anyone
 * with the device unlocked and a file manager on a rooted phone. The Keystore
 * key is hardware-backed where the device offers it and never leaves it.
 *
 * IT FAILS CLOSED, NOT OPEN. Keystore can genuinely fail — a corrupted keyset
 * after a restore-from-backup, a device whose secure hardware is in a bad
 * state. [create] catches that, clears the keyset and retries once; if the
 * retry also fails it returns a storage that keeps nothing, so the user is
 * signed out rather than having their token written somewhere unencrypted.
 * Degrading to plaintext on failure would be the one outcome SEC-004 exists to
 * prevent.
 */
class AndroidSecureStorage private constructor(
    private val prefs: SharedPreferences,
) : SecureStorage {

    override fun putString(key: String, value: String) {
        prefs.edit().putString(key, value).apply()
    }

    override fun getString(key: String): String? = prefs.getString(key, null)

    override fun remove(key: String) {
        prefs.edit().remove(key).apply()
    }

    /**
     * SET-FR-006 — clear everything.
     *
     * Called on logout and on account deletion. `commit()` rather than
     * `apply()` on purpose: logout usually precedes finishing the activity, and
     * an asynchronous write that loses the race leaves the token on disk after
     * the user believes they have signed out.
     */
    override fun clear() {
        prefs.edit().clear().commit()
    }

    companion object {
        private const val FILE = "mohalla.session.v1"

        fun create(context: Context): SecureStorage {
            return try {
                AndroidSecureStorage(open(context))
            } catch (first: Exception) {
                // A damaged keyset is unrecoverable but not fatal: the only
                // thing it holds is a session, and a lost session means one
                // sign-in. Delete and retry once.
                context.deleteSharedPreferences(FILE)
                try {
                    AndroidSecureStorage(open(context))
                } catch (second: Exception) {
                    // Never fall back to plaintext. Nothing persists, the user
                    // signs in again this launch, and SEC-004 holds.
                    InMemorySecureStorage()
                }
            }
        }

        /**
         * `MasterKeys` rather than `MasterKey.Builder`.
         *
         * The builder API arrived in security-crypto 1.1.0, which has been in
         * ALPHA for years. This is a product build for an audience that cannot
         * easily update, so a deprecated-but-released API is the better trade
         * than an alpha dependency in the path that holds session tokens. The
         * key spec is identical — AES256-GCM, Keystore-backed — so the
         * deprecation costs a warning and nothing else.
         */
        @Suppress("DEPRECATION")
        private fun open(context: Context): SharedPreferences {
            val alias = MasterKeys.getOrCreate(MasterKeys.AES256_GCM_SPEC)

            return EncryptedSharedPreferences.create(
                FILE,
                alias,
                context,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
            )
        }
    }
}
