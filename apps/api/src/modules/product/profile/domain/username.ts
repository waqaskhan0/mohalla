/**
 * Username rules (PROFILE-FR-002 · BR-005 · SRS §12 · EDGE-007/008).
 *
 * 3–20 characters, lowercase letters / digits / underscore, must start with a
 * letter, unique case-insensitively, and not on the reserved list.
 *
 * IMMUTABLE ONCE SET. Mentions resolve against the username
 * (ENGAGE-FR-008), so changing one silently re-points every historical mention
 * at a different person. The database enforces this with a trigger; nothing
 * here can undo that.
 *
 * WHY THE CHARACTER SET IS THIS NARROW ON A BILINGUAL PLATFORM. Display names
 * accept any script, and Urdu display names are first-class. Usernames do not,
 * because a username is an *identifier*: it appears in mentions, and in
 * anything that resolves a handle to a person. Allowing mixed scripts there
 * invites homograph impersonation — Cyrillic `а` beside Latin `a` renders
 * identically, so `@ayesha` and `@аyesha` would be visually the same handle
 * belonging to two different people. On a civic platform where an
 * impersonated account can be used to mislead a neighbourhood, that is not a
 * theoretical risk. The Urdu identity lives in the display name, which is
 * shown more prominently anyway.
 */

export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 20;

/** Lowercase ASCII, digits, underscore; must begin with a letter. */
const USERNAME_PATTERN = /^[a-z][a-z0-9_]{2,19}$/;

/**
 * Handles nobody may claim.
 *
 * The SRS names `admin`, `shehersaaz`, `support`, `official` "and similar", so
 * this is that list read generously rather than minimally: anything that could
 * let an account pass itself off as the platform, its staff, or a system
 * function.
 *
 * A reserved handle is reported as UNAVAILABLE, never as "reserved" — the SRS
 * is explicit that it is refused *without explaining why*. Saying "reserved"
 * would hand an impersonator the exact list to work around.
 */
export const RESERVED_USERNAMES: ReadonlySet<string> = new Set([
  // The platform itself, in both names it goes by.
  'mohalla',
  'shehersaaz',
  'shehrsaaz',
  'sheher',
  'mohallah',

  // Staff and authority.
  'admin',
  'admins',
  'administrator',
  'moderator',
  'moderators',
  'mod',
  'staff',
  'team',
  'official',
  'officials',
  'support',
  'help',
  'helpdesk',
  'contact',
  'security',
  'abuse',
  'legal',
  'privacy',
  'press',
  'info',

  // Anything that reads as a system account or a notice.
  'system',
  'root',
  'null',
  'undefined',
  'anonymous',
  'deleted',
  'deleteduser',
  'notice',
  'alert',
  'announcement',
  'verified',
  'verify',
  'verification',

  // Reserved because they collide with route segments. `/users/{id}` and
  // `/me` exist today, and a handle that shadows a path is a bug waiting for
  // whoever later adds `/profile/{username}`.
  //
  // `me` and `my` are deliberately NOT listed: at two characters they are
  // already unreachable under the 3-character minimum, and an entry that can
  // never be typed is dead weight that hides a typo in the rest of the list.
  // A test asserts every entry here is itself shape-valid, which is how those
  // two were found.
  'self',
  'users',
  'user',
  'profile',
  'profiles',
  'settings',
  'login',
  'logout',
  'register',
  'signup',
  'signin',
  'auth',
  'api',
  'health',
  'docs',
  'search',
  'feed',
  'posts',
  'post',
  'events',
  'event',
  'messages',
  'message',
  'notifications',
  'about',
  'terms',
  'guidelines',
]);

export type UsernameRejection =
  'NOT_A_STRING' | 'TOO_SHORT' | 'TOO_LONG' | 'MUST_START_WITH_LETTER' | 'INVALID_CHARACTERS';

/**
 * Check the SHAPE of a username.
 *
 * Deliberately does not consider availability: whether a handle is free is a
 * database question, and whether it is reserved is deliberately reported as
 * the same "unavailable" as taken. Keeping shape separate means the caller can
 * give a genuinely helpful message for a malformed handle — which reveals
 * nothing about anyone else — while staying silent about the other two.
 *
 * Input is NOT lowercased for the caller. A username is chosen once and never
 * changed, so quietly transforming `Ayesha` into `ayesha` would hand someone a
 * permanent handle they did not type. They are told, and they choose.
 */
export function checkUsernameShape(username: unknown): UsernameRejection | null {
  if (typeof username !== 'string') return 'NOT_A_STRING';

  // Counted in code points. Every legal character here is one UTF-16 unit, so
  // this only differs for input that is already invalid - but it makes the
  // length error accurate for that input instead of surprising.
  const length = [...username].length;
  if (length < USERNAME_MIN_LENGTH) return 'TOO_SHORT';
  if (length > USERNAME_MAX_LENGTH) return 'TOO_LONG';

  if (USERNAME_PATTERN.test(username)) return null;

  // Distinguish "wrong first character" from "wrong characters" only because
  // the two produce genuinely different advice.
  if (!/^[a-z]/.test(username)) return 'MUST_START_WITH_LETTER';
  return 'INVALID_CHARACTERS';
}

export function isUsernameShapeValid(username: unknown): boolean {
  return checkUsernameShape(username) === null;
}

/**
 * Is this handle reserved?
 *
 * Compared case-insensitively so `Admin` is caught as readily as `admin`, even
 * though a mixed-case handle is refused by shape anyway. Belt and braces: this
 * predicate is also used to audit an existing list.
 */
export function isReservedUsername(username: string): boolean {
  return RESERVED_USERNAMES.has(username.toLowerCase());
}

/**
 * Everything about a username that can be decided without the database.
 *
 * Returns `AVAILABLE` only in the sense of "worth asking the database about".
 * The final answer belongs to the UNIQUE index (EDGE-007): two people
 * confirming the same handle simultaneously both pass any prior check, and
 * exactly one survives the insert.
 */
export type UsernameCheck =
  | { status: 'MALFORMED'; reason: UsernameRejection }
  | { status: 'UNAVAILABLE' }
  | { status: 'WORTH_CHECKING' };

export function checkUsername(username: unknown): UsernameCheck {
  const shape = checkUsernameShape(username);
  if (shape !== null) return { status: 'MALFORMED', reason: shape };
  if (isReservedUsername(username as string)) return { status: 'UNAVAILABLE' };
  return { status: 'WORTH_CHECKING' };
}
