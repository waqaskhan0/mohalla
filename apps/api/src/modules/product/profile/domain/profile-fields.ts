/**
 * Profile field validation (PROFILE-FR-001/003 · SRS §12 · BR-010).
 *
 * | Field        | Min | Max | Notes                                   |
 * |--------------|-----|-----|-----------------------------------------|
 * | display name |   2 |  50 | Any script. Not blank. NOT unique       |
 * | bio          |   0 | 200 | Any script, GRAPHEME CLUSTERS counted   |
 * | city         |   0 |  60 | Free text; never derived from the device |
 *
 * THE COUNTING RULE IS THE INTERESTING PART. §12 specifies grapheme clusters
 * for the bio, and on this platform that is not pedantry:
 *
 *   - Urdu is written with combining marks. `کِتاب` is 4 letters a reader sees
 *     but 5 code points, so counting code points charges Urdu writers for
 *     diacritics they did not "spend".
 *   - A flag emoji is 2 code points and 4 UTF-16 units; a family emoji can be
 *     11 code points. `.length` would let a 200-character bio hold as few as
 *     18 visible emoji, or reject a perfectly ordinary Urdu sentence.
 *
 * So the limit is what a person would count if they counted by eye. That means
 * `Intl.Segmenter`, not `.length`, and not `[...s].length`.
 *
 * The DATABASE checks `char_length`, which counts code points. The two
 * deliberately disagree: the database bound is a backstop against a code path
 * that skipped validation, and a code-point count is always >= a grapheme
 * count, so anything this function accepts the database also accepts. The
 * reverse is not true, which is the correct direction for a safety net.
 */

export const DISPLAY_NAME_MIN_LENGTH = 2;
export const DISPLAY_NAME_MAX_LENGTH = 50;
export const BIO_MAX_LENGTH = 200;
export const CITY_MAX_LENGTH = 60;

/**
 * Count what a reader would call "characters".
 *
 * `Intl.Segmenter` is in Node 18+ and every Android WebView this targets, so
 * there is no fallback path to keep correct. If it were absent, silently
 * falling back to code points would make the limit quietly wrong for exactly
 * the users this platform is for, so it is better that it is simply present.
 */
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

export function countGraphemes(value: string): number {
  let n = 0;
  for (const _ of segmenter.segment(value)) n += 1;
  return n;
}

export type DisplayNameRejection = 'NOT_A_STRING' | 'BLANK' | 'TOO_SHORT' | 'TOO_LONG';

/**
 * Validate a display name.
 *
 * Leading and trailing whitespace is REJECTED rather than trimmed. Trimming
 * silently would mean two neighbours could hold names that look identical but
 * differ by an invisible character, and the person who typed the space would
 * never learn why their name renders oddly. §12 says "no leading or trailing
 * whitespace", so that is what is checked.
 *
 * BR-010: display names are NOT unique. Two people in one neighbourhood may
 * genuinely share a name, and forcing one of them to add a number to their own
 * name is a worse outcome than the ambiguity. The username disambiguates.
 */
export function checkDisplayName(name: unknown): DisplayNameRejection | null {
  if (typeof name !== 'string') return 'NOT_A_STRING';
  if (name.trim() === '') return 'BLANK';
  if (name !== name.trim()) return 'BLANK';

  const length = countGraphemes(name);
  if (length < DISPLAY_NAME_MIN_LENGTH) return 'TOO_SHORT';
  if (length > DISPLAY_NAME_MAX_LENGTH) return 'TOO_LONG';
  return null;
}

export type BioRejection = 'NOT_A_STRING' | 'TOO_LONG';

/** Optional. An absent bio and an empty bio are the same thing. */
export function checkBio(bio: unknown): BioRejection | null {
  if (bio === null || bio === undefined) return null;
  if (typeof bio !== 'string') return 'NOT_A_STRING';
  return countGraphemes(bio) > BIO_MAX_LENGTH ? 'TOO_LONG' : null;
}

export type CityRejection = 'NOT_A_STRING' | 'TOO_LONG';

/**
 * Optional, free text (PRIV-012).
 *
 * There is no fixed city list in V1 and, more importantly, this is never
 * derived from the device. A city inferred from GPS or an IP address is
 * location data the user did not choose to share, on a platform where being
 * locatable can be the risk.
 */
export function checkCity(city: unknown): CityRejection | null {
  if (city === null || city === undefined) return null;
  if (typeof city !== 'string') return 'NOT_A_STRING';
  return countGraphemes(city) > CITY_MAX_LENGTH ? 'TOO_LONG' : null;
}

/** Empty optional text normalises to null, so "" and absent are one state. */
export function normalizeOptionalText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}
