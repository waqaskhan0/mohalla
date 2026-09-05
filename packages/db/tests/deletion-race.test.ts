import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Client, Pool } from 'pg';
import { randomUUID } from 'node:crypto';

/**
 * MANDATORY TEST F — restore versus erasure.
 *
 * The technical architecture names it and states its scope: deletion
 * irreversibility is mitigated by a "State machine; dry-run in staging;
 * TEST F INCLUDING DAY-29 AND DAY-31".
 *
 * ADR-019 states the guarantee this proves: "A RESTORE AT DAY 29 AND AN
 * ERASURE AT DAY 30 CANNOT INTERLEAVE — whichever commits first determines the
 * outcome, and the second observes the new state and aborts."
 *
 * WHY THIS RUNS AGAINST REAL POSTGRESQL, AND CANNOT BE FAKED. The claim is
 * about `SELECT … FOR UPDATE` serialising two transactions that both intend to
 * write the same row. An in-memory fake decides that by reading a field in a
 * single-threaded loop, which is a different claim: it proves the code checks,
 * not that the check holds when two connections check at the same instant. The
 * unit test in `apps/api` proves the service re-reads; this proves the database
 * makes the re-read meaningful.
 *
 * WHY IT MATTERS MORE THAN THE OTHER RACES IN THIS CODEBASE. Test C's failure
 * mode is a post that should have been hidden and was not; test D's is one
 * administrator's decision lost. Both are recoverable by a human doing the
 * thing again. THIS ONE IS NOT. If the erasure commits while a restore is in
 * flight, somebody who changed their mind on day 29 gets an account that
 * reports itself restored and has had its posts, profile and messages
 * anonymised underneath it — and nothing puts that back.
 *
 * The rows here are synthetic and removed afterwards. `password_hash` is not a
 * hash of anything, and no login can reach these accounts.
 */

const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
const describeIfDb = url === undefined ? describe.skip : describe;

const DAY = 24 * 60 * 60 * 1000;
const GRACE_DAYS = 30;
const ANONYMOUS_ACTOR_ID = '00000000-0000-4000-8000-000000000001';

let admin: Client;
let pool: Pool;

describeIfDb('mandatory test F — a restore and an erasure that arrive together', () => {
  const users: string[] = [];
  let userId: string;
  let requestId: string;
  let postId: string;

  beforeAll(async () => {
    admin = new Client({ connectionString: url });
    await admin.connect();
    pool = new Pool({ connectionString: url, max: 10 });

    // The anonymous actor is created by migration 0021, not by the job — a job
    // that erases somebody and then finds the destination missing has already
    // passed the point of no return. Assert it, because every case below
    // depends on it existing before any of them runs.
    const actor = await admin.query('SELECT 1 FROM users WHERE id = $1', [ANONYMOUS_ACTOR_ID]);
    expect(actor.rowCount).toBe(1);
  });

  afterAll(async () => {
    await pool?.end();
    if (users.length > 0) {
      await admin?.query('DELETE FROM posts WHERE author_id = ANY($1::uuid[])', [users]);
      await admin?.query('DELETE FROM deletion_requests WHERE user_id = ANY($1::uuid[])', [users]);
      await admin?.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [users]);
    }
    await admin?.end();
  });

  /**
   * An account that asked to be deleted `daysAgo` days ago — phase one exactly
   * as `DeletionService.requestDeletion` leaves it: the state changed, the
   * request row written, and NOTHING ERASED. That last part is what makes a
   * restore free, so the post is seeded here and checked at the end.
   */
  const seedPendingDeletion = async (daysAgo: number): Promise<void> => {
    userId = randomUUID();
    users.push(userId);

    await admin.query(
      `INSERT INTO users (id, state, password_hash, date_of_birth, terms_version, terms_accepted_at)
       VALUES ($1, 'PENDING_DELETION', 'synthetic-not-a-real-hash', '1995-06-15',
               'terms-2026-01', now())`,
      [userId],
    );

    postId = randomUUID();
    await admin.query(
      `INSERT INTO posts (id, author_id, body)
       VALUES ($1, $2, 'A synthetic post used by the deletion race test')`,
      [postId, userId],
    );

    requestId = randomUUID();
    const requestedAt = new Date(Date.now() - daysAgo * DAY);
    await admin.query(
      `INSERT INTO deletion_requests (id, user_id, requested_at, scheduled_erasure_at)
       VALUES ($1, $2, $3, $4)`,
      [requestId, userId, requestedAt, new Date(requestedAt.getTime() + GRACE_DAYS * DAY)],
    );
  };

  /**
   * The restore path, exactly as `DeletionService.restore` performs it: lock
   * the open request, RE-CHECK the outcome columns inside the same
   * transaction, then write.
   *
   * `pauseMs` sits between the lock and the write to widen the window the
   * other transaction has to commit in. Without it both would finish so fast
   * that a broken implementation could pass by luck.
   */
  const restore = async (opts: { pauseMs?: number } = {}): Promise<boolean> => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const locked = await client.query<{ id: string; scheduled_erasure_at: Date }>(
        `SELECT id, scheduled_erasure_at FROM deletion_requests
          WHERE user_id = $1 AND restored_at IS NULL AND completed_at IS NULL
          FOR UPDATE`,
        [userId],
      );

      if (opts.pauseMs !== undefined) {
        await new Promise((r) => setTimeout(r, opts.pauseMs));
      }

      const row = locked.rows[0];
      if (row === undefined || row.scheduled_erasure_at.getTime() <= Date.now()) {
        await client.query('ROLLBACK');
        return false;
      }

      const updated = await client.query(
        `UPDATE deletion_requests SET restored_at = now()
          WHERE id = $1 AND restored_at IS NULL AND completed_at IS NULL`,
        [row.id],
      );
      await client.query(
        `UPDATE users SET state = 'ACTIVE', state_changed_at = now()
          WHERE id = $1 AND state <> 'DELETED'`,
        [userId],
      );

      await client.query('COMMIT');
      return (updated.rowCount ?? 0) > 0;
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  };

  /**
   * The day-30 sweep, exactly as `DeletionService.runErasure` performs it: the
   * due row is selected OUTSIDE the transaction (as the job's query does),
   * then re-read under lock, and every anonymisation happens inside the one
   * transaction that marks the request completed.
   */
  const erase = async (opts: { pauseMs?: number; dryRun?: boolean } = {}): Promise<boolean> => {
    const due = await pool.query<{ id: string }>(
      `SELECT id FROM deletion_requests
        WHERE user_id = $1 AND restored_at IS NULL AND completed_at IS NULL
          AND scheduled_erasure_at <= now()`,
      [userId],
    );
    if (due.rows.length === 0) return false;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const locked = await client.query<{ id: string }>(
        `SELECT id FROM deletion_requests
          WHERE user_id = $1 AND restored_at IS NULL AND completed_at IS NULL
          FOR UPDATE`,
        [userId],
      );

      if (opts.pauseMs !== undefined) {
        await new Promise((r) => setTimeout(r, opts.pauseMs));
      }

      const row = locked.rows[0];
      if (row === undefined) {
        // ADR-019: "the second observes the new state and aborts."
        await client.query('ROLLBACK');
        return false;
      }

      if (opts.dryRun === true) {
        await client.query('SELECT count(*) FROM posts WHERE author_id = $1', [userId]);
        await client.query('ROLLBACK');
        return false;
      }

      // BR-009: the post's TEXT survives; only the author changes.
      await client.query('UPDATE posts SET author_id = $2 WHERE author_id = $1', [
        userId,
        ANONYMOUS_ACTOR_ID,
      ]);
      await client.query(
        `UPDATE users SET state = 'DELETED', state_changed_at = now() WHERE id = $1`,
        [userId],
      );
      const completed = await client.query(
        `UPDATE deletion_requests SET completed_at = now()
          WHERE id = $1 AND restored_at IS NULL AND completed_at IS NULL`,
        [row.id],
      );

      await client.query('COMMIT');
      return (completed.rowCount ?? 0) > 0;
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  };

  const current = async () => {
    const r = await admin.query<{
      state: string;
      restored_at: Date | null;
      completed_at: Date | null;
      author_id: string;
    }>(
      `SELECT u.state, d.restored_at, d.completed_at, p.author_id
         FROM users u
         JOIN deletion_requests d ON d.user_id = u.id
         JOIN posts p ON p.id = $2
        WHERE u.id = $1`,
      [userId, postId],
    );
    return r.rows[0];
  };

  describe('day 29 — restoring inside the window', () => {
    beforeEach(async () => {
      await seedPendingDeletion(29);
    });

    it('RESTORES, AND THE SWEEP FINDS NOTHING TO DO', async () => {
      expect(await restore()).toBe(true);

      const state = await current();
      expect(state?.state).toBe('ACTIVE');
      expect(state?.restored_at).not.toBeNull();
      expect(state?.completed_at).toBeNull();

      // "Follower relationships that existed before deletion are present" is
      // true by construction, not by a restore routine: phase one changed only
      // the state, so the post never moved.
      expect(state?.author_id).toBe(userId);

      expect(await erase()).toBe(false);
    });

    it('is not due, so a sweep running at day 29 does not select it at all', async () => {
      expect(await erase()).toBe(false);
      expect((await current())?.author_id).toBe(userId);
    });
  });

  describe('day 31 — past the window', () => {
    beforeEach(async () => {
      await seedPendingDeletion(31);
    });

    it('ERASES, AND THE POST SURVIVES ATTRIBUTED TO THE ANONYMOUS ACTOR (BR-009)', async () => {
      expect(await erase()).toBe(true);

      const state = await current();
      expect(state?.state).toBe('DELETED');
      expect(state?.completed_at).not.toBeNull();
      expect(state?.author_id).toBe(ANONYMOUS_ACTOR_ID);

      // PRIV-007: what remains "carries no link back to the deleted identity".
      const body = await admin.query<{ body: string }>('SELECT body FROM posts WHERE id = $1', [
        postId,
      ]);
      expect(body.rows[0]?.body).toContain('synthetic post');
    });

    it('refuses to restore, which is the neutral not-found SET-FR-005 requires', async () => {
      expect(await restore()).toBe(false);
      expect((await current())?.state).toBe('PENDING_DELETION');
    });

    it('IS IDEMPOTENT — a second sweep erases nothing twice', async () => {
      expect(await erase()).toBe(true);
      expect(await erase()).toBe(false);

      const rows = await admin.query('SELECT completed_at FROM deletion_requests WHERE id = $1', [
        requestId,
      ]);
      expect(rows.rowCount).toBe(1);
    });

    it('THE DRY RUN CHANGES NOTHING AND LEAVES THE ACCOUNT ERASABLE', async () => {
      // ADR-019: the job "runs dry-run in staging first". A rehearsal that
      // altered a row would not be a rehearsal, and one that consumed the
      // request would make the real run a no-op.
      expect(await erase({ dryRun: true })).toBe(false);

      const after = await current();
      expect(after?.state).toBe('PENDING_DELETION');
      expect(after?.author_id).toBe(userId);
      expect(after?.completed_at).toBeNull();

      expect(await erase()).toBe(true);
    });
  });

  describe('the two arriving together', () => {
    /**
     * A REQUEST WHOSE GRACE PERIOD EXPIRES DURING THE TEST.
     *
     * This is the only way to make the two paths genuinely contend. Restore
     * and erase are complementary by construction — `canRestore` and
     * `isDueForErasure` are never both true — so at any FIXED instant one of
     * them declines before it ever reaches the lock, and a test that ran them
     * at a fixed instant would prove nothing about locking.
     *
     * The real interleaving is the one ADR-019 describes: the sweep selects
     * due rows OUTSIDE its transaction, and a restore that began while the
     * account was still restorable is in flight when it does. So the boundary
     * is placed a few hundred milliseconds ahead, and the two transactions
     * straddle it.
     */
    const seedExpiringIn = async (ms: number): Promise<void> => {
      await seedPendingDeletion(GRACE_DAYS);
      await admin.query('UPDATE deletion_requests SET scheduled_erasure_at = $2 WHERE id = $1', [
        requestId,
        new Date(Date.now() + ms),
      ]);
    };

    it('A RESTORE STILL IN FLIGHT WHEN THE GRACE EXPIRES DECLINES RATHER THAN RACES', async () => {
      // THE ASYMMETRY IS DELIBERATE, and this test exists to pin it down.
      //
      // The sweep can only contend for the row AFTER the boundary, because
      // that is when its due-query first matches. A restore can only succeed
      // BEFORE it. So a restore that takes the lock at day 29 and is still
      // holding it when day 30 arrives cannot win: it re-reads the deadline
      // after the lock, exactly as `canRestore` does with `clock.now()`, and
      // finds it has passed.
      //
      // Losing is the correct direction. The alternative — trusting the
      // deadline read before the lock — would restore an account onto content
      // the sweep is about to anonymise, and nothing puts that back. A user
      // who taps Restore in the last second of day 29 and is refused can log
      // in again; a user restored onto erased content cannot.
      await seedExpiringIn(400);

      const restoring = restore({ pauseMs: 900 });
      await new Promise((r) => setTimeout(r, 500));
      const erasing = erase();

      const [restored, erased] = await Promise.all([restoring, erasing]);

      expect(restored).toBe(false);

      // AND THE ACCOUNT IS NOT STRANDED. Whether the sweep that ran alongside
      // it got there or was blocked out, the request is still open and due, so
      // the next sweep completes it. Nothing is left needing a human.
      if (!erased) {
        expect(await erase()).toBe(true);
      }

      const state = await current();
      expect(state?.state).toBe('DELETED');
      expect(state?.restored_at).toBeNull();
      expect(state?.author_id).toBe(ANONYMOUS_ACTOR_ID);
    });

    it('THE SWEEP COMMITS FIRST AND THE RESTORE FINDS NOTHING LEFT TO RESTORE', async () => {
      // The order with no recovery: if this restore succeeded it would hand
      // somebody back an account whose posts, profile and messages had already
      // been anonymised. The restore blocks on the sweep's lock, and when it is
      // granted the open request is gone.
      await seedPendingDeletion(31);

      const erasing = erase({ pauseMs: 600 });
      await new Promise((r) => setTimeout(r, 100));
      const restoring = restore();

      const [erased, restored] = await Promise.all([erasing, restoring]);

      expect(erased).toBe(true);
      expect(restored).toBe(false);

      const state = await current();
      expect(state?.state).toBe('DELETED');
      expect(state?.restored_at).toBeNull();
      expect(state?.author_id).toBe(ANONYMOUS_ACTOR_ID);
    });

    it('TWO SWEEPS ON THE SAME ROW ERASE IT ONCE (the job is idempotent under concurrency)', async () => {
      // Two workers, or one worker whose previous run overlapped this one.
      // Without the lock both would read an open request and both would run
      // every anonymiser — harmless for a repointed author, NOT harmless for
      // any contributor that deletes counted rows.
      await seedPendingDeletion(31);

      const results = await Promise.all([erase({ pauseMs: 250 }), erase({ pauseMs: 250 })]);

      expect(results.filter(Boolean)).toHaveLength(1);
      expect((await current())?.state).toBe('DELETED');
    });

    it('TWO RESTORES FROM A DOUBLE TAP RESTORE ONCE', async () => {
      await seedPendingDeletion(29);

      const results = await Promise.all([restore({ pauseMs: 250 }), restore({ pauseMs: 250 })]);

      expect(results.filter(Boolean)).toHaveLength(1);

      const state = await current();
      expect(state?.state).toBe('ACTIVE');
      expect(state?.completed_at).toBeNull();
      expect(state?.author_id).toBe(userId);
    });

    it('NEVER BOTH — the account is never restored onto content already anonymised', async () => {
      // Launched together across the boundary with the ordering left to the
      // scheduler. This is the invariant the whole design exists to hold: the
      // two outcomes are mutually exclusive, and the losing side leaves no
      // half-finished state behind.
      await seedExpiringIn(150);

      const [restored, erased] = await Promise.all([
        restore({ pauseMs: 300 }),
        (async () => {
          await new Promise((r) => setTimeout(r, 200));
          return erase({ pauseMs: 300 });
        })(),
      ]);

      expect(restored && erased).toBe(false);

      const state = await current();
      if (restored === true) {
        expect(state?.state).toBe('ACTIVE');
        expect(state?.completed_at).toBeNull();
        expect(state?.author_id).toBe(userId);
      } else if (erased === true) {
        expect(state?.state).toBe('DELETED');
        expect(state?.restored_at).toBeNull();
        expect(state?.author_id).toBe(ANONYMOUS_ACTOR_ID);
      } else {
        // Neither: the restore was too late and the sweep was locked out. The
        // request is still open and due, so it is the next sweep's, and the
        // content is untouched in the meantime.
        expect(state?.state).toBe('PENDING_DELETION');
        expect(state?.author_id).toBe(userId);
        expect(await erase()).toBe(true);
      }
    });

    it('THE DATABASE REFUSES BOTH OUTCOMES ON ONE ROW EVEN IF THE CODE ASKED', async () => {
      // `deletion_requests_one_outcome`. The application guards this three
      // ways already, and the constraint is there for the day a fourth caller
      // is written by somebody who read none of them.
      await seedPendingDeletion(29);
      await restore();

      await expect(
        admin.query('UPDATE deletion_requests SET completed_at = now() WHERE id = $1', [requestId]),
      ).rejects.toThrow(/one_outcome/);
    });

    it('allows only ONE open request per account, whatever the caller does', async () => {
      // `deletion_requests_one_open_per_user`. Two open requests would give the
      // sweep two due rows for one account and the restore an ambiguous lock.
      await seedPendingDeletion(29);

      await expect(
        admin.query(
          `INSERT INTO deletion_requests (id, user_id, requested_at, scheduled_erasure_at)
           VALUES ($1, $2, now(), now() + interval '30 days')`,
          [randomUUID(), userId],
        ),
      ).rejects.toThrow(/one_open_per_user/);

      // And once the first is closed, a second is permitted: somebody may
      // delete, restore, and later delete again.
      await restore();
      await admin.query(
        `INSERT INTO deletion_requests (id, user_id, requested_at, scheduled_erasure_at)
         VALUES ($1, $2, now(), now() + interval '30 days')`,
        [randomUUID(), userId],
      );
    });
  });
});
