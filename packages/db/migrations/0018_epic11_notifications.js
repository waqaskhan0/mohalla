/**
 * 0018 — EPIC-11 · the outbox, notification records, preferences and device tokens.
 *
 * `07-database-design.md` §2.7 · ADR-014.
 *
 * ADR-014's shape in one line: A DURABLE IN-APP RECORD IS THE SOURCE OF TRUTH,
 * AND PUSH IS A BEST-EFFORT PROJECTION OF IT. NOTIF-FR-001 is the requirement
 * that forces it — a user who declines the OS push permission must lose nothing
 * but push, "so nothing is lost" — and PRIV-015 says declining degrades no other
 * function.
 *
 * THE OUTBOX IS WRITTEN IN THE BUSINESS TRANSACTION. That is the durability
 * guarantee, not an optimisation: if the notification were created after commit,
 * a crash in between would lose it silently and nobody would ever know which
 * ones. Writing the row inside the same transaction makes the notification
 * exactly as durable as the like, comment or message that caused it.
 *
 * NOTIFICATION RECORDS STORE A TEMPLATE KEY AND PARAMETERS, NOT RENDERED TEXT.
 * LOCALE-FR-002 requires that switching language updates "the entire interface
 * without reinstall"; a centre full of pre-rendered Urdu would still be Urdu
 * after somebody switched to English. Rendering at read time is what makes the
 * switch honest. LOCALE-FR-006's other half — "user-generated content inside a
 * notification is never translated" — is why the parameters are stored
 * verbatim: a display name is data, not copy.
 *
 * `device_tokens` CARRIES ITS OWN LANGUAGE, which looks redundant beside
 * `users.language` and is not. BR-040 says NO DEFAULT LANGUAGE IS PRE-SELECTED,
 * and LOCALE-FR-001 stores the first-launch choice ON THE DEVICE. So at the
 * moment a token is registered the device knows the answer and the server may
 * not yet. Push is rendered per device with the user's stored preference where
 * one exists and the device's own choice otherwise — which means a push is
 * never rendered in a language nobody chose.
 */

exports.shorthands = undefined;

exports.up = async (pgm) => {
  // ------------------------------------------------------ language on users
  pgm.sql(`
    CREATE TYPE app_language AS ENUM ('en', 'ur');

    -- NULLABLE, deliberately. BR-040: "no default is pre-selected", so a user
    -- who has not synced a choice has no server-side language rather than a
    -- guessed one. SET-FR-001 fills it in ("Urdu selected on one device...
    -- applied there too" on the next), and EPIC-14 owns that endpoint.
    ALTER TABLE users ADD COLUMN language app_language;

    COMMENT ON COLUMN users.language IS
      'BR-040: no default is pre-selected, so NULL means the user has not synced a choice. Push falls back to the language the DEVICE recorded at registration - never to a server-chosen default.';
  `);

  // ---------------------------------------------------------- notifications
  pgm.sql(`
    -- The seven categories NOTIF-FR-007 lists by name: "likes, comments,
    -- follows, mentions, messages, events, announcements". REPLY is separate
    -- from COMMENT because NOTIF-FR-003 lists "a comment on their post" and "a
    -- reply to their comment" as different notifications - but both are gated
    -- by the COMMENT preference, since the requirement offers seven switches,
    -- not eight.
    CREATE TYPE notification_category AS ENUM (
      'LIKE', 'COMMENT', 'REPLY', 'FOLLOW', 'MENTION', 'MESSAGE', 'EVENT', 'ANNOUNCEMENT'
    );

    -- What the notification points AT, so a deleted target can be found and
    -- removed (NOTIF-FR-002) without a column per content type.
    CREATE TYPE notification_target AS ENUM (
      'POST', 'COMMENT', 'EVENT', 'CONVERSATION', 'PROFILE', 'ANNOUNCEMENT'
    );
  `);

  pgm.createTable('notifications', {
    id: { type: 'uuid', primaryKey: true },
    recipient_id: { type: 'uuid', notNull: true, references: 'users', onDelete: 'CASCADE' },
    category: { type: 'notification_category', notNull: true },
    /**
     * The person who caused it. NULL for a system or admin notification, which
     * is why it is nullable rather than pointing at a synthetic "system" user —
     * a fake user row would show up in counts, searches and moderation queues.
     */
    actor_id: { type: 'uuid', notNull: false, references: 'users', onDelete: 'CASCADE' },
    target_type: { type: 'notification_target', notNull: true },
    /** Not a foreign key: it points at one of six tables. */
    target_id: { type: 'uuid', notNull: false },
    /** A localization key. Rendered at READ time, in the reader's language. */
    template_key: { type: 'text', notNull: true },
    /**
     * Template parameters — a display name, a count, an event title.
     *
     * Stored VERBATIM and never translated (LOCALE-FR-006). A person's name is
     * data, not copy, and "translating" it would be both wrong and insulting.
     */
    params: { type: 'jsonb', notNull: true, default: '{}' },
    /** NOTIF-FR-003: a batched summary replaces N individual rows. */
    batch_count: { type: 'integer', notNull: true, default: 1 },
    read_at: { type: 'timestamptz', notNull: false },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.sql(`
    ALTER TABLE notifications ADD CONSTRAINT notifications_batch_count_positive
      CHECK (batch_count >= 1);

    -- NOTIF-FR-003: "no notification is generated for the user's own actions".
    -- Structural, so no producer can forget - the requirement lists it first
    -- among the rules, and the failure is a user being told they liked their
    -- own post.
    ALTER TABLE notifications ADD CONSTRAINT notifications_not_self
      CHECK (actor_id IS NULL OR actor_id <> recipient_id);

    -- NOTIF-FR-002: "an in-app list shows all notifications newest-first with
    -- an unread count".
    CREATE INDEX notifications_by_recipient
      ON notifications (recipient_id, created_at DESC, id DESC);

    -- The unread badge, which is read on nearly every screen.
    CREATE INDEX notifications_unread
      ON notifications (recipient_id)
      WHERE read_at IS NULL;

    -- NOTIF-FR-002: "those referring to deleted content are removed rather than
    -- left to navigate nowhere". This index serves that cleanup.
    CREATE INDEX notifications_by_target ON notifications (target_type, target_id);

    -- The 90-day prune (ADR-014 retention).
    CREATE INDEX notifications_by_age ON notifications (created_at);

    COMMENT ON COLUMN notifications.template_key IS
      'LOCALE-FR-002/006: the key, not the rendered text. A centre full of pre-rendered Urdu would still be Urdu after the user switched to English.';
  `);

  // ------------------------------------------- per-category push preferences
  pgm.createTable('notification_preferences', {
    user_id: { type: 'uuid', notNull: true, references: 'users', onDelete: 'CASCADE' },
    category: { type: 'notification_category', notNull: true },
    push_enabled: { type: 'boolean', notNull: true, default: true },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.addConstraint('notification_preferences', 'notification_preferences_pkey', {
    primaryKey: ['user_id', 'category'],
  });

  pgm.sql(`
    COMMENT ON TABLE notification_preferences IS
      'NOTIF-FR-007 / SET-FR-007: preferences gate PUSH ONLY. The in-app centre always records everything, so disabling push never loses information. An absent row means enabled - a user who has never opened settings gets notifications.';
  `);

  // -------------------------------------------------------- device tokens
  pgm.createTable('device_tokens', {
    id: { type: 'uuid', primaryKey: true },
    user_id: { type: 'uuid', notNull: true, references: 'users', onDelete: 'CASCADE' },
    /** The FCM registration token. Opaque; never logged. */
    token: { type: 'text', notNull: true },
    platform: { type: 'text', notNull: true, default: 'ANDROID' },
    /**
     * The language THIS DEVICE is using (LOCALE-FR-001, BR-040).
     *
     * Recorded at registration because the device always knows the first-launch
     * choice and the server may not yet. Push is then never rendered in a
     * language nobody picked.
     */
    language: { type: 'app_language', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    last_seen_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    /** Set when FCM reports the token invalid (ADR-014). Never deleted inline. */
    invalidated_at: { type: 'timestamptz', notNull: false },
  });

  pgm.sql(`
    -- One row per token, whoever holds it. A token that moves to another
    -- account - a shared phone, a factory reset - must not deliver the previous
    -- user's notifications, so re-registration REASSIGNS rather than duplicates.
    ALTER TABLE device_tokens ADD CONSTRAINT device_tokens_token_unique UNIQUE (token);

    -- Every live token for a user, which is what a push fan-out reads.
    CREATE INDEX device_tokens_live
      ON device_tokens (user_id)
      WHERE invalidated_at IS NULL;

    COMMENT ON TABLE device_tokens IS
      'ADR-014: multiple devices per user; tokens removed when FCM reports them invalid. Token registration is NOT a precondition for anything else (PRIV-015) - declining push degrades only push.';
  `);

  // ---------------------------------------------------------------- outbox
  //
  // ADR-014's durability boundary. Written by the API inside the business
  // transaction; drained by the worker afterwards.
  //
  // A TABLE RATHER THAN A DIRECT QUEUE INSERT, because the guarantee is about
  // the TRANSACTION: the row must commit or roll back with the like it
  // describes. Enqueuing to pg-boss from application code after commit would
  // reintroduce exactly the window this exists to close.
  pgm.createTable('outbox', {
    id: { type: 'uuid', primaryKey: true },
    /** The domain event, e.g. `engagement.liked`. Not a queue name. */
    topic: { type: 'text', notNull: true },
    payload: { type: 'jsonb', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    /** Non-null once the worker has turned it into notification records. */
    processed_at: { type: 'timestamptz', notNull: false },
    attempts: { type: 'integer', notNull: true, default: 0 },
    /** The last failure, for the dead-letter path. Never the payload again. */
    last_error: { type: 'text', notNull: false },
  });

  pgm.sql(`
    ALTER TABLE outbox ADD CONSTRAINT outbox_attempts_non_negative CHECK (attempts >= 0);

    -- The drain query: oldest unprocessed first, so notifications arrive in the
    -- order the things that caused them happened.
    CREATE INDEX outbox_pending
      ON outbox (created_at)
      WHERE processed_at IS NULL;

    COMMENT ON TABLE outbox IS
      'ADR-014: written in the SAME transaction as the business change. A notification is then exactly as durable as the event that caused it - a crash between commit and enqueue cannot lose one.';
  `);

  // ------------------------------- NOTIF-FR-002: no notification outlives its target
  //
  // "Those referring to deleted content are removed rather than left to
  // navigate nowhere." A user who taps a notification and lands on an error is
  // being told something was there and is gone, which is both a bad experience
  // and, for removed content, a small disclosure.
  //
  // Posts and comments are SOFT-deleted, so the trigger follows the STATE
  // rather than the row. Events are hard-deleted while nobody has responded, so
  // that one is an ordinary DELETE trigger.
  pgm.sql(`
    CREATE OR REPLACE FUNCTION notifications_drop_for_hidden_post()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $fn$
    BEGIN
      IF NEW.visibility_state <> 'VISIBLE' AND OLD.visibility_state = 'VISIBLE' THEN
        DELETE FROM notifications
         WHERE target_type = 'POST' AND target_id = NEW.id;
      END IF;
      RETURN NULL;
    END
    $fn$;

    CREATE TRIGGER posts_drop_notifications
      AFTER UPDATE ON posts
      FOR EACH ROW
      EXECUTE FUNCTION notifications_drop_for_hidden_post();

    CREATE OR REPLACE FUNCTION notifications_drop_for_hidden_comment()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $fn$
    BEGIN
      IF NEW.visibility_state <> 'VISIBLE' AND OLD.visibility_state = 'VISIBLE' THEN
        DELETE FROM notifications
         WHERE target_type = 'COMMENT' AND target_id = NEW.id;
      END IF;
      RETURN NULL;
    END
    $fn$;

    CREATE TRIGGER comments_drop_notifications
      AFTER UPDATE ON comments
      FOR EACH ROW
      EXECUTE FUNCTION notifications_drop_for_hidden_comment();

    CREATE OR REPLACE FUNCTION notifications_drop_for_deleted_event()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $fn$
    BEGIN
      DELETE FROM notifications WHERE target_type = 'EVENT' AND target_id = OLD.id;
      RETURN NULL;
    END
    $fn$;

    CREATE TRIGGER events_drop_notifications
      AFTER DELETE ON events
      FOR EACH ROW
      EXECUTE FUNCTION notifications_drop_for_deleted_event();
  `);

  // ------------------------------------- NOTIF-FR-005: the broadcast ledger
  //
  // "Broadcasts are limited to 2 per week, because over-use is a direct cause
  // of uninstalls; every broadcast is audit-logged with the publishing
  // administrator." The AUDIT entry belongs to the audit log; this column is
  // what makes the LIMIT countable without scanning it.
  pgm.sql(`
    ALTER TABLE announcements ADD COLUMN broadcast_at timestamptz;

    CREATE INDEX announcements_broadcasts ON announcements (broadcast_at)
      WHERE broadcast_at IS NOT NULL;

    COMMENT ON COLUMN announcements.broadcast_at IS
      'NOTIF-FR-005: set when an announcement is also pushed to every user. Two per week, counted from this column so the limit cannot drift from the thing it limits.';
  `);
};

exports.down = async (pgm) => {
  pgm.sql(`
    DROP TRIGGER IF EXISTS events_drop_notifications ON events;
    DROP TRIGGER IF EXISTS comments_drop_notifications ON comments;
    DROP TRIGGER IF EXISTS posts_drop_notifications ON posts;
    DROP FUNCTION IF EXISTS notifications_drop_for_deleted_event();
    DROP FUNCTION IF EXISTS notifications_drop_for_hidden_comment();
    DROP FUNCTION IF EXISTS notifications_drop_for_hidden_post();

    DROP INDEX IF EXISTS announcements_broadcasts;
    ALTER TABLE announcements DROP COLUMN IF EXISTS broadcast_at;
  `);
  pgm.dropTable('outbox');
  pgm.dropTable('device_tokens');
  pgm.dropTable('notification_preferences');
  pgm.dropTable('notifications');
  pgm.sql(`
    DROP TYPE IF EXISTS notification_target;
    DROP TYPE IF EXISTS notification_category;
    ALTER TABLE users DROP COLUMN IF EXISTS language;
    DROP TYPE IF EXISTS app_language;
  `);
};
