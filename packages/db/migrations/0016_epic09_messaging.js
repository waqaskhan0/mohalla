/**
 * 0016 — EPIC-09 · conversations, per-participant state, and messages.
 *
 * `07-database-design.md` §2.5. Three tables, and each one carries a rule that
 * would otherwise have to be remembered by every code path that touches it.
 *
 * 1. ONE CONVERSATION PER PAIR, FOREVER (BR-024), by storing the pair in
 *    canonical order with `CHECK (user_low_id < user_high_id)` and a UNIQUE on
 *    the pair. MSG-FR-001's acceptance criterion — "the existing thread opens
 *    rather than a second being created" — is then structural. Without the
 *    ordering, A→B and B→A are different rows and the second conversation
 *    appears the first time the other person starts the thread, which is
 *    exactly the case nobody tests.
 *
 * 2. REQUEST STATE IS PER PARTICIPANT, NOT PER CONVERSATION. This is the whole
 *    mechanism behind Message Requests. The recipient holds PENDING while the
 *    SENDER sees an ordinary thread, which is what makes a decline invisible
 *    (BR-028) — the sender's row never changes, so there is nothing for them to
 *    observe. A per-conversation column could not express that.
 *
 * 3. `UNIQUE (conversation_id, client_message_id)` IS THE IDEMPOTENCY
 *    GUARANTEE. ADR-009 is emphatic that deduplication lives in PostgreSQL and
 *    never in the transport, because the transport is the thing that
 *    duplicates. A retry (EDGE-020), a duplicate delivery (EDGE-021) and a
 *    switch from socket to polling all reuse the same client-generated id and
 *    resolve to the same row.
 *
 * WHY MESSAGES DO NOT CASCADE ON THE SENDER, WHEN POSTS DO. BR-046: "Deleting
 * an account removes conversations from the deleting user's side only. The
 * other participant retains their copy, since the conversation is equally their
 * record." A CASCADE from `users` would erase one side of somebody else's
 * conversation — a legal-review rule silently reversed by a foreign-key
 * default. The participant ROW cascades (the deleting user's side goes) and the
 * messages do not. RESTRICT is deliberate: V1 deletion is a terminal STATE and
 * the user row survives, so this never fires — but if a future erasure job ever
 * tries to remove the row outright it fails loudly instead of quietly taking
 * the other person's history with it.
 */

exports.shorthands = undefined;

exports.up = async (pgm) => {
  // -------------------------------------------- media visibility (MSG-FR-008)
  //
  // MSG-FR-008's acceptance criterion is a privacy claim, not a storage one:
  // "GIVEN an image sent in a message, WHEN it is stored, THEN it is not
  // retrievable by anyone outside that conversation."
  //
  // Until now every READY object was served by one public-by-id route, which is
  // correct for a post — a post is public, so its image is too — and wrong for
  // a message. An id is not a secret: it appears in the sender's own client, in
  // logs, and in any backup of either device.
  //
  // So media carries its own visibility, and RESTRICTED objects are unreachable
  // through the generic route. The conversation route serves them after
  // checking participation. Two mechanisms, because there are two questions:
  // this column answers "may anyone fetch this by id", and the owning module
  // answers "may THIS person see it".
  pgm.sql(`
    CREATE TYPE media_visibility AS ENUM ('PUBLIC', 'RESTRICTED');

    ALTER TABLE media ADD COLUMN visibility media_visibility NOT NULL DEFAULT 'PUBLIC';

    COMMENT ON COLUMN media.visibility IS
      'MSG-FR-008: RESTRICTED objects are not served by GET /media/{id} at all. The module that owns the containing record serves them after its own access check. PUBLIC is the default because post media is public by design.';
  `);

  // ---------------------------------------------------------- conversations
  pgm.createTable('conversations', {
    id: { type: 'uuid', primaryKey: true },
    // Canonical ordering. NOT "user_a"/"user_b" — names that suggest an order
    // which does not exist would invite a caller to store them as given.
    user_low_id: { type: 'uuid', notNull: true, references: 'users', onDelete: 'RESTRICT' },
    user_high_id: { type: 'uuid', notNull: true, references: 'users', onDelete: 'RESTRICT' },
    /**
     * Who opened the thread. Needed for the request rate limit (MSG-FR-005 E3)
     * and for nothing else — it is never shown, because "who started it" is not
     * information either participant is owed about the other.
     */
    initiated_by: { type: 'uuid', notNull: true, references: 'users', onDelete: 'RESTRICT' },
    /** Maintained by trigger. The inbox sorts on it (MSG-FR-003). */
    last_message_at: { type: 'timestamptz', notNull: false },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.sql(`
    ALTER TABLE conversations ADD CONSTRAINT conversations_pair_ordered
      CHECK (user_low_id < user_high_id);
    ALTER TABLE conversations ADD CONSTRAINT conversations_pair_unique
      UNIQUE (user_low_id, user_high_id);
    ALTER TABLE conversations ADD CONSTRAINT conversations_initiator_is_participant
      CHECK (initiated_by IN (user_low_id, user_high_id));

    -- MSG-FR-005 E3: "a maximum of 10 new message requests per sender per day".
    -- Counted from this table rather than from a counter, so the limit cannot
    -- drift from the thing it is limiting.
    CREATE INDEX conversations_by_initiator ON conversations (initiated_by, created_at DESC);

    COMMENT ON TABLE conversations IS
      'BR-024: exactly one row per pair of users, for the lifetime of both accounts. The canonical ordering is what makes MSG-FR-001 structural rather than a check somebody has to remember.';
  `);

  // ---------------------------------------------- conversation_participants
  pgm.sql(`
    CREATE TYPE message_request_state AS ENUM ('ACCEPTED', 'PENDING', 'DECLINED');
  `);

  pgm.createTable('conversation_participants', {
    conversation_id: {
      type: 'uuid',
      notNull: true,
      references: 'conversations',
      onDelete: 'CASCADE',
    },
    // CASCADE here and only here. BR-046: the deleting user's side goes, the
    // other participant keeps theirs.
    user_id: { type: 'uuid', notNull: true, references: 'users', onDelete: 'CASCADE' },
    request_state: { type: 'message_request_state', notNull: true, default: 'ACCEPTED' },
    unread_count: { type: 'integer', notNull: true, default: 0 },
    /**
     * MSG-FR-009. Read receipts are DERIVED from this rather than written per
     * message: a message counts as read when the OTHER participant's
     * `last_read_at` is at or after it. One row moves instead of a thousand,
     * and "never a receipt for a request" becomes a single condition in one
     * query instead of a rule every write path has to remember.
     */
    last_read_at: { type: 'timestamptz', notNull: false },
    /**
     * Set when THIS participant blocks the other (MSG-FR-003, EDGE-019). The
     * conversation leaves their inbox and returns intact on unblock — the
     * timestamp is cleared and no history moves.
     */
    hidden_at: { type: 'timestamptz', notNull: false },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.addConstraint('conversation_participants', 'conversation_participants_pkey', {
    primaryKey: ['conversation_id', 'user_id'],
  });

  pgm.sql(`
    ALTER TABLE conversation_participants
      ADD CONSTRAINT conversation_participants_unread_positive CHECK (unread_count >= 0);

    -- The inbox query: this user's conversations, split by request state.
    -- Requests are "a separate section with its own count" (MSG-FR-003), so the
    -- state is IN the index rather than filtered after the fact.
    CREATE INDEX conversation_participants_inbox
      ON conversation_participants (user_id, request_state, created_at DESC)
      WHERE hidden_at IS NULL;

    COMMENT ON COLUMN conversation_participants.request_state IS
      'MSG-FR-005, PER PARTICIPANT. The recipient can hold PENDING while the sender sees an ordinary thread - which is what makes a decline invisible to the sender (BR-028).';
    COMMENT ON COLUMN conversation_participants.hidden_at IS
      'EDGE-019: set when this participant blocks the other. Their inbox loses the conversation; history is retained and restored intact on unblock (SAFETY-FR-006).';
  `);

  // --------------------------------------------------------------- messages
  pgm.createTable('messages', {
    id: { type: 'uuid', primaryKey: true },
    conversation_id: {
      type: 'uuid',
      notNull: true,
      references: 'conversations',
      onDelete: 'CASCADE',
    },
    // RESTRICT, not CASCADE — see the file header. BR-046 is a legal-review
    // rule, and a foreign-key default is not the place to reverse one.
    sender_id: { type: 'uuid', notNull: true, references: 'users', onDelete: 'RESTRICT' },
    /** Generated ON THE DEVICE before sending (ADR-009 step 1). */
    client_message_id: { type: 'uuid', notNull: true },
    body: { type: 'text', notNull: false },
    /** MSG-FR-008: one image per message, at most. */
    media_id: { type: 'uuid', notNull: false, references: 'media', onDelete: 'SET NULL' },
    /**
     * SERVER clock (MSG-FR-004): "messages are ordered by server timestamp so
     * that both participants see the same order". A device clock would let a
     * phone with the wrong time reorder somebody else's conversation.
     */
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.sql(`
    -- THE constraint. EDGE-020 and EDGE-021 are satisfied by this line rather
    -- than by convention: a retry, a duplicate delivery and a transport switch
    -- all carry the same client id and resolve to the same row.
    ALTER TABLE messages ADD CONSTRAINT messages_client_id_unique
      UNIQUE (conversation_id, client_message_id);

    -- A message must say something. MSG-FR-002 refuses empty and
    -- whitespace-only text; an image with no caption is still a message, so the
    -- alternative is an attachment.
    ALTER TABLE messages ADD CONSTRAINT messages_not_empty
      CHECK (btrim(coalesce(body, '')) <> '' OR media_id IS NOT NULL);

    -- 2,000 characters (MSG-FR-002). As everywhere else the REAL limit is in
    -- grapheme clusters and lives in the application; this is a generous byte
    -- ceiling that anything valid fits inside, so a path which skipped
    -- validation still cannot store something absurd.
    ALTER TABLE messages ADD CONSTRAINT messages_body_byte_ceiling
      CHECK (body IS NULL OR octet_length(body) <= 8000);

    -- History, newest first, keyset-paginated.
    CREATE INDEX messages_by_conversation
      ON messages (conversation_id, created_at DESC, id DESC);

    COMMENT ON TABLE messages IS
      'ADR-009: deduplication lives in UNIQUE (conversation_id, client_message_id), never in the transport. Re-verify this when a pub/sub adapter is introduced - ADR-009 makes it a mandatory review item.';
  `);

  // ------------------------------------------------ derived state, by trigger
  //
  // Conversation activity and unread counts move in the SAME transaction as the
  // insert, for the reason every other counter in this schema does: there is
  // more than one path that can create a message (REST now, the socket handler
  // reusing the same service, a future admin action), and a trigger covers the
  // paths nobody has written yet.
  pgm.sql(`
    CREATE OR REPLACE FUNCTION messages_after_insert()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $fn$
    BEGIN
      UPDATE conversations
         SET last_message_at = NEW.created_at
       WHERE id = NEW.conversation_id;

      -- The RECIPIENT's unread count, never the sender's. A sender whose own
      -- message counted as unread would see a badge for something they just
      -- typed.
      --
      -- \`hidden_at IS NULL\` is the block rule (MSG-FR-006): "messages sent
      -- before the block are retained but not delivered onward". A blocker
      -- whose unread count climbed would be told, by the badge, that the person
      -- they blocked is still writing to them.
      UPDATE conversation_participants
         SET unread_count = unread_count + 1
       WHERE conversation_id = NEW.conversation_id
         AND user_id <> NEW.sender_id
         AND hidden_at IS NULL;

      RETURN NULL;
    END
    $fn$;

    CREATE TRIGGER messages_activity
      AFTER INSERT ON messages
      FOR EACH ROW
      EXECUTE FUNCTION messages_after_insert();
  `);

  // ---- the sender must be a participant -----------------------------------
  // Object-level authorization is check 3 of SEC-009 and lives in the
  // application, where the object is loaded. This is the BACKSTOP: not a
  // replacement for that check, but the reason a missed one cannot become a
  // stored message in a stranger's thread.
  pgm.sql(`
    CREATE OR REPLACE FUNCTION messages_sender_is_participant()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $fn$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM conversation_participants
         WHERE conversation_id = NEW.conversation_id
           AND user_id = NEW.sender_id
      ) THEN
        RAISE EXCEPTION 'sender is not a participant in this conversation'
          USING ERRCODE = 'insufficient_privilege';
      END IF;
      RETURN NEW;
    END
    $fn$;

    CREATE TRIGGER messages_sender_participation
      BEFORE INSERT ON messages
      FOR EACH ROW
      EXECUTE FUNCTION messages_sender_is_participant();
  `);

  // ---- an attachment must be READY, owned, and restricted -----------------
  // The same race ADR-013 step 7 closes for posts: a message could otherwise
  // reference a file that has not passed inspection yet, or one that fails it a
  // moment later. A foreign key cannot express this, because the media row
  // exists throughout — it is the STATE that matters.
  //
  // The third condition is new and specific to messaging: a PUBLIC object
  // attached to a private message would be readable by id from the generic
  // media route, which is exactly what MSG-FR-008 forbids. Enforcing it here
  // rather than trusting the upload path means a client that requests a public
  // slot and then attaches it to a message is refused rather than quietly
  // publishing its own private image.
  pgm.sql(`
    CREATE OR REPLACE FUNCTION messages_media_requires_ready()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $fn$
    DECLARE
      m RECORD;
    BEGIN
      IF NEW.media_id IS NULL THEN
        RETURN NEW;
      END IF;

      SELECT state, owner_id, visibility, kind INTO m FROM media WHERE id = NEW.media_id;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'media does not exist'
          USING ERRCODE = 'foreign_key_violation';
      END IF;

      IF m.owner_id <> NEW.sender_id THEN
        RAISE EXCEPTION 'media belongs to another user'
          USING ERRCODE = 'insufficient_privilege';
      END IF;

      IF m.state <> 'READY' THEN
        RAISE EXCEPTION 'media has not passed inspection'
          USING ERRCODE = 'restrict_violation';
      END IF;

      IF m.visibility <> 'RESTRICTED' THEN
        RAISE EXCEPTION 'message media must be restricted (MSG-FR-008)'
          USING ERRCODE = 'restrict_violation';
      END IF;

      -- MSG-FR-008 is "send an IMAGE in a message". Documents are a posts
      -- feature (BR-015) and PDF is gated by ADR-013 besides; there is no
      -- requirement for one in a conversation, so the schema does not allow it.
      IF m.kind <> 'IMAGE' THEN
        RAISE EXCEPTION 'only images may be attached to a message'
          USING ERRCODE = 'restrict_violation';
      END IF;

      RETURN NEW;
    END
    $fn$;

    CREATE TRIGGER messages_media_ready
      BEFORE INSERT ON messages
      FOR EACH ROW
      EXECUTE FUNCTION messages_media_requires_ready();
  `);
};

exports.down = async (pgm) => {
  pgm.sql(`
    DROP TRIGGER IF EXISTS messages_media_ready ON messages;
    DROP TRIGGER IF EXISTS messages_sender_participation ON messages;
    DROP TRIGGER IF EXISTS messages_activity ON messages;
    DROP FUNCTION IF EXISTS messages_media_requires_ready();
    DROP FUNCTION IF EXISTS messages_sender_is_participant();
    DROP FUNCTION IF EXISTS messages_after_insert();
  `);
  pgm.dropTable('messages');
  pgm.dropTable('conversation_participants');
  pgm.sql('DROP TYPE IF EXISTS message_request_state;');
  pgm.dropTable('conversations');
  pgm.sql(`
    ALTER TABLE media DROP COLUMN IF EXISTS visibility;
    DROP TYPE IF EXISTS media_visibility;
  `);
};
