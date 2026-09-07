import { spawnSync } from 'node:child_process';
import { mkdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';

/**
 * Logical backup via pg_dump, RECORDED IN THE LEDGER (SEC-026 · §15.4).
 *
 * Writes a custom-format dump (-Fc), which is compressed and can be restored
 * selectively with pg_restore. Uses ADMIN_DATABASE_URL or MIGRATION_DATABASE_URL
 * - a backup must see every object, so it runs as an owner, never as runtime_app.
 *
 * This is the LOCAL / rehearsal path. In production the managed provider's
 * automated backups are authoritative (ADR-016); this script exists so the
 * restore procedure can be REHEARSED, which an un-rehearsed provider backup
 * never is.
 *
 * WHAT CHANGED IN EPIC-15: every run writes a row to `backup_runs`, BEFORE the
 * dump starts and again when it settles. §15.4 monitors "backup status" and
 * pages on "backup failure", and neither is possible against a file on a disk -
 * nothing can ask a file whether last night's run happened. The failure mode of
 * a backup is silence, and silence is what this ledger converts into a number
 * the metrics endpoint can report.
 *
 * The RUNNING row is written first on purpose: a process killed mid-dump then
 * leaves evidence it started, which is a different fact from never having run
 * and needs a different response.
 */
const url = process.env.ADMIN_DATABASE_URL ?? process.env.MIGRATION_DATABASE_URL;
if (!url) {
  console.error('FAIL: ADMIN_DATABASE_URL or MIGRATION_DATABASE_URL must be set');
  process.exit(2);
}

/**
 * Where the PostgreSQL client tools are.
 *
 * `pg_dump` and `pg_restore` are usually on PATH, and usually that is right.
 * They are overridable because a MANAGED PROVIDER'S SERVER IS OFTEN NEWER THAN
 * THE HOST'S CLIENT, and pg_dump refuses outright to dump a server newer than
 * itself - which turns "install postgresql-client" into "install exactly the
 * right one", and on a machine with several installed, into naming the path.
 *
 * A full path to an executable, never a command line: this is passed straight
 * to `spawnSync` WITHOUT A SHELL, so the connection URL - which contains a
 * password - is never parsed by one.
 */
const PG_DUMP = process.env.PG_DUMP_BIN ?? 'pg_dump';

const outDir = process.env.BACKUP_DIR ?? resolve(process.cwd(), '.backups');
mkdirSync(outDir, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outFile = resolve(outDir, `mohalla-${stamp}.dump`);

/**
 * Tables whose counts are recorded with the dump.
 *
 * §15.5's restore procedure says to "verify row counts INCLUDING `audit_log`",
 * and a rehearsal can only verify counts it has something to compare against.
 * Recorded at BACKUP time so the comparison at RESTORE time is against what was
 * actually in the source, not against whatever the source holds later.
 *
 * `audit_log` is listed first because it is the one §15.5 singles out: it is
 * append-only (BR-039) and survives the people it describes (ADR-018), so a
 * restore that quietly lost rows from it would lose the only record of what
 * administrators did.
 */
const COUNTED_TABLES = [
  'audit_log',
  'users',
  'profiles',
  'posts',
  'comments',
  'events',
  'conversations',
  'messages',
  'reports',
  'moderation_cases',
  'deletion_requests',
];

async function counts(client) {
  const out = {};
  for (const table of COUNTED_TABLES) {
    try {
      const r = await client.query(`SELECT count(*)::text AS n FROM ${table}`);
      out[table] = Number(r.rows[0].n);
    } catch {
      // A table that does not exist yet is recorded as absent rather than
      // zero. A restore comparing against a zero it invented would pass while
      // having lost everything in that table.
      out[table] = null;
    }
  }
  return out;
}

const runId = randomUUID();
const ledger = new Client({ connectionString: url });

async function main() {
  await ledger.connect();

  const rowCounts = await counts(ledger);

  await ledger.query(
    `INSERT INTO backup_runs (id, kind, status, row_counts, destination)
     VALUES ($1, 'BACKUP', 'RUNNING', $2, $3)`,
    [runId, JSON.stringify(rowCounts), outFile],
  );

  const r = spawnSync(PG_DUMP, ['--format=custom', '--no-owner', '--file', outFile, url], {
    stdio: 'inherit',
  });

  if (r.error) {
    await settle('FAILED', null, `pg_dump could not run - ${r.error.message}`);
    console.error(`BLOCKED: pg_dump could not run - ${r.error.message}`);
    console.error(
      'pg_dump ships with the PostgreSQL client tools and must be on PATH, or named by ' +
        'PG_DUMP_BIN.',
    );
    // EXIT 3 = TOOLING ABSENT, NOTHING PROVEN - distinct from 1, which means
    // the backup was attempted and failed. A verify lane can render this as
    // BLOCKED, which is the honest answer: nothing was backed up, and nothing
    // about the backup was disproved either. Collapsing the two would make a
    // developer machine without postgresql-client look like a broken backup.
    return 3;
  }
  if (r.status !== 0) {
    await settle('FAILED', null, `pg_dump exited ${r.status}`);
    return r.status ?? 1;
  }

  const size = statSync(outFile).size;
  await settle('SUCCEEDED', size, null);

  // SEC-027 requires backups to be ENCRYPTED AT REST. pg_dump does not encrypt,
  // and this script does not pretend to: it says so, every time, so that the
  // gap is visible to whoever wires up the deployed path rather than assumed
  // to be handled. In a deployed environment the destination must provide it.
  console.error(
    "NOTE (SEC-027): this dump is NOT encrypted. Encryption at rest is the destination's " +
      'responsibility and must be configured before any deployed use.',
  );

  console.log(outFile);
  return 0;
}

async function settle(status, sizeBytes, detail) {
  await ledger.query(
    `UPDATE backup_runs
        SET status = $2, finished_at = now(), size_bytes = $3, detail = $4
      WHERE id = $1`,
    [runId, status, sizeBytes, detail === null ? null : detail.slice(0, 2000)],
  );
}

main()
  .then(async (code) => {
    await ledger.end();
    process.exit(code);
  })
  .catch(async (e) => {
    // The ledger write itself failed, or the connection did. Say so loudly:
    // a backup whose status could not be recorded is a backup nobody will
    // notice the absence of.
    console.error(`FAIL: ${e instanceof Error ? e.message : String(e)}`);
    await ledger.end().catch(() => undefined);
    process.exit(1);
  });
