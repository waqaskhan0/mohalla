/**
 * 0008 — EPIC-04 · profiles, the category taxonomy, and interests.
 *
 * Faithful to `07-database-design.md` §2.2. Three tables:
 *
 *   profiles            1:1 with users; the PUBLIC projection lives here
 *   categories          eleven fixed rows, not user-extensible (BR-017)
 *   profile_interests   optional (PROFILE-FR-011, Could-have)
 *
 * TWO THINGS THIS SCHEMA ENFORCES THAT THE APPLICATION MUST NOT BE TRUSTED WITH.
 *
 * 1. USERNAME UNIQUENESS IS CASE-INSENSITIVE (BR-005, EDGE-008). `citext` with
 *    a UNIQUE index, so `Ayesha` and `ayesha` cannot both exist. Doing this by
 *    lowercasing in the application would leave the database able to hold both
 *    the moment one code path forgets — and EDGE-007 (two people confirming the
 *    same handle at once) is decided by this index, not by a prior SELECT.
 *
 * 2. THE USERNAME IS IMMUTABLE (BR-005). Enforced by a trigger, because "we
 *    never write that column" is a convention and this is a rule. Mentions
 *    resolve against the username (ENGAGE-FR-008), so a silent change would
 *    quietly re-point every historical mention at a different person.
 *
 * `visibility` is deliberately ABSENT as a column. BR-VIS-001 fixes it to
 * PUBLIC in V1; §137 of the design keeps it a profile-level *concept* so Phase 2
 * adds a column rather than touching every read path.
 *
 * `photo_media_id` has no foreign key yet — the `media` table arrives with its
 * own module. Added as a plain uuid now so the profile shape is complete, with
 * the constraint to follow (forward-only, ADR-008).
 */

exports.shorthands = undefined;

/**
 * The eleven categories from UI/UX §15.
 *
 * English names are taken verbatim from the approved palette table, so the
 * chip colours and these rows cannot drift apart.
 *
 * ⚠ URDU NAMES ARE PROVISIONAL. Category *content* is DEP-012 / OD-017 and has
 * not been confirmed by Shehersaaz. These are reasonable translations, not
 * approved copy, and are marked here rather than silently presented as final.
 * `slug` is what code refers to, so revising a name is a data change and never
 * a code change.
 */
const CATEGORIES = [
  ['environment-climate', 'Environment & Climate', 'ماحول اور موسمیاتی تبدیلی'],
  ['education', 'Education', 'تعلیم'],
  ['health', 'Health', 'صحت'],
  ['infrastructure-transport', 'Infrastructure & Transport', 'انفراسٹرکچر اور ٹرانسپورٹ'],
  ['water-sanitation', 'Water & Sanitation', 'پانی اور صفائی'],
  ['womens-rights', "Women's Rights", 'خواتین کے حقوق'],
  ['youth', 'Youth', 'نوجوان'],
  ['governance-accountability', 'Governance & Accountability', 'حکومتی نظم و جوابدہی'],
  ['disaster-emergency', 'Disaster & Emergency', 'آفات اور ہنگامی صورتحال'],
  ['community-events', 'Community Events', 'کمیونٹی تقریبات'],
  ['general', 'General', 'عمومی'],
];

exports.up = async (pgm) => {
  // ------------------------------------------------------------- extensions
  // `pg_trgm` is a FROZEN stack decision (ADR-011, 02-technology-stack.md §35):
  // Roman Urdu recall depends on trigram matching, and the whole reason no
  // search engine is deployed is that PostgreSQL covers it. The foundation
  // enabled only citext and pgcrypto, so this is installed by its first
  // consumer rather than left for the search epic to discover missing.
  //
  // IF NOT EXISTS because posts and events will index with it too, and a
  // migration that fails when the extension is already present is a migration
  // that breaks the second time anyone runs the suite.
  pgm.sql(`CREATE EXTENSION IF NOT EXISTS pg_trgm;`);

  // ------------------------------------------------------------- categories
  pgm.createTable('categories', {
    id: { type: 'uuid', primaryKey: true },
    slug: { type: 'text', notNull: true },
    name_en: { type: 'text', notNull: true },
    name_ur: { type: 'text', notNull: true },
    sort_order: { type: 'smallint', notNull: true },
  });
  pgm.addConstraint('categories', 'categories_slug_unique', { unique: ['slug'] });
  pgm.addConstraint('categories', 'categories_sort_order_unique', { unique: ['sort_order'] });

  pgm.sql(`
    COMMENT ON TABLE categories IS
      'BR-017: fixed taxonomy, not user-extensible. Urdu names are PROVISIONAL pending DEP-012/OD-017.';
    COMMENT ON COLUMN categories.slug IS
      'The stable identifier code refers to. Renaming a display name must never require a code change.';
  `);

  // `pgm.sql` takes a string, so the literals are escaped here. Doubling the
  // single quote matters: one of the eleven names is "Women's Rights", and an
  // unescaped apostrophe would end the string literal mid-name.
  const lit = (v) => `'${String(v).replace(/'/g, "''")}'`;
  for (const [i, [slug, en, ur]] of CATEGORIES.entries()) {
    pgm.sql(
      `INSERT INTO categories (id, slug, name_en, name_ur, sort_order)
       VALUES (uuidv7(), ${lit(slug)}, ${lit(en)}, ${lit(ur)}, ${i + 1})`,
    );
  }

  // --------------------------------------------------------------- profiles
  pgm.createTable('profiles', {
    // PK and FK together: a profile cannot exist without its user, and a user
    // cannot have two.
    user_id: {
      type: 'uuid',
      primaryKey: true,
      references: 'users',
      onDelete: 'CASCADE',
    },
    // citext: uniqueness is case-insensitive in the DATABASE (BR-005,
    // EDGE-008), not by application discipline.
    username: { type: 'citext', notNull: true },
    display_name: { type: 'text', notNull: true },
    // Free text, never derived from the device (PRIV-012).
    city: { type: 'text', notNull: false },
    bio: { type: 'text', notNull: false },
    // FK to `media` follows with that module's migration.
    photo_media_id: { type: 'uuid', notNull: false },

    // ADMIN-GRANTED ONLY (ADMIN-FR-010). Selecting an Organization account type
    // does not grant this, which is why it is a separate column from
    // `users.account_type`.
    verified_badge: { type: 'boolean', notNull: true, default: false },
    verified_by_admin_id: { type: 'uuid', notNull: false, references: 'admins' },
    verified_at: { type: 'timestamptz', notNull: false },

    // Denormalised counters (§5). Maintained by the social-graph and posts
    // modules; a count is read on every profile view and computing it from the
    // edge tables each time would make the cheapest screen the most expensive.
    follower_count: { type: 'integer', notNull: true, default: 0 },
    following_count: { type: 'integer', notNull: true, default: 0 },
    post_count: { type: 'integer', notNull: true, default: 0 },

    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.sql(`
    -- BR-005 / EDGE-007 / EDGE-008. The index is what decides a concurrent
    -- claim: two simultaneous confirmations both pass any prior SELECT, and
    -- exactly one survives the INSERT.
    ALTER TABLE profiles ADD CONSTRAINT profiles_username_unique UNIQUE (username);

    -- §12 shape, restated in the database. The application validates first and
    -- gives a helpful message; this catches the path that forgot to.
    ALTER TABLE profiles ADD CONSTRAINT profiles_username_format
      CHECK (username ~ '^[a-z][a-z0-9_]{2,19}$');

    ALTER TABLE profiles ADD CONSTRAINT profiles_display_name_length
      CHECK (char_length(display_name) BETWEEN 2 AND 50);
    ALTER TABLE profiles ADD CONSTRAINT profiles_display_name_not_blank
      CHECK (btrim(display_name) <> '');
    ALTER TABLE profiles ADD CONSTRAINT profiles_bio_length
      CHECK (bio IS NULL OR char_length(bio) <= 200);
    ALTER TABLE profiles ADD CONSTRAINT profiles_city_length
      CHECK (city IS NULL OR char_length(city) <= 60);

    -- Counters cannot go negative. A negative follower count means a
    -- double-decrement bug, and failing the write is how it gets found.
    ALTER TABLE profiles ADD CONSTRAINT profiles_counts_non_negative
      CHECK (follower_count >= 0 AND following_count >= 0 AND post_count >= 0);

    -- The badge and its audit trail travel together: a badge with no granting
    -- admin is unattributable, and an attribution with no badge is a leftover.
    ALTER TABLE profiles ADD CONSTRAINT profiles_badge_attributed
      CHECK (
        (verified_badge AND verified_by_admin_id IS NOT NULL AND verified_at IS NOT NULL)
        OR (NOT verified_badge AND verified_by_admin_id IS NULL AND verified_at IS NULL)
      );

    COMMENT ON COLUMN profiles.username IS
      'BR-005: unique case-insensitively (citext) and IMMUTABLE - enforced by trigger below.';
    COMMENT ON COLUMN profiles.display_name IS
      'BR-010: display names need NOT be unique. Two neighbours may share a name.';
    COMMENT ON COLUMN profiles.verified_badge IS
      'ADMIN-FR-010: granted by an administrator only. An ORGANIZATION account type does not imply it.';
  `);

  // --------------------------------------- BR-005: the username cannot change
  pgm.sql(`
    CREATE OR REPLACE FUNCTION profiles_username_is_immutable()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      IF NEW.username IS DISTINCT FROM OLD.username THEN
        RAISE EXCEPTION 'username is immutable (BR-005)'
          USING ERRCODE = 'restrict_violation';
      END IF;
      RETURN NEW;
    END
    $$;

    -- A trigger rather than a convention, because mentions resolve against the
    -- username (ENGAGE-FR-008): changing one silently re-points every
    -- historical mention at a different person. Defence in depth alongside the
    -- application never writing the column on edit.
    CREATE TRIGGER profiles_username_immutable
      BEFORE UPDATE ON profiles
      FOR EACH ROW
      EXECUTE FUNCTION profiles_username_is_immutable();
  `);

  // ------------------------------------------------------- search (ADR-011)
  pgm.sql(`
    -- Generated, so it can never disagree with the columns it summarises.
    -- 'simple' rather than 'english': the corpus is Urdu and Roman Urdu, and
    -- English stemming would mangle both. SEARCH-FR-003's fuzzy matching is
    -- served by the trigram index instead.
    ALTER TABLE profiles ADD COLUMN search_norm tsvector
      GENERATED ALWAYS AS (
        to_tsvector('simple', coalesce(display_name, '') || ' ' || coalesce(username::text, ''))
      ) STORED;

    CREATE INDEX profiles_search_fts ON profiles USING GIN (search_norm);
    CREATE INDEX profiles_search_trgm
      ON profiles USING GIN ((display_name || ' ' || username::text) gin_trgm_ops);
  `);

  // -------------------------------------------------------- profile_interests
  pgm.createTable('profile_interests', {
    user_id: { type: 'uuid', notNull: true, references: 'profiles', onDelete: 'CASCADE' },
    category_id: { type: 'uuid', notNull: true, references: 'categories', onDelete: 'CASCADE' },
  });
  pgm.addConstraint('profile_interests', 'profile_interests_pkey', {
    primaryKey: ['user_id', 'category_id'],
  });
  pgm.sql(`
    COMMENT ON TABLE profile_interests IS
      'PROFILE-FR-011 (Could). Optional: skipping it must degrade no other function.';
  `);

  // ------------------------------------------------------------- privileges
  pgm.sql(`
    -- Categories are reference data seeded by migration. The runtime reads
    -- them and must never write them (BR-017: not user-extensible), so the
    -- application cannot add a twelfth category even by accident.
    REVOKE ALL ON categories FROM runtime_app, runtime_worker;
    GRANT SELECT ON categories TO runtime_app, runtime_worker;
  `);
};

exports.down = async (pgm) => {
  pgm.sql(`
    DROP TRIGGER IF EXISTS profiles_username_immutable ON profiles;
    DROP FUNCTION IF EXISTS profiles_username_is_immutable();
  `);
  pgm.dropTable('profile_interests');
  pgm.dropTable('profiles');
  pgm.dropTable('categories');
};
