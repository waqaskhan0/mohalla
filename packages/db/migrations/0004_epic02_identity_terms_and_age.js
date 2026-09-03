/**
 * 0004 — EPIC-02 · terms acceptance and the minimum-age rule.
 *
 * Corrects an omission in 0003. That migration was built from the mermaid ERD
 * (`diagrams/database-erd.mmd`), which does not list every column; the
 * AUTHORITATIVE table catalogue in `07-database-design.md` §2.1 also specifies:
 *
 *   terms_version      text        AUTH-FR-009 — accepted version recorded
 *   terms_accepted_at  timestamptz BR-004
 *
 * Forward-only (ADR-008): 0003 is already applied, so the fix is a new
 * migration rather than an edit to a migration that has run.
 *
 * Also adds BR-002 (minimum age 13), which `09-authentication-authorization.md`
 * §43 requires as a CHECK on `users.date_of_birth` evaluated against the SERVER
 * CLOCK. PostgreSQL 18 accepts `CURRENT_DATE` here and enforces it on write —
 * verified before relying on it, including the exact boundary: a date exactly
 * 13 years ago is accepted and one day later is rejected.
 *
 * The rule is one-directional, which is what makes it safe as a CHECK: an
 * accepted row only becomes *more* valid as time passes, so no stored row can
 * later violate it.
 */

exports.shorthands = undefined;

exports.up = async (pgm) => {
  // ------------------------------------------------- terms acceptance
  // Nullable first so the columns can be added to a table that may already hold
  // rows, then backfilled and tightened. On a fresh database this is a no-op,
  // but the migration must also be correct against an existing development
  // database (§27 requires both paths to work).
  pgm.addColumns('users', {
    terms_version: { type: 'text', notNull: false },
    terms_accepted_at: { type: 'timestamptz', notNull: false },
  });

  pgm.sql(`
    -- Any pre-existing row predates the requirement; mark it explicitly rather
    -- than inventing a version it never agreed to.
    UPDATE users
       SET terms_version = 'PRE-AUTH-FR-009',
           terms_accepted_at = created_at
     WHERE terms_version IS NULL;
  `);

  pgm.alterColumn('users', 'terms_version', { notNull: true });
  pgm.alterColumn('users', 'terms_accepted_at', { notNull: true });

  pgm.sql(`
    COMMENT ON COLUMN users.terms_version IS
      'AUTH-FR-009: the exact document version the user affirmatively accepted.';
    COMMENT ON COLUMN users.terms_accepted_at IS
      'BR-004 / PRIV-014: when acceptance was recorded. Evidence of consent.';
  `);

  // ------------------------------------------------------ BR-002 minimum age
  pgm.sql(`
    ALTER TABLE users ADD CONSTRAINT users_min_age_13
      CHECK (date_of_birth <= (CURRENT_DATE - INTERVAL '13 years'));

    -- Reject impossible dates outright. Without this, a typo like year 0203 or
    -- a future date passes the age rule (a future date is trivially "over 13"
    -- backwards) and corrupts every age-derived calculation later.
    ALTER TABLE users ADD CONSTRAINT users_dob_plausible
      CHECK (date_of_birth > DATE '1900-01-01' AND date_of_birth <= CURRENT_DATE);

    COMMENT ON CONSTRAINT users_min_age_13 ON users IS
      'BR-002: minimum age 13, evaluated against the server clock, never a client-supplied date.';
  `);
};

exports.down = async (pgm) => {
  pgm.sql(`
    ALTER TABLE users DROP CONSTRAINT IF EXISTS users_dob_plausible;
    ALTER TABLE users DROP CONSTRAINT IF EXISTS users_min_age_13;
  `);
  pgm.dropColumns('users', ['terms_version', 'terms_accepted_at']);
};
