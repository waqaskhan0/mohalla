package org.shehersaaz.mohalla

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.shehersaaz.mohalla.core.network.ApiFailure

/**
 * WHICH REFUSALS MAY EXPLAIN THEMSELVES, AS AN EXHAUSTIVE `when`.
 *
 * This is the rule the whole product's neutral-refusal discipline rests on, and
 * it is stated once here rather than re-derived at each call site:
 *
 *   A 404 IS ABOUT EXISTENCE, so its causes must stay indistinguishable —
 *   deleted, auto-hidden, blocked, banned and never-there are one answer
 *   (BR-025, SEC-019, mandatory test A). It therefore carries NO code.
 *
 *   A 403 IS ABOUT PERMISSION on something already known to exist, so a reason
 *   discloses nothing further — and EVENT-FR-003 requires one by name: "the
 *   join control is not yet active AND the availability time is stated". It
 *   carries a code and details.
 *
 *   A 400 IS ABOUT THE REQUEST, which the caller wrote, so naming the field is
 *   help rather than disclosure.
 *
 * AN EXHAUSTIVE `when` RATHER THAN REFLECTION, and the difference is the point.
 * Reflection asks "does this type happen to have a field called `code`?" — a
 * question a field named `reason` answers wrongly, which was measured: adding
 * `ApiFailure.Unavailable.reason` left all 271 tests passing. A `when` over the
 * sealed hierarchy asks the structural question instead, and a new variant
 * fails to COMPILE until somebody decides which side of the line it sits on.
 *
 * The exact-field-set assertions below close the remaining gap, which is a
 * field ADDED to an existing variant.
 */
class ApiFailureShapeTest {

    /**
     * What a failure is allowed to tell the caller about WHY.
     *
     * The `when` is exhaustive over `ApiFailure`, so a new variant is a compile
     * error here — deliberately, because "may this one explain itself?" is a
     * decision nobody should make implicitly.
     */
    private fun disclosedCode(failure: ApiFailure): String? = when (failure) {
        // ABOUT EXISTENCE. Nothing may distinguish the causes.
        is ApiFailure.Unavailable -> null

        // ABOUT THE SESSION. There is one cause and no payload at all.
        ApiFailure.Unauthenticated -> null

        // NOT A SERVER ANSWER. No socket, so nothing was said.
        ApiFailure.Offline -> null

        // ABOUT PERMISSION on something that exists. EVENT-FR-003 needs the
        // reason stated, and the resource is already public.
        is ApiFailure.Restricted -> failure.code

        // ABOUT THE REQUEST the caller wrote.
        is ApiFailure.Validation -> failure.code

        // ABOUT A COLLISION the caller can act on (EDGE-007, EDGE-024).
        is ApiFailure.Conflict -> failure.code

        // ABOUT PACING. No code, but a retry-after the caller can honour.
        is ApiFailure.RateLimited -> null

        // ABOUT US. The correlation id is for quoting to support, and says
        // nothing about the resource (SEC-018).
        is ApiFailure.Server -> null
    }

    @Test
    fun `THE NEUTRAL REFUSAL DISCLOSES NOTHING, AND CANNOT`() {
        // Mandatory test A's client half. If `Unavailable` ever gains a field
        // that distinguishes deleted from blocked from never-there, the whole
        // point of the server's uniform 404 is undone at the last step.
        assertNull(disclosedCode(ApiFailure.Unavailable(null)))
        assertNull(disclosedCode(ApiFailure.Unavailable("This content is no longer available.")))

        assertExactFields(
            type = ApiFailure.Unavailable::class.java,
            // The localised message and nothing else. Note the message is the
            // SAME sentence for every cause — the server sends one string.
            expected = setOf("message"),
            because = "BR-025 keeps deleted, auto-hidden, blocked, banned and " +
                "never-existed indistinguishable; any field here could tell them apart",
        )
    }

    @Test
    fun `A 403 CARRIES ITS REASON, WHICH IS THE ONE DELIBERATE EXCEPTION`() {
        assertEquals(
            "RSVP_REQUIRED",
            disclosedCode(ApiFailure.Restricted(message = null, code = "RSVP_REQUIRED")),
        )

        assertExactFields(
            type = ApiFailure.Restricted::class.java,
            expected = setOf("message", "code", "details"),
            because = "EVENT-FR-003 requires the join refusal to state its reason and " +
                "availability time, on an event that is already public",
        )
    }

    @Test
    fun `a 400 names the field the caller got wrong`() {
        assertEquals(
            "SEARCH_QUERY_TOO_SHORT",
            disclosedCode(
                ApiFailure.Validation(message = null, code = "SEARCH_QUERY_TOO_SHORT"),
            ),
        )

        assertExactFields(
            type = ApiFailure.Validation::class.java,
            expected = setOf("message", "fieldErrors", "code"),
            because = "a form must put each complaint under the right input, and the " +
                "request is the caller's own",
        )
    }

    @Test
    fun `AN UNAUTHENTICATED FAILURE CARRIES A CONSTANT NULL AND NOTHING ELSE`() {
        // A `data object`. It declares ONE field, `message`, because the sealed
        // interface requires the property and `override val message: String? =
        // null` gives it a backing field — which the first version of this test
        // did not expect and which the assertion caught. The field is a
        // CONSTANT NULL rather than a channel, and that is what is asserted:
        // EDGE-010's revocation and an expired token are one thing.
        assertNull(ApiFailure.Unauthenticated.message)
        assertNull(disclosedCode(ApiFailure.Unauthenticated))

        assertExactFields(
            type = ApiFailure.Unauthenticated::class.java,
            expected = setOf("message"),
            because = "the interface requires the property; it is a constant null here " +
                "because the session is simply gone and there is no variation to report",
        )
    }

    @Test
    fun `OFFLINE CARRIES A CONSTANT NULL, BECAUSE NOTHING WAS SAID`() {
        assertNull(ApiFailure.Offline.message)
        assertNull(disclosedCode(ApiFailure.Offline))

        assertExactFields(
            type = ApiFailure.Offline::class.java,
            expected = setOf("message"),
            because = "no socket means no server answer to report, so the required " +
                "property is a constant null",
        )
    }

    @Test
    fun `a rate limit carries pacing, not a cause`() {
        assertNull(disclosedCode(ApiFailure.RateLimited("Too many attempts.")))
        assertExactFields(
            type = ApiFailure.RateLimited::class.java,
            expected = setOf("message", "retryAfterSeconds"),
            because = "UX-STATE-004 tells the user when to try again, which is pacing " +
                "rather than a reason",
        )
    }

    @Test
    fun `a server failure carries a correlation id and no detail`() {
        assertNull(disclosedCode(ApiFailure.Server("Something went wrong", "abc-123")))
        assertExactFields(
            type = ApiFailure.Server::class.java,
            expected = setOf("message", "correlationId"),
            because = "SEC-018 keeps technical detail away from the user; the id exists " +
                "only to be quoted to support",
        )
    }

    @Test
    fun `a conflict carries a code the caller can act on`() {
        assertEquals(
            "USERNAME_TAKEN",
            disclosedCode(ApiFailure.Conflict(message = null, code = "USERNAME_TAKEN")),
        )
        assertExactFields(
            type = ApiFailure.Conflict::class.java,
            expected = setOf("message", "code"),
            because = "EDGE-007's username race needs the caller to know to pick another",
        )
    }

    @Test
    fun `THE ERROR ENVELOPE ITSELF CARRIES NO EXTRA CHANNEL`() {
        // What the wire format allows is the upper bound on what any failure
        // could ever hold. A field added here would be a channel every endpoint
        // gained at once.
        assertExactFields(
            type = org.shehersaaz.mohalla.core.network.ApiErrorBody::class.java,
            expected = setOf("code", "message", "correlationId", "details"),
            because = "this is the whole error contract; a new field is a new channel " +
                "on every endpoint simultaneously",
        )
        assertExactFields(
            type = org.shehersaaz.mohalla.core.network.ApiErrorDetail::class.java,
            expected = setOf("path", "message"),
            because = "a detail names a field and says what is wrong with it, nothing more",
        )
    }
}
