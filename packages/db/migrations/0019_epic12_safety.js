/**
 * 0019 — EPIC-12 · reports, moderation cases, enforcement actions.
 *
 * `07-database-design.md` §2.8 · `13-moderation-audit.md`.
 *
 * BR-032 IS THE SENTENCE THIS WHOLE EPIC IS BUILT AROUND: "nothing is ever
 * deleted automatically. A human always makes the permanent decision." The SRS
 * says why, and RSK-010 says it again — coordinated reporting used to silence
 * legitimate civic criticism is a MEDIUM-likelihood, HIGH-impact risk on a
 * platform whose purpose is civic criticism. Auto-hide is reversible; deletion
 * is not; so the automatic step is the reversible one.
 *
 * FOUR STRUCTURAL DECISIONS.
 *
 * 1. `UNIQUE (reporter_id, target_type, target_id)` — BR-030 and EDGE-023 in
 *    one constraint. A second report from the same account is `ON CONFLICT DO
 *    NOTHING`, which returns the same acknowledgement without moving the count.
 *    SAFETY-FR-001 is explicit that this is so "the reporter cannot infer the
 *    current tally" — a reporter who could watch the number climb could also
 *    tell when one more account would tip it.
 *
 * 2. THRESHOLDS DIFFER BY TYPE, and two of them are "never". Posts and comments
 *    hide at 3; events at 2 (BR-044 — a fake gathering wastes real travel);
 *    PROFILES AND DIRECT MESSAGES NEVER HIDE. SAFETY-FR-002 gives the reason
 *    for profiles: "hiding a whole person on report count would be trivially
 *    weaponised". For messages a threshold is meaningless — they are private
 *    between two people, so a count of two is the maximum possible.
 *
 * 3. `resolution_reason` IS A CHECK CONSTRAINT, not a validator. BR-038 makes a
 *    reason mandatory on every moderation action, and the audit trail is only
 *    worth having if it cannot contain a blank.
 *
 * 4. `enforcement_actions.target_user_id` REFERENCES `users` AND NOTHING ELSE.
 *    BR-ADM-001 and SEC-021 forbid any action against an administrator, and the
 *    absence of a foreign key to `admins` is what makes that structural rather
 *    than a check somebody could remove.
 */

exports.shorthands = undefined;

exports.up = async (pgm) => {
  pgm.sql(`
    -- SAFETY-FR-003: exactly eight, and the reporter picks one. All eight need
    -- Urdu translations (OD-016) - the enum is the machine-readable half and
    -- the localization catalogue carries the words.
    CREATE TYPE report_reason AS ENUM (
      'SPAM_OR_MISLEADING',
      'HARASSMENT_OR_BULLYING',
      'HATE_SPEECH',
      'VIOLENCE_OR_THREATS',
      'SEXUAL_OR_INAPPROPRIATE',
      'FALSE_INFORMATION',
      'IMPERSONATION',
      'SOMETHING_ELSE'
    );

    -- Severity ORDERS THE QUEUE (SAFETY-FR-003, ADMIN-FR-002). It is derived
    -- from the reason at insert rather than chosen by the reporter: letting a
    -- reporter set severity would make "Critical" the rational choice every
    -- time, and the ordering would stop meaning anything.
    CREATE TYPE report_severity AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

    CREATE TYPE report_target AS ENUM ('POST', 'COMMENT', 'EVENT', 'PROFILE', 'CONVERSATION');

    CREATE TYPE moderation_state AS ENUM (
      'OPEN',
      'RESOLVED_RESTORED',
      'RESOLVED_DELETED',
      'RESOLVED_NO_ACTION',
      'CLOSED_AUTHOR_DELETED'
    );

    CREATE TYPE enforcement_kind AS ENUM ('SUSPEND', 'BAN', 'REINSTATE', 'CONTENT_DELETED');
  `);

  // ---------------------------------------------------------------- reports
  pgm.createTable('reports', {
    id: { type: 'uuid', primaryKey: true },
    reporter_id: { type: 'uuid', notNull: true, references: 'users', onDelete: 'CASCADE' },
    target_type: { type: 'report_target', notNull: true },
    target_id: { type: 'uuid', notNull: true },
    /**
     * The account responsible for the reported thing.
     *
     * Denormalised from the target so BR-037's "three confirmed deletions of
     * ONE USER'S content in 30 days" is answerable without joining five tables
     * — and so a case survives the target row being deleted.
     */
    target_owner_id: { type: 'uuid', notNull: false, references: 'users', onDelete: 'SET NULL' },
    reason_code: { type: 'report_reason', notNull: true },
    severity: { type: 'report_severity', notNull: true },
    /** SAFETY-FR-001: "optionally adds a note of up to 500 characters". */
    note: { type: 'text', notNull: false },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.sql(`
    -- BR-030 AND EDGE-023, in one line. "Thresholds count distinct reporting
    -- accounts, never total reports."
    ALTER TABLE reports ADD CONSTRAINT reports_one_per_reporter_per_target
      UNIQUE (reporter_id, target_type, target_id);

    -- SAFETY-FR-001: "a user cannot report their own content". Checked in the
    -- application too, so the caller gets a reason - but structural here
    -- because a self-report inflating a count would be a way to hide your own
    -- content and then blame the platform.
    ALTER TABLE reports ADD CONSTRAINT reports_not_self
      CHECK (target_owner_id IS NULL OR target_owner_id <> reporter_id);

    ALTER TABLE reports ADD CONSTRAINT reports_note_length
      CHECK (note IS NULL OR char_length(note) <= 500);

    -- The distinct count, per target. The UNIQUE constraint above means a row
    -- count IS a distinct-reporter count.
    CREATE INDEX reports_by_target ON reports (target_type, target_id);

    -- SAFETY-FR-009: 20 reports per user per day, counted from this table.
    CREATE INDEX reports_by_reporter ON reports (reporter_id, created_at DESC);

    COMMENT ON TABLE reports IS
      'BR-030 / EDGE-023: one report per user per item, enforced by UNIQUE. A repeat report is ON CONFLICT DO NOTHING and returns the SAME acknowledgement - SAFETY-FR-001 requires that the reporter cannot infer the tally.';
  `);

  // ------------------------------------------------------- moderation cases
  pgm.createTable('moderation_cases', {
    id: { type: 'uuid', primaryKey: true },
    target_type: { type: 'report_target', notNull: true },
    target_id: { type: 'uuid', notNull: true },
    target_owner_id: { type: 'uuid', notNull: false, references: 'users', onDelete: 'SET NULL' },
    state: { type: 'moderation_state', notNull: true, default: 'OPEN' },
    /** Queue ordering, part one (ADMIN-FR-002). */
    max_severity: { type: 'report_severity', notNull: true },
    /** Queue ordering, part two. Maintained with the threshold check. */
    distinct_report_count: { type: 'integer', notNull: true, default: 0 },
    /** True once the threshold hid the content. Profiles and DMs never do. */
    auto_hidden: { type: 'boolean', notNull: true, default: false },
    resolution_reason: { type: 'text', notNull: false },
    resolved_by_admin_id: { type: 'uuid', notNull: false, references: 'admins' },
    resolved_at: { type: 'timestamptz', notNull: false },
    /** EDGE-024 optimistic lock. Two admins cannot both resolve one case. */
    version: { type: 'integer', notNull: true, default: 1 },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.sql(`
    -- ONE OPEN CASE PER TARGET. Without it, the third and fourth report on the
    -- same post would each open a case and the queue would show the same item
    -- twice - and two admins could resolve "it" differently.
    CREATE UNIQUE INDEX moderation_cases_one_open_per_target
      ON moderation_cases (target_type, target_id)
      WHERE state = 'OPEN';

    -- BR-038 ENFORCED BY THE DATABASE, exactly as §2.8 specifies. A resolved
    -- case without a reason is an audit trail with a hole in it.
    ALTER TABLE moderation_cases ADD CONSTRAINT moderation_cases_reason_required
      CHECK (state = 'OPEN' OR char_length(resolution_reason) >= 5);

    -- A resolved case names who resolved it and when. EDGE-024's 409 has to
    -- report "who resolved it and how", which it cannot do from a null.
    ALTER TABLE moderation_cases ADD CONSTRAINT moderation_cases_resolution_complete
      CHECK (
        state = 'OPEN'
        OR (resolved_at IS NOT NULL AND (resolved_by_admin_id IS NOT NULL OR state = 'CLOSED_AUTHOR_DELETED'))
      );

    ALTER TABLE moderation_cases ADD CONSTRAINT moderation_cases_count_non_negative
      CHECK (distinct_report_count >= 0);

    -- ADMIN-FR-002: "ordered by severity, then count, then age". The index
    -- carries all three so the queue is a range scan rather than a sort of
    -- every open case.
    CREATE INDEX moderation_cases_queue
      ON moderation_cases (max_severity DESC, distinct_report_count DESC, created_at ASC)
      WHERE state = 'OPEN';

    -- BR-037: three confirmed deletions of one user's content in 30 days.
    CREATE INDEX moderation_cases_by_owner
      ON moderation_cases (target_owner_id, resolved_at DESC)
      WHERE state = 'RESOLVED_DELETED';

    COMMENT ON COLUMN moderation_cases.version IS
      'EDGE-024 optimistic lock. A stale decision is refused with 409 naming who resolved it and how - rendered as information, not an error.';
  `);

  // ---------------------------------------------------- enforcement actions
  pgm.createTable('enforcement_actions', {
    id: { type: 'uuid', primaryKey: true },
    /**
     * `users` AND NEVER `admins`.
     *
     * BR-ADM-001 and SEC-021: there is no schema path by which an enforcement
     * action could target an administrator. The absence of that foreign key is
     * the control — a check constraint could be dropped by whoever adds the
     * route, a missing table reference cannot be worked around by accident.
     */
    target_user_id: { type: 'uuid', notNull: true, references: 'users', onDelete: 'CASCADE' },
    admin_id: { type: 'uuid', notNull: true, references: 'admins' },
    kind: { type: 'enforcement_kind', notNull: true },
    /** BR-038 again. Mandatory, and checked below. */
    reason: { type: 'text', notNull: true },
    /** Null for BAN and REINSTATE; set for a timed suspension (EDGE-027). */
    expires_at: { type: 'timestamptz', notNull: false },
    case_id: { type: 'uuid', notNull: false, references: 'moderation_cases' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.sql(`
    ALTER TABLE enforcement_actions ADD CONSTRAINT enforcement_actions_reason_length
      CHECK (char_length(reason) BETWEEN 5 AND 500);

    -- Only a suspension has an expiry. A ban with one would silently lift.
    ALTER TABLE enforcement_actions ADD CONSTRAINT enforcement_actions_expiry_matches_kind
      CHECK ((kind = 'SUSPEND') = (expires_at IS NOT NULL));

    -- A user's enforcement history, which ADMIN-FR-002 puts on the case view
    -- "so proportionality can be judged without navigating away".
    CREATE INDEX enforcement_actions_by_target
      ON enforcement_actions (target_user_id, created_at DESC);

    COMMENT ON TABLE enforcement_actions IS
      'BR-ADM-001 / SEC-021: target_user_id references users and there is no column that could reference admins. An action against an administrator has no schema path, not merely no route.';
  `);

  // ------------------------------------- the report counters on the content
  //
  // `posts`, `comments` and `events` already carry `distinct_report_count`.
  // Nothing maintained them until now - EPIC-06, 07 and 10 created the columns
  // and left the counting to the epic that owns the threshold, which is this
  // one. The count is moved in the SAME TRANSACTION as the report insert and
  // the visibility change (§13 "Atomicity"), by application code holding
  // SELECT ... FOR UPDATE on the target.
  //
  // NOT A TRIGGER, and that is deliberate. The threshold decision needs the
  // count AND the type AND the current visibility state together, and it must
  // hold a row lock across the read and the write. A trigger sees one row
  // changing and cannot take the lock before the read that informs it.
  pgm.sql(`
    COMMENT ON COLUMN posts.distinct_report_count IS
      'BR-030: DISTINCT reporting accounts, never total reports. Maintained by the safety module inside one transaction holding SELECT ... FOR UPDATE on this row (mandatory test C).';
    COMMENT ON COLUMN comments.distinct_report_count IS
      'BR-030, as posts. Threshold 3 (BR-032).';
    COMMENT ON COLUMN events.distinct_report_count IS
      'BR-030, as posts. Threshold TWO (BR-044) - a fake gathering wastes real travel and time.';
  `);

  // ------------------------------------------- EDGE-025: the author got there first
  //
  // "Content is deleted by its author before an administrator reviews it → the
  // queue entry closes automatically as resolved, with no action available."
  //
  // A trigger rather than application code, because the author's delete path
  // lives in another module and should not have to know that moderation
  // exists. `CLOSED_AUTHOR_DELETED` is a distinct state from
  // `RESOLVED_NO_ACTION`: the second says an admin looked and declined to act,
  // and recording an automatic close as a human decision would corrupt the one
  // record that exists to show who decided what.
  pgm.sql(`
    CREATE OR REPLACE FUNCTION moderation_close_on_author_delete()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $fn$
    BEGIN
      IF NEW.visibility_state = 'AUTHOR_DELETED' AND OLD.visibility_state <> 'AUTHOR_DELETED' THEN
        UPDATE moderation_cases
           SET state = 'CLOSED_AUTHOR_DELETED',
               resolution_reason = 'Content was deleted by its author before review.',
               resolved_at = now(),
               updated_at = now(),
               version = version + 1
         WHERE target_type = TG_ARGV[0]::report_target
           AND target_id = NEW.id
           AND state = 'OPEN';
      END IF;
      RETURN NULL;
    END
    $fn$;

    CREATE TRIGGER posts_close_moderation_case
      AFTER UPDATE ON posts
      FOR EACH ROW
      EXECUTE FUNCTION moderation_close_on_author_delete('POST');
  `);

  // Comments have no AUTHOR_DELETED state - their enum is
  // VISIBLE/AUTO_HIDDEN/DELETED - so the same rule needs its own function
  // rather than a shared one with a different constant.
  pgm.sql(`
    CREATE OR REPLACE FUNCTION moderation_close_on_comment_delete()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $fn$
    BEGIN
      IF NEW.visibility_state = 'DELETED' AND OLD.visibility_state <> 'DELETED' THEN
        UPDATE moderation_cases
           SET state = 'CLOSED_AUTHOR_DELETED',
               resolution_reason = 'Content was deleted by its author before review.',
               resolved_at = now(),
               updated_at = now(),
               version = version + 1
         WHERE target_type = 'COMMENT'
           AND target_id = NEW.id
           AND state = 'OPEN';
      END IF;
      RETURN NULL;
    END
    $fn$;

    CREATE TRIGGER comments_close_moderation_case
      AFTER UPDATE ON comments
      FOR EACH ROW
      EXECUTE FUNCTION moderation_close_on_comment_delete();

    -- An event is HARD-deleted while nobody has responded (EVENT-FR-007), so
    -- its case closes on DELETE rather than on a state change.
    CREATE OR REPLACE FUNCTION moderation_close_on_event_delete()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $fn$
    BEGIN
      UPDATE moderation_cases
         SET state = 'CLOSED_AUTHOR_DELETED',
             resolution_reason = 'Content was deleted by its author before review.',
             resolved_at = now(),
             updated_at = now(),
             version = version + 1
       WHERE target_type = 'EVENT'
         AND target_id = OLD.id
         AND state = 'OPEN';
      RETURN NULL;
    END
    $fn$;

    CREATE TRIGGER events_close_moderation_case
      AFTER DELETE ON events
      FOR EACH ROW
      EXECUTE FUNCTION moderation_close_on_event_delete();
  `);
};

exports.down = async (pgm) => {
  pgm.sql(`
    DROP TRIGGER IF EXISTS events_close_moderation_case ON events;
    DROP TRIGGER IF EXISTS comments_close_moderation_case ON comments;
    DROP TRIGGER IF EXISTS posts_close_moderation_case ON posts;
    DROP FUNCTION IF EXISTS moderation_close_on_event_delete();
    DROP FUNCTION IF EXISTS moderation_close_on_comment_delete();
    DROP FUNCTION IF EXISTS moderation_close_on_author_delete();
  `);
  pgm.dropTable('enforcement_actions');
  pgm.dropTable('moderation_cases');
  pgm.dropTable('reports');
  pgm.sql(`
    DROP TYPE IF EXISTS enforcement_kind;
    DROP TYPE IF EXISTS moderation_state;
    DROP TYPE IF EXISTS report_target;
    DROP TYPE IF EXISTS report_severity;
    DROP TYPE IF EXISTS report_reason;
  `);
};
