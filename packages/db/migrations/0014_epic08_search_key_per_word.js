/**
 * 0014 — EPIC-08 · the trailing-letter rule applies PER WORD, not per string.
 *
 * `0013` removed a trailing `h` or `y` from the search key, because Urdu words
 * ending in ہ are romanised with a final "a" (محلہ → "mohalla") and ی endings
 * appear as "i" or "ya".
 *
 * It anchored that with `$`, which is the end of the WHOLE STRING. So it fired
 * on a single word and silently did nothing inside a phrase:
 *
 *     "محلہ کمیٹی"  ->  "mhlh kmt"     but "mohalla committee" -> "mhl cmt"
 *     "شکریہ بھائی" ->  "1krh b"       but "shukriya bhai"     -> "1kry b"
 *
 * Both pairs should meet and neither did. Found by searching for a person
 * called عائشہ خان and getting nothing back — the display name is a phrase, so
 * every real name hit this.
 *
 * The fix is a lookahead rather than a consumed delimiter: `[hy](?=\s|$)`. A
 * pattern that consumed the space would match the first word and then have
 * eaten the boundary the next match needs, so a global replace would skip every
 * other word.
 *
 *     "محلہ کمیٹی"  ->  "mhl kmt"      "mohalla committee" -> "mhl cmt"
 *     "شکریہ بھائی" ->  "1kr b"        "shukriya bhai"     -> "1kr b"
 *
 * Forward-only (ADR-008): 0013 has run, so this is a new migration. Replacing
 * the function is enough — the generated columns recompute from it, which is
 * the reason they are generated rather than trigger-maintained.
 */

exports.shorthands = undefined;

/**
 * Rebuilding a function a STORED generated column depends on.
 *
 * PostgreSQL will not allow the definition of a function used by a generated
 * column to change underneath it, so the columns are dropped and re-added. On
 * an empty or small table that is a moment; at scale it would need a
 * concurrent-index dance, which is recorded here rather than discovered later.
 */
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
                lower(input),
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
        -- PER WORD. A lookahead, so the delimiter is not consumed - consuming
        -- it would eat the boundary the next match needs and a global replace
        -- would skip every other word.
        '[hy](?=\\s|$)', '', 'g'
      );
    $fn$;

    COMMENT ON FUNCTION search_key(text) IS
      'SEARCH-FR-003 / BR-042: reduces Urdu script and Roman Urdu to one consonant skeleton so either finds the other. Best-effort by requirement - known misses include the retroflex ڑ (romanised as both r and d) and English loanwords.';

    -- Recreated from the new definition.
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
