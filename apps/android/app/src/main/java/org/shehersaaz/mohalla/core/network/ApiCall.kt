package org.shehersaaz.mohalla.core.network

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import retrofit2.HttpException
import retrofit2.Response
import java.io.IOException

/**
 * The one place an HTTP response becomes an [ApiResult].
 *
 * EVERY repository call goes through here, and that is the point. The mapping
 * from status code to UI state carries privacy decisions — a 404 must stay one
 * indistinguishable state (BR-025, SEC-019) and a 401 must always mean sign-out
 * (EDGE-010) — and a rule enforced in one function cannot be got wrong by the
 * fifteenth repository somebody writes.
 *
 * NOTHING IS LOGGED HERE. SEC-028 forbids logging tokens, phone numbers or
 * message content, and a request body on this product contains all three. An
 * interceptor that dumped bodies in debug builds would be the easiest possible
 * way to violate it, so there isn't one — `okhttp-logging` is deliberately not
 * wired in even for debug.
 */
val MohallaJson: Json = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
    // The backend never sends a bare value where an object is expected, but a
    // lenient parser survives an additive contract change instead of crashing
    // a screen on a field the app does not know about yet.
    coerceInputValues = true
}

/**
 * Run a Retrofit call and classify the outcome.
 *
 * @param onUnauthenticated invoked before the failure is returned, so the shell
 *   can sign out exactly once regardless of which screen made the call.
 */
suspend fun <T> apiCall(
    onUnauthenticated: (() -> Unit)? = null,
    block: suspend () -> Response<T>,
): ApiResult<T> = withContext(Dispatchers.IO) {
    try {
        val response = block()
        val body = response.body()

        if (response.isSuccessful) {
            @Suppress("UNCHECKED_CAST")
            return@withContext when {
                body != null -> ApiResult.Ok(body)
                // 204 No Content is a success with nothing in it. Several
                // endpoints use it (logout, unfollow, unlike, set language), and
                // treating an empty body as a parse failure would make every one
                // of them look broken.
                response.code() == 204 -> ApiResult.Ok(Unit as T)
                else -> ApiResult.Err(ApiFailure.Server(null))
            }
        }

        val envelope = parseEnvelope(response)
        ApiResult.Err(classify(response.code(), envelope, response, onUnauthenticated))
    } catch (e: IOException) {
        // No socket, DNS failure, timeout. NOT an error screen — UX-STATE-002,
        // because cached content may still be readable and a retry will likely
        // work (NFR-AVAIL-002).
        ApiResult.Err(ApiFailure.Offline)
    } catch (e: HttpException) {
        ApiResult.Err(ApiFailure.Server(null))
    } catch (e: Exception) {
        // A serialization failure or anything else unanticipated. The user gets
        // the generic server state; the detail never reaches them (SEC-018).
        ApiResult.Err(ApiFailure.Server(null))
    }
}

private fun <T> parseEnvelope(response: Response<T>): ApiErrorBody? = try {
    response.errorBody()?.string()?.takeIf { it.isNotBlank() }?.let {
        MohallaJson.decodeFromString<ApiErrorEnvelope>(it).error
    }
} catch (e: Exception) {
    // A non-JSON body from a proxy or gateway. Nothing to show; the status code
    // still classifies correctly below.
    null
}

private fun <T> classify(
    code: Int,
    error: ApiErrorBody?,
    response: Response<T>,
    onUnauthenticated: (() -> Unit)?,
): ApiFailure = when (code) {
    400, 422 -> ApiFailure.Validation(
        message = error?.message,
        fieldErrors = error?.details.orEmpty()
            .mapNotNull { d -> d.path?.let { p -> p to (d.message ?: return@mapNotNull null) } }
            .toMap(),
        code = error?.code,
    )

    401 -> {
        onUnauthenticated?.invoke()
        ApiFailure.Unauthenticated
    }

    403 -> ApiFailure.Restricted(error?.message)

    // ONE STATE. Deleted, auto-hidden, blocked, banned, never existed — the
    // server refuses identically and so does this. There is no sub-case to add
    // here, and adding one would undo mandatory test A.
    404 -> ApiFailure.Unavailable(error?.message)

    409 -> ApiFailure.Conflict(error?.message, error?.code)

    429 -> ApiFailure.RateLimited(
        message = error?.message,
        retryAfterSeconds = response.headers()["Retry-After"]?.toIntOrNull(),
    )

    else -> ApiFailure.Server(error?.message, error?.correlationId)
}
