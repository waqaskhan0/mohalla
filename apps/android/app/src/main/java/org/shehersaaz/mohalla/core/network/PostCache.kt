package org.shehersaaz.mohalla.core.network

/**
 * The last posts the reader actually saw, so a detail screen opens instantly.
 *
 * WHY THIS EXISTS AT ALL. §19 is explicit about UX-HOME-003: "post renders from
 * the feed's cached copy instantly; only comments load." Tapping a card must not
 * show a spinner where the post already was — the reader has just been looking
 * at it, and a blank screen followed by the same text a second later is the
 * worst kind of slowness, the kind that comes from the app forgetting something
 * it knew.
 *
 * With string nav routes the detail screen receives only an id, so something has
 * to hold the object between the two screens. The alternatives were worse:
 * passing the post through the route means serialising a whole object into a URL
 * (and re-encoding an author's display name into a path), and a shared ViewModel
 * across the whole graph means the feed's state outliving the feed.
 *
 * IT IS NOT A SOURCE OF TRUTH, and every reader treats it that way. The detail
 * screen renders the cached copy immediately AND fetches the real one; when the
 * fetch lands it replaces the cache's answer wholesale. A cached post can be
 * stale in every field — the like count moved, the text was edited, the post was
 * deleted — so nothing decides anything from it. It exists to fill one frame.
 *
 * BOUNDED, AND SMALL. Twenty entries, which is one feed page: on the 2GB device
 * NFR-COMP-002 targets, an unbounded map of every post ever scrolled past is a
 * leak that grows with session length. The eviction is insertion-ordered rather
 * than least-recently-used, because the useful entries are the ones just
 * scrolled past and a reader who scrolls back up gets them re-inserted by the
 * feed anyway.
 *
 * IN MEMORY ONLY. Nothing is written to disk: a post is other people's content
 * held for a few seconds of navigation, and persisting it would mean deciding
 * how long a deleted post may survive on a device (BR-025's neutral refusal
 * exists precisely so a client cannot keep serving something the server has
 * withdrawn).
 */
class PostCache {

    /**
     * Insertion-ordered, and access does not reorder it.
     *
     * `LinkedHashMap` with `accessOrder = false`, so [get] is a pure read — a
     * cache whose reads mutated it would make the detail screen's own lookup
     * change what the feed evicts next.
     */
    private val entries = object : LinkedHashMap<String, FeedItemResponse>(
        INITIAL_CAPACITY,
        LOAD_FACTOR,
        false,
    ) {
        override fun removeEldestEntry(
            eldest: MutableMap.MutableEntry<String, FeedItemResponse>?,
        ): Boolean = size > MAX_ENTRIES
    }

    /** Called with each feed page as it lands. */
    @Synchronized
    fun put(items: List<FeedItemResponse>) {
        items.forEach { entries[it.id] = it }
    }

    @Synchronized
    fun put(item: FeedItemResponse) {
        entries[item.id] = item
    }

    /** The cached copy, or null. Never authoritative — see the class comment. */
    @Synchronized
    fun get(postId: String): FeedItemResponse? = entries[postId]

    /**
     * Forget a post.
     *
     * Called when the server has said a post is unavailable, so a second visit
     * does not render a copy of something that has been withdrawn. Without
     * this, the "renders instantly" behaviour would keep showing a deleted post
     * for as long as the process lived.
     */
    @Synchronized
    fun forget(postId: String) {
        entries.remove(postId)
    }

    @Synchronized
    fun clear() {
        entries.clear()
    }

    private companion object {
        /** One feed page (`FeedRepository.PAGE_SIZE`). */
        const val MAX_ENTRIES = 20

        /** Sized so the map never rehashes at its bounded size. */
        const val INITIAL_CAPACITY = 32
        const val LOAD_FACTOR = 0.75f
    }
}
