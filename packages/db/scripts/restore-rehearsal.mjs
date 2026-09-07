import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';

/**
 * THE RESTORE REHEARSAL — REL-007's gate, run end to end (SEC-026 · §15.5).
 *
 * SEC-026 states the reason in six words: "AN UNTESTED BACKUP IS NOT A BACKUP."
 * REL-007 turns it into a release condition: "GIVEN a production backup WHEN a
 * restore is performed into a clean environment before launch THEN it completes
 * successfully and THE DATA IS INTACT."
 *
 * THE SECOND HALF IS THE HARD PART, and it is why this script exists rather
 * than a line in a runbook saying "run pg_restore". `pg_restore` exiting zero
 * proves a file was readable. It does not prove the data arrived. A dump
 * truncated at 90%, a table that failed to copy, an `audit_log` that came back
 * empty - all of those restore "successfully".
 *
 * So this follows §15.5's procedure literally:
 *
 *   provision clean database → restore latest → VERIFY ROW COUNTS INCLUDING
 *   `audit_log` → point staging at it → run smoke tests → confirm
 *
 * and implements the first three, which are the ones a script can do. Pointing
 * staging at the restored copy and running the smoke suite against it is a
 * human step, because it involves a deployment; this prints the connection
 * string for it and records the outcome either way.
 *
 * THE COUNTS COME FROM THE LEDGER, NOT FROM THE LIVE DATABASE. `backup.mjs`
 * records what was in each table when the dump was taken. Comparing the restore
 * against the SOURCE AS IT IS NOW would fail every time somebody posts between
 * the backup and the rehearsal - and, worse, would pass if both were empty.
 *
 * IT REFUSES TO TOUCH THE PRIMARY. The target is passed explicitly and checked
 * against every URL that could be the live system. Restoring over production
 * while rehearsing for a disaster would be a memorable way to cause one.
 *
 * Usage:
 *   RESTORE_TARGET_URL=postgres://.../mohalla_rehearsal \
 *   ADMIN_DATABASE_URL=postgres://.../mohalla \
 *   node scripts/restore-rehearsal.mjs [dumpfile]
 *
 * With no dumpfile, the most recent SUCCEEDED backup in the ledger is used —
 * which is the case that matters, because "the latest backup" is what a real
 * recovery would reach for.
 */

const source = process.env.ADMIN_DATABASE_URL ?? process.env.MIGRATION_DATABASE_URL;
const target = process.env.RESTORE_TARGET_URL;

if (!source || !target) {
  console.error(
    'FAIL: ADMIN_DATABASE_URL (or MIGRATION_DATABASE_URL) and RESTORE_TARGET_URL must be set',
  );
  process.exit(2);
}

// Every way the target could be the live system. Compared before anything is
// opened, so a mistake costs a message rather than a database.
for (const [name, value] of [
  ['ADMIN_DATABASE_URL', process.env.ADMIN_DATABASE_URL],
  ['MIGRATION_DATABASE_URL', process.env.MIGRATION_DATABASE_URL],
  ['DATABASE_URL', process.env.DATABASE_URL],
  ['RUNTIME_APP_DATABASE_URL', process.env.RUNTIME_APP_DATABASE_URL],
]) {
  if (value !== undefined && value === target) {
    console.error(
      `FAIL: RESTORE_TARGET_URL equals ${name}. Refusing to restore over a live database.`,
    );
    process.exit(2);
  }
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
const PG_RESTORE = process.env.PG_RESTORE_BIN ?? 'pg_restore';

const results = [];
let failures = 0;

function check(label, ok, detail) {
  results.push({ label, ok });
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail === undefined ? '' : ` — ${detail}`}`);
}

/**
 * Run a client tool, and RETURN rather than exit when it cannot be run.
 *
 * An earlier version called `process.exit` here. That left the RUNNING row this
 * script had already written stranded forever - which is precisely the
 * ambiguity the ledger exists to remove: "did the rehearsal fail, or did it
 * never happen?" A missing binary is a FAILED rehearsal with a reason, and it
 * has to be recorded like any other.
 */
function tool(name, args) {
  const r = spawnSync(name, args, { stdio: 'inherit' });
  if (r.error) {
    return {
      status: null,
      detail:
        `${name} could not run - ${r.error.message}. It ships with the PostgreSQL client ` +
        `tools and must be on PATH, or named by PG_RESTORE_BIN.`,
    };
  }
  return { status: r.status ?? 0, detail: null };
}

const runId = randomUUID();

async function main() {
  const ledger = new Client({ connectionString: source });
  await ledger.connect();

  // ---- which dump ------------------------------------------------------
  let dump = process.argv[2];
  let recordedCounts = null;

  const latest = await ledger.query(
    `SELECT destination, row_counts, finished_at
       FROM backup_runs
      WHERE kind = 'BACKUP' AND status = 'SUCCEEDED'
      ORDER BY finished_at DESC
      LIMIT 1`,
  );

  if (dump === undefined) {
    if (latest.rows.length === 0) {
      // NOTHING TO REHEARSE AGAINST. Exit 3 rather than 2, for the same reason
      // a missing pg_restore does: the rehearsal has neither passed nor found a
      // problem. The usual cause is that the backup step could not run either,
      // and reporting the consequence as a failure would put a second red lane
      // next to the one that explains it.
      console.error('BLOCKED: no successful backup recorded. Run `npm run db:backup` first.');
      await ledger.end();
      process.exit(3);
    }
    dump = latest.rows[0].destination;
    recordedCounts = latest.rows[0].row_counts;
  } else {
    const match = await ledger.query(
      `SELECT row_counts FROM backup_runs
        WHERE destination = $1 AND status = 'SUCCEEDED'
        ORDER BY finished_at DESC LIMIT 1`,
      [dump],
    );
    recordedCounts = match.rows[0]?.row_counts ?? null;
  }

  console.log(`\n--- restore rehearsal (REL-007) ---`);
  console.log(`  dump:   ${dump}`);
  console.log(`  target: ${redactUrl(target)}\n`);

  await ledger.query(
    `INSERT INTO backup_runs (id, kind, status, row_counts, destination)
     VALUES ($1, 'RESTORE_REHEARSAL', 'RUNNING', $2, $3)`,
    [runId, recordedCounts === null ? null : JSON.stringify(recordedCounts), dump],
  );

  // ---- restore into the clean target -----------------------------------
  //
  // `--clean --if-exists` so a target reused between rehearsals starts empty.
  // pg_restore exits non-zero on benign warnings, so its status is reported
  // rather than trusted: the row counts below are what actually decide.
  const restore = tool(PG_RESTORE, [
    '--clean',
    '--if-exists',
    '--no-owner',
    '--dbname',
    target,
    dump,
  ]);
  check('pg_restore completed', restore.status === 0, restore.detail ?? `exit ${restore.status}`);

  if (restore.status === null) {
    // Nothing was restored, so there is nothing to verify. Settle the ledger
    // row and stop rather than reporting count failures that describe the
    // missing tool instead of the backup.
    await settle(ledger, 'FAILED', restore.detail);
    await ledger.end();
    console.log('\nRESTORE REHEARSAL: COULD NOT RUN - REL-007 IS NOT SATISFIED');
    // EXIT 3 = TOOLING ABSENT, NOTHING PROVEN. Not 1: a rehearsal that could
    // not start has neither passed nor found a problem with the backup, and a
    // gate that reported those the same way would train people to ignore it.
    return 3;
  }

  // ---- verify the data is INTACT ---------------------------------------
  const restored = new Client({ connectionString: target });
  await restored.connect();

  if (recordedCounts === null) {
    check(
      'row counts were recorded with the dump',
      false,
      'no ledger entry for this dump - the restore cannot be verified, only attempted',
    );
  } else {
    for (const [table, expected] of Object.entries(recordedCounts)) {
      if (expected === null) continue;

      let actual = null;
      try {
        const r = await restored.query(`SELECT count(*)::text AS n FROM ${table}`);
        actual = Number(r.rows[0].n);
      } catch (e) {
        check(`${table} exists in the restored copy`, false, e.message.split('\n')[0]);
        continue;
      }

      // EXACT, not "at least". A restored copy with MORE rows than the dump is
      // as wrong as one with fewer: it means the target was not clean, and the
      // rehearsal proved nothing about the dump.
      check(
        `${table}: ${actual} rows restored`,
        actual === expected,
        actual === expected ? undefined : `expected ${expected}`,
      );
    }

    // §15.5 singles this one out, so it is asserted separately rather than
    // relying on it having been in the loop: the audit log is append-only
    // (BR-039) and outlives the people it describes (ADR-018), so losing rows
    // from it loses the only record of what administrators did.
    check(
      'AUDIT LOG WAS PRESENT IN THE VERIFICATION (§15.5)',
      Object.prototype.hasOwnProperty.call(recordedCounts, 'audit_log') &&
        recordedCounts.audit_log !== null,
    );
  }

  // The append-only trigger is part of the schema, not of the data, and a dump
  // that restored rows without it would leave the audit log mutable - intact
  // today and unprotected tomorrow.
  const trigger = await restored.query(
    `SELECT count(*)::text AS n FROM pg_trigger
      WHERE tgrelid = 'audit_log'::regclass AND NOT tgisinternal`,
  );
  check(
    'the audit log is still append-only after the restore (BR-039)',
    Number(trigger.rows[0].n) > 0,
    `${trigger.rows[0].n} triggers`,
  );

  const migrations = await restored.query('SELECT count(*)::text AS n FROM pgmigrations');
  check(
    'migration history restored',
    Number(migrations.rows[0].n) > 0,
    `${migrations.rows[0].n} applied`,
  );

  await restored.end();

  // ---- record and report ------------------------------------------------
  await settle(
    ledger,
    failures === 0 ? 'SUCCEEDED' : 'FAILED',
    failures === 0 ? null : `${failures} check(s) failed`,
  );
  await ledger.end();

  console.log(`\n  ${results.length - failures} passed · ${failures} failed`);

  if (failures > 0) {
    console.log('\nRESTORE REHEARSAL: FAILED — REL-007 IS NOT SATISFIED');
    return 1;
  }

  // The remaining §15.5 steps are a human's: this proves the data arrived, not
  // that the application runs against it.
  console.log('\nRESTORE REHEARSAL: DATA VERIFIED');
  console.log('  REL-007 also requires the application to be exercised against the restored copy.');
  console.log('  Point staging at the target and run `npm run smoke:api` to complete the gate.');
  return 0;
}

async function settle(ledger, status, detail) {
  await ledger.query(
    `UPDATE backup_runs
        SET status = $2, finished_at = now(), detail = $3
      WHERE id = $1`,
    [runId, status, detail === null ? null : detail.slice(0, 2000)],
  );
}

/** Never print a password, not even in a rehearsal log. */
function redactUrl(url) {
  return url.replace(/\/\/([^:]+):[^@]*@/, '//$1:[REDACTED]@');
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error(`\nRESTORE REHEARSAL: ERRORED\n${e instanceof Error ? e.stack : String(e)}`);
    process.exit(2);
  });
