package org.shehersaaz.mohalla

import org.junit.Assert.assertEquals

/**
 * Asserting that a type carries EXACTLY the fields it is allowed to carry.
 *
 * WHY THIS FILE EXISTS, AND WHAT WAS WRONG BEFORE IT.
 *
 * Several of this product's privacy and safety rules are enforced by the SHAPE
 * of a type rather than by the behaviour of a screen. SEC-006 keeps a wrong
 * password and an unknown number indistinguishable by giving the state no field
 * that could tell them apart. BR-025 keeps the neutral 404 neutral the same
 * way. EVENT-FR-003 keeps a meeting credential out of every list response by
 * having no field to put it in. BR-014 stops an edit changing a post's images
 * by leaving `mediaIds` out of the request body.
 *
 * The tests for those rules were written as DENYLISTS — "assert no field is
 * named `meeting…`", "assert no field is called `accountFound`". That is a test
 * of the names somebody thought of, and it was measured to be worthless: with
 * `EventResponse.roomUrl`, `EventResponse.participantIds`,
 * `UpdatePostBody.attachmentIds` and `ApiFailure.Unavailable.reason` all added
 * — a live meeting credential, a list of attendee identities, media on an edit,
 * and a discriminator on the neutral refusal — the entire suite of 271 tests
 * passed. Every one of those four is precisely the defect its test claimed to
 * prevent.
 *
 * SO THE CHECK IS INVERTED. Instead of naming what is forbidden, each call site
 * names the COMPLETE SET that is allowed. Any field added under any name fails,
 * and the failure message names it — which turns "we did not think of that
 * name" into a defect that cannot be introduced silently. Adding a field to one
 * of these types now requires editing the test, which is the moment somebody
 * reads why the type is shaped as it is.
 *
 * WHERE A SEALED HIERARCHY IS INVOLVED, PREFER AN EXHAUSTIVE `when` INSTEAD.
 * That is a compile-time gate rather than a runtime one: a new variant fails to
 * BUILD, with the reason in front of whoever wrote it, and needs no reflection
 * at all. `AuthUniformityTest` uses one for `LoginOutcome`, and
 * `ApiFailureShapeTest` uses one for `ApiFailure`. This helper is for data
 * classes, where no such construct exists — a default parameter value means an
 * added field still compiles everywhere.
 *
 * ONLY JAVA REFLECTION IS USED, so `kotlin-reflect` stays off the test
 * classpath.
 */
fun assertExactFields(
    type: Class<*>,
    /** Every field the type is allowed to declare. Order is irrelevant. */
    expected: Set<String>,
    /** Why the shape is what it is, quoted in the failure. */
    because: String,
) {
    val actual = declaredFieldNames(type)

    val added = (actual - expected).sorted()
    val removed = (expected - actual).sorted()

    val detail = buildString {
        if (added.isNotEmpty()) {
            append("\n  UNEXPECTED field(s): ")
            append(added.joinToString(", "))
            append("\n  Adding a field here needs a deliberate decision — $because")
        }
        if (removed.isNotEmpty()) {
            append("\n  MISSING field(s): ")
            append(removed.joinToString(", "))
            append("\n  If the removal is intended, update the expected set.")
        }
    }

    assertEquals(
        "${type.simpleName} must declare exactly the fields listed.$detail",
        expected,
        actual,
    )
}

/**
 * The fields Kotlin actually declares, minus the ones it generates.
 *
 * `INSTANCE` is emitted for an `object`, `$stable` and other `$`-prefixed
 * members come from the Compose compiler, `Companion` is a nested holder, and
 * `serialVersionUID` and `$childSerializers` come from kotlinx-serialization.
 * None is payload, and none is something a developer wrote — filtering them is
 * what makes an exact-set assertion possible at all.
 */
fun declaredFieldNames(type: Class<*>): Set<String> = type.declaredFields
    .filterNot { it.isSynthetic }
    .map { it.name }
    .filterNot { it == "INSTANCE" || it == "Companion" || it == "serialVersionUID" }
    .filterNot { it.startsWith("$") }
    .toSet()
