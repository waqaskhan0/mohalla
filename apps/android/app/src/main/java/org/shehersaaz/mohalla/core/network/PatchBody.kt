package org.shehersaaz.mohalla.core.network

import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/**
 * A PATCH body where **absent**, **null** and **a value** are three different
 * requests.
 *
 * THIS FILE EXISTS BECAUSE THE CLIENT COULD NOT SEND A NULL, AND TWO SCREENS
 * WERE SILENTLY BROKEN BY IT.
 *
 * `MohallaJson` sets `explicitNulls = false`, which is right for reading — a
 * server that stops sending an optional field must not crash a screen — and it
 * also means kotlinx **omits** a null property when WRITING. So
 * `UpdateProfileRequest(bio = null)` serialised to `{}`, and the API's rule is
 * the exact opposite of what that expresses:
 *
 *   > Send `null` to clear an optional field; omit it to leave it alone.
 *
 * The consequences were not cosmetic. Nobody could clear a bio, a city or a
 * profile photo — the request said "leave it alone" every time. And on
 * `PATCH /events/{id}` it broke a whole flow: the backend's own comment predicts
 * it, that "a caller switching a PHYSICAL event to ONLINE — who must send a link
 * AND null the location — would have the old location merged back in and be told
 * they supplied both. The type change would be impossible, and the error message
 * would blame a field they had just cleared."
 *
 * SO THE BODY IS BUILT AS JSON RATHER THAN AS A DATA CLASS. JSON already has
 * three states and a Kotlin nullable field has two; no amount of care with data
 * classes recovers the third under this parser configuration, and a second `Json`
 * instance configured differently for writing would be a subtler trap than the
 * one it fixed.
 *
 * ```
 * patch {
 *     field("displayName", "Ayesha Khan")   // set it
 *     field("bio", null)                     // CLEAR it
 *     // city is never mentioned            // leave it alone
 * }
 * ```
 */
fun patch(build: PatchBody.() -> Unit): JsonObject = PatchBody().apply(build).build()

class PatchBody internal constructor() {
    private val fields = mutableMapOf<String, kotlinx.serialization.json.JsonElement>()

    /**
     * Include a field.
     *
     * A `null` value is sent AS null, which the server reads as "clear this".
     * To leave a field alone, do not call this at all — which is why there is no
     * `field(name, value, include = false)` overload: an "include" flag reads as
     * a formatting detail, and forgetting it would restore exactly the bug this
     * file was written to fix.
     */
    fun field(name: String, value: String?) {
        fields[name] = if (value == null) JsonNull else JsonPrimitive(value)
    }

    fun field(name: String, value: Boolean) {
        fields[name] = JsonPrimitive(value)
    }

    /**
     * Include a field only when the caller actually changed it.
     *
     * The common case for an edit form, and it keeps the "only what changed"
     * decision in one place instead of at every call site. `to == null` with a
     * non-null `from` is a genuine CLEAR and is sent as one.
     */
    fun changed(name: String, from: String?, to: String?) {
        if (from != to) field(name, to)
    }

    /** How many fields the request will carry. Zero means there is nothing to send. */
    val size: Int get() = fields.size

    internal fun build() = JsonObject(fields)
}

/**
 * Absent · cleared · set.
 *
 * USED WHERE A CHANGE HAS TO TRAVEL THROUGH A LAYER BEFORE IT IS SERIALISED —
 * a ViewModel deciding what the user touched, handing it to a repository that
 * knows the wire format. A nullable field cannot carry the distinction, and this
 * is the smallest type that can.
 */
sealed interface Patch<out T> {
    /** Not touched. The field will not appear in the request at all. */
    data object Unchanged : Patch<Nothing>

    /** Explicitly emptied. The field will be sent as `null`. */
    data object Clear : Patch<Nothing>

    data class Set<T>(val value: T) : Patch<T>
}

/** Apply a [Patch] to a [PatchBody]. Exhaustive, so a new case cannot be missed. */
fun PatchBody.field(name: String, patch: Patch<String>) {
    when (patch) {
        Patch.Unchanged -> Unit
        Patch.Clear -> field(name, null)
        is Patch.Set -> field(name, patch.value)
    }
}

/** A value, or a clear when it is blank. Never "unchanged" — see [changedTo]. */
fun String?.asPatch(): Patch<String> =
    if (this.isNullOrBlank()) Patch.Clear else Patch.Set(this.trim())

/**
 * What to send for a field an edit form holds.
 *
 * Compares the trimmed new value against what the server holds: unchanged
 * fields are omitted, a value that was emptied becomes a CLEAR, and anything
 * else is a set. Blank and null are treated alike, because a text field the user
 * emptied contains `""` and means the same thing as absent.
 */
fun changedTo(current: String?, next: String?): Patch<String> {
    val before = current?.trim().orEmpty()
    val after = next?.trim().orEmpty()

    return when {
        before == after -> Patch.Unchanged
        after.isEmpty() -> Patch.Clear
        else -> Patch.Set(after)
    }
}
