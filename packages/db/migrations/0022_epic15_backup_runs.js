/**
 * 0022 — EPIC-15 · the backup ledger.
 *
 * SEC-026 · REL-007 · NFR-OBS-003 · §15.4 · §15.5.
 *
 * SEC-026: "Automated backups run at least daily, are stored separately from
 * the primary system, and a restore is tested before launch. AN UNTESTED BACKUP
 * IS NOT A BACKUP."
 *
 * §15.4 lists "backup status" among the things monitored and "backup failure"
 * among the things that page. NEITHER IS POSSIBLE WITHOUT A RECORD, and until
 * this table there was none: the backup script wrote a file and printed a path.
 * A file on a disk is not a status — nothing can ask it whether last night's
 * run happened, and the failure mode of a backup is silence. Nobody notices
 * backups stopped until the day they need one, which is the day it matters
 * most and the day it is too late to find out.
 *
 * WHY THE LEDGER LIVES IN THE DATABASE IT DESCRIBES, WHICH LOOKS WRONG.
 *
 * It is a fair objection: if the database is gone, so is the record of the
 * backups that could restore it. But this table is not the backup and does not
 * need to survive the disaster — it exists to answer "is the backup job still
 * running?" WHILE EVERYTHING IS FINE, which is the only time that question can
 * still be acted on. The dumps themselves are stored separately, as SEC-026
 * requires; this records that they were made. Putting the ledger somewhere else
 * would add a second store to operate, for a two-person team (§15.5), to
 * protect a record whose whole value is in the healthy case.
 *
 * REHEARSALS ARE ROWS TOO, and that is the point of `kind`. REL-007 gates
 * release on "a restore performed into a clean environment before launch", and
 * §15.5 requires it "rehearsed before launch, then quarterly". A rehearsal that
 * leaves no trace cannot gate anything — somebody would have to remember. With
 * this, the question "has a restore ever been proven?" has an answer that is a
 * query rather than a recollection.
 *
 * NOTHING HERE IS PERSONAL DATA. Row counts, byte totals, timings and an error
 * message. That is deliberate: this table is read by an unauthenticated-ish
 * operational surface, and anything sensitive in it would be a new disclosure
 * path for the sake of a status page.
 */

exports.shorthands = undefined;

exports.up = async (pgm) => {
  pgm.sql(`
    CREATE TYPE backup_run_kind AS ENUM ('BACKUP', 'RESTORE_REHEARSAL');
    CREATE TYPE backup_run_status AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED');
  `);

  pgm.createTable('backup_runs', {
    id: { type: 'uuid', primaryKey: true },

    kind: { type: 'backup_run_kind', notNull: true },

    /**
     * A run is inserted as RUNNING and updated on completion.
     *
     * Written FIRST, before the work, so that a process killed mid-dump leaves
     * a RUNNING row rather than nothing. An interrupted backup that leaves no
     * trace is indistinguishable from one that never started, and those need
     * different responses.
     */
    status: { type: 'backup_run_status', notNull: true, default: 'RUNNING' },

    started_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    finished_at: { type: 'timestamptz', notNull: false },

    /** Dump size. The input to a "backup suddenly got small" question. */
    size_bytes: { type: 'bigint', notNull: false },

    /**
     * Row counts per table at the time of the run, as JSON.
     *
     * §15.5's restore procedure is explicit: "verify row counts INCLUDING
     * audit_log". Recording them at BACKUP time is what makes that verifiable
     * at RESTORE time — otherwise a rehearsal can only prove that pg_restore
     * exited zero, which is not the same as the data being intact.
     */
    row_counts: { type: 'jsonb', notNull: false },

    /**
     * Where it went. A path or a bucket key, never a credential.
     *
     * SEC-026 requires backups "stored separately from the primary system", so
     * this is the field that lets somebody check that claim rather than assume
     * it.
     */
    destination: { type: 'text', notNull: false },

    /** Failure detail, for the operator. Truncated by the writer, never a secret. */
    detail: { type: 'text', notNull: false },
  });

  pgm.sql(`
    ALTER TABLE backup_runs ADD CONSTRAINT backup_runs_finished_when_settled
      CHECK ((status = 'RUNNING') = (finished_at IS NULL));

    ALTER TABLE backup_runs ADD CONSTRAINT backup_runs_finish_is_forward
      CHECK (finished_at IS NULL OR finished_at >= started_at);
  `);

  // The only question this table is asked in anger: "when did a run of this
  // kind last SUCCEED?" Partial, because failed and running rows are never the
  // answer to it and would only make the index bigger.
  pgm.sql(`
    CREATE INDEX backup_runs_last_success
      ON backup_runs (kind, finished_at DESC)
      WHERE status = 'SUCCEEDED';
  `);

  /**
   * READ-ONLY FOR THE APPLICATION, and that is the point.
   *
   * The metrics endpoint reads this table to report backup status, so
   * runtime_app needs SELECT. It needs nothing else, and must not have it: an
   * application that could INSERT here could report a backup that never
   * happened, which would turn the one control against silent backup failure
   * into a source of false assurance.
   *
   * The writers are the backup and rehearsal scripts, which connect as an
   * owner (ADMIN_DATABASE_URL / MIGRATION_DATABASE_URL) precisely because they
   * are operator tools rather than application code.
   */
  pgm.sql(`
    GRANT SELECT ON backup_runs TO runtime_app, runtime_worker;
  `);

  pgm.sql(`
    COMMENT ON TABLE backup_runs IS
      'Ledger of backup and restore-rehearsal runs (SEC-026, REL-007). Contains no personal data: counts, sizes, timings and error text only. The dumps themselves are stored separately; this records that they were made, so that a backup job which stops is noticed while it can still be fixed.';
  `);
};

exports.down = async (pgm) => {
  pgm.dropTable('backup_runs');
  pgm.sql(`
    DROP TYPE IF EXISTS backup_run_status;
    DROP TYPE IF EXISTS backup_run_kind;
  `);
};
