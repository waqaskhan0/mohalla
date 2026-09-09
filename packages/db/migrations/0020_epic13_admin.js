/**
 * 0020 — EPIC-13 · bilingual announcements and the ban list's missing link.
 *
 * A small migration, because most of what the Admin Portal needs already
 * exists: `admins`, `admin_sessions`, `moderation_cases`, `enforcement_actions`,
 * `audit_log`, `banned_identifiers` and `profiles.verified_badge` were all
 * created by the epics that owned their data. What is left is two gaps that
 * only appear once an administrator can actually act.
 *
 * 1. ANNOUNCEMENTS MUST BE BILINGUAL. ADMIN-FR-009: "both language versions are
 *    required, BECAUSE A SINGLE-LANGUAGE ANNOUNCEMENT FAILS HALF THE AUDIENCE."
 *    EPIC-07 created the table with one `title` and one `body`, which was right
 *    for a table nobody could write to yet and wrong the moment somebody can.
 *    Its acceptance criterion is a refusal — "GIVEN an announcement submitted
 *    with only English text, WHEN publish is attempted, THEN it is refused
 *    until the Urdu version is supplied" — so both columns are NOT NULL and the
 *    refusal is structural rather than a validator somebody can skip.
 *
 * 2. THE BAN LIST NEEDS TO KNOW WHO WAS BANNED. BR-036: "a banned account's
 *    registered mobile number cannot be used to create a new account."
 *    `banned_identifiers` held the hash, the time and a reason but not the
 *    account — so a reinstatement (ADMIN-FR-008) had no way to find the row it
 *    needed to remove, and the number would have stayed blocked forever after
 *    an administrator reversed their own decision. ADMIN-FR-008 exists because
 *    "administrators make mistakes and the product must let them be corrected",
 *    and a correction that leaves the person unable to register is not one.
 *
 * WHAT THIS MIGRATION DELIBERATELY DOES NOT ADD: any column, table or
 * constraint by which an enforcement action could target an administrator.
 * BR-ADM-001 and SEC-021 are enforced by the ABSENCE of a foreign key from
 * `enforcement_actions` to `admins`, established in 0019 and left alone here.
 */

exports.shorthands = undefined;

exports.up = async (pgm) => {
  // ------------------------------------------------- bilingual announcements
  //
  // Existing rows are migrated by copying the single-language text into BOTH
  // columns. There are none in any environment that matters — the table has had
  // no writer since EPIC-07 created it — but a migration that would corrupt
  // data if a row existed is a migration nobody can safely re-run.
  pgm.sql(`
    ALTER TABLE announcements ADD COLUMN title_en text;
    ALTER TABLE announcements ADD COLUMN title_ur text;
    ALTER TABLE announcements ADD COLUMN body_en text;
    ALTER TABLE announcements ADD COLUMN body_ur text;

    UPDATE announcements
       SET title_en = title, title_ur = title,
           body_en = body,  body_ur = body;

    ALTER TABLE announcements ALTER COLUMN title_en SET NOT NULL;
    ALTER TABLE announcements ALTER COLUMN title_ur SET NOT NULL;
    ALTER TABLE announcements ALTER COLUMN body_en  SET NOT NULL;
    ALTER TABLE announcements ALTER COLUMN body_ur  SET NOT NULL;

    -- The single-language columns go. Leaving them would give a future writer
    -- somewhere to put an announcement that reaches half the audience, which
    -- is the exact failure ADMIN-FR-009 names.
    ALTER TABLE announcements DROP COLUMN title;
    ALTER TABLE announcements DROP COLUMN body;

    ALTER TABLE announcements DROP CONSTRAINT IF EXISTS announcements_title_length;
    ALTER TABLE announcements DROP CONSTRAINT IF EXISTS announcements_body_length;

    ALTER TABLE announcements ADD CONSTRAINT announcements_titles_length
      CHECK (
        char_length(title_en) BETWEEN 1 AND 200
        AND char_length(title_ur) BETWEEN 1 AND 200
      );
    ALTER TABLE announcements ADD CONSTRAINT announcements_bodies_length
      CHECK (
        char_length(body_en) BETWEEN 1 AND 2000
        AND char_length(body_ur) BETWEEN 1 AND 2000
      );

    -- Neither may be whitespace. A space is not a translation, and NOT NULL
    -- alone would accept one.
    ALTER TABLE announcements ADD CONSTRAINT announcements_not_blank
      CHECK (
        btrim(title_en) <> '' AND btrim(title_ur) <> ''
        AND btrim(body_en) <> '' AND btrim(body_ur) <> ''
      );

    COMMENT ON TABLE announcements IS
      'ADMIN-FR-009: BOTH language versions are required, because a single-language announcement fails half the audience. NOT NULL on all four columns makes the refusal structural rather than a validator somebody can skip.';
  `);

  // ------------------------------------------------ the ban list's back link
  pgm.sql(`
    -- Nullable, because a row may predate this column and because the hash is
    -- the operative value: registration checks the HASH, never the user id.
    -- This exists so a REINSTATEMENT can find the row to remove.
    ALTER TABLE banned_identifiers
      ADD COLUMN banned_user_id uuid REFERENCES users(id) ON DELETE SET NULL;

    CREATE INDEX banned_identifiers_by_user
      ON banned_identifiers (banned_user_id)
      WHERE banned_user_id IS NOT NULL;

    COMMENT ON COLUMN banned_identifiers.banned_user_id IS
      'BR-036 blocks the NUMBER; ADMIN-FR-008 must be able to unblock it. Without this link a reinstatement could not find the row, and an administrator correcting their own mistake would leave the person permanently unable to register.';
  `);

  // ------------------------------------- the audit log stays append-only
  //
  // BR-039: "no interface, permission or administrator can edit or delete an
  // entry." The grants were established at the foundation and the append-only
  // test asserts them every run. This migration touches nothing about them, and
  // says so out loud because EPIC-13 is the epic where somebody would be most
  // tempted to add an "admin can tidy the log" route.
  pgm.sql(`
    COMMENT ON TABLE audit_log IS
      'BR-039 / ADMIN-FR-012: APPEND-ONLY. runtime_app and runtime_worker hold SELECT and INSERT; UPDATE, DELETE and TRUNCATE are never granted to a runtime role. There is no admin route that mutates this table, and mandatory test D asserts there cannot be.';
  `);
};

exports.down = async (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS banned_identifiers_by_user;
    ALTER TABLE banned_identifiers DROP COLUMN IF EXISTS banned_user_id;

    ALTER TABLE announcements ADD COLUMN title text;
    ALTER TABLE announcements ADD COLUMN body text;
    UPDATE announcements SET title = title_en, body = body_en;
    ALTER TABLE announcements ALTER COLUMN title SET NOT NULL;
    ALTER TABLE announcements ALTER COLUMN body SET NOT NULL;

    ALTER TABLE announcements DROP CONSTRAINT IF EXISTS announcements_not_blank;
    ALTER TABLE announcements DROP CONSTRAINT IF EXISTS announcements_bodies_length;
    ALTER TABLE announcements DROP CONSTRAINT IF EXISTS announcements_titles_length;

    ALTER TABLE announcements DROP COLUMN title_en;
    ALTER TABLE announcements DROP COLUMN title_ur;
    ALTER TABLE announcements DROP COLUMN body_en;
    ALTER TABLE announcements DROP COLUMN body_ur;
  `);
};
