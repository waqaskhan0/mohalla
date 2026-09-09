import { describe, it, expect } from 'vitest';
import {
  RESERVED_USERNAMES,
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
  checkUsername,
  checkUsernameShape,
  isReservedUsername,
  isUsernameShapeValid,
} from './username.js';

describe('checkUsernameShape (SRS §12: 3–20, a–z 0–9 _, starts with a letter)', () => {
  it('accepts an ordinary handle', () => {
    expect(checkUsernameShape('ayesha_k')).toBeNull();
    expect(isUsernameShapeValid('bilal99')).toBe(true);
  });

  it('enforces both bounds exactly', () => {
    expect(checkUsernameShape('ab')).toBe('TOO_SHORT');
    expect(checkUsernameShape('abc')).toBeNull();
    expect(checkUsernameShape('a'.repeat(USERNAME_MAX_LENGTH))).toBeNull();
    expect(checkUsernameShape('a'.repeat(USERNAME_MAX_LENGTH + 1))).toBe('TOO_LONG');
  });

  it('requires a letter first, so a handle is never mistaken for an id', () => {
    expect(checkUsernameShape('1ayesha')).toBe('MUST_START_WITH_LETTER');
    expect(checkUsernameShape('_ayesha')).toBe('MUST_START_WITH_LETTER');
  });

  it('rejects uppercase rather than silently lowercasing it', () => {
    // A username is chosen ONCE and never changed (BR-005). Quietly
    // transforming the input would hand someone a permanent handle they did
    // not type.
    expect(checkUsernameShape('Ayesha')).toBe('MUST_START_WITH_LETTER');
    expect(checkUsernameShape('ayeshaK')).toBe('INVALID_CHARACTERS');
  });

  it('rejects punctuation that looks harmless', () => {
    for (const bad of ['ayesha-k', 'ayesha.k', 'ayesha k', 'ayesha@k', 'ayesha/k', 'ayesha+k']) {
      expect(checkUsernameShape(bad)).toBe('INVALID_CHARACTERS');
    }
  });

  it('REJECTS NON-LATIN SCRIPT, which is a deliberate asymmetry', () => {
    // Display names accept any script and Urdu names are first-class. A
    // USERNAME is an identifier used in mentions, so mixed scripts invite
    // homograph impersonation: Cyrillic 'а' renders identically to Latin 'a',
    // making @ayesha and @аyesha visually the same handle owned by two people.
    expect(checkUsernameShape('عائشہ')).toBe('MUST_START_WITH_LETTER');
    expect(checkUsernameShape('аyesha')).toBe('MUST_START_WITH_LETTER'); // Cyrillic а
    expect(checkUsernameShape('ayeshа')).toBe('INVALID_CHARACTERS'); // Cyrillic а at the end
  });

  it('rejects an emoji handle', () => {
    expect(checkUsernameShape('ayesha😀')).toBe('INVALID_CHARACTERS');
  });

  it('counts length by code point, so a long emoji handle is not "short"', () => {
    // Invalid either way, but the reported reason should be accurate.
    expect(checkUsernameShape('😀😀')).toBe('TOO_SHORT');
  });

  it('rejects non-string input rather than coercing it', () => {
    for (const bad of [undefined, null, 12345, {}, []]) {
      expect(checkUsernameShape(bad)).toBe('NOT_A_STRING');
    }
  });

  it('exposes the documented bounds', () => {
    expect(USERNAME_MIN_LENGTH).toBe(3);
    expect(USERNAME_MAX_LENGTH).toBe(20);
  });
});

describe('reserved usernames', () => {
  it('reserves the platform, its staff and its system accounts', () => {
    for (const name of ['admin', 'shehersaaz', 'support', 'official', 'mohalla', 'system']) {
      expect(isReservedUsername(name)).toBe(true);
    }
  });

  it('RESERVES HANDLES THAT COLLIDE WITH ROUTE SEGMENTS', () => {
    // /users/{id} and /me exist today. A handle shadowing a path is a bug
    // waiting for whoever later adds /profile/{username}.
    for (const name of ['users', 'api', 'login', 'settings', 'search', 'health', 'profile']) {
      expect(isReservedUsername(name)).toBe(true);
    }
  });

  it('does not bother reserving what the length rule already blocks', () => {
    // `me` is a route segment, but at two characters it can never be a
    // username anyway. Listing it would be dead weight that hides a typo in
    // the rest of the list.
    expect(checkUsernameShape('me')).toBe('TOO_SHORT');
    expect(isReservedUsername('me')).toBe(false);
  });

  it('reserves "deleted", which a deleted account is displayed as', () => {
    expect(isReservedUsername('deleted')).toBe(true);
    expect(isReservedUsername('deleteduser')).toBe(true);
  });

  it('compares case-insensitively', () => {
    expect(isReservedUsername('ADMIN')).toBe(true);
    expect(isReservedUsername('Shehersaaz')).toBe(true);
  });

  it('leaves ordinary handles alone', () => {
    for (const name of ['ayesha_k', 'bilal99', 'karachi_walla', 'admin_ayesha']) {
      expect(isReservedUsername(name)).toBe(false);
    }
  });

  it('contains only entries that are themselves shape-valid', () => {
    // A reserved word that could never be typed as a username is dead weight
    // and hides a typo in the list.
    for (const name of RESERVED_USERNAMES) {
      expect(checkUsernameShape(name), `reserved entry "${name}"`).toBeNull();
    }
  });
});

describe('checkUsername — what the caller is told', () => {
  it('reports a malformed handle with its reason', () => {
    // Safe to be specific: it says nothing about anyone else's account.
    expect(checkUsername('ab')).toEqual({ status: 'MALFORMED', reason: 'TOO_SHORT' });
  });

  it('REPORTS A RESERVED HANDLE AS MERELY UNAVAILABLE', () => {
    // The SRS says a reserved handle is refused "without explaining why".
    // Saying "reserved" would hand an impersonator the list to work around.
    expect(checkUsername('admin')).toEqual({ status: 'UNAVAILABLE' });
    expect(checkUsername('shehersaaz')).toEqual({ status: 'UNAVAILABLE' });
  });

  it('makes a reserved handle indistinguishable from a taken one', () => {
    // The service returns UNAVAILABLE for a taken handle too, so these must be
    // the same value here.
    const reserved = checkUsername('support');
    expect(JSON.stringify(reserved)).toBe(JSON.stringify({ status: 'UNAVAILABLE' }));
  });

  it('defers a well-formed free handle to the database', () => {
    // Availability is decided by the UNIQUE index, not here: two people
    // confirming the same handle at once both pass this check (EDGE-007).
    expect(checkUsername('ayesha_k')).toEqual({ status: 'WORTH_CHECKING' });
  });
});
