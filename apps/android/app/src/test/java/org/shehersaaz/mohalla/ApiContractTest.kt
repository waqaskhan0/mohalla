package org.shehersaaz.mohalla

import java.io.File
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Every route the client calls, checked against the server's own contract —
 * §44/§45 integration validation.
 *
 * WHAT THIS REPLACES IS THE ONE THING THIS PROJECT CANNOT DO. §44's eleven
 * end-to-end flows need a device and there is none (`20-mobile-open-issues.md`
 * §2), so the integration that CAN be validated here is the seam itself: does
 * every endpoint the Android client declares actually exist on the backend, with
 * the same method and the same path shape?
 *
 * THAT SEAM IS WHERE THIS STAGE'S DEFECTS ACTUALLY CAME FROM. Group 12's
 * message-history cursor deserialised into the events cursor's field name and
 * broke paging on long threads. Group 14–15's PATCH bodies could not express a
 * null and made clearing a bio impossible. Group 21's share link built the
 * internal route instead of the public path, so every shared post opened a
 * browser. None of those was a logic error — each was the client and the server
 * disagreeing about a string, which is exactly the class of defect a contract
 * check catches and a unit test does not.
 *
 * THE SPEC IS THE GENERATED ONE, not the hand-written `openapi-v1.yaml`. A
 * hand-written contract can be out of date with the code that serves it; the
 * generated file is produced from the NestJS controllers, so a route that
 * appears in it is a route that exists.
 *
 * PATH PARAMETERS ARE NORMALISED because the two sides name them differently and
 * legitimately: Retrofit's `@Path("id")` and the controller's `:id` become
 * `{id}` in the spec, while the client writes `{conversationId}` for the same
 * position. Comparing the NAMES would fail on a difference that has no effect on
 * a single request.
 */
class ApiContractTest {

    private val json = Json { ignoreUnknownKeys = true }

    /** Every `METHOD /path` the backend serves. */
    private val serverRoutes: Set<Route> by lazy {
        // Gradle runs unit tests with the MODULE as the working directory, so
        // three levels up from `apps/android/app` is the repository root.
        val spec = File("../../../docs/architecture/contracts/openapi-stage6-generated.json")
        assertTrue(
            "the generated OpenAPI contract must be readable at ${spec.absolutePath}",
            spec.isFile,
        )

        val paths = json.parseToJsonElement(spec.readText())
            .jsonObject["paths"]!!
            .jsonObject

        paths.entries.flatMap { (path, operations) ->
            (operations as JsonObject).keys.map { Route(it.uppercase(), path) }
        }.toSet()
    }

    /** Every route the Retrofit interface declares. */
    private val clientRoutes: Set<Route> by lazy {
        val api = File("src/main/java/org/shehersaaz/mohalla/core/network/MohallaApi.kt")
        assertTrue("MohallaApi.kt must be readable", api.isFile)
        val text = api.readText()

        val annotated = Regex("""@(GET|POST|PUT|PATCH|DELETE)\("([^"]+)"\)""")
            .findAll(text)
            .map { Route(it.groupValues[1], "/" + it.groupValues[2]) }

        // `@HTTP` is used where a method needs a body Retrofit's own annotation
        // will not carry — `DELETE /me` with the re-entered password.
        val http = Regex("""@HTTP\(method = "(\w+)", path = "([^"]+)"""")
            .findAll(text)
            .map { Route(it.groupValues[1], "/" + it.groupValues[2]) }

        (annotated + http).toSet()
    }

    private data class Route(val method: String, val path: String) {
        /** `{anything}` collapses to `{}` — see the class comment. */
        val shape: String get() = path.replace(Regex("""\{[^}]+}"""), "{}")

        override fun toString() = "$method $path"
    }

    @Test
    fun `EVERY ROUTE THE CLIENT CALLS EXISTS ON THE SERVER`() {
        // The assertion this file is for. A client route absent from the
        // contract is a 404 waiting for whoever opens that screen on a device —
        // and with no device in this project, nothing else would find it.
        val serverShapes = serverRoutes.map { it.method to it.shape }.toSet()

        val missing = clientRoutes
            .filterNot { (it.method to it.shape) in serverShapes }
            .sortedBy { it.toString() }

        assertEquals(
            "These routes are declared by MohallaApi and served by nothing:\n" +
                missing.joinToString("\n") { "    $it" } + "\n",
            emptyList<Route>(),
            missing,
        )
    }

    @Test
    fun `THE CLIENT ACTUALLY COVERS THE PRODUCT SURFACE`() {
        // The check above passes trivially for a client that calls nothing, so
        // this is the other half: 75 routes across fifteen modules is the shape
        // of an app that talks to the whole product rather than a corner of it.
        assertTrue(
            "only ${clientRoutes.size} routes declared — the client should cover the product",
            clientRoutes.size >= 70,
        )
    }

    @Test
    fun `EVERY SERVER ROUTE THE CLIENT IGNORES IS IGNORED FOR A STATED REASON`() {
        // THE INTERESTING DIRECTION. A server route nobody calls is either out
        // of scope, blocked, or a requirement quietly dropped — and the third is
        // the one worth catching. So each is enumerated with its reason, and a
        // NEW unused route fails this test until somebody says which it is.
        // MATCHED BY PREFIX OR WHOLE PATH, never by substring. A substring
        // rule is the kind that stops working silently: "media" would go on to
        // explain a future `POST /posts/{}/media`, and "session" a future
        // `POST /session/logout-all`, which is exactly the dropped requirement
        // this test exists to catch.
        val explainedPrefixes = mapOf(
            // §49 and the Stage 7 brief both exclude the Admin Web Portal.
            "/admin/" to "The Admin Web Portal is not part of Stage 7.",
            // Infrastructure, not product.
            "/health" to "Liveness and readiness are for the platform, not the app.",
        )

        val explainedExactly = mapOf(
            // GAP-M-010 — no push service has been provisioned (DEP-003), so
            // there is no device token to register or remove.
            "/notifications/devices" to
                "Push is not implemented: DEP-003 is unprovisioned (GAP-M-010).",
            // The route's own summary: "The guard already slides the window on
            // every authenticated request, so this exists for a client that
            // wants to extend a session without making a real call." This app
            // always has a real call to make, so it never needs one. NOT a gap.
            "/session/refresh" to
                "The idle window already slides on every authenticated request.",
            // BYTES, NOT JSON — three routes that move an image rather than a
            // model, and none of them belongs on a Retrofit interface.
            //
            // The two GETs are read by Coil, which owns its own request
            // pipeline and needs a URL rather than a typed call. The PUT is
            // made by `ImageUploader` with OkHttp directly, and deliberately:
            // the URL, the method and the headers all come from the slot the
            // server just issued — "the client does not invent headers for a
            // presigned target" — so hardcoding `PUT /media/upload/{key}` in
            // the client would be asserting a shape the server is entitled to
            // change. The JSON either side of it, `POST media/upload-slot` and
            // `POST media/{id}/complete`, IS declared and IS checked.
            "/media/{}" to "Read by Coil, which needs a URL rather than a typed call.",
            "/media/upload/{}" to "The presigned byte PUT: url, method and headers come from the slot.",
            "/conversations/media/{}" to "Attachment bytes, read by Coil.",
            // PROFILE-FR-011 is a COULD with no screen in the 61-screen UI/UX
            // inventory and an open decision behind it (OD-017). The client
            // READS `interests` on the own-profile response and can never write
            // it back. GAP-M-016.
            "/me/interests" to
                "PROFILE-FR-011 has no designed screen (OD-017, GAP-M-016).",
        )

        val clientShapes = clientRoutes.map { it.method to it.shape }.toSet()

        val unexplained = serverRoutes
            .filterNot { (it.method to it.shape) in clientShapes }
            .filterNot { route ->
                route.shape in explainedExactly ||
                    explainedPrefixes.keys.any { route.path.startsWith(it) }
            }
            .sortedBy { it.toString() }

        assertEquals(
            "These server routes are called by nothing and explained by nothing. " +
                "Add the reason to this test, or call them:\n" +
                unexplained.joinToString("\n") { "    $it" } + "\n",
            emptyList<Route>(),
            unexplained,
        )
    }

    @Test
    fun `THE CONTRACT IS THE GENERATED ONE, AND IT IS THE WHOLE PRODUCT`() {
        // A guard on the fixture itself. If the spec were truncated or a stale
        // fragment, the first test would pass for the wrong reason — a client
        // route "exists" only because the file it was checked against is thin.
        assertTrue(
            "the generated contract looks too small: ${serverRoutes.size} routes",
            serverRoutes.size >= 80,
        )
    }
}
