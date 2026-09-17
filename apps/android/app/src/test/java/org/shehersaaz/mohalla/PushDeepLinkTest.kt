package org.shehersaaz.mohalla

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.shehersaaz.mohalla.navigation.DeepLinks
import org.shehersaaz.mohalla.navigation.Routes

/**
 * QA-009 — mapping a push payload's `deepLink` to a screen.
 *
 * The paths asserted here are taken from `outbox-drain.service.ts`, which is
 * the only thing that produces them. They are not invented, and if the backend
 * ever emits a shape that is not in this list the app lands the reader on their
 * normal start destination rather than guessing.
 */
class PushDeepLinkTest {

    // Every shape the backend actually emits, one test each.
    @Test
    fun `a like points at the post`() {
        assertEquals(Routes.post("p1"), DeepLinks.resolvePath("/posts/p1"))
    }

    @Test
    fun `a comment points at the post, and the comment fragment is dropped`() {
        // GAP-M-009: there is no route to a single comment, so the post is the
        // destination and the fragment is discarded rather than refused.
        assertEquals(Routes.post("p1"), DeepLinks.resolvePath("/posts/p1#c9"))
    }

    @Test
    fun `a follow points at the profile`() {
        assertEquals(Routes.profile("u1"), DeepLinks.resolvePath("/users/u1"))
    }

    @Test
    fun `a message points at the conversation`() {
        assertEquals(Routes.conversation("c1"), DeepLinks.resolvePath("/conversations/c1"))
    }

    @Test
    fun `an event points at the event`() {
        assertEquals(Routes.event("e1"), DeepLinks.resolvePath("/events/e1"))
    }

    // §14 — a malformed payload must not crash, and must not guess.
    @Test
    fun `malformed and unknown paths resolve to nothing rather than throwing`() {
        val rubbish = listOf(
            null, "", "   ", "posts/p1", "/", "//", "/posts", "/posts/",
            "/posts/a/b", "/unknown/x", "/../../etc/passwd", "/posts/../users/u1",
            "https://elsewhere.example/posts/p1", "javascript:alert(1)",
        )
        rubbish.forEach { assertNull("expected null for $it", DeepLinks.resolvePath(it)) }
    }

    // Traversal is refused rather than normalised — a resolver that normalised
    // would be resolving somebody else's path.
    @Test
    fun `path traversal is refused`() {
        assertNull(DeepLinks.resolvePath("/posts/.."))
        assertNull(DeepLinks.resolvePath("/./users/u1"))
    }

    // The announcement broadcast has no screen yet (NOTIF-FR-005). Null lands
    // the reader on their start destination instead of claiming the
    // announcement was unavailable.
    @Test
    fun `an announcement resolves to nothing, deliberately`() {
        assertNull(DeepLinks.resolvePath("/announcements/a1"))
    }

    // A path is not a URL. `resolve` requires a host and refuses anything else;
    // `resolvePath` requires no host and refuses a URL. Keeping them separate is
    // what stops a push payload being trusted as if it named the app's host.
    @Test
    fun `the two resolvers do not accept each other's input`() {
        assertNull(DeepLinks.resolvePath("https://mohalla.invalid/posts/p1"))
        assertNull(DeepLinks.resolve("/posts/p1", "mohalla.invalid"))
    }
}
