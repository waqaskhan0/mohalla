import { countGraphemes } from '../../profile/domain/profile-fields.js';

/**
 * Comment rules (ENGAGE-FR-002 · BR-033 · SRS §12).
 *
 * 1–1,000 characters, "not whitespace-only", counted as GRAPHEME CLUSTERS for
 * the same reason posts are: counting code points would charge an Urdu writer
 * for diacritics a reader does not see.
 */

export const COMMENT_BODY_MAX_LENGTH = 1000;

export type CommentBodyRejection = 'NOT_A_STRING' | 'EMPTY' | 'TOO_LONG';

export function checkCommentBody(body: unknown): CommentBodyRejection | null {
  if (typeof body !== 'string') return 'NOT_A_STRING';

  const trimmed = body.trim();
  // Unlike a post, a comment has no attachment to stand in for text, so empty
  // is always an error.
  if (trimmed === '') return 'EMPTY';
  if (countGraphemes(trimmed) > COMMENT_BODY_MAX_LENGTH) return 'TOO_LONG';
  return null;
}

export function normalizeCommentBody(body: string): string {
  return body.trim();
}

/**
 * Who may delete a comment (ENGAGE-FR-004/005 · BR-020).
 *
 * Two people: its author, and THE AUTHOR OF THE POST it sits on. The second is
 * unusual enough to be worth stating — ENGAGE-FR-005 gives the reason: "this
 * distributes moderation away from administrators". Someone whose notice
 * attracts abuse can clear it themselves at 2am rather than waiting for a
 * moderator, which on a neighbourhood platform is the difference between a
 * usable thread and an abandoned one.
 *
 * It is deliberately NOT an administrator power here. An admin removes content
 * through the moderation path, which has its own audit trail (ADMIN-FR-004);
 * routing it through this function would lose that record.
 */
export function canDeleteComment(facts: {
  viewerId: string;
  commentAuthorId: string;
  postAuthorId: string;
}): boolean {
  return facts.viewerId === facts.commentAuthorId || facts.viewerId === facts.postAuthorId;
}

/**
 * Resolve which comment a reply should attach to (BR-033).
 *
 * ENGAGE-FR-003: "a reply to a reply attaches to the same parent thread". So a
 * reply aimed at a nested comment is re-pointed at that comment's parent rather
 * than refused — the user's intent is clear and rejecting it would be pedantry.
 * The database refuses a third level regardless, which is what makes this a
 * convenience rather than the enforcement.
 *
 * @returns the id the reply should actually attach to.
 */
export function resolveThreadParent(target: {
  id: string;
  parentCommentId: string | null;
}): string {
  return target.parentCommentId ?? target.id;
}
