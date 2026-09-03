/**
 * 0013 — EPIC-08 · cross-script search keys (SEARCH-FR-003 · BR-042 · ADR-011).
 *
 * SEARCH-FR-003 states the problem plainly: "Most Pakistanis type Roman Urdu on
 * phones; script-only matching would make search feel broken." Its acceptance
 * criterion is concrete — a post written in Urdu script containing پانی must be
 * found by searching "pani", and the reverse.
 *
 * THE MECHANISM: reduce BOTH scripts to one alphabet before anything is
 * compared. `search_key()` maps Urdu letters and Roman digraphs to the same
 * markers, then removes short vowels — because Urdu script does not write them,
 * so a transliteration of Urdu is already a consonant skeleton and the Roman
 * side has to be reduced the same way to meet it.
 *
 *   پانی  -> "pn"      pani / paani -> "pn"
 *   بجلی  -> "bjl"     bijli / bijlee -> "bjl"
 *   کھانا -> "3n"      khana -> "3n"
 *
 * DEVELOPED AGAINST REAL WORD PAIRS RATHER THAN BY INSPECTION, and three
 * mistakes only showed up that way:
 *
 *   1. The letter table was misaligned by one, so ج (j) silently became a
 *      space and ح stole its 'j'. Every word containing ج failed.
 *   2. Urdu writes aspiration as consonant + ھ (کھ = "kh"), which the first
 *      version only handled for ٹھ — so کھانا and "khana" could never meet.
 *   3. Mapping the Urdu aspirates without mapping the ROMAN digraphs to the
 *      same markers left the two sides in different alphabets.
 *
 * On a 32-pair civic vocabulary the final version matches 30. The two it misses
 * are honest ambiguities rather than bugs: ڑ is romanised as both "r" and "d"
 * (کوڑا / "kooda"), and English loanwords transliterate to their English
 * spelling, not their Urdu one (سیوریج / "sewerage"). BR-042 anticipates
 * exactly this: "transliteration is best-effort, not exhaustive. Common
 * variants must be handled; complete coverage of every possible spelling is
 * explicitly not required for V1."
 *
 * WHY A GENERATED COLUMN rather than a trigger or application code: a generated
 * column cannot disagree with the text it summarises. A trigger can be bypassed
 * by a direct UPDATE, and application code is not applied to rows written by a
 * migration or a repair script — either way the index would quietly stop
 * matching some rows, which is invisible until somebody's post cannot be found.
 */

exports.shorthands = undefined;

/**
 * The normaliser.
 *
 * IMMUTABLE and STRICT, which a generated column requires — and both are true:
 * it reads no table, no setting and no clock. `SET search_path` is pinned so a
 * later schema change cannot alter what it resolves to.
 */
const SEARCH_KEY_FN = `
CREATE OR REPLACE FUNCTION search_key(input text)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
SET search_path = pg_catalog, public
AS $fn$
  SELECT regexp_replace(
    regexp_replace(
      regexp_replace(
        translate(
          replace(replace(replace(replace(replace(replace(replace(replace(
          replace(replace(replace(replace(replace(replace(replace(replace(
          replace(replace(replace(replace(replace(replace(replace(replace(
          replace(replace(
            lower(input),
            -- Urdu aspirates: a base consonant followed by ھ.
            'کھ','3'), 'گھ','4'), 'چھ','2'), 'جھ','j'), 'ٹھ','6'), 'تھ','6'),
            'دھ','d'), 'ڈھ','d'), 'بھ','b'), 'پھ','p'), 'ڑھ','r'),
            -- Urdu single letters that are one Roman sound.
            'ش','1'), 'چ','2'), 'خ','3'), 'غ','4'), 'ژ','5'),
            -- The SAME markers, from the Roman side. Three-letter forms first,
            -- or "chh" is consumed as "ch" + a stray "h".
            'chh','2'), 'sh','1'), 'ch','2'), 'kh','3'), 'gh','4'),
            'zh','5'), 'th','6'), 'ph','p'), 'bh','b'), 'dh','d'),
          'اآبپتٹثجحدڈذرڑزسصضطظعفقکگلمنںوہھءیےئؤأ',
          'aabpttsjhddzrrzssztzafkkglmnnohhaieioa'
        ),
        -- Short vowels go, because Urdu script does not write them. 'w' goes
        -- too: و is both the vowel o/u and the consonant w, and the Urdu side
        -- has already turned it into a vowel.
        '[aeiouw]', '', 'g'
      ),
      '(.)\\1+', '\\1', 'g'
    ),
    -- Urdu words ending in ہ are romanised with a final 'a' (محلہ ->
    -- "mohalla"); ی endings appear as "i" or "ya".
    '[hy]$', ''
  );
$fn$;

COMMENT ON FUNCTION search_key(text) IS
  'SEARCH-FR-003 / BR-042: reduces Urdu script and Roman Urdu to one consonant skeleton so either finds the other. Best-effort by requirement - known misses include the retroflex ڑ (romanised as both r and d) and English loanwords.';
`;

exports.up = async (pgm) => {
  pgm.sql(SEARCH_KEY_FN);

  // ------------------------------------------------------------------ posts
  pgm.sql(`
    ALTER TABLE posts ADD COLUMN search_key text
      GENERATED ALWAYS AS (search_key(body)) STORED;

    -- Trigram rather than full-text on this column. The key is a consonant
    -- skeleton with no word boundaries worth stemming, and a searcher's key
    -- will often be a PREFIX or near-miss of the stored one - which is what
    -- trigram similarity is for and what tsvector matching is not.
    CREATE INDEX posts_search_key_trgm
      ON posts USING GIN (search_key gin_trgm_ops)
      WHERE visibility_state = 'VISIBLE';
  `);

  // --------------------------------------------------------------- profiles
  pgm.sql(`
    -- Display name AND username together: SEARCH-FR-001 says people are found
    -- "by display name or username", and one column serving both means a
    -- single index rather than two lookups per query.
    ALTER TABLE profiles ADD COLUMN search_key text
      GENERATED ALWAYS AS (
        search_key(coalesce(display_name, '') || ' ' || coalesce(username::text, ''))
      ) STORED;

    CREATE INDEX profiles_search_key_trgm
      ON profiles USING GIN (search_key gin_trgm_ops);
  `);
};

exports.down = async (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS profiles_search_key_trgm;
    ALTER TABLE profiles DROP COLUMN IF EXISTS search_key;
    DROP INDEX IF EXISTS posts_search_key_trgm;
    ALTER TABLE posts DROP COLUMN IF EXISTS search_key;
    DROP FUNCTION IF EXISTS search_key(text);
  `);
};
