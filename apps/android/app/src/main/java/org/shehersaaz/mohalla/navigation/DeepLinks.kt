package org.shehersaaz.mohalla.navigation

/**
 * Turning a link somebody tapped into a route — §42.
 *
 * A PURE FUNCTION OVER A STRING, and that is the whole design. `Uri.parse` and
 * `Intent` are Android types that need an instrumentation runner to assert, and
 * there is no device in this project (`20-mobile-open-issues.md` §2) — so the
 * one piece of routing that is driven by input from OUTSIDE the app would have
 * been the one piece nothing checked. This takes the link as text, parses it by
 * hand, and is asserted on the JVM.
 *
 * A LINK IS NEVER AUTHORISATION. It names a destination and nothing else. Where
 * the reader actually lands is the startup resolver's decision — a link tapped
 * by somebody signed out reaches the login screen and is *held*, not honoured
 * (see [PendingDeepLink]). §9's rule that an unauthorised screen must never
 * flash is not something a URL gets to override, and treating a link as a
 * capability is how apps end up rendering somebody else's content to whoever
 * has the address.
 *
 * WHAT IS ACCEPTED IS ENUMERATED, NOT PATTERN-MATCHED LOOSELY. Five paths
 * resolve; everything else — an unknown path, a missing id, a path with an extra
 * segment, a link to another host — returns null and the caller opens the app
 * where it would have opened anyway. A deep-link parser that guesses is a
 * parser that eventually routes `/posts/../../admin` somewhere.
 *
 * THE SERVER'S OWN LINKS ARE THE SAME LINKS. `outbox-drain.service.ts` builds
 * `/posts/{postId}#{commentId}`, `/users/{id}`, `/events/{id}` and
 * `/conversations/{id}` for push notifications, so those four shapes are the
 * contract rather than a client invention — and the comment fragment is dropped
 * deliberately: it names a comment the client has no route to (GAP-M-009), and
 * the post it belongs to is the right place to land.
 */
object DeepLinks {

    /**
     * THE PUBLIC PATH AND THE INTERNAL ROUTE ARE TWO DIFFERENT VOCABULARIES, and
     * conflating them broke the share link.
     *
     * `Routes.post(id)` is `post/{id}` — singular, because it is a navigation
     * destination. The public URL the server publishes and the manifest claims
     * is `/posts/{id}` — plural, because it is a REST collection. The share
     * sheet was building `https://host/${'$'}{Routes.post(id)}`, which produced
     * `/post/p1`: a link that matched no intent filter and no server link, so
     * every shared post opened a browser rather than the app.
     *
     * These constants are the collection names, used by BOTH the resolver below
     * and the URL builders — so the link the app hands to WhatsApp and the link
     * it agrees to open are the same string by construction.
     */
    const val POSTS = "posts"
    const val USERS = "users"
    const val EVENTS = "events"
    const val CONVERSATIONS = "conversations"

    /** NOTIF-FR-005's target. Recognised so it can be refused deliberately. */
    const val ANNOUNCEMENTS = "announcements"

    /**
     * The public URL for a post (ENGAGE-FR-007).
     *
     * The one URL this app publishes. Built from the same constant the resolver
     * matches on, which is what the round-trip test asserts.
     */
    fun postUrl(host: String, postId: String): String = "https://$host/$POSTS/$postId"

    /**
     * Resolve a link to an internal route, or `null` when it is not ours.
     *
     * `host` is the app's own host, from the build config. A link to any other
     * host is refused even if its path happens to match: an intent filter can be
     * matched by a URL somebody else published, and honouring it would let a
     * third party choose which of the reader's screens opens.
     */
    /**
     * Resolve a PATH to an internal route (QA-009).
     *
     * The push payload carries `deepLink` as a path — `/posts/{id}`,
     * `/posts/{id}#{commentId}`, `/users/{id}`, `/events/{id}`,
     * `/conversations/{id}` — never a URL, because ADR-014 keeps the payload to
     * "the minimum needed for the deep link" and a host would be redundant.
     *
     * WHY THIS IS NOT `resolve` WITH A SYNTHESISED HOST. `resolve` refuses any
     * host but the app's own, and the app's host is empty in a release build
     * (DEP-007) — so routing a push through it would fail on exactly the builds
     * that ship. Inventing a host to satisfy the check would defeat the check.
     *
     * The path still goes through the SAME allowlist: two segments, a known
     * collection, no traversal. A payload is not trusted more than a link just
     * because it arrived over FCM.
     */
    fun resolvePath(path: String?): String? {
        if (path.isNullOrBlank()) return null
        if (!path.startsWith("/")) return null

        val withoutFragment = path.substringBefore('#')
        val segments = withoutFragment.substringBefore('?').split('/').filter { it.isNotBlank() }
        if (segments.size != 2) return null
        if (segments.any { it == "." || it == ".." }) return null

        val id = segments[1].takeIf { it.isNotBlank() } ?: return null

        return when (segments[0]) {
            POSTS -> Routes.post(id)
            USERS -> Routes.profile(id)
            EVENTS -> Routes.event(id)
            CONVERSATIONS -> Routes.conversation(id)
            // As in `resolve`: NOTIF-FR-005's broadcast has no screen yet, so
            // the reader lands on their normal start destination rather than on
            // a claim that the announcement was unavailable.
            ANNOUNCEMENTS -> null
            else -> null
        }
    }

    fun resolve(url: String?, host: String): String? {
        if (url.isNullOrBlank() || host.isBlank()) return null

        val parsed = parse(url) ?: return null
        if (!parsed.host.equals(host, ignoreCase = true)) return null

        val segments = parsed.segments
        // Exactly two segments — a collection and an id. Not one, not three:
        // `/posts` is a list this app does not have a screen for, and
        // `/posts/a/b` is a shape nobody publishes.
        if (segments.size != 2) return null

        val id = segments[1].takeIf { it.isNotBlank() } ?: return null

        return when (segments[0]) {
            POSTS -> Routes.post(id)
            USERS -> Routes.profile(id)
            EVENTS -> Routes.event(id)
            CONVERSATIONS -> Routes.conversation(id)

            // NOTIF-FR-005's broadcast points here, and UX-HOME-006 does not
            // exist yet. Returning null lands the reader on their normal start
            // destination rather than on a screen that would claim the
            // announcement was unavailable — see `17-mobile-screen-coverage.md`.
            ANNOUNCEMENTS -> null

            else -> null
        }
    }

    /**
     * The pieces this resolver needs, without `android.net.Uri`.
     *
     * DELIBERATELY STRICT. Only `https` is accepted: an `http` link to the same
     * host would be a downgrade somebody could arrange on a shared network, and
     * a custom scheme is not used at all (see the manifest's own comment on why
     * `mohalla://` was rejected).
     */
    private fun parse(url: String): Parsed? {
        val withoutScheme = url.removePrefix(HTTPS_PREFIX)
        if (withoutScheme == url) return null

        // Anything after `#` names a fragment. The server appends a comment id
        // that way, and there is no route to a comment (GAP-M-009), so the
        // fragment is dropped and the post is the destination.
        val withoutFragment = withoutScheme.substringBefore('#')
        // A query string is not part of any link this app publishes, and is
        // ignored rather than refused: a share that picked up a tracking
        // parameter on its way through somebody's messaging app should still
        // open the post.
        val withoutQuery = withoutFragment.substringBefore('?')

        val hostEnd = withoutQuery.indexOf('/')
        val host = if (hostEnd < 0) withoutQuery else withoutQuery.take(hostEnd)
        if (host.isBlank()) return null

        val path = if (hostEnd < 0) "" else withoutQuery.substring(hostEnd)

        val segments = path.split('/').filter { it.isNotBlank() }
        // `.` and `..` never appear in a link this app publishes, and a resolver
        // that let them through would be resolving somebody else's path.
        if (segments.any { it == "." || it == ".." }) return null

        return Parsed(host = host, segments = segments)
    }

    private data class Parsed(val host: String, val segments: List<String>)

    private const val HTTPS_PREFIX = "https://"
}

/**
 * A link that arrived before the reader was allowed to follow it.
 *
 * SOMEBODY TAPS A SHARED POST AND IS NOT SIGNED IN. §42 wants them to reach the
 * post; §9 forbids the app rendering it before authentication; and losing the
 * link entirely — landing on the feed and leaving them to wonder what they were
 * sent — is the outcome an app gets by doing nothing.
 *
 * SO THE LINK IS HELD, NOT HONOURED, and consumed exactly once when the reader
 * reaches a screen they are entitled to. Held IN MEMORY and not on disk: a link
 * that survived a process death would open a post somebody tapped last Tuesday,
 * and a link that survived a SIGN-OUT would open one account's content in
 * another's session on a shared phone — which is the same class of mistake as
 * the caches that are cleared on sign-out for exactly that reason.
 *
 * CONSUMED ONCE. `take` clears as it reads, so a recomposition cannot navigate
 * twice and Back cannot land on the same push a second time.
 */
class PendingDeepLink {

    private var route: String? = null

    fun hold(route: String) {
        this.route = route
    }

    /** Reads and clears. Returns `null` when there is nothing waiting. */
    fun take(): String? {
        val held = route
        route = null
        return held
    }

    /** Sign-out, and revocation. A link belongs to the session that received it. */
    fun clear() {
        route = null
    }
}
