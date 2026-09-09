import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from 'pg';
import { randomUUID } from 'node:crypto';

/**
 * MOBILE-BACKEND-FIX-002 — `profiles.post_count` is maintained by a trigger.
 *
 * FOUND BY RUNNING §44's FLOW C ON AN EMULATOR. A post was published, it
 * appeared in the profile's post list, and the Posts stat directly above that
 * list read **0**:
 *
 *     username    | post_count | actual_posts
 *     masjid_noor |          0 |            1
 *
 * Every other denormalised counter in this schema has a trigger, and each was
 * correct in the same run — `follows_counts` had `following_count` at 1,
 * `likes_count` had `like_count` at 1. `posts` had no count trigger at all. So
 * it was an omission rather than a disagreement: `post_count` was declared,
 * selected by the profile projection, rendered on the stat pill, and
 * incremented by nobody.
 *
 * WHY THIS TEST LIVES HERE AND NOT IN THE API SUITE. The guarantee is a
 * property of the database, and it has to hold for paths no TypeScript touches:
 * SAFETY-FR-004's threshold auto-hide moves `visibility_state` from a trigger,
 * an administrator's removal (ADMIN-FR-004) and restore (ADMIN-FR-003) move it
 * from another module, and account deletion cascades rows out entirely. A test
 * against a mocked repository would prove the code calls something named
 * `incrementPostCount` — which is not the same claim, and is exactly the claim
 * that was false.
 *
 * THE `UPDATE` BRANCH IS THE ONE THAT MATTERS MOST. Auto-hide, removal and
 * restore are none of them an INSERT or a DELETE of the row, so a trigger that
 * only watched INSERT and DELETE would drift the moment moderation touched a
 * post — silently, on a number a viewer reads on every profile.
 */

const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
const describeIfDb = url === undefined ? describe.skip : describe;

describeIfDb('profiles.post_count is maintained by a trigger', () => {
  let admin: Client;
  let author: string;

  beforeAll(async () => {
    admin = new Client({ connectionString: url });
    await admin.connect();

    // A deterministic synthetic account. No identifier row points at it, so it
    // can never be logged into, and nothing here sends anything to anybody.
    author = randomUUID();
    await admin.query(
      `INSERT INTO users (
         id, state, password_hash, date_of_birth, terms_version, terms_accepted_at
       )
       VALUES ($1, 'ACTIVE', 'synthetic-not-a-real-hash', '1995-06-15',
               'terms-2026-01', now())`,
      [author],
    );
    await admin.query(
      `INSERT INTO profiles (user_id, username, display_name)
       VALUES ($1, $2, 'Synthetic Count Probe')`,
      [author, `probe_${author.replace(/-/g, '').slice(0, 12)}`],
    );
  });

  afterAll(async () => {
    await admin?.query('DELETE FROM users WHERE id = $1', [author]);
    await admin?.end();
  });

  const count = async (): Promise<number> => {
    const r = await admin.query<{ post_count: number }>(
      'SELECT post_count FROM profiles WHERE user_id = $1',
      [author],
    );
    return Number(r.rows[0]?.post_count ?? -1);
  };

  const addPost = async (state = 'VISIBLE'): Promise<string> => {
    const id = randomUUID();
    await admin.query(
      `INSERT INTO posts (id, author_id, body, visibility_state)
       VALUES ($1, $2, 'A synthetic post used by the count trigger test', $3)`,
      [id, author, state],
    );
    return id;
  };

  it('STARTS AT ZERO AND COUNTS A PUBLISHED POST', async () => {
    // The assertion the defect failed. Before the trigger existed this stayed
    // at 0 forever, and the profile rendered "0 Posts" above a list with a
    // post in it.
    expect(await count()).toBe(0);

    await addPost();
    expect(await count()).toBe(1);

    await addPost();
    expect(await count()).toBe(2);
  });

  it('DOES NOT COUNT A POST THAT IS NOT VISIBLE', async () => {
    // `post_count` is on the PUBLIC projection. If it counted auto-hidden
    // posts, a viewer could compare the number against the list they can see —
    // 5 against 4 — and infer that one had been hidden. BR-025 exists to make
    // hidden content indistinguishable from absent content, and a count that
    // betrays it would undo that at the last step.
    const before = await count();

    await addPost('AUTO_HIDDEN');
    expect(await count()).toBe(before);

    await addPost('AUTHOR_DELETED');
    expect(await count()).toBe(before);
  });

  it('FOLLOWS A POST ACROSS THE VISIBILITY BOUNDARY, IN BOTH DIRECTIONS', async () => {
    // THE BRANCH THAT MATTERS MOST. Auto-hide (SAFETY-FR-004), an
    // administrator's removal (ADMIN-FR-004) and a restore (ADMIN-FR-003) are
    // none of them an INSERT or a DELETE — they are UPDATEs of
    // `visibility_state`. A trigger watching only INSERT and DELETE would drift
    // the first time moderation touched a post.
    const id = await addPost();
    const withPost = await count();

    await admin.query(`UPDATE posts SET visibility_state = 'AUTO_HIDDEN' WHERE id = $1`, [id]);
    expect(await count()).toBe(withPost - 1);

    await admin.query(`UPDATE posts SET visibility_state = 'VISIBLE' WHERE id = $1`, [id]);
    expect(await count()).toBe(withPost);

    await admin.query(`UPDATE posts SET visibility_state = 'AUTHOR_DELETED' WHERE id = $1`, [id]);
    expect(await count()).toBe(withPost - 1);
  });

  it('DECREMENTS WHEN A VISIBLE POST IS DELETED OUTRIGHT', async () => {
    const id = await addPost();
    const withPost = await count();

    await admin.query('DELETE FROM posts WHERE id = $1', [id]);
    expect(await count()).toBe(withPost - 1);
  });

  it('NEVER GOES NEGATIVE', async () => {
    // `GREATEST(x - 1, 0)` belts-and-braces the CHECK on `profiles`, following
    // the same reasoning `follows_maintain_counts` records: a double-decrement
    // should be caught by the constraint in development, but it must not take
    // the site down in production.
    await admin.query('DELETE FROM posts WHERE author_id = $1', [author]);
    expect(await count()).toBe(0);

    // A hidden post deleted from an already-zero count must not push it under.
    const hidden = await addPost('AUTO_HIDDEN');
    await admin.query('DELETE FROM posts WHERE id = $1', [hidden]);
    expect(await count()).toBe(0);
  });
});
