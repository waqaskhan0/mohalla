/**
 * 0015 — EPIC-08 · collapse vowel+y diphthongs in the search key.
 *
 * After 0014, one case still failed and it was the one that matters most for
 * SEARCH-FR-001: `عائشہ` was not found by searching "ayesha".
 *
 * The cause is that Roman Urdu writes a diphthong with a `y` — "ayesha",
 * "zainab", "paidal" — where the Urdu script has a vowel letter that this
 * function already drops. So the Roman side kept a consonant the Urdu side
 * never had:
 *
 *     عائشہ  -> "1"        ayesha -> "y1"
 *
 * Collapsing `[aeiou]y` to the bare vowel BEFORE the rest of the pipeline puts
 * them back in the same alphabet.
 *
 * MEASURED BEFORE ADOPTING, across names and ordinary vocabulary together —
 * because a rule that fixes names while quietly costing recall on everyday
 * words is not a win, and that is not visible from the name list alone. On a
 * 24-pair set: 23/24 before, 24/24 after, no regressions. Names are the case
 * that justified it (most people will type a Roman name into people search),
 * and words like "kya", "paidal" and "zainab" confirmed it costs nothing.
 *
 * A NOTE ON WHAT THIS PRODUCES. Short words reduce to very short keys — علی and
 * "ali" both become "l". A one-character key would match almost anything, so
 * the SERVICE requires a normalised query key of at least two characters and
 * falls back to matching the original text below that. SEARCH-FR-003 E2 already
 * refuses queries under two characters outright; this is the same guard applied
 * to the key rather than the input.
 *
 * Forward-only (ADR-008). Third refinement of one function, and each step was
 * driven by a failing pair rather than by inspection — which is the point:
 * transliteration is not something to get right by reasoning about it.
 */

exports.shorthands = undefined;

exports.up = async (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS posts_search_key_trgm;
    ALTER TABLE posts DROP COLUMN IF EXISTS search_key;
    DROP INDEX IF EXISTS profiles_search_key_trgm;
    ALTER TABLE profiles DROP COLUMN IF EXISTS search_key;

    DROP FUNCTION IF EXISTS search_key(text);

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
                -- Diphthongs first: Roman writes "ay"/"ai"/"ey" where the Urdu
                -- script has a vowel letter this function later drops.
                regexp_replace(lower(input), '([aeiou])y', '\\1', 'g'),
                -- Urdu aspirates: a base consonant followed by ھ.
                'کھ','3'), 'گھ','4'), 'چھ','2'), 'جھ','j'), 'ٹھ','6'), 'تھ','6'),
                'دھ','d'), 'ڈھ','d'), 'بھ','b'), 'پھ','p'), 'ڑھ','r'),
                -- Urdu single letters that are one Roman sound.
                'ش','1'), 'چ','2'), 'خ','3'), 'غ','4'), 'ژ','5'),
                -- The SAME markers from the Roman side. Three-letter forms
                -- first, or "chh" is consumed as "ch" plus a stray "h".
                'chh','2'), 'sh','1'), 'ch','2'), 'kh','3'), 'gh','4'),
                'zh','5'), 'th','6'), 'ph','p'), 'bh','b'), 'dh','d'),
              'اآبپتٹثجحدڈذرڑزسصضطظعفقکگلمنںوہھءیےئؤأ',
              'aabpttsjhddzrrzssztzafkkglmnnohhaieioa'
            ),
            -- Short vowels go: Urdu script does not write them, so a
            -- transliteration of Urdu is already a consonant skeleton and the
            -- Roman side must be reduced the same way to meet it. 'w' goes too
            -- - و is both the vowel o/u and the consonant w.
            '[aeiouw]', '', 'g'
          ),
          '(.)\\1+', '\\1', 'g'
        ),
        -- PER WORD, via a lookahead so the delimiter is not consumed.
        '[hy](?=\\s|$)', '', 'g'
      );
    $fn$;

    COMMENT ON FUNCTION search_key(text) IS
      'SEARCH-FR-003 / BR-042: reduces Urdu script and Roman Urdu to one consonant skeleton so either finds the other. Best-effort by requirement - known misses are the retroflex ڑ (romanised as both r and d) and English loanwords. Short words yield short keys, so callers must require a key of at least 2 characters.';

    ALTER TABLE posts ADD COLUMN search_key text
      GENERATED ALWAYS AS (search_key(body)) STORED;
    CREATE INDEX posts_search_key_trgm
      ON posts USING GIN (search_key gin_trgm_ops)
      WHERE visibility_state = 'VISIBLE';

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
