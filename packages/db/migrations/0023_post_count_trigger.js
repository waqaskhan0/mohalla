/**
 * MOBILE-BACKEND-FIX-002 — `profiles.post_count` was never maintained.
 *
 * Found by running §44's Flow C on an emulator against this database: a post
 * was published, it appeared in the profile's post list, and the Posts stat
 * above that list read **0**.
 *
 *     username    | post_count | actual_posts
 *     masjid_noor |          0 |            1
 *
 * Every other denormalised counter in this schema is maintained by a trigger,
 * and each one was correct in the same run:
 *
 *     follows      -> follows_counts       (following_count read 1, correctly)
 *     likes        -> likes_count          (like_count read 1, correctly)
 *     comments     -> comments_count
 *     event_rsvps  -> event_rsvps_counts
 *     posts        -> NOTHING
 *
 * So this is not a design disagreement, it is an omission: `post_count` is
 * declared on `profiles`, selected by the profile projection, rendered on the
 * stat pill, and incremented by nobody.
 *
 * WHY A TRIGGER, and not application code — the same reasoning
 * `0010_epic05_social_graph` gives for follows, which applies here verbatim.
 * A count that is read on every profile view can drift, and every path that
 * can change a post has to change the count in the same transaction:
 * publishing, the author deleting, an administrator removing (ADMIN-FR-004),
 * SAFETY-FR-004's threshold auto-hide, a restore (ADMIN-FR-003), and account
 * deletion cascading. A trigger covers all of them, including the ones nobody
 * has written yet. Application code covers the ones somebody remembered.
 *
 * WHY IT COUNTS `VISIBLE` ONLY, which is the one real decision here.
 *
 * `listByAuthor` shows `VISIBLE` to everyone and additionally `AUTO_HIDDEN` to
 * the author themselves. `post_count` lives on the PUBLIC projection, so if it
 * included auto-hidden posts a viewer could compare the count with the list
 * they can see — 5 against 4 — and infer that one post had been hidden. BR-025
 * exists to make hidden content indistinguishable from absent content, and a
 * count that betrays it would undo that at the last step.
 *
 * The consequence is deliberate and worth stating: an author with an
 * auto-hidden post sees one more row in their own list than their own stat
 * reports. That is the correct trade — the alternative leaks, for everyone, to
 * spare the author a discrepancy only they can see.
 */

exports.shorthands = undefined;

exports.up = async (pgm) => {
  pgm.sql(`
    CREATE OR REPLACE FUNCTION posts_maintain_counts()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      -- Only VISIBLE posts count. See the file comment for why.
      IF TG_OP = 'INSERT' THEN
        IF NEW.visibility_state = 'VISIBLE' THEN
          UPDATE profiles SET post_count = post_count + 1
            WHERE user_id = NEW.author_id;
        END IF;

      ELSIF TG_OP = 'DELETE' THEN
        IF OLD.visibility_state = 'VISIBLE' THEN
          UPDATE profiles SET post_count = GREATEST(post_count - 1, 0)
            WHERE user_id = OLD.author_id;
        END IF;

      ELSIF TG_OP = 'UPDATE' THEN
        -- A post crossing INTO or OUT OF visibility. This is the branch that
        -- covers auto-hide, admin removal, restore and author deletion, none
        -- of which is an INSERT or a DELETE of the row.
        IF OLD.visibility_state <> 'VISIBLE' AND NEW.visibility_state = 'VISIBLE' THEN
          UPDATE profiles SET post_count = post_count + 1
            WHERE user_id = NEW.author_id;
        ELSIF OLD.visibility_state = 'VISIBLE' AND NEW.visibility_state <> 'VISIBLE' THEN
          UPDATE profiles SET post_count = GREATEST(post_count - 1, 0)
            WHERE user_id = NEW.author_id;
        END IF;
      END IF;

      RETURN NULL;
    END
    $$;

    CREATE TRIGGER posts_counts
      AFTER INSERT OR DELETE OR UPDATE OF visibility_state ON posts
      FOR EACH ROW
      EXECUTE FUNCTION posts_maintain_counts();

    -- BACKFILL, because every profile that has ever posted is currently wrong.
    -- Recomputed from the rows rather than adjusted, so it is correct whatever
    -- the drift was.
    UPDATE profiles p
       SET post_count = COALESCE(c.n, 0)
      FROM (
        SELECT author_id, COUNT(*) AS n
          FROM posts
         WHERE visibility_state = 'VISIBLE'
         GROUP BY author_id
      ) c
     WHERE c.author_id = p.user_id
       AND p.post_count <> COALESCE(c.n, 0);

    -- And profiles whose only posts are hidden or deleted, which the join above
    -- cannot reach.
    UPDATE profiles p
       SET post_count = 0
     WHERE p.post_count <> 0
       AND NOT EXISTS (
         SELECT 1 FROM posts po
          WHERE po.author_id = p.user_id
            AND po.visibility_state = 'VISIBLE'
       );
  `);
};

exports.down = async (pgm) => {
  pgm.sql(`
    DROP TRIGGER IF EXISTS posts_counts ON posts;
    DROP FUNCTION IF EXISTS posts_maintain_counts();
  `);
};
