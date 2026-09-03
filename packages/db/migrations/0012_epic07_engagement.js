/**
 * 0012 — EPIC-07 · likes, comments, saved posts, and announcements.
 *
 * `07-database-design.md` §2.4 and §4.11.
 *
 * THE COMPOSITE PRIMARY KEYS DO THE WORK, again.
 *
 * `likes (user_id, post_id)` is what makes BR-031 — one like per user per post
 * — true rather than merely intended, and it is what ENGAGE-FR-001's acceptance
 * criterion depends on: "GIVEN a user taps like 6 times rapidly, WHEN the
 * requests settle, THEN the like count has changed by at most one." Six
 * concurrent inserts against one key produce one row. No amount of application
 * care could match that under real concurrency.
 *
 * COMMENTS NEST EXACTLY ONE LEVEL (BR-033), enforced by a trigger rather than
 * by convention. ENGAGE-FR-003 is explicit that a reply to a reply attaches to
 * the SAME parent thread, and the requirement notes why the rule exists at all:
 * "This is the requirement that solves WhatsApp's lack of threading." Unbounded
 * nesting would recreate the problem the product exists to fix.
 *
 * COUNTS ARE MAINTAINED BY TRIGGER, for the same reason follower counts are:
 * every path that can add or remove a like or comment must move the count in
 * the same transaction, including the cascades from deleting a post, deleting a
 * parent comment, or erasing an account. A trigger covers the paths nobody has
 * written yet.
 */

exports.shorthands = undefined;

exports.up = async (pgm) => {
  // ------------------------------------------------------------------ likes
  pgm.createTable('likes', {
    user_id: { type: 'uuid', notNull: true, references: 'users', onDelete: 'CASCADE' },
    post_id: { type: 'uuid', notNull: true, references: 'posts', onDelete: 'CASCADE' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('likes', 'likes_pkey', { primaryKey: ['user_id', 'post_id'] });

  pgm.sql(`
    -- "Who liked this post", for the per-viewer count adjustment
    -- (ENGAGE-FR-006). The PK serves the other direction.
    CREATE INDEX likes_by_post ON likes (post_id);

    COMMENT ON TABLE likes IS
      'BR-031: one like per user per post, enforced by the composite PRIMARY KEY. Six rapid taps produce one row (ENGAGE-FR-001 AC).';
  `);

  // --------------------------------------------------------------- comments
  pgm.sql(`
    CREATE TYPE comment_visibility_state AS ENUM ('VISIBLE', 'AUTO_HIDDEN', 'DELETED');
  `);

  pgm.createTable('comments', {
    id: { type: 'uuid', primaryKey: true },
    post_id: { type: 'uuid', notNull: true, references: 'posts', onDelete: 'CASCADE' },
    author_id: { type: 'uuid', notNull: true, references: 'users', onDelete: 'CASCADE' },
    // ENGAGE-FR-004: "it and its replies are removed" - the cascade is the
    // mechanism, so deleting a parent cannot leave orphaned replies.
    parent_comment_id: {
      type: 'uuid',
      notNull: false,
      references: 'comments',
      onDelete: 'CASCADE',
    },
    body: { type: 'text', notNull: true },
    visibility_state: { type: 'comment_visibility_state', notNull: true, default: 'VISIBLE' },
    distinct_report_count: { type: 'integer', notNull: true, default: 0 },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.sql(`
    -- §12: 1-1,000 characters, "not whitespace-only". As with posts, the real
    -- limit is in GRAPHEME CLUSTERS and lives in the application; this is a
    -- generous byte ceiling that anything valid fits inside.
    ALTER TABLE comments ADD CONSTRAINT comments_body_byte_ceiling
      CHECK (octet_length(body) <= 4000);
    ALTER TABLE comments ADD CONSTRAINT comments_body_not_blank
      CHECK (btrim(body) <> '');

    ALTER TABLE comments ADD CONSTRAINT comments_not_own_parent
      CHECK (parent_comment_id IS NULL OR parent_comment_id <> id);

    -- ENGAGE-FR-002: comments appear "oldest-first beneath the post". Partial,
    -- because deleted comments are never rendered.
    CREATE INDEX comments_by_post
      ON comments (post_id, created_at)
      WHERE visibility_state <> 'DELETED';

    -- Replies to a parent, oldest first (ENGAGE-FR-003).
    CREATE INDEX comments_by_parent
      ON comments (parent_comment_id, created_at)
      WHERE parent_comment_id IS NOT NULL AND visibility_state <> 'DELETED';

    COMMENT ON COLUMN comments.parent_comment_id IS
      'BR-033: exactly one level of nesting, enforced by trigger. A reply to a reply attaches to the SAME parent thread.';
  `);

  // -- BR-033: one level of nesting ---------------------------------------
  pgm.sql(`
    CREATE OR REPLACE FUNCTION comments_enforce_one_level()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    DECLARE
      parent RECORD;
    BEGIN
      IF NEW.parent_comment_id IS NULL THEN
        RETURN NEW;
      END IF;

      SELECT post_id, parent_comment_id INTO parent
        FROM comments WHERE id = NEW.parent_comment_id;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'parent comment % does not exist', NEW.parent_comment_id
          USING ERRCODE = 'foreign_key_violation';
      END IF;

      -- A reply must attach to a TOP-LEVEL comment. The application resolves a
      -- reply-to-a-reply up to its thread parent before inserting; this is what
      -- guarantees no path can produce a third level.
      IF parent.parent_comment_id IS NOT NULL THEN
        RAISE EXCEPTION 'comments nest one level only (BR-033)'
          USING ERRCODE = 'restrict_violation';
      END IF;

      -- A reply must belong to the same post as its parent. Without this, a
      -- reply could be filed under a different post and appear in a thread it
      -- has nothing to do with.
      IF parent.post_id <> NEW.post_id THEN
        RAISE EXCEPTION 'reply and parent belong to different posts'
          USING ERRCODE = 'restrict_violation';
      END IF;

      RETURN NEW;
    END
    $$;

    CREATE TRIGGER comments_one_level
      BEFORE INSERT OR UPDATE ON comments
      FOR EACH ROW
      EXECUTE FUNCTION comments_enforce_one_level();
  `);

  // ------------------------------------------------- denormalised counters
  pgm.sql(`
    CREATE OR REPLACE FUNCTION likes_maintain_count()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      IF TG_OP = 'INSERT' THEN
        UPDATE posts SET like_count = like_count + 1 WHERE id = NEW.post_id;
      ELSIF TG_OP = 'DELETE' THEN
        UPDATE posts SET like_count = GREATEST(like_count - 1, 0) WHERE id = OLD.post_id;
      END IF;
      RETURN NULL;
    END
    $$;

    CREATE TRIGGER likes_count
      AFTER INSERT OR DELETE ON likes
      FOR EACH ROW
      EXECUTE FUNCTION likes_maintain_count();

    CREATE OR REPLACE FUNCTION comments_maintain_count()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      -- Counts VISIBLE comments only, and follows the state rather than the
      -- row: a soft-deleted comment must leave the count immediately, and a
      -- moderation hide must too.
      IF TG_OP = 'INSERT' AND NEW.visibility_state = 'VISIBLE' THEN
        UPDATE posts SET comment_count = comment_count + 1 WHERE id = NEW.post_id;
      ELSIF TG_OP = 'DELETE' AND OLD.visibility_state = 'VISIBLE' THEN
        UPDATE posts SET comment_count = GREATEST(comment_count - 1, 0) WHERE id = OLD.post_id;
      ELSIF TG_OP = 'UPDATE' THEN
        IF OLD.visibility_state = 'VISIBLE' AND NEW.visibility_state <> 'VISIBLE' THEN
          UPDATE posts SET comment_count = GREATEST(comment_count - 1, 0) WHERE id = NEW.post_id;
        ELSIF OLD.visibility_state <> 'VISIBLE' AND NEW.visibility_state = 'VISIBLE' THEN
          UPDATE posts SET comment_count = comment_count + 1 WHERE id = NEW.post_id;
        END IF;
      END IF;
      RETURN NULL;
    END
    $$;

    CREATE TRIGGER comments_count
      AFTER INSERT OR UPDATE OR DELETE ON comments
      FOR EACH ROW
      EXECUTE FUNCTION comments_maintain_count();
  `);

  // ----------------------------------------------- saved posts (Could-have)
  pgm.createTable('saved_posts', {
    user_id: { type: 'uuid', notNull: true, references: 'users', onDelete: 'CASCADE' },
    post_id: { type: 'uuid', notNull: true, references: 'posts', onDelete: 'CASCADE' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('saved_posts', 'saved_posts_pkey', { primaryKey: ['user_id', 'post_id'] });

  pgm.sql(`
    -- "Newest-saved-first", per user (FEED-FR-007).
    CREATE INDEX saved_posts_by_user ON saved_posts (user_id, created_at DESC);

    COMMENT ON TABLE saved_posts IS
      'FEED-FR-007: PRIVATE to the saving user and generates no notification to the author. A deleted post disappears from saved lists by the FK cascade on visibility, applied in the read query.';
  `);

  // ------------------------------------------------------- announcements
  // Owned by `admin-ops` (§331), which writes them. Created here because the
  // FEED reads them and EPIC-07 is where that read is built - a table nobody
  // can read yet would be a table nobody could test.
  pgm.createTable('announcements', {
    id: { type: 'uuid', primaryKey: true },
    created_by_admin_id: { type: 'uuid', notNull: true, references: 'admins' },
    title: { type: 'text', notNull: true },
    body: { type: 'text', notNull: true },
    /** FEED-FR-002: "each with an expiry date set by the administrator". */
    expires_at: { type: 'timestamptz', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.sql(`
    ALTER TABLE announcements ADD CONSTRAINT announcements_title_length
      CHECK (char_length(title) BETWEEN 1 AND 200);
    ALTER TABLE announcements ADD CONSTRAINT announcements_body_length
      CHECK (char_length(body) BETWEEN 1 AND 2000);
    ALTER TABLE announcements ADD CONSTRAINT announcements_expiry_after_creation
      CHECK (expires_at > created_at);

    -- "Up to 5 announcements, newest first", expired ones dropping out
    -- automatically (FEED-FR-002). The read is on every feed load, so it gets
    -- its own index rather than scanning.
    CREATE INDEX announcements_active ON announcements (expires_at, created_at DESC);

    -- Read by the runtime, written only by admin-ops through the same runtime
    -- role - so no extra grant is needed, but the ownership is recorded.
    COMMENT ON TABLE announcements IS
      'FEED-FR-002 / ADMIN-FR-009. Owned by admin-ops; read by the feed. BR-029: only administrators publish here. This section is the cold-start guarantee (RSK-001).';
  `);
};

exports.down = async (pgm) => {
  pgm.sql(`
    DROP TRIGGER IF EXISTS comments_count ON comments;
    DROP FUNCTION IF EXISTS comments_maintain_count();
    DROP TRIGGER IF EXISTS likes_count ON likes;
    DROP FUNCTION IF EXISTS likes_maintain_count();
    DROP TRIGGER IF EXISTS comments_one_level ON comments;
    DROP FUNCTION IF EXISTS comments_enforce_one_level();
  `);
  pgm.dropTable('announcements');
  pgm.dropTable('saved_posts');
  pgm.dropTable('comments');
  pgm.dropTable('likes');
  pgm.sql(`DROP TYPE IF EXISTS comment_visibility_state;`);
};
