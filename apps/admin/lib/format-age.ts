/**
 * How long a case has been waiting, in words.
 *
 * AGE IS THE THIRD ORDERING KEY, so it is a working number rather than
 * decoration: the queue puts the oldest of equal cases first, and a moderator
 * reading down the column is checking whether anything has been left. "6d" for
 * a Critical item is a different message from "20m".
 *
 * COARSE ON PURPOSE. Nobody triages by the minute, and a precise duration
 * invites a precision the figure does not have — the case's `createdAt` is
 * when it was opened, not when the content was posted. Days, hours, minutes.
 *
 * COMPUTED ON THE SERVER, which is safe here because every page that uses it is
 * a Server Component rendered per request with `cache: 'no-store'`. There is no
 * client hydration to disagree with, and no stale value from a cache. If this
 * is ever needed in a client component it must take the server's `now` as a
 * prop instead, or the two will render different strings for the same instant.
 */
export function formatAge(iso: string, now: Date = new Date()): string {
  const created = Date.parse(iso);

  // An unparseable timestamp is reported, not guessed at. A case showing "0m"
  // because its date was malformed would sort to the top of a moderator's
  // attention for no reason.
  if (!Number.isFinite(created)) return 'unknown';

  const seconds = Math.floor((now.getTime() - created) / 1000);

  // A future timestamp means clock skew between the API host and this one.
  // Saying so is better than "-3h", which reads as a bug in the queue.
  if (seconds < 0) return 'just now';

  return coarse(seconds);
}

/**
 * A duration in seconds, in the coarse buckets this file uses everywhere.
 *
 * SHARED SO THE TWO CALLERS CANNOT DRIFT. An age of "6d" and an expiry of "6
 * days" on the same screen would read as two different kinds of measurement.
 */
function coarse(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;

  const days = Math.floor(hours / 24);
  if (days < 100) return `${days}d`;

  // Past a hundred days the exact count stops meaning anything, and a queue
  // item that old is a different conversation from a triage decision.
  return '100d+';
}

/**
 * When something ends — or that it already has.
 *
 * WHY THIS IS NOT `formatAge`. The enforcement history's `expiresAt` is a
 * FUTURE instant for a suspension still running, and `formatAge` answers a
 * future instant with "just now", which on that column would be a plain
 * falsehood. The first version of the case detail rendered the raw value
 * instead — a moderator judging proportionality was shown
 * `2026-09-16T10:16:37.923Z` in a table where every other time was coarse.
 *
 * THE TENSE IS THE INFORMATION. "in 6d" is a suspension currently in force;
 * "ended 3d ago" is one that has lifted. Those lead to different decisions, and
 * a bare "6d" would not distinguish them — EDGE-028 makes the difference real,
 * because a suspension lifts automatically with no administrator action.
 */
export function formatExpiry(iso: string, now: Date = new Date()): string {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return 'unknown';

  const seconds = Math.floor((at - now.getTime()) / 1000);
  return seconds > 0 ? `in ${coarse(seconds)}` : `ended ${coarse(-seconds)} ago`;
}

/**
 * The full instant, for a `title` attribute.
 *
 * The coarse age is what gets scanned; this is what gets checked when somebody
 * needs to know exactly when. Kept as the ISO value rather than a localised
 * format, because an administrator comparing this against an audit entry or a
 * log line wants the same string those carry.
 */
export function exactInstant(iso: string): string {
  return Number.isFinite(Date.parse(iso)) ? iso : 'unknown';
}
