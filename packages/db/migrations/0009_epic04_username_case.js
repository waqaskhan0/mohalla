/**
 * 0009 — EPIC-04 · usernames must be STORED lowercase, not merely compared so.
 *
 * `0008` put the §12 shape rule in a CHECK:
 *
 *     CHECK (username ~ '^[a-z][a-z0-9_]{2,19}$')
 *
 * That looks like it forbids uppercase. It does not. `username` is `citext`,
 * and citext's `~` operator is CASE-INSENSITIVE — so `Ayesha_K` satisfies a
 * pattern written entirely in lowercase, and PostgreSQL stores it verbatim.
 * Verified against the real table before writing this: the row was accepted and
 * read back as `"Ayesha_K"`.
 *
 * WHY THAT MATTERS RATHER THAN BEING COSMETIC. Uniqueness was never at risk —
 * citext's UNIQUE index still prevents two people holding the same handle in
 * different cases. What breaks is everything that treats the username as a
 * stable string:
 *
 *   - §12 specifies lowercase, so the stored value contradicts the spec;
 *   - mentions resolve against the username (ENGAGE-FR-008), and would carry
 *     whatever casing the author happened to type;
 *   - a profile URL and the displayed `@handle` would vary per account for no
 *     reason a user could understand.
 *
 * The fix compares against `lower()` through an explicit `::text` cast, which
 * forces the case-SENSITIVE text operator. The lesson generalises: on a citext
 * column, any constraint that cares about case must cast, and a pattern that
 * merely *looks* case-specific is not one.
 *
 * The one existing test row was removed by the check that found this; there is
 * no production data, so no backfill is required. A `lower()` normalisation is
 * applied first regardless, so this migration is correct against a database
 * that does hold rows.
 */

exports.shorthands = undefined;

exports.up = async (pgm) => {
  pgm.sql(`
    -- Normalise anything already stored, so the constraint below can be added
    -- to a non-empty table.
    UPDATE profiles SET username = lower(username::text)
     WHERE username::text <> lower(username::text);

    -- The ::text casts are load-bearing. Without them this comparison uses the
    -- citext operator, is case-insensitive, and is therefore always true.
    ALTER TABLE profiles ADD CONSTRAINT profiles_username_is_lowercase
      CHECK (username::text = lower(username::text));

    COMMENT ON CONSTRAINT profiles_username_is_lowercase ON profiles IS
      'BR-005 / SRS §12: usernames are stored lowercase. The ::text casts force a case-sensitive comparison - citext operators are case-insensitive, which is why profiles_username_format alone did not prevent uppercase.';
  `);
};

exports.down = async (pgm) => {
  pgm.sql(`ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_username_is_lowercase;`);
};
