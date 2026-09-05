import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Client, Pool } from 'pg';
import { randomUUID } from 'node:crypto';

/**
 * MANDATORY TEST C — the atomic auto-hide threshold.
 *
 * `13-moderation-audit.md` §2 names this test and states what it must prove:
 *
 *   "Report insert, distinct-count recompute and visibility change occur in ONE
 *    transaction with `SELECT … FOR UPDATE` on the target. TWO SIMULTANEOUS
 *    THRESHOLD-REACHING REPORTS CANNOT DOUBLE-HIDE OR MISS."
 *
 * WHY IT LIVES HERE AND NOT IN THE API SUITE. The guarantee is a property of
 * PostgreSQL's row locking, not of TypeScript. An in-memory fake cannot
 * interleave two transactions, and a mocked repository would test that the code
 * calls a method named `lockTarget` — which is not the same claim at all. This
 * runs real concurrent transactions against a real database.
 *
 * THE FAILURE IT GUARDS AGAINST IS SILENT. Without the lock, two reports that
 * both take a post from 2 to 3 can each read 2, each conclude the threshold is
 * not reached, and each insert. The post ends with three distinct reporters and
 * full visibility, and nothing anywhere records that the threshold was missed.
 * On a platform where the threshold is the only thing standing between one
 * moderator and an open feed, that is the failure that matters.
 */

const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
const describeIfDb = url === undefined ? describe.skip : describe;

let admin: Client;
let pool: Pool;

/** Posts and comments hide at 3 distinct reporters (BR-032). */
const POST_THRESHOLD = 3;

describeIfDb('mandatory test C — the atomic auto-hide threshold', () => {
  const users: string[] = [];
  let author: string;

  beforeAll(async () => {
    admin = new Client({ connectionString: url });
    await admin.connect();
    pool = new Pool({ connectionString: url, max: 10 });

    // Deterministic synthetic accounts. No identifier row points at any of
    // them, so none can be logged into, and nothing in this suite sends a
    // message, an email or a push.
    const make = async (): Promise<string> => {
      const id = randomUUID();
      await admin.query(
        `INSERT INTO users (
           id, state, password_hash, date_of_birth, terms_version, terms_accepted_at
         )
         VALUES ($1, 'ACTIVE', $2, '1995-06-15', 'terms-2026-01', now())`,
        // Not a hash of anything, and not a credential: this account can never
        // be logged into, because no identifier row points at it. The addendum
        // requires deterministic synthetic test data, and a string that is
        // obviously not an Argon2 digest is the clearest form of that.
        [id, 'synthetic-not-a-real-hash'],
      );
      return id;
    };

    author = await make();
    for (let i = 0; i < 8; i += 1) users.push(await make());
  });

  afterAll(async () => {
    await pool?.end();
    await admin?.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[author, ...users]]);
    await admin?.end();
  });

  const makePost = async (): Promise<string> => {
    const id = randomUUID();
    await admin.query(
      `INSERT INTO posts (id, author_id, body, visibility_state)
       VALUES ($1, $2, 'A synthetic post used by the threshold test', 'VISIBLE')`,
      [id, author],
    );
    return id;
  };

  const stateOf = async (postId: string): Promise<string> => {
    const r = await admin.query<{ visibility_state: string }>(
      'SELECT visibility_state FROM posts WHERE id = $1',
      [postId],
    );
    return r.rows[0]?.visibility_state ?? 'MISSING';
  };

  const countOf = async (postId: string): Promise<number> => {
    const r = await admin.query<{ distinct_report_count: number }>(
      'SELECT distinct_report_count FROM posts WHERE id = $1',
      [postId],
    );
    return r.rows[0]?.distinct_report_count ?? -1;
  };

  /**
   * One report, exactly as `ReportService.report` performs it.
   *
   * Duplicated here rather than imported because this suite runs against the
   * database package and must not depend on the API build — and because what is
   * under test is the SQL SEQUENCE, which is easier to trust when it is visible
   * in the test. If the service ever diverges from this, the smoke test's
   * end-to-end assertions are what catch it.
   */
  const report = async (
    reporterId: string,
    postId: string,
    opts: { pauseMs?: number } = {},
  ): Promise<{ hidden: boolean; count: number }> => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // THE LOCK, FIRST.
      const target = await client.query<{ author_id: string; visibility_state: string }>(
        'SELECT author_id, visibility_state FROM posts WHERE id = $1 FOR UPDATE',
        [postId],
      );
      const row = target.rows[0];
      if (row === undefined) {
        await client.query('ROLLBACK');
        return { hidden: false, count: 0 };
      }

      // A deliberate pause BETWEEN the lock and the rest, to widen the window
      // in which a racing transaction could interleave. If the lock were not
      // held, this is where the second transaction would read a stale count.
      if (opts.pauseMs !== undefined) {
        await new Promise((r) => setTimeout(r, opts.pauseMs));
      }

      await client.query(
        `INSERT INTO reports (
           id, reporter_id, target_type, target_id, target_owner_id, reason_code, severity
         )
         VALUES ($1, $2, 'POST', $3, $4, 'SPAM_OR_MISLEADING', 'LOW')
         ON CONFLICT (reporter_id, target_type, target_id) DO NOTHING`,
        [randomUUID(), reporterId, postId, row.author_id],
      );

      const counted = await client.query<{ n: string }>(
        "SELECT COUNT(*) AS n FROM reports WHERE target_type = 'POST' AND target_id = $1",
        [postId],
      );
      const count = Number(counted.rows[0]?.n ?? 0);

      await client.query('UPDATE posts SET distinct_report_count = $2 WHERE id = $1', [
        postId,
        count,
      ]);

      let hidden = false;
      if (count >= POST_THRESHOLD && row.visibility_state === 'VISIBLE') {
        const updated = await client.query(
          `UPDATE posts SET visibility_state = 'AUTO_HIDDEN'
            WHERE id = $1 AND visibility_state = 'VISIBLE'`,
          [postId],
        );
        hidden = (updated.rowCount ?? 0) > 0;
      }

      await client.query('COMMIT');
      return { hidden, count };
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  };

  let postId: string;
  beforeEach(async () => {
    postId = await makePost();
  });

  it('hides at exactly the third distinct reporter, not before', async () => {
    expect(await stateOf(postId)).toBe('VISIBLE');

    await report(users[0]!, postId);
    expect(await stateOf(postId)).toBe('VISIBLE');

    await report(users[1]!, postId);
    expect(await stateOf(postId)).toBe('VISIBLE');

    await report(users[2]!, postId);
    expect(await stateOf(postId)).toBe('AUTO_HIDDEN');
    expect(await countOf(postId)).toBe(3);
  });

  it('COUNTS DISTINCT REPORTERS, so three reports from one account hide nothing (EDGE-023)', async () => {
    // "The same user reports one item three times → the distinct-reporter count
    // remains 1. The threshold is not reached."
    await report(users[0]!, postId);
    await report(users[0]!, postId);
    await report(users[0]!, postId);

    expect(await countOf(postId)).toBe(1);
    expect(await stateOf(postId)).toBe('VISIBLE');
  });

  it('TWO SIMULTANEOUS THRESHOLD-REACHING REPORTS HIDE EXACTLY ONCE', async () => {
    // The named case. Two reporters already on file, then two more racing to
    // be the third - each pausing inside its transaction to widen the window.
    await report(users[0]!, postId);
    await report(users[1]!, postId);
    expect(await stateOf(postId)).toBe('VISIBLE');

    const [a, b] = await Promise.all([
      report(users[2]!, postId, { pauseMs: 120 }),
      report(users[3]!, postId, { pauseMs: 120 }),
    ]);

    // EXACTLY ONE of them performed the hide. Both committed, both counted, and
    // the second saw the post already hidden - which is what stops the author
    // being notified twice.
    expect([a.hidden, b.hidden].filter(Boolean)).toHaveLength(1);
    expect(await stateOf(postId)).toBe('AUTO_HIDDEN');
    expect(await countOf(postId)).toBe(4);
  });

  it('AND NEITHER MISSES — the count is never left short of the threshold', async () => {
    // The other half of "cannot double-hide OR MISS": two racing reports that
    // take a post from 2 to 4 must not both read 2 and both decline to hide.
    await report(users[0]!, postId);
    await report(users[1]!, postId);

    await Promise.all([
      report(users[2]!, postId, { pauseMs: 80 }),
      report(users[3]!, postId, { pauseMs: 80 }),
    ]);

    expect(await stateOf(postId)).toBe('AUTO_HIDDEN');
  });

  it('holds under EIGHT concurrent reporters', async () => {
    // Well past the threshold and well past any plausible interleaving. One
    // hide, eight reports, and a count that matches the rows.
    const results = await Promise.all(
      users.map((u, i) => report(u, postId, { pauseMs: 20 + i * 10 })),
    );

    expect(results.filter((r) => r.hidden)).toHaveLength(1);
    expect(await stateOf(postId)).toBe('AUTO_HIDDEN');
    expect(await countOf(postId)).toBe(users.length);

    const rows = await admin.query<{ n: string }>(
      "SELECT COUNT(*) AS n FROM reports WHERE target_type = 'POST' AND target_id = $1",
      [postId],
    );
    expect(Number(rows.rows[0]?.n)).toBe(users.length);
  });

  it('A REPORT ON AN ALREADY-HIDDEN POST DOES NOT HIDE IT AGAIN', async () => {
    for (let i = 0; i < 3; i += 1) await report(users[i]!, postId);
    expect(await stateOf(postId)).toBe('AUTO_HIDDEN');

    const fourth = await report(users[3]!, postId);

    // `hidden: false` is what stops a second "your content is under review"
    // notification going to an author who has already been told.
    expect(fourth.hidden).toBe(false);
    expect(fourth.count).toBe(4);
  });

  it('the UNIQUE constraint is what makes a row count a DISTINCT count', async () => {
    // BR-030: "thresholds count distinct reporting accounts, never total
    // reports". The row count is only equal to the distinct count because the
    // database refuses the second row - asserted directly, because everything
    // above depends on it.
    await report(users[0]!, postId);

    await expect(
      admin.query(
        `INSERT INTO reports (id, reporter_id, target_type, target_id, reason_code, severity)
         VALUES ($1, $2, 'POST', $3, 'SPAM_OR_MISLEADING', 'LOW')`,
        [randomUUID(), users[0], postId],
      ),
    ).rejects.toThrow(/reports_one_per_reporter_per_target|duplicate key/i);
  });
});

describeIfDb('thresholds that are deliberately absent (SAFETY-FR-002, MSG-FR-007)', () => {
  it('has no auto-hide state on users or conversations to move', async () => {
    const client = new Client({ connectionString: url });
    await client.connect();
    try {
      // SAFETY-FR-002: a profile is "only ever actioned by an administrator,
      // because hiding a whole person on report count would be trivially
      // weaponised". Asserted as an ABSENCE at the schema level: there is no
      // column a threshold could write to.
      const userColumns = await client.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
          WHERE table_name = 'users' AND column_name IN ('visibility_state', 'auto_hidden')`,
      );
      expect(userColumns.rows).toHaveLength(0);

      const conversationColumns = await client.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
          WHERE table_name = 'conversations'
            AND column_name IN ('visibility_state', 'auto_hidden')`,
      );
      expect(conversationColumns.rows).toHaveLength(0);
    } finally {
      await client.end();
    }
  });

  it('enforcement_actions cannot reference an administrator (BR-ADM-001, SEC-021)', async () => {
    const client = new Client({ connectionString: url });
    await client.connect();
    try {
      // "There is no schema path by which an enforcement action could target an
      // administrator." Asserted against the foreign keys themselves rather
      // than against a code path, because the claim is about the schema.
      const fks = await client.query<{ foreign_table: string; column_name: string }>(
        `SELECT ccu.table_name AS foreign_table, kcu.column_name
           FROM information_schema.table_constraints tc
           JOIN information_schema.key_column_usage kcu
             ON kcu.constraint_name = tc.constraint_name
           JOIN information_schema.constraint_column_usage ccu
             ON ccu.constraint_name = tc.constraint_name
          WHERE tc.table_name = 'enforcement_actions'
            AND tc.constraint_type = 'FOREIGN KEY'`,
      );

      const targetFks = fks.rows.filter((r) => r.column_name === 'target_user_id');
      expect(targetFks).toHaveLength(1);
      expect(targetFks[0]?.foreign_table).toBe('users');

      // The only column pointing at `admins` is the one naming who ACTED.
      const adminFks = fks.rows.filter((r) => r.foreign_table === 'admins');
      expect(adminFks.map((r) => r.column_name)).toEqual(['admin_id']);
    } finally {
      await client.end();
    }
  });
});
