/**
 * 0006 — EPIC-02 · login attempt history, for the failure lockout.
 *
 * `08-api-architecture.md` §281 — login: 10 failures per 15 minutes, then a
 * 30-minute lockout (SEC-007) — and §274: limits apply **per account AND per
 * source address**.
 *
 * WHY BOTH KEYS. An account-only lockout is itself an attack: anyone who knows
 * a number can fail ten logins against it and lock its owner out for half an
 * hour, repeatedly. A source-only lockout is the opposite hole — one machine
 * can spray one guess each across thousands of accounts and never trip it.
 * Neither key is sufficient alone, which is why the spec names both.
 *
 * WHAT IS STORED. Hashes, never the identifier and never the raw IP address.
 * An attempt row is written for people who are NOT users — a mistyped number,
 * an attacker's list — so this table would otherwise become a log of phone
 * numbers belonging to non-members, which is precisely the data the platform
 * has no business holding (PRIV-010, SEC-002). The peppered hash still answers
 * "how many failures for this subject" without being reversible.
 *
 * Note the deliberate absence of a foreign key to `users`: an attempt against
 * an unknown number must be recorded exactly like one against a real account,
 * or the table's own shape would reveal which numbers exist.
 */

exports.shorthands = undefined;

exports.up = async (pgm) => {
  pgm.sql(`CREATE TYPE login_subject_kind AS ENUM ('USER', 'ADMIN');`);

  pgm.createTable('login_attempts', {
    id: { type: 'uuid', primaryKey: true },
    // USER and ADMIN credentials live in separate stores (SEC-020) and have
    // different thresholds, so their attempt histories must not mix.
    subject_kind: { type: 'login_subject_kind', notNull: true },
    subject_hash: { type: 'bytea', notNull: true },
    source_hash: { type: 'bytea', notNull: false },
    succeeded: { type: 'boolean', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.sql(`
    COMMENT ON TABLE login_attempts IS
      'SEC-007: failure history for the login lockout. Hashed subjects only - rows exist for non-users too.';
    COMMENT ON COLUMN login_attempts.subject_hash IS
      'Peppered hash of the identifier. Never the number or email itself (SEC-002, PRIV-010).';
    COMMENT ON COLUMN login_attempts.source_hash IS
      'Peppered hash of the source address. NULL when the transport did not supply one.';

    -- Both lockout questions are "recent attempts for this key", newest first.
    -- Partial on failures: a success is written for the audit trail but the
    -- lockout only ever counts failures, and most rows in a healthy system are
    -- successes.
    CREATE INDEX login_attempts_recent_by_subject
      ON login_attempts (subject_kind, subject_hash, created_at DESC);

    CREATE INDEX login_attempts_recent_failures_by_source
      ON login_attempts (subject_kind, source_hash, created_at DESC)
      WHERE NOT succeeded;
  `);

  // TODO(EPIC-15): scheduled pruning. Nothing older than the longest lockout
  // window affects any decision, so this table is pure growth after that point.
};

exports.down = async (pgm) => {
  pgm.dropTable('login_attempts');
  pgm.sql(`DROP TYPE IF EXISTS login_subject_kind;`);
};
