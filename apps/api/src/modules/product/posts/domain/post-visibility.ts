/**
 * Who may see a post, and why (POST-FR-009 · BR-014/025/032 · UX-STATE-001).
 *
 * Four states rather than a boolean, because each behaves differently:
 *
 *   VISIBLE        everyone (subject to blocks)
 *   AUTO_HIDDEN    THE AUTHOR ONLY, marked under review (BR-032), and
 *                  administrators. POST-FR-009: "auto-hidden posts return a
 *                  not-available state to everyone except the author and
 *                  administrators."
 *   ADMIN_REMOVED  nobody, including the author — retained for the audit trail
 *   AUTHOR_DELETED nobody, and an administrator CANNOT restore it (BR-014)
 *
 * The author seeing their own hidden post is the interesting case. It is
 * deliberate: PROFILE-FR-004 requires "the owner additionally sees their own
 * auto-hidden content, marked as under review". Hiding it from them too would
 * mean a person's post silently disappears with no explanation, which is worse
 * for them and worse for moderation — they cannot appeal what they cannot see.
 */

export type PostVisibilityState = 'VISIBLE' | 'AUTO_HIDDEN' | 'ADMIN_REMOVED' | 'AUTHOR_DELETED';

export interface PostViewerFacts {
  state: PostVisibilityState;
  isAuthor: boolean;
  isAdmin: boolean;
  /** A block between viewer and author, in either direction (BR-025). */
  blockedEitherWay: boolean;
  /** The author's account is not publicly visible (banned or deleted). */
  authorHidden: boolean;
}

export type PostVisibility =
  /** Render normally. */
  | 'VISIBLE'
  /** Render to the author, marked under review (BR-032). */
  | 'VISIBLE_UNDER_REVIEW'
  /** One neutral not-available state (UX-STATE-001). */
  | 'NOT_AVAILABLE';

/**
 * Decide what this viewer gets.
 *
 * The order is load-bearing. A BLOCK is checked before the post's own state,
 * so a blocked viewer gets the same answer whatever the post is — otherwise
 * timing or behaviour could differ between "blocked and the post exists" and
 * "blocked and it does not", which is a slow leak of the same fact a block
 * exists to hide.
 */
export function decidePostVisibility(facts: PostViewerFacts): PostVisibility {
  // An administrator sees removed and hidden content, because moderation
  // cannot review what it cannot load (ADMIN-FR-002/003). Author-deleted is
  // the one exception: BR-014 says an admin cannot restore it, so there is
  // nothing to review and no reason to show it.
  if (facts.isAdmin) {
    return facts.state === 'AUTHOR_DELETED' ? 'NOT_AVAILABLE' : 'VISIBLE';
  }

  if (facts.blockedEitherWay) return 'NOT_AVAILABLE';
  if (facts.authorHidden && !facts.isAuthor) return 'NOT_AVAILABLE';

  switch (facts.state) {
    case 'VISIBLE':
      return 'VISIBLE';
    case 'AUTO_HIDDEN':
      // BR-032 / PROFILE-FR-004: the author sees it, marked. Nobody else does.
      return facts.isAuthor ? 'VISIBLE_UNDER_REVIEW' : 'NOT_AVAILABLE';
    case 'ADMIN_REMOVED':
    case 'AUTHOR_DELETED':
      // Not even the author. A deleted post is gone from their view too -
      // POST-FR-007 says it "disappears from every feed and profile".
      return 'NOT_AVAILABLE';
  }
}

/**
 * May this person edit or delete the post?
 *
 * Author only. An administrator can REMOVE a post (a separate moderation
 * action with its own audit trail), but cannot edit one — putting words in
 * someone's mouth under their name is not a moderation power any requirement
 * grants.
 */
export function canAuthorModify(facts: { state: PostVisibilityState; isAuthor: boolean }): boolean {
  if (!facts.isAuthor) return false;
  // A removed or already-deleted post is not editable. An author must not be
  // able to edit their way out of a moderation decision.
  return facts.state === 'VISIBLE' || facts.state === 'AUTO_HIDDEN';
}
