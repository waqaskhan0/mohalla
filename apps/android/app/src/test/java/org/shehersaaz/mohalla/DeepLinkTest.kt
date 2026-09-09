package org.shehersaaz.mohalla

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.shehersaaz.mohalla.navigation.DeepLinks
import org.shehersaaz.mohalla.navigation.PendingDeepLink
import org.shehersaaz.mohalla.navigation.Routes

/**
 * Deep links — §42.
 *
 * THIS IS THE ONE PIECE OF ROUTING DRIVEN BY INPUT FROM OUTSIDE THE APP, which
 * is why the resolver parses a `String` by hand instead of using `Uri`: an
 * Android type needs an instrumentation runner to assert and there is no device
 * in this project (`20-mobile-open-issues.md` §2), so the highest-risk router
 * would have been the one nothing checked.
 *
 * WHAT THE TESTS ARE MOSTLY ABOUT IS REFUSAL. A link is not authorisation and
 * not a pattern to guess at: another host, a traversal segment, an extra path
 * segment, a missing id, an `http` downgrade and an unknown collection all
 * resolve to nothing, and the app opens where it would have opened anyway.
 */
class DeepLinkTest {

    private val host = "mohalla.pk"

    // ================================================ the four the server publishes
    @Test
    fun `THE FOUR SHAPES THE SERVER PUBLISHES ALL RESOLVE`() {
        // `outbox-drain.service.ts` builds exactly these for push
        // notifications, so they are the contract rather than a client
        // invention: /posts/{id}, /users/{id}, /events/{id} and
        // /conversations/{id}.
        assertEquals(Routes.post("p1"), DeepLinks.resolve("https://$host/posts/p1", host))
        assertEquals(Routes.profile("u1"), DeepLinks.resolve("https://$host/users/u1", host))
        assertEquals(Routes.event("e1"), DeepLinks.resolve("https://$host/events/e1", host))
        assertEquals(
            Routes.conversation("c1"),
            DeepLinks.resolve("https://$host/conversations/c1", host),
        )
    }

    @Test
    fun `A COMMENT FRAGMENT IS DROPPED AND THE POST IS THE DESTINATION`() {
        // The server appends `#{commentId}` to a comment notification's link.
        // There is no route to a comment (GAP-M-009), and the post it belongs to
        // is the right place to land — so the fragment is discarded rather than
        // making the whole link unresolvable.
        assertEquals(
            Routes.post("p1"),
            DeepLinks.resolve("https://$host/posts/p1#c9", host),
        )
    }

    @Test
    fun `a tracking parameter picked up in transit does not break the link`() {
        // A share that travelled through somebody's messaging app can arrive
        // with a query string nobody in this product added. Ignoring it is
        // kinder than refusing the link.
        assertEquals(
            Routes.post("p1"),
            DeepLinks.resolve("https://$host/posts/p1?utm_source=whatsapp", host),
        )
    }

    @Test
    fun `THE LINK THE APP SHARES IS A LINK THE APP CAN OPEN`() {
        // THIS TEST FOUND A REAL DEFECT. `Routes.post(id)` is `post/{id}` —
        // singular, a navigation destination — and the public URL is
        // `/posts/{id}`, plural, a REST collection. The share sheet was building
        // the former, producing a link that matched no intent filter and no
        // server link: every shared post opened a browser rather than the app.
        //
        // Both now come from one constant, and this asserts the round trip.
        val shared = DeepLinks.postUrl(host, "p1")

        assertEquals("https://$host/posts/p1", shared)
        assertEquals(Routes.post("p1"), DeepLinks.resolve(shared, host))
    }

    // ============================================================ refusals
    @Test
    fun `A LINK TO ANOTHER HOST IS REFUSED EVEN WHEN ITS PATH MATCHES`() {
        // An intent filter can be matched by a URL somebody else published.
        // Honouring it would let a third party choose which of the reader's
        // screens opens — including a conversation.
        assertNull(DeepLinks.resolve("https://evil.example/posts/p1", host))
        // And a host that merely ENDS with ours is a different host.
        assertNull(DeepLinks.resolve("https://notmohalla.pk/posts/p1", host))
        assertNull(DeepLinks.resolve("https://mohalla.pk.evil.example/posts/p1", host))
    }

    @Test
    fun `A TRAVERSAL SEGMENT IS REFUSED`() {
        // Never appears in a link this app publishes, and a resolver that let
        // one through would be resolving somebody else's path.
        assertNull(DeepLinks.resolve("https://$host/posts/../users/u1", host))
        assertNull(DeepLinks.resolve("https://$host/posts/./p1", host))
    }

    @Test
    fun `AN EXTRA SEGMENT IS REFUSED, BECAUSE NOBODY PUBLISHES ONE`() {
        // Exactly a collection and an id. `/posts` is a list this app has no
        // screen for, and `/posts/a/b` is a shape the product never emits.
        assertNull(DeepLinks.resolve("https://$host/posts", host))
        assertNull(DeepLinks.resolve("https://$host/posts/p1/edit", host))
        assertNull(DeepLinks.resolve("https://$host/posts/", host))
    }

    @Test
    fun `AN HTTP DOWNGRADE IS REFUSED`() {
        // A plain-http link to the same host is something somebody can arrange
        // on a shared network. The manifest declares no `http` filter either,
        // so this is belt and braces on the same decision.
        assertNull(DeepLinks.resolve("http://$host/posts/p1", host))
    }

    @Test
    fun `an unknown collection is refused`() {
        assertNull(DeepLinks.resolve("https://$host/admin/dashboard", host))
        assertNull(DeepLinks.resolve("https://$host/settings/delete", host))
    }

    @Test
    fun `AN ANNOUNCEMENT LINK RESOLVES TO NOTHING UNTIL ITS SCREEN EXISTS`() {
        // NOTIF-FR-005's broadcast points at one and UX-HOME-006 is not built.
        // Returning null lands the reader on their normal start destination
        // rather than on a screen claiming the announcement was unavailable —
        // which would be a lie about the announcement rather than about the app.
        assertNull(DeepLinks.resolve("https://$host/announcements/a1", host))
    }

    @Test
    fun `EVERY LINK IS REFUSED WHEN THE BUILD HAS NO HOST`() {
        // DEP-007 has not provisioned a domain, so a release build's `APP_HOST`
        // is empty. A blank host must not match a blank-host link or become a
        // wildcard — GAP-M-015.
        assertNull(DeepLinks.resolve("https://$host/posts/p1", ""))
        assertNull(DeepLinks.resolve("https:///posts/p1", ""))
    }

    @Test
    fun `nothing, empty and malformed all resolve to nothing`() {
        assertNull(DeepLinks.resolve(null, host))
        assertNull(DeepLinks.resolve("", host))
        assertNull(DeepLinks.resolve("   ", host))
        assertNull(DeepLinks.resolve("mohalla://posts/p1", host))
        assertNull(DeepLinks.resolve("https://", host))
        assertNull(DeepLinks.resolve("not a url at all", host))
    }

    @Test
    fun `the host match is case-insensitive, because DNS is`() {
        assertEquals(
            Routes.post("p1"),
            DeepLinks.resolve("https://MOHALLA.PK/posts/p1", host),
        )
    }

    // ==================================================== holding and consuming
    @Test
    fun `A HELD LINK IS CONSUMED EXACTLY ONCE`() {
        // A recomposition must not navigate twice, and Back must not land on
        // the same push a second time.
        val pending = PendingDeepLink()
        pending.hold(Routes.post("p1"))

        assertEquals(Routes.post("p1"), pending.take())
        assertNull("and it is gone", pending.take())
    }

    @Test
    fun `A SIGN-OUT TAKES ANY WAITING LINK WITH IT`() {
        // A link belongs to the session that received it. One left behind would
        // open one account's content inside another's session — and a shared
        // phone is a common arrangement in this market.
        val pending = PendingDeepLink()
        pending.hold(Routes.conversation("c1"))

        pending.clear()

        assertNull(pending.take())
    }

    @Test
    fun `a second link replaces the first, because it is the one just tapped`() {
        val pending = PendingDeepLink()
        pending.hold(Routes.post("p1"))
        pending.hold(Routes.event("e1"))

        assertEquals(Routes.event("e1"), pending.take())
    }

    @Test
    fun `nothing is waiting to begin with`() {
        assertNull(PendingDeepLink().take())
    }
}
