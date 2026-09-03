import { describe, it, expect } from 'vitest';
import {
  COMMENT_BODY_MAX_LENGTH,
  canDeleteComment,
  checkCommentBody,
  normalizeCommentBody,
  resolveThreadParent,
} from './comment-body.js';

describe('checkCommentBody (ENGAGE-FR-002, §12)', () => {
  it('accepts an ordinary comment', () => {
    expect(checkCommentBody('Thanks, this is useful.')).toBeNull();
  });

  it('accepts an Urdu comment without penalising diacritics', () => {
    const urdu = 'کِ'.repeat(COMMENT_BODY_MAX_LENGTH);
    expect([...urdu].length).toBeGreaterThan(COMMENT_BODY_MAX_LENGTH);
    expect(checkCommentBody(urdu)).toBeNull();
  });

  it('enforces the bound exactly', () => {
    expect(checkCommentBody('x'.repeat(COMMENT_BODY_MAX_LENGTH))).toBeNull();
    expect(checkCommentBody('x'.repeat(COMMENT_BODY_MAX_LENGTH + 1))).toBe('TOO_LONG');
  });

  it('REJECTS EMPTY AND WHITESPACE-ONLY', () => {
    // Unlike a post, a comment has no attachment to stand in for text.
    for (const bad of ['', '   ', '\n\t']) {
      expect(checkCommentBody(bad)).toBe('EMPTY');
    }
  });

  it('rejects non-string input', () => {
    expect(checkCommentBody(42)).toBe('NOT_A_STRING');
  });
});

describe('normalizeCommentBody', () => {
  it('trims the outside and keeps the inside', () => {
    expect(normalizeCommentBody('  line one\n  line two  ')).toBe('line one\n  line two');
  });
});

describe('canDeleteComment (ENGAGE-FR-004/005, BR-020)', () => {
  const commentAuthorId = 'author-of-comment';
  const postAuthorId = 'author-of-post';

  it('lets the comment author delete it', () => {
    expect(canDeleteComment({ viewerId: commentAuthorId, commentAuthorId, postAuthorId })).toBe(
      true,
    );
  });

  it("LETS THE POST'S AUTHOR DELETE ANY COMMENT ON IT (BR-020)", () => {
    // ENGAGE-FR-005 gives the reason: "this distributes moderation away from
    // administrators". Somebody whose notice attracts abuse can clear it
    // themselves rather than waiting for a moderator.
    expect(canDeleteComment({ viewerId: postAuthorId, commentAuthorId, postAuthorId })).toBe(true);
  });

  it('REFUSES A THIRD PARTY', () => {
    // ENGAGE-FR-005 AC: "WHEN user B attempts the same, THEN the request is
    // refused."
    expect(canDeleteComment({ viewerId: 'someone-else', commentAuthorId, postAuthorId })).toBe(
      false,
    );
  });

  it('is not an administrator power', () => {
    // An admin removes content through the moderation path, which has its own
    // audit trail (ADMIN-FR-004). Routing it through here would lose that.
    expect(canDeleteComment({ viewerId: 'an-admin', commentAuthorId, postAuthorId })).toBe(false);
  });
});

describe('resolveThreadParent (BR-033, ENGAGE-FR-003)', () => {
  it('attaches a reply to a top-level comment directly', () => {
    expect(resolveThreadParent({ id: 'top', parentCommentId: null })).toBe('top');
  });

  it('RE-POINTS A REPLY-TO-A-REPLY AT THE SAME PARENT THREAD', () => {
    // ENGAGE-FR-003: "a reply to a reply attaches to the same parent thread".
    // Re-pointed rather than refused - the intent is clear, and refusing would
    // be pedantry. The database refuses a third level regardless, which is
    // what makes this a convenience and not the enforcement.
    expect(resolveThreadParent({ id: 'a-reply', parentCommentId: 'top' })).toBe('top');
  });
});
