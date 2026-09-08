package org.shehersaaz.mohalla.core.state

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

/**
 * What this viewer's relationship to a person or a post is — as far as the app
 * has been able to find out.
 *
 * THIS CLASS EXISTS BECAUSE THE API ANSWERS THE QUESTION FOR LIKES AND FOR
 * NOTHING ELSE. A post body carries `viewerHasLiked`, so a like renders in the
 * right state on a cold open. Nothing carries `viewerFollows` (GAP-M-011) or
 * `viewerHasSaved` (GAP-M-012) — the server has `isFollowing` internally and
 * exposes it on no route at all — so a Follow control and a Save control cannot
 * be drawn correctly the first time a screen is opened.
 *
 * THE ANSWER IS THEREFORE A TRI-STATE AND NOT A BOOLEAN. [Unknown] is a real
 * answer and the honest one before anything has been observed; a `Boolean`
 * would force a guess to be stored as a fact, and every screen reading it would
 * inherit the guess without knowing it was one.
 *
 * WHERE KNOWLEDGE COMES FROM, given no endpoint provides it:
 *
 *   1. AN ACTION THIS SESSION PERFORMED. Following somebody makes the answer
 *      known for the rest of the session, which is what stops a profile
 *      re-opened two screens later from offering Follow to somebody the viewer
 *      just followed. That flicker is the whole reason this is not simply local
 *      screen state.
 *   2. THE VIEWER'S OWN FOLLOWING LIST. Opening it learns the whole set at once
 *      — the one place the API does answer the question, incidentally, for
 *      twenty people a page.
 *
 * IT IS SESSION-SCOPED AND DELIBERATELY NOT PERSISTED. A stale answer written to
 * disk would survive a follow performed on another device and would be wrong for
 * longer, with no way to notice; forgetting on restart returns to [Unknown],
 * which is at least true.
 *
 * WHAT THE UNKNOWN STATE MEANS FOR THE UI is decided by the screens, and both
 * resolve it the same way: offer the ACTION rather than its undo. Offering
 * Follow to somebody already followed costs a wasted tap and changes nothing —
 * the route is idempotent and the count does not move. Offering "Following" to
 * somebody who is not followed would stop the viewer following them at all.
 */
class ViewerRelations {

    private val _follows = MutableStateFlow(Knowledge())
    val follows: StateFlow<Knowledge> = _follows.asStateFlow()

    private val _saves = MutableStateFlow(Knowledge())
    val saves: StateFlow<Knowledge> = _saves.asStateFlow()

    fun followState(userId: String): Relation = _follows.value.of(userId)

    fun saveState(postId: String): Relation = _saves.value.of(postId)

    fun recordFollow(userId: String, following: Boolean) =
        _follows.update { it.with(userId, following) }

    fun recordSave(postId: String, saved: Boolean) =
        _saves.update { it.with(postId, saved) }

    /**
     * Learn a whole set at once.
     *
     * Used when the viewer opens their OWN following list: every id on the page
     * is followed, by definition of the list. Ids NOT on the page are left
     * unknown rather than marked not-followed — the list is paginated, so an
     * absent id may simply be on page three.
     */
    fun recordFollowing(userIds: Collection<String>) =
        _follows.update { it.withAll(userIds, true) }

    /** Sign-out. A relationship belongs to an account, not to an install. */
    fun clear() {
        _follows.value = Knowledge()
        _saves.value = Knowledge()
    }
}

/**
 * Which ids are known to be true and which known to be false.
 *
 * TWO SETS RATHER THAN A MAP, so the empty state is unambiguously "nothing is
 * known" and reading an absent id can only produce [Relation.Unknown]. A
 * `Map<String, Boolean>` allows exactly the same information, and allows a
 * caller to write `map[id] ?: false` — collapsing the third state back into a
 * guess, silently, at one call site.
 */
data class Knowledge(
    val yes: Set<String> = emptySet(),
    val no: Set<String> = emptySet(),
) {
    fun of(id: String): Relation = when (id) {
        in yes -> Relation.Yes
        in no -> Relation.No
        else -> Relation.Unknown
    }

    fun with(id: String, value: Boolean): Knowledge =
        if (value) copy(yes = yes + id, no = no - id) else copy(yes = yes - id, no = no + id)

    fun withAll(ids: Collection<String>, value: Boolean): Knowledge =
        if (value) copy(yes = yes + ids, no = no - ids.toSet())
        else copy(yes = yes - ids.toSet(), no = no + ids)
}

/** Known true, known false, or not yet known. */
enum class Relation {
    Yes,
    No,

    /**
     * Nothing has been observed.
     *
     * Screens treat this as "offer the action", never as `No`. See the class
     * comment for why that direction is the safe one.
     */
    Unknown,
    ;

    /**
     * Whether the control should read as done — Following, Saved.
     *
     * ONLY [Yes]. Written once here rather than as `== Relation.Yes` at six call
     * sites, so the Unknown-is-not-No rule holds in one place instead of being
     * re-decided by whoever writes the seventh.
     */
    val isDone: Boolean get() = this == Yes
}
