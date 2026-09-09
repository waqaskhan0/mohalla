package org.shehersaaz.mohalla

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test
import org.shehersaaz.mohalla.core.network.FeedItemResponse
import org.shehersaaz.mohalla.core.network.PostCache
import org.shehersaaz.mohalla.core.network.PublicProfileResponse

/**
 * The post cache (§19 — UX-HOME-003's "renders from the feed's cached copy
 * instantly").
 *
 * A CACHE ON A 2GB DEVICE IS A LEAK IF IT IS NOT BOUNDED, and the bound is the
 * only thing here that cannot be seen by reading the class. NFR-COMP-002 sets
 * the baseline at 2GB of RAM, and a map of every post ever scrolled past grows
 * with session length — so the test that matters is the eviction one.
 */
class PostCacheTest {

    private fun item(id: String) = FeedItemResponse(
        id = id,
        author = PublicProfileResponse(userId = "u-$id", displayName = "Neighbour"),
        body = "Body $id",
        createdAt = "2026-09-01T10:00:00Z",
    )

    @Test
    fun `a post put in comes back out`() {
        val cache = PostCache()
        cache.put(item("a"))

        assertEquals("Body a", cache.get("a")?.body)
    }

    @Test
    fun `an unknown post is null rather than a placeholder`() {
        // The detail screen branches on null to decide whether to show a
        // spinner (the deep-link case), so a placeholder here would make every
        // arrival look like it came from the feed.
        assertNull(PostCache().get("never-seen"))
    }

    @Test
    fun `a whole page goes in at once`() {
        val cache = PostCache()
        cache.put(listOf(item("a"), item("b"), item("c")))

        assertNotNull(cache.get("a"))
        assertNotNull(cache.get("b"))
        assertNotNull(cache.get("c"))
    }

    @Test
    fun `THE CACHE IS BOUNDED AT ONE FEED PAGE`() {
        // Twenty entries, matching `FeedRepository.PAGE_SIZE`. Unbounded, this
        // would hold every post a long scrolling session ever rendered.
        val cache = PostCache()
        (1..25).forEach { cache.put(item("post-$it")) }

        // The oldest five are gone.
        (1..5).forEach { assertNull("post-$it should have been evicted", cache.get("post-$it")) }
        // The newest twenty are held.
        (6..25).forEach { assertNotNull("post-$it should be cached", cache.get("post-$it")) }
    }

    @Test
    fun `READING DOES NOT REORDER, SO A LOOKUP CANNOT CHANGE WHAT IS EVICTED`() {
        // `accessOrder = false` on purpose. If reads reordered, the detail
        // screen's own lookup would change which entries the feed evicts next —
        // making eviction depend on navigation rather than on scrolling.
        val cache = PostCache()
        (1..20).forEach { cache.put(item("post-$it")) }

        // Touch the oldest entry repeatedly.
        repeat(5) { cache.get("post-1") }

        // Then push one more in. The oldest is still the one that goes.
        cache.put(item("post-21"))

        assertNull(cache.get("post-1"))
        assertNotNull(cache.get("post-21"))
    }

    @Test
    fun `re-putting a post refreshes it in place`() {
        // The feed re-inserts what it renders, so scrolling back up over an
        // entry keeps it alive — which is why insertion order is good enough
        // without access ordering.
        val cache = PostCache()
        cache.put(item("a"))
        cache.put(item("a").copy(body = "Edited"))

        assertEquals("Edited", cache.get("a")?.body)
    }

    @Test
    fun `A FORGOTTEN POST STAYS FORGOTTEN`() {
        // Called when the server says a post is unavailable. Without it, the
        // "renders instantly" behaviour would keep showing a withdrawn post for
        // the life of the process — which is exactly the stale-content case
        // POST-FR-007's acceptance criterion is about.
        val cache = PostCache()
        cache.put(item("gone"))
        cache.forget("gone")

        assertNull(cache.get("gone"))
    }

    @Test
    fun `forgetting something absent is harmless`() {
        // Reached whenever a deep-linked post turns out to be unavailable and
        // was never in the cache to begin with.
        PostCache().forget("never-there")
    }

    @Test
    fun `clear empties everything`() {
        val cache = PostCache()
        cache.put(listOf(item("a"), item("b")))
        cache.clear()

        assertNull(cache.get("a"))
        assertNull(cache.get("b"))
    }
}
