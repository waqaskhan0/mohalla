/**
 * 0021 — EPIC-14 · deletion requests, the anonymous actor, and reserved identifiers.
 *
 * ADR-019 · `07-database-design.md` §2.8 · BR-008/009/046 · PRIV-005/006/007.
 *
 * THIS IS THE ONLY EPIC WHOSE MISTAKES DESTROY DATA. Everything else in the
 * product hides, marks or reverses; day 30 erases. So the schema is built to
 * make the irreversible step hard to reach by accident and impossible to reach
 * twice.
 *
 * THREE THINGS THIS MIGRATION CREATES.
 *
 * 1. `deletion_requests` — the schedule, and the record. ADR-019 is explicit
 *    that a boolean flag "cannot express 'invisible but restorable', cannot
 *    drive the day-30 job, and cannot distinguish restorable from terminal".
 *    `scheduled_erasure_at` is what the job reads; `restored_at` and
 *    `completed_at` are mutually exclusive by CHECK, because an account cannot
 *    be both restored and erased and a row claiming both would mean the
 *    concurrency guard failed.
 *
 * 2. THE ANONYMOUS ACTOR — one permanent row in `users` that every erased
 *    person's content is repointed to. BR-009: posts and comments "are
 *    ANONYMIZED to 'Deleted User' — THEY ARE NOT ERASED", because deleting one
 *    person's side of a community discussion destroys everybody else's thread.
 *    PRIV-007 adds that anonymised content "carries NO LINK BACK to the deleted
 *    identity", which is why the content is REPOINTED rather than having its
 *    author id nulled: a null would still be a distinct absence per person, and
 *    two posts by the same deleted user would still be visibly by one author.
 *    One shared actor makes them genuinely unlinkable.
 *
 * 3. `reserved_identifiers` — ADR-019: at erasure "the identifier hash moves to
 *    a reserved list so it cannot be recycled while a ban or dispute could
 *    still apply." Distinct from `banned_identifiers`: a ban is an enforcement
 *    decision that a reinstatement can lift (ADMIN-FR-008), while a reservation
 *    is a consequence of erasure with nobody to appeal to. Merging them would
 *    make a reinstatement able to release a number belonging to an account that
 *    no longer exists.
 *
 * WHAT THIS MIGRATION DOES NOT DO: erase anything. The job does that, and it
 * has a dry-run mode, because ADR-019 says erasure "is irreversible, so the job
 * is heavily tested and runs dry-run in staging first".
 */

exports.shorthands = undefined;

/**
 * The single anonymous actor.
 *
 * A fixed UUID rather than a generated one, so every environment agrees and a
 * repair script can name it without a lookup. It is deliberately NOT a v7 —
 * the all-zeros-prefixed form is visibly synthetic to anyone reading a row.
 */
const ANONYMOUS_ACTOR_ID = '00000000-0000-4000-8000-000000000001';

exports.up = async (pgm) => {
  // -------------------------------------------------------- the anonymous actor
  //
  // Created here rather than by the application, because the erasure job must
  // never have to create it: a job that erases somebody and then discovers the
  // destination row is missing has already passed the point of no return.
  pgm.sql(`
    INSERT INTO users (
      id, state, account_type, password_hash, date_of_birth,
      terms_version, terms_accepted_at
    )
    VALUES (
      '${ANONYMOUS_ACTOR_ID}',
      'DELETED',
      'INDIVIDUAL',
      'no-password-this-account-cannot-be-logged-into',
      -- A plausible date, because users_dob_plausible and users_min_age_13
      -- apply to every row and this one is no exception. It describes nobody:
      -- there is no identifier row, no session and no person behind it. Using
      -- an impossible sentinel would have meant weakening a constraint that
      -- exists to catch typos in real registrations.
      '1970-01-01',
      'not-applicable',
      now()
    )
    ON CONFLICT (id) DO NOTHING;

    COMMENT ON TABLE users IS
      'Contains one synthetic row: the ANONYMOUS ACTOR (00000000-0000-4000-8000-000000000001), which erased users'' content is repointed to. It is in state DELETED, has no identifier row, and cannot be logged into. BR-009 keeps the content; PRIV-007 requires it to carry no link back, and ONE SHARED ACTOR is what makes two posts by the same erased person unlinkable - a per-person null would not.';
  `);

  // A profile for it, so every read path that joins `profiles` finds a display
  // name rather than a gap. "Deleted User" is the string BR-009 names; the
  // client renders it from a locale key, and this is the fallback for any
  // surface that reads the column directly.
  pgm.sql(`
    INSERT INTO profiles (user_id, username, display_name, created_at, updated_at)
    VALUES ('${ANONYMOUS_ACTOR_ID}', 'deleted_user', 'Deleted User', now(), now())
    ON CONFLICT (user_id) DO NOTHING;
  `);

  // ------------------------------------------------------- deletion_requests
  pgm.createTable('deletion_requests', {
    id: { type: 'uuid', primaryKey: true },
    user_id: { type: 'uuid', notNull: true, references: 'users', onDelete: 'CASCADE' },
    requested_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    /** requested_at + 30 days. The day-30 job reads exactly this column. */
    scheduled_erasure_at: { type: 'timestamptz', notNull: true },
    /** SET-FR-005 — set when the user logged in and restored within the grace. */
    restored_at: { type: 'timestamptz', notNull: false },
    /** Set when erasure finished. Terminal. */
    completed_at: { type: 'timestamptz', notNull: false },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.sql(`
    -- ONE OPEN REQUEST PER USER. A second delete while one is pending would
    -- create a second schedule, and the earlier one would erase an account the
    -- user thought they had 30 days to change their mind about.
    CREATE UNIQUE INDEX deletion_requests_one_open_per_user
      ON deletion_requests (user_id)
      WHERE restored_at IS NULL AND completed_at IS NULL;

    -- An account cannot be both restored and erased. A row claiming both means
    -- the concurrency guard ADR-019 describes has failed, and it should be
    -- impossible to write rather than merely surprising to read.
    ALTER TABLE deletion_requests ADD CONSTRAINT deletion_requests_one_outcome
      CHECK (restored_at IS NULL OR completed_at IS NULL);

    ALTER TABLE deletion_requests ADD CONSTRAINT deletion_requests_grace_is_forward
      CHECK (scheduled_erasure_at > requested_at);

    -- The day-30 sweep: everything due, oldest first. Partial, because a
    -- resolved request is never swept again.
    CREATE INDEX deletion_requests_due
      ON deletion_requests (scheduled_erasure_at)
      WHERE restored_at IS NULL AND completed_at IS NULL;

    COMMENT ON TABLE deletion_requests IS
      'ADR-019: an explicit state machine, not a boolean. A flag cannot express "invisible but restorable", cannot drive the day-30 job, and cannot distinguish restorable from terminal - EDGE-029 alone requires the distinction.';
  `);

  // ----------------------------------------------------- reserved_identifiers
  pgm.createTable('reserved_identifiers', {
    identifier_hash: { type: 'bytea', primaryKey: true },
    reserved_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    reason: { type: 'text', notNull: true, default: 'ACCOUNT_ERASED' },
  });

  pgm.sql(`
    COMMENT ON TABLE reserved_identifiers IS
      'ADR-019: at erasure the identifier hash moves here "so it cannot be recycled while a ban or dispute could still apply". DISTINCT from banned_identifiers - a ban is an enforcement decision a reinstatement can lift (ADMIN-FR-008), while a reservation is a consequence of erasure with nobody left to appeal to. Merging the two would let a reinstatement release a number belonging to an account that no longer exists.';
  `);

  // --------------------------------- EDGE-030: pending requests are withdrawn
  //
  // "User is deleted while they hold pending message requests → requests are
  // withdrawn from recipients' views. Existing accepted conversations remain
  // for the other participant."
  //
  // Withdrawal is a state change on the RECIPIENT's participant row rather than
  // a delete: BR-046 keeps the counterpart's copy of an accepted conversation,
  // and the same row shape has to serve both outcomes. A request the sender is
  // no longer around to continue simply stops being offered.
  pgm.sql(`
    ALTER TYPE message_request_state ADD VALUE IF NOT EXISTS 'WITHDRAWN';

    COMMENT ON COLUMN conversation_participants.request_state IS
      'MSG-FR-005, PER PARTICIPANT. The recipient can hold PENDING while the sender sees an ordinary thread - which is what makes a decline invisible to the sender (BR-028). WITHDRAWN is EDGE-030: the sender deleted their account, so the request is no longer offered, while an ACCEPTED conversation stays for the counterpart (BR-046).';
  `);
};

exports.down = async (pgm) => {
  // The enum value cannot be removed - PostgreSQL has no DROP VALUE - so the
  // down migration leaves it. That is honest rather than tidy: pretending to
  // reverse it would leave rows referencing a value the type no longer admits.
  pgm.dropTable('reserved_identifiers');
  pgm.dropTable('deletion_requests');
  pgm.sql(`
    DELETE FROM profiles WHERE user_id = '${ANONYMOUS_ACTOR_ID}';
    DELETE FROM users WHERE id = '${ANONYMOUS_ACTOR_ID}';
  `);
};

exports.ANONYMOUS_ACTOR_ID = ANONYMOUS_ACTOR_ID;
