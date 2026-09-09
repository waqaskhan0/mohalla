/**
 * 0011 — EPIC-06 · media, posts, attachments and link previews.
 *
 * `07-database-design.md` §2.4 and ADR-013.
 *
 * THREE RULES THIS SCHEMA CARRIES THAT CODE MUST NOT BE TRUSTED WITH.
 *
 * 1. A POST CANNOT EXPOSE MEDIA BEFORE IT IS `READY` (ADR-013 step 7,
 *    "enforced by a trigger on `post_media`, not by controller logic"). That
 *    trigger is what closes the race where a post references a file that
 *    subsequently fails inspection. A foreign key alone cannot express it,
 *    because the media row exists throughout — it is the STATE that matters.
 *
 * 2. AT MOST FOUR IMAGES, IN A STABLE ORDER (BR-013). `position` is
 *    CHECK-bounded to 0–3 and UNIQUE per post, so "five images" and "two
 *    images both in slot 2" are unrepresentable rather than merely rejected.
 *
 * 3. ZERO OR ONE CATEGORY (BR-017). A nullable single column, not a join
 *    table: a join table would make "two categories" expressible and then need
 *    a constraint to forbid it.
 *
 * FOUR VISIBILITY STATES, NOT A BOOLEAN, because each behaves differently
 * (§185). `AUTO_HIDDEN` is visible to the author only, marked under review
 * (PROFILE-FR-004). `ADMIN_REMOVED` is visible to nobody but retained for the
 * audit trail. `AUTHOR_DELETED` cannot be restored by an administrator
 * (BR-014). ADMIN-FR-003 depends on telling those apart.
 *
 * BODY LENGTH IS NOT FULLY ENFORCED HERE, on purpose. BR-012 is 3,000 GRAPHEME
 * CLUSTERS, and SQL has no grapheme count — `char_length` counts code points.
 * The application enforces the real limit; the CHECK below is a generous byte
 * ceiling so a path that skipped validation cannot store something absurd.
 * The two deliberately disagree, and in the safe direction: every string the
 * application accepts fits inside the database bound.
 */

exports.shorthands = undefined;

exports.up = async (pgm) => {
  // ------------------------------------------------------------------ media
  pgm.sql(`
    CREATE TYPE media_kind AS ENUM ('IMAGE', 'DOCUMENT');
    CREATE TYPE media_state AS ENUM ('PENDING_UPLOAD', 'PROCESSING', 'READY', 'REJECTED');
  `);

  pgm.createTable('media', {
    id: { type: 'uuid', primaryKey: true },
    owner_id: { type: 'uuid', notNull: true, references: 'users', onDelete: 'CASCADE' },
    kind: { type: 'media_kind', notNull: true },
    state: { type: 'media_state', notNull: true, default: 'PENDING_UPLOAD' },

    // Random, unrelated to the original filename (SEC-015). The ORIGINAL
    // FILENAME IS NOT STORED AT ALL - it can carry a person's name, a case
    // number or a diagnosis, and there is no feature that needs it.
    quarantine_key: { type: 'text', notNull: true },
    storage_key: { type: 'text', notNull: false },

    // Determined by CONTENT INSPECTION, never from the client's claim
    // (SEC-013). Null until inspection has run.
    mime_verified: { type: 'text', notNull: false },

    // Re-measured from the stored object, not taken from the slot request
    // (SEC-012, MEDIA-FR-005).
    byte_size: { type: 'integer', notNull: false },
    width: { type: 'integer', notNull: false },
    height: { type: 'integer', notNull: false },

    /** Why a REJECTED row was rejected. Shown to the uploader (EDGE-013). */
    rejection_reason: { type: 'text', notNull: false },

    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    ready_at: { type: 'timestamptz', notNull: false },
  });

  pgm.sql(`
    ALTER TABLE media ADD CONSTRAINT media_quarantine_key_unique UNIQUE (quarantine_key);
    ALTER TABLE media ADD CONSTRAINT media_storage_key_unique UNIQUE (storage_key);

    -- A READY row must have everything a served object needs. Without this, a
    -- half-promoted row is servable and nothing notices.
    ALTER TABLE media ADD CONSTRAINT media_ready_is_complete
      CHECK (
        state <> 'READY'
        OR (storage_key IS NOT NULL AND mime_verified IS NOT NULL
            AND byte_size IS NOT NULL AND ready_at IS NOT NULL)
      );

    -- Conversely, a rejected row must say why, and must NOT have a served key.
    ALTER TABLE media ADD CONSTRAINT media_rejected_has_reason
      CHECK (state <> 'REJECTED' OR rejection_reason IS NOT NULL);
    ALTER TABLE media ADD CONSTRAINT media_rejected_is_not_served
      CHECK (state <> 'REJECTED' OR storage_key IS NULL);

    ALTER TABLE media ADD CONSTRAINT media_size_positive
      CHECK (byte_size IS NULL OR byte_size > 0);

    -- The 24-hour orphan sweep (ADR-013). Partial, because a healthy system is
    -- almost all READY rows and indexing those would be wasted work.
    CREATE INDEX media_sweepable
      ON media (created_at)
      WHERE state IN ('PENDING_UPLOAD', 'PROCESSING', 'REJECTED');

    CREATE INDEX media_by_owner ON media (owner_id, created_at DESC);

    COMMENT ON COLUMN media.storage_key IS
      'SEC-015: random, generated at promotion, unrelated to the quarantine key or the original filename.';
    COMMENT ON COLUMN media.mime_verified IS
      'SEC-013: type determined by inspecting bytes. The client-declared type is never stored.';
    COMMENT ON TABLE media IS
      'ADR-013 quarantine lifecycle. The original filename is deliberately DISCARDED, not stored.';
  `);

  // ------------------------------------------------------------------ posts
  pgm.sql(`
    CREATE TYPE post_visibility_state AS ENUM (
      'VISIBLE', 'AUTO_HIDDEN', 'ADMIN_REMOVED', 'AUTHOR_DELETED'
    );
  `);

  pgm.createTable('posts', {
    id: { type: 'uuid', primaryKey: true },
    author_id: { type: 'uuid', notNull: true, references: 'users', onDelete: 'CASCADE' },
    body: { type: 'text', notNull: true },
    // BR-017: zero or one. A nullable column rather than a join table, so
    // "two categories" is unrepresentable.
    category_id: { type: 'uuid', notNull: false, references: 'categories', onDelete: 'SET NULL' },
    visibility_state: { type: 'post_visibility_state', notNull: true, default: 'VISIBLE' },

    // Denormalised (§5). Maintained by triggers in the engagement epic.
    like_count: { type: 'integer', notNull: true, default: 0 },
    comment_count: { type: 'integer', notNull: true, default: 0 },
    // Maintained transactionally with the threshold evaluation (§6.3).
    distinct_report_count: { type: 'integer', notNull: true, default: 0 },

    /** Non-null once edited — POST-FR-008 marks the post "edited". */
    edited_at: { type: 'timestamptz', notNull: false },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.sql(`
    -- A byte ceiling, NOT the real limit. BR-012 is 3,000 grapheme clusters,
    -- which SQL cannot count; the application enforces that. 4 bytes per
    -- grapheme is a generous upper bound for UTF-8, so anything the
    -- application accepts fits here and anything absurd does not.
    ALTER TABLE posts ADD CONSTRAINT posts_body_byte_ceiling
      CHECK (octet_length(body) <= 12000);

    -- A post must say something or show something. Enforced in the application
    -- too, because "has an attachment" is not knowable from this row alone -
    -- the attachment rows are inserted after the post.
    ALTER TABLE posts ADD CONSTRAINT posts_body_not_whitespace_only
      CHECK (body = '' OR btrim(body) <> '');

    ALTER TABLE posts ADD CONSTRAINT posts_counts_non_negative
      CHECK (like_count >= 0 AND comment_count >= 0 AND distinct_report_count >= 0);

    -- The feed and the profile post list both want "visible posts, newest
    -- first". Partial, because hidden and deleted posts are never returned by
    -- either, so indexing them wastes space and slows every write (§373).
    CREATE INDEX posts_visible_by_created
      ON posts (created_at DESC, id DESC)
      WHERE visibility_state = 'VISIBLE';

    -- PROFILE-FR-008: a profile's own posts. Includes AUTO_HIDDEN, because the
    -- author sees their own hidden posts marked under review (BR-032).
    CREATE INDEX posts_by_author
      ON posts (author_id, created_at DESC)
      WHERE visibility_state IN ('VISIBLE', 'AUTO_HIDDEN');

    -- FEED-FR-006: filtering by category.
    CREATE INDEX posts_by_category
      ON posts (category_id, created_at DESC)
      WHERE visibility_state = 'VISIBLE' AND category_id IS NOT NULL;

    COMMENT ON COLUMN posts.visibility_state IS
      'Four states, not a boolean: AUTO_HIDDEN is author-visible under review; ADMIN_REMOVED is retained for audit; AUTHOR_DELETED cannot be restored by an admin (BR-014). ADMIN-FR-003 depends on the distinction.';
  `);

  // ------------------------------------------------------------- attachments
  pgm.createTable('post_media', {
    post_id: { type: 'uuid', notNull: true, references: 'posts', onDelete: 'CASCADE' },
    media_id: { type: 'uuid', notNull: true, references: 'media', onDelete: 'CASCADE' },
    position: { type: 'smallint', notNull: true },
  });
  pgm.addConstraint('post_media', 'post_media_pkey', { primaryKey: ['post_id', 'media_id'] });

  pgm.sql(`
    -- BR-013: at most four, in a stable order. Both halves are structural, so
    -- neither "five images" nor "two images in slot 2" can be stored.
    ALTER TABLE post_media ADD CONSTRAINT post_media_position_range
      CHECK (position BETWEEN 0 AND 3);
    ALTER TABLE post_media ADD CONSTRAINT post_media_position_unique
      UNIQUE (post_id, position);

    CREATE INDEX post_media_by_media ON post_media (media_id);
  `);

  // -- ADR-013 step 7: the trigger that closes the race --------------------
  pgm.sql(`
    CREATE OR REPLACE FUNCTION post_media_requires_ready()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    DECLARE
      m RECORD;
    BEGIN
      SELECT state, owner_id INTO m FROM media WHERE id = NEW.media_id;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'media % does not exist', NEW.media_id
          USING ERRCODE = 'foreign_key_violation';
      END IF;

      IF m.state <> 'READY' THEN
        RAISE EXCEPTION 'media % is %, not READY (ADR-013 step 7)', NEW.media_id, m.state
          USING ERRCODE = 'restrict_violation';
      END IF;

      -- Also refuse to attach someone ELSE'S media. Without this, a caller who
      -- learns a media id could staple another person's photo to their own
      -- post - and the id is not secret, it is returned to its uploader.
      IF m.owner_id <> (SELECT author_id FROM posts WHERE id = NEW.post_id) THEN
        RAISE EXCEPTION 'media % does not belong to the post author', NEW.media_id
          USING ERRCODE = 'insufficient_privilege';
      END IF;

      RETURN NEW;
    END
    $$;

    -- Why a trigger and not a controller check: ADR-013 step 7 exists to close
    -- a RACE. Media can pass inspection, be referenced, and the state can
    -- change; a check in the request handler is separated from the insert by
    -- time, and this is not. It also covers every future writer of this table.
    CREATE TRIGGER post_media_ready_only
      BEFORE INSERT OR UPDATE ON post_media
      FOR EACH ROW
      EXECUTE FUNCTION post_media_requires_ready();
  `);

  // ----------------------------------------------------------- link previews
  pgm.createTable('link_previews', {
    post_id: { type: 'uuid', primaryKey: true, references: 'posts', onDelete: 'CASCADE' },
    url: { type: 'text', notNull: true },
    title: { type: 'text', notNull: false },
    description: { type: 'text', notNull: false },
    /** A media row, so a remote thumbnail is fetched server-side and inspected. */
    thumbnail_media_id: { type: 'uuid', notNull: false, references: 'media', onDelete: 'SET NULL' },
    fetched_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.sql(`
    ALTER TABLE link_previews ADD CONSTRAINT link_previews_url_length
      CHECK (char_length(url) <= 2048);

    COMMENT ON TABLE link_previews IS
      'POST-FR-004: one per post, fetched SERVER-SIDE so the user address is never disclosed to the linked host (SEC-014).';
  `);

  // ------------------------------------------------------------ search norm
  pgm.sql(`
    -- ADR-011. 'simple' rather than 'english': the corpus is Urdu and Roman
    -- Urdu, and English stemming would mangle both. Fuzzy/Roman-Urdu recall is
    -- served by the trigram index (SEARCH-FR-003).
    ALTER TABLE posts ADD COLUMN search_norm tsvector
      GENERATED ALWAYS AS (to_tsvector('simple', coalesce(body, ''))) STORED;

    CREATE INDEX posts_search_fts ON posts USING GIN (search_norm)
      WHERE visibility_state = 'VISIBLE';
    CREATE INDEX posts_search_trgm ON posts USING GIN (body gin_trgm_ops)
      WHERE visibility_state = 'VISIBLE';
  `);
};

exports.down = async (pgm) => {
  pgm.sql(`
    DROP TRIGGER IF EXISTS post_media_ready_only ON post_media;
    DROP FUNCTION IF EXISTS post_media_requires_ready();
  `);
  pgm.dropTable('link_previews');
  pgm.dropTable('post_media');
  pgm.dropTable('posts');
  pgm.dropTable('media');
  pgm.sql(`
    DROP TYPE IF EXISTS post_visibility_state;
    DROP TYPE IF EXISTS media_state;
    DROP TYPE IF EXISTS media_kind;
  `);
};
