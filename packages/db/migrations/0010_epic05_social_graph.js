/**
 * 0010 — EPIC-05 · follows and blocks.
 *
 * `07-database-design.md` §2.3. Two tables, each with a composite primary key
 * that carries a business rule rather than merely identifying a row.
 *
 * `follows (follower_id, followee_id)` — the PK is what "makes EDGE-015
 * impossible by construction". A repeated follow is an upsert onto the same
 * key, not a second row, so the idempotency required by SOCIAL-FR-001 is a
 * property of the schema and not of every code path that ever follows someone.
 *
 * `blocks (blocker_id, blocked_id)` — UNILATERAL IN THE ROW, MUTUAL IN EFFECT.
 * One row records who blocked whom; every read path tests BOTH directions. That
 * asymmetry is deliberate and is the whole design: storing two rows would make
 * "unblock" ambiguous (whose block is being lifted?) and would lose the fact of
 * who chose to block, which moderation needs. Storing one row and reading it
 * symmetrically keeps both.
 *
 * Hence TWO indexes, `(blocker_id, blocked_id)` and `(blocked_id, blocker_id)`.
 * The PK serves the first; without the second, "who has blocked me?" is a
 * sequential scan, and that question is asked on every read path in the product.
 *
 * COUNTS ARE MAINTAINED BY TRIGGER, not by the application. See the trigger
 * comment for why.
 */

exports.shorthands = undefined;

exports.up = async (pgm) => {
  // ---------------------------------------------------------------- follows
  pgm.createTable('follows', {
    follower_id: { type: 'uuid', notNull: true, references: 'users', onDelete: 'CASCADE' },
    followee_id: { type: 'uuid', notNull: true, references: 'users', onDelete: 'CASCADE' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('follows', 'follows_pkey', {
    primaryKey: ['follower_id', 'followee_id'],
  });

  pgm.sql(`
    -- BR-019. A self-follow is not an error to report to the user so much as a
    -- state that must not exist: it would inflate both counts and put a
    -- person's own posts in their feed twice.
    ALTER TABLE follows ADD CONSTRAINT follows_no_self_follow
      CHECK (follower_id <> followee_id);

    -- "Who follows this person", newest first, for the paginated list
    -- (SOCIAL-FR-003). The PK already serves the other direction.
    CREATE INDEX follows_by_followee ON follows (followee_id, created_at DESC);

    COMMENT ON TABLE follows IS
      'SOCIAL-FR-001/002. The composite PK makes a duplicate follow impossible by construction (EDGE-015).';
  `);

  // ----------------------------------------------------------------- blocks
  pgm.createTable('blocks', {
    blocker_id: { type: 'uuid', notNull: true, references: 'users', onDelete: 'CASCADE' },
    blocked_id: { type: 'uuid', notNull: true, references: 'users', onDelete: 'CASCADE' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('blocks', 'blocks_pkey', {
    primaryKey: ['blocker_id', 'blocked_id'],
  });

  pgm.sql(`
    ALTER TABLE blocks ADD CONSTRAINT blocks_no_self_block
      CHECK (blocker_id <> blocked_id);

    -- The REVERSE lookup. Every read path in the product asks "is there a block
    -- either way", and without this index the "has anyone blocked me" half is a
    -- sequential scan on the busiest predicate in the system.
    CREATE INDEX blocks_by_blocked ON blocks (blocked_id, blocker_id);

    COMMENT ON TABLE blocks IS
      'BR-025 / SEC-019: unilateral in the row, MUTUAL in effect. Every read path tests both directions, and a block is never disclosed to the blocked user.';
  `);

  // ------------------------------------------------- denormalised counters
  pgm.sql(`
    CREATE OR REPLACE FUNCTION follows_maintain_counts()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      IF TG_OP = 'INSERT' THEN
        UPDATE profiles SET following_count = following_count + 1
          WHERE user_id = NEW.follower_id;
        UPDATE profiles SET follower_count = follower_count + 1
          WHERE user_id = NEW.followee_id;
      ELSIF TG_OP = 'DELETE' THEN
        UPDATE profiles SET following_count = GREATEST(following_count - 1, 0)
          WHERE user_id = OLD.follower_id;
        UPDATE profiles SET follower_count = GREATEST(follower_count - 1, 0)
          WHERE user_id = OLD.followee_id;
      END IF;
      RETURN NULL;
    END
    $$;

    -- WHY A TRIGGER RATHER THAN APPLICATION CODE.
    --
    -- The counts are denormalised for a good reason (they are read on every
    -- profile view), which means they can drift. Drift here is not cosmetic:
    -- SOCIAL-FR-001's acceptance criterion is about the count being unchanged
    -- after a repeat follow, and PROFILE-FR-009 requires counts to move on
    -- follow and unfollow.
    --
    -- Every path that can change a follow must therefore change the count in
    -- the same transaction: following, unfollowing, blocking (BR-024 removes
    -- follows both ways), account deletion cascading, and any future admin
    -- action. A trigger covers all of them, including the ones nobody has
    -- written yet. Application code covers the ones somebody remembered.
    --
    -- GREATEST(x - 1, 0) belts-and-braces the CHECK on profiles: a
    -- double-decrement should be found by the constraint in development, but it
    -- must not take the site down in production.
    CREATE TRIGGER follows_counts
      AFTER INSERT OR DELETE ON follows
      FOR EACH ROW
      EXECUTE FUNCTION follows_maintain_counts();
  `);
};

exports.down = async (pgm) => {
  pgm.sql(`
    DROP TRIGGER IF EXISTS follows_counts ON follows;
    DROP FUNCTION IF EXISTS follows_maintain_counts();
  `);
  pgm.dropTable('blocks');
  pgm.dropTable('follows');
};
