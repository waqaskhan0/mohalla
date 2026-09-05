import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Client, Pool } from 'pg';
import { randomUUID } from 'node:crypto';

/**
 * MANDATORY TEST D — the moderation decision collision.
 *
 * `13-moderation-audit.md` §4 names this test and states what it must prove:
 *
 *   "Collision (EDGE-024) — `version` column. A stale decision returns 409
 *    NAMING WHO RESOLVED IT AND HOW, rendered as INFORMATION rather than an
 *    error. Mandatory test D."
 *
 * EDGE-024 itself: "Two administrators act on the same queue item
 * simultaneously → the first action is applied. The second administrator is
 * told the item was already resolved, BY WHOM, AND HOW — not shown a generic
 * error."
 *
 * WHY THIS RUNS AGAINST REAL POSTGRESQL. The guarantee is that a conditional
 * UPDATE either matches or does not, atomically, under concurrent transactions.
 * An in-memory fake decides that by reading a number in a single-threaded loop,
 * which is a different claim from the one being made. Two administrators
 * clicking at the same moment is the case, so two real transactions is the test.
 *
 * WHAT MAKES THIS EPIC'S FAILURE MODE DIFFERENT FROM TEST C'S. A missed
 * threshold hides nothing; a lost collision means one administrator's decision
 * silently overwrites another's, and the audit log shows both as if they had
 * agreed. RSK-010 is that coordinated reporting silences civic criticism — a
 * restore quietly replaced by a delete is that risk arriving from inside.
 */

const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
const describeIfDb = url === undefined ? describe.skip : describe;

let admin: Client;
let pool: Pool;

describeIfDb('mandatory test D — two administrators, one case', () => {
  const admins: string[] = [];
  let author: string;
  let postId: string;

  beforeAll(async () => {
    admin = new Client({ connectionString: url });
    await admin.connect();
    pool = new Pool({ connectionString: url, max: 10 });

    // Synthetic administrators. OD-020 means no real administrator can be
    // provisioned - there is no named technical owner, and no bootstrap
    // endpoint exists in any environment. These rows are written directly by
    // the test and removed afterwards; they are never reachable by a login,
    // because the password hash is not a hash of anything.
    for (let i = 0; i < 2; i += 1) {
      const id = randomUUID();
      await admin.query(
        `INSERT INTO admins (id, email, password_hash, state, display_name)
         VALUES ($1, $2, $3, 'ACTIVE', $4)`,
        [id, `synthetic-admin-${id}@example.invalid`, 'synthetic-not-a-real-hash', `Admin ${i}`],
      );
      admins.push(id);
    }

    const userId = randomUUID();
    await admin.query(
      `INSERT INTO users (id, state, password_hash, date_of_birth, terms_version, terms_accepted_at)
       VALUES ($1, 'ACTIVE', $2, '1995-06-15', 'terms-2026-01', now())`,
      [userId, 'synthetic-not-a-real-hash'],
    );
    author = userId;
  });

  afterAll(async () => {
    await pool?.end();
    await admin?.query('DELETE FROM moderation_cases WHERE target_owner_id = $1', [author]);
    await admin?.query('DELETE FROM users WHERE id = $1', [author]);
    await admin?.query('DELETE FROM admins WHERE id = ANY($1::uuid[])', [admins]);
    await admin?.end();
  });

  const openCase = async (): Promise<{ caseId: string; version: number }> => {
    postId = randomUUID();
    await admin.query(
      `INSERT INTO posts (id, author_id, body, visibility_state)
       VALUES ($1, $2, 'A synthetic post used by the collision test', 'AUTO_HIDDEN')`,
      [postId, author],
    );

    const caseId = randomUUID();
    const r = await admin.query<{ version: number }>(
      `INSERT INTO moderation_cases (
         id, target_type, target_id, target_owner_id, max_severity,
         distinct_report_count, auto_hidden
       )
       VALUES ($1, 'POST', $2, $3, 'HIGH', 3, true)
       RETURNING version`,
      [caseId, postId, author],
    );
    return { caseId, version: r.rows[0]!.version };
  };

  /**
   * One administrator's decision, exactly as `ReportService.resolve` performs
   * it: a conditional UPDATE on `(id, version, state = 'OPEN')`.
   *
   * @returns the resolved row, or null when somebody got there first.
   */
  const resolve = async (
    caseId: string,
    adminId: string,
    version: number,
    state: 'RESOLVED_RESTORED' | 'RESOLVED_DELETED' | 'RESOLVED_NO_ACTION',
    opts: { pauseMs?: number } = {},
  ): Promise<{ state: string; version: number; resolvedBy: string } | null> => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // The read an administrator's screen would have done, then a pause to
      // widen the window in which the other one commits.
      await client.query('SELECT version FROM moderation_cases WHERE id = $1', [caseId]);
      if (opts.pauseMs !== undefined) {
        await new Promise((r) => setTimeout(r, opts.pauseMs));
      }

      const r = await client.query<{
        state: string;
        version: number;
        resolved_by_admin_id: string;
      }>(
        `UPDATE moderation_cases
            SET state = $3,
                resolution_reason = 'Reviewed by the collision test.',
                resolved_by_admin_id = $4,
                resolved_at = now(),
                updated_at = now(),
                version = version + 1
          WHERE id = $1 AND version = $2 AND state = 'OPEN'
          RETURNING state, version, resolved_by_admin_id`,
        [caseId, version, state, adminId],
      );

      await client.query('COMMIT');
      const row = r.rows[0];
      return row === undefined
        ? null
        : { state: row.state, version: row.version, resolvedBy: row.resolved_by_admin_id };
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  };

  const currentCase = async (caseId: string) => {
    const r = await admin.query<{
      state: string;
      version: number;
      resolved_by_admin_id: string | null;
      resolution_reason: string | null;
    }>(
      `SELECT state, version, resolved_by_admin_id, resolution_reason
         FROM moderation_cases WHERE id = $1`,
      [caseId],
    );
    return r.rows[0];
  };

  let opened: { caseId: string; version: number };
  beforeEach(async () => {
    opened = await openCase();
  });

  it('THE FIRST DECISION IS APPLIED AND THE SECOND IS REFUSED', async () => {
    const [a, b] = await Promise.all([
      resolve(opened.caseId, admins[0]!, opened.version, 'RESOLVED_RESTORED', { pauseMs: 120 }),
      resolve(opened.caseId, admins[1]!, opened.version, 'RESOLVED_DELETED', { pauseMs: 120 }),
    ]);

    // Exactly one of them wrote. The other's UPDATE matched no row, which is
    // what the 409 is built from.
    const applied = [a, b].filter((x) => x !== null);
    expect(applied).toHaveLength(1);

    const current = await currentCase(opened.caseId);
    expect(current?.state).toBe(applied[0]!.state);
    expect(current?.version).toBe(opened.version + 1);
  });

  it('THE REFUSED ADMINISTRATOR CAN LEARN WHO RESOLVED IT AND HOW (EDGE-024)', async () => {
    const first = await resolve(opened.caseId, admins[0]!, opened.version, 'RESOLVED_DELETED');
    expect(first).not.toBeNull();

    const second = await resolve(opened.caseId, admins[1]!, opened.version, 'RESOLVED_RESTORED');
    expect(second).toBeNull();

    // "Not shown a generic error." Both facts the requirement names are
    // readable from the row the second administrator re-reads: WHO, and HOW.
    const current = await currentCase(opened.caseId);
    expect(current?.resolved_by_admin_id).toBe(admins[0]);
    expect(current?.state).toBe('RESOLVED_DELETED');
  });

  it('A RESTORE IS NEVER SILENTLY REPLACED BY A DELETE', async () => {
    // The failure this test exists to prevent. Without the version check, the
    // second UPDATE would overwrite the first and the audit log would show two
    // administrators who appear to have agreed - RSK-010 arriving from inside.
    await resolve(opened.caseId, admins[0]!, opened.version, 'RESOLVED_RESTORED');
    await resolve(opened.caseId, admins[1]!, opened.version, 'RESOLVED_DELETED');

    const current = await currentCase(opened.caseId);
    expect(current?.state).toBe('RESOLVED_RESTORED');
    expect(current?.resolved_by_admin_id).toBe(admins[0]);
  });

  it('holds when FOUR administrators act at once', async () => {
    const results = await Promise.all([
      resolve(opened.caseId, admins[0]!, opened.version, 'RESOLVED_RESTORED', { pauseMs: 40 }),
      resolve(opened.caseId, admins[1]!, opened.version, 'RESOLVED_DELETED', { pauseMs: 60 }),
      resolve(opened.caseId, admins[0]!, opened.version, 'RESOLVED_NO_ACTION', { pauseMs: 80 }),
      resolve(opened.caseId, admins[1]!, opened.version, 'RESOLVED_DELETED', { pauseMs: 100 }),
    ]);

    expect(results.filter((r) => r !== null)).toHaveLength(1);
    expect((await currentCase(opened.caseId))?.version).toBe(opened.version + 1);
  });

  it('a decision carrying a STALE version is refused even with no concurrency', async () => {
    // The lock is not only about simultaneity. An administrator who left the
    // page open for an hour is holding a stale version too, and their decision
    // is stale for the same reason.
    await resolve(opened.caseId, admins[0]!, opened.version, 'RESOLVED_NO_ACTION');
    const late = await resolve(opened.caseId, admins[1]!, opened.version, 'RESOLVED_DELETED');
    expect(late).toBeNull();
  });
});

describeIfDb('BR-038 and BR-039 are the database’s, not the application’s', () => {
  let client: Client;

  beforeAll(async () => {
    client = new Client({ connectionString: url });
    await client.connect();
  });

  afterAll(async () => {
    await client?.end();
  });

  it('REFUSES A RESOLVED CASE WITH NO REASON (BR-038)', async () => {
    // "A reason is mandatory on every moderation and enforcement action", and
    // §4 says it is "a CHECK constraint, not a validator". An audit trail is
    // only worth having if it cannot contain a blank.
    const id = randomUUID();
    await expect(
      client.query(
        `INSERT INTO moderation_cases (
           id, target_type, target_id, max_severity, state, resolved_at
         )
         VALUES ($1, 'POST', $2, 'LOW', 'RESOLVED_DELETED', now())`,
        [id, randomUUID()],
      ),
    ).rejects.toThrow(/moderation_cases_reason_required|check constraint/i);
  });

  it('refuses a reason of fewer than five characters', async () => {
    const id = randomUUID();
    await expect(
      client.query(
        `INSERT INTO moderation_cases (
           id, target_type, target_id, max_severity, state, resolution_reason,
           resolved_by_admin_id, resolved_at
         )
         VALUES ($1, 'POST', $2, 'LOW', 'RESOLVED_DELETED', 'no',
                 (SELECT id FROM admins LIMIT 1), now())`,
        [id, randomUUID()],
      ),
    ).rejects.toThrow(/moderation_cases_reason_required|check constraint|null value/i);
  });

  it('REFUSES AN ENFORCEMENT ACTION AGAINST AN ADMINISTRATOR (BR-ADM-001, SEC-021)', async () => {
    // The foreign key does the refusing. `target_user_id` references `users`,
    // and an administrator id is not in `users` - so the row cannot be written
    // whatever the application does. SEC-021: "cannot be reached by any
    // request, regardless of interface state."
    const adminId = randomUUID();
    await client.query(
      `INSERT INTO admins (id, email, password_hash, state)
       VALUES ($1, $2, $3, 'ACTIVE')`,
      [adminId, `synthetic-target-${adminId}@example.invalid`, 'synthetic-not-a-real-hash'],
    );

    try {
      await expect(
        client.query(
          `INSERT INTO enforcement_actions (id, target_user_id, admin_id, kind, reason)
           VALUES ($1, $2, $3, 'BAN', 'attempting to ban an administrator')`,
          [randomUUID(), adminId, adminId],
        ),
      ).rejects.toThrow(/foreign key|violates/i);
    } finally {
      await client.query('DELETE FROM admins WHERE id = $1', [adminId]);
    }
  });

  it('refuses a BAN that carries an expiry, and a SUSPEND that does not', async () => {
    // Only a suspension has an end. A ban with an expiry would silently lift;
    // a suspension without one would be a permanent sentence nobody chose.
    const userId = randomUUID();
    const adminId = randomUUID();
    await client.query(
      `INSERT INTO users (id, state, password_hash, date_of_birth, terms_version, terms_accepted_at)
       VALUES ($1, 'ACTIVE', $2, '1995-06-15', 'terms-2026-01', now())`,
      [userId, 'synthetic-not-a-real-hash'],
    );
    await client.query(
      `INSERT INTO admins (id, email, password_hash, state)
       VALUES ($1, $2, $3, 'ACTIVE')`,
      [adminId, `synthetic-actor-${adminId}@example.invalid`, 'synthetic-not-a-real-hash'],
    );

    try {
      await expect(
        client.query(
          `INSERT INTO enforcement_actions (id, target_user_id, admin_id, kind, reason, expires_at)
           VALUES ($1, $2, $3, 'BAN', 'a ban should not expire', now() + interval '1 day')`,
          [randomUUID(), userId, adminId],
        ),
      ).rejects.toThrow(/expiry_matches_kind|check constraint/i);

      await expect(
        client.query(
          `INSERT INTO enforcement_actions (id, target_user_id, admin_id, kind, reason)
           VALUES ($1, $2, $3, 'SUSPEND', 'a suspension needs an end')`,
          [randomUUID(), userId, adminId],
        ),
      ).rejects.toThrow(/expiry_matches_kind|check constraint/i);
    } finally {
      await client.query('DELETE FROM enforcement_actions WHERE target_user_id = $1', [userId]);
      await client.query('DELETE FROM users WHERE id = $1', [userId]);
      await client.query('DELETE FROM admins WHERE id = $1', [adminId]);
    }
  });

  it('REFUSES A SINGLE-LANGUAGE ANNOUNCEMENT (ADMIN-FR-009)', async () => {
    // "Both language versions are required, because a single-language
    // announcement fails half the audience." NOT NULL on all four columns makes
    // the refusal structural rather than a validator somebody can skip.
    const adminId = randomUUID();
    await client.query(
      `INSERT INTO admins (id, email, password_hash, state)
       VALUES ($1, $2, $3, 'ACTIVE')`,
      [adminId, `synthetic-publisher-${adminId}@example.invalid`, 'synthetic-not-a-real-hash'],
    );

    try {
      await expect(
        client.query(
          `INSERT INTO announcements (
             id, created_by_admin_id, title_en, body_en, expires_at
           )
           VALUES ($1, $2, 'English only', 'This has no Urdu version', now() + interval '7 days')`,
          [randomUUID(), adminId],
        ),
      ).rejects.toThrow(/null value|not-null/i);

      // And a space is not a translation.
      await expect(
        client.query(
          `INSERT INTO announcements (
             id, created_by_admin_id, title_en, title_ur, body_en, body_ur, expires_at
           )
           VALUES ($1, $2, 'English only', '   ', 'Body', '   ', now() + interval '7 days')`,
          [randomUUID(), adminId],
        ),
      ).rejects.toThrow(/announcements_not_blank|check constraint/i);
    } finally {
      await client.query('DELETE FROM announcements WHERE created_by_admin_id = $1', [adminId]);
      await client.query('DELETE FROM admins WHERE id = $1', [adminId]);
    }
  });
});
