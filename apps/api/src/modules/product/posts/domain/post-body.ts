import { countGraphemes } from '../../profile/domain/profile-fields.js';

/**
 * Post body rules (POST-FR-010 · BR-012 · SRS §12).
 *
 * 1–3,000 characters, counted as GRAPHEME CLUSTERS. BR-012 says why in the
 * requirement itself: "counted as Unicode grapheme clusters so that Urdu script
 * is not penalised relative to Latin text".
 *
 * That is not a nicety on this platform. Urdu uses combining marks, so `.length`
 * charges an Urdu writer for diacritics a reader does not see as characters —
 * a 3,000-character limit would become roughly 2,000 for one language and 3,000
 * for the other, on a platform whose whole point is that both are first-class.
 *
 * POST-FR-010's acceptance criterion is explicit that the client is not
 * trusted: "GIVEN a 3,001-character post submitted directly to the server with
 * the client bypassed, THEN it is rejected". The counter in the app is
 * feedback; this is authority.
 */

export const POST_BODY_MAX_LENGTH = 3000;

export type PostBodyRejection = 'NOT_A_STRING' | 'EMPTY' | 'TOO_LONG';

/**
 * Validate a post body.
 *
 * `hasAttachment` matters because POST-FR-001 makes the text conditional:
 * §12 says post text is "Required unless an attachment is present". A post
 * that is one photo and no words is a normal post — a neighbourhood noticeboard
 * is full of them — so an empty body is only an error when nothing else is
 * there.
 */
export function checkPostBody(
  body: unknown,
  options: { hasAttachment: boolean } = { hasAttachment: false },
): PostBodyRejection | null {
  if (typeof body !== 'string') return 'NOT_A_STRING';

  const trimmed = body.trim();
  if (trimmed === '' && !options.hasAttachment) return 'EMPTY';

  // Counted on the TRIMMED value: trailing newlines a keyboard added are not
  // characters the writer chose to spend.
  if (countGraphemes(trimmed) > POST_BODY_MAX_LENGTH) return 'TOO_LONG';
  return null;
}

/**
 * Normalise a body for storage.
 *
 * Trimmed, so leading and trailing whitespace does not survive into every
 * feed render. Interior whitespace is left exactly as written — a poster
 * laying out a notice with line breaks meant them.
 */
export function normalizePostBody(body: string): string {
  return body.trim();
}

/**
 * The first URL in a body, for the link preview (POST-FR-004).
 *
 * "One preview per post, generated from the first URL." Only http and https:
 * other schemes are either unfetchable or actively hostile (`file:` would aim
 * the SERVER-SIDE fetcher at the server's own disk, which is the classic
 * server-side request forgery through a preview feature).
 *
 * @returns the URL, or null when there is none worth previewing.
 */
export function findFirstUrl(body: string): string | null {
  // Deliberately conservative: a scheme is required. Bare `example.com` is not
  // treated as a link, because guessing turns ordinary punctuation into a
  // server-side fetch.
  const match = /\bhttps?:\/\/[^\s<>"']{4,2048}/i.exec(body);
  if (match === null) return null;

  // Trailing punctuation is almost always sentence punctuation rather than
  // part of the address.
  const url = match[0].replace(/[.,;:!?)\]}]+$/, '');
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}
