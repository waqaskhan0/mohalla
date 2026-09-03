import { describe, it, expect } from 'vitest';
import {
  POST_BODY_MAX_LENGTH,
  checkPostBody,
  findFirstUrl,
  normalizePostBody,
} from './post-body.js';
import { canAuthorModify, decidePostVisibility, type PostViewerFacts } from './post-visibility.js';

describe('checkPostBody (BR-012, POST-FR-010)', () => {
  it('accepts an ordinary post', () => {
    expect(checkPostBody('The water has been off on our street since Tuesday.')).toBeNull();
  });

  it('DOES NOT PENALISE URDU RELATIVE TO LATIN (BR-012)', () => {
    // The requirement says so in as many words: counted as grapheme clusters
    // "so that Urdu script is not penalised relative to Latin text". Counting
    // code points would make the limit ~2,000 for one language and 3,000 for
    // the other, on a platform where both are first-class.
    const urdu = 'کِ'.repeat(POST_BODY_MAX_LENGTH);
    expect([...urdu].length).toBeGreaterThan(POST_BODY_MAX_LENGTH);
    expect(checkPostBody(urdu)).toBeNull();
  });

  it('enforces the limit exactly', () => {
    expect(checkPostBody('x'.repeat(POST_BODY_MAX_LENGTH))).toBeNull();
    expect(checkPostBody('x'.repeat(POST_BODY_MAX_LENGTH + 1))).toBe('TOO_LONG');
  });

  it('REJECTS 3,001 CHARACTERS EVEN WITH THE CLIENT BYPASSED', () => {
    // POST-FR-010's acceptance criterion, stated as a test.
    expect(checkPostBody('a'.repeat(3001))).toBe('TOO_LONG');
  });

  it('requires text when there is no attachment', () => {
    expect(checkPostBody('')).toBe('EMPTY');
    expect(checkPostBody('   ')).toBe('EMPTY');
  });

  it('ALLOWS AN EMPTY BODY WHEN A PHOTO IS ATTACHED', () => {
    // §12: post text is "Required unless an attachment is present". A post
    // that is one photo and no words is a normal noticeboard post.
    expect(checkPostBody('', { hasAttachment: true })).toBeNull();
    expect(checkPostBody('   ', { hasAttachment: true })).toBeNull();
  });

  it('counts the trimmed value, so a trailing newline is not a character spent', () => {
    expect(checkPostBody(`${'x'.repeat(POST_BODY_MAX_LENGTH)}\n\n  `)).toBeNull();
  });

  it('counts emoji as one character each', () => {
    expect(checkPostBody('🇵🇰'.repeat(POST_BODY_MAX_LENGTH))).toBeNull();
    expect(checkPostBody('🇵🇰'.repeat(POST_BODY_MAX_LENGTH + 1))).toBe('TOO_LONG');
  });

  it('rejects non-string input', () => {
    for (const bad of [undefined, null, 42, {}]) {
      expect(checkPostBody(bad)).toBe('NOT_A_STRING');
    }
  });
});

describe('normalizePostBody', () => {
  it('trims the outside and preserves the inside', () => {
    // A poster laying out a notice with line breaks meant them.
    expect(normalizePostBody('  Notice:\n\n  Water off\n  ')).toBe('Notice:\n\n  Water off');
  });
});

describe('findFirstUrl (POST-FR-004)', () => {
  it('finds the first URL in a body', () => {
    expect(findFirstUrl('See https://example.org/notice for details')).toBe(
      'https://example.org/notice',
    );
  });

  it('takes only the FIRST, since there is one preview per post', () => {
    expect(findFirstUrl('https://first.example and https://second.example')).toBe(
      'https://first.example',
    );
  });

  it('REFUSES NON-HTTP SCHEMES, which is a server-side-request-forgery guard', () => {
    // The preview is fetched SERVER-SIDE (SEC-014). A `file:` URL would aim
    // that fetcher at the server's own disk.
    expect(findFirstUrl('file:///etc/passwd')).toBeNull();
    expect(findFirstUrl('ftp://example.org/x')).toBeNull();
    expect(findFirstUrl('javascript:alert(1)')).toBeNull();
    expect(findFirstUrl('data:text/html,<script>')).toBeNull();
  });

  it('does not guess at bare domains', () => {
    // Guessing turns ordinary punctuation into a server-side fetch.
    expect(findFirstUrl('visit example.org today')).toBeNull();
  });

  it('drops trailing sentence punctuation', () => {
    expect(findFirstUrl('Read https://example.org/notice.')).toBe('https://example.org/notice');
    expect(findFirstUrl('(see https://example.org/x)')).toBe('https://example.org/x');
  });

  it('returns null when there is nothing to preview', () => {
    expect(findFirstUrl('no links here')).toBeNull();
    expect(findFirstUrl('')).toBeNull();
  });
});

describe('decidePostVisibility (POST-FR-009, BR-025/032)', () => {
  const facts = (over: Partial<PostViewerFacts> = {}): PostViewerFacts => ({
    state: 'VISIBLE',
    isAuthor: false,
    isAdmin: false,
    blockedEitherWay: false,
    authorHidden: false,
    ...over,
  });

  it('shows a visible post to anyone', () => {
    expect(decidePostVisibility(facts())).toBe('VISIBLE');
  });

  it('SHOWS AN AUTO-HIDDEN POST TO ITS AUTHOR, MARKED (BR-032)', () => {
    // PROFILE-FR-004: "the owner additionally sees their own auto-hidden
    // content, marked as under review". Hiding it from them would mean their
    // post silently vanishes and they cannot appeal what they cannot see.
    expect(decidePostVisibility(facts({ state: 'AUTO_HIDDEN', isAuthor: true }))).toBe(
      'VISIBLE_UNDER_REVIEW',
    );
  });

  it('hides an auto-hidden post from everyone else', () => {
    expect(decidePostVisibility(facts({ state: 'AUTO_HIDDEN' }))).toBe('NOT_AVAILABLE');
  });

  it('hides a deleted post FROM ITS AUTHOR TOO', () => {
    // POST-FR-007: it "disappears from every feed and profile".
    expect(decidePostVisibility(facts({ state: 'AUTHOR_DELETED', isAuthor: true }))).toBe(
      'NOT_AVAILABLE',
    );
    expect(decidePostVisibility(facts({ state: 'ADMIN_REMOVED', isAuthor: true }))).toBe(
      'NOT_AVAILABLE',
    );
  });

  it('lets an administrator see removed and hidden content', () => {
    // Moderation cannot review what it cannot load (ADMIN-FR-002/003).
    expect(decidePostVisibility(facts({ state: 'ADMIN_REMOVED', isAdmin: true }))).toBe('VISIBLE');
    expect(decidePostVisibility(facts({ state: 'AUTO_HIDDEN', isAdmin: true }))).toBe('VISIBLE');
  });

  it('DOES NOT SHOW AN ADMIN AN AUTHOR-DELETED POST', () => {
    // BR-014: an administrator cannot restore it, so there is nothing to
    // review and no reason to surface it.
    expect(decidePostVisibility(facts({ state: 'AUTHOR_DELETED', isAdmin: true }))).toBe(
      'NOT_AVAILABLE',
    );
  });

  it('CHECKS THE BLOCK BEFORE THE POST STATE', () => {
    // A blocked viewer gets the same answer whatever the post is. Otherwise
    // behaviour could differ between "blocked and the post exists" and
    // "blocked and it does not" - a slow leak of the fact a block exists.
    const answers = [
      decidePostVisibility(facts({ blockedEitherWay: true, state: 'VISIBLE' })),
      decidePostVisibility(facts({ blockedEitherWay: true, state: 'AUTO_HIDDEN' })),
      decidePostVisibility(facts({ blockedEitherWay: true, state: 'ADMIN_REMOVED' })),
      decidePostVisibility(facts({ blockedEitherWay: true, state: 'AUTHOR_DELETED' })),
    ];
    expect(new Set(answers).size).toBe(1);
    expect(answers[0]).toBe('NOT_AVAILABLE');
  });

  it('hides a post whose author is banned or deleted', () => {
    expect(decidePostVisibility(facts({ authorHidden: true }))).toBe('NOT_AVAILABLE');
  });

  it('still shows a suspended author their own post', () => {
    // `authorHidden` is banned/deleted only; a suspended person keeps reading.
    expect(decidePostVisibility(facts({ authorHidden: true, isAuthor: true }))).toBe('VISIBLE');
  });

  it('covers every combination without a gap', () => {
    const states = ['VISIBLE', 'AUTO_HIDDEN', 'ADMIN_REMOVED', 'AUTHOR_DELETED'] as const;
    for (const state of states) {
      for (const isAuthor of [true, false]) {
        for (const isAdmin of [true, false]) {
          for (const blockedEitherWay of [true, false]) {
            for (const authorHidden of [true, false]) {
              const result = decidePostVisibility({
                state,
                isAuthor,
                isAdmin,
                blockedEitherWay,
                authorHidden,
              });
              expect(['VISIBLE', 'VISIBLE_UNDER_REVIEW', 'NOT_AVAILABLE']).toContain(result);
            }
          }
        }
      }
    }
  });
});

describe('canAuthorModify (POST-FR-007/008, BR-014)', () => {
  it('lets the author edit their own visible post', () => {
    expect(canAuthorModify({ state: 'VISIBLE', isAuthor: true })).toBe(true);
  });

  it('lets the author edit a post that is under review', () => {
    // They can still fix what was reported, which is often the useful outcome.
    expect(canAuthorModify({ state: 'AUTO_HIDDEN', isAuthor: true })).toBe(true);
  });

  it('REFUSES ANYONE WHO IS NOT THE AUTHOR, including an administrator', () => {
    // An admin can REMOVE a post - a separate action with its own audit trail
    // - but putting words in someone's mouth under their name is not a
    // moderation power any requirement grants.
    expect(canAuthorModify({ state: 'VISIBLE', isAuthor: false })).toBe(false);
  });

  it('refuses to edit a post that has been removed or deleted', () => {
    // An author must not edit their way out of a moderation decision.
    expect(canAuthorModify({ state: 'ADMIN_REMOVED', isAuthor: true })).toBe(false);
    expect(canAuthorModify({ state: 'AUTHOR_DELETED', isAuthor: true })).toBe(false);
  });
});
