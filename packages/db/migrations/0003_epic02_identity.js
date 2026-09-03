/**
 * 0003 — EPIC-02 · Authentication & sessions: identity schema.
 *
 * Tables owned by the `identity` platform module (06-backend-modules.md §4.1),
 * exactly as defined in the frozen ERD (diagrams/database-erd.mmd):
 *
 *   users · user_identifiers · banned_identifiers · sessions
 *   otp_challenges · admins · admin_sessions
 *
 * KEY APPROVED DECISIONS ENCODED HERE
 *
 * - OD-021 Option C: a verified Pakistani mobile is the mandatory V1 identity.
 *   `user_identifiers` stays polymorphic (`kind`) so a future version can relax
 *   it, but a CHECK constraint pins the PRIMARY identifier to PHONE. That single
 *   line is what a later version edits — AUTH-FR-004 / EMAIL_PRIMARY is removed
 *   from V1, so `identity_type` carries one value today.
 * - SEC-020: administrator credentials live in a SEPARATE store (`admins`,
 *   `admin_sessions`). No foreign key joins them to `users`. A user credential
 *   can never satisfy admin auth because the rows are in different tables.
 * - ADR-008 / opaque sessions: only a HASH of the session token is stored
 *   (`bytea token_hash`). The token itself is never persisted, so a database
 *   read cannot yield a usable session.
 * - PRIV-002 / PRIV-003: `date_of_birth` and `value_normalized` are never
 *   exposed in a public DTO. Enforced in code by PublicProfileProjection; the
 *   column comments record the constraint at the schema level too.
 * - BR-036 / ARCH-CONFLICT-005: `banned_identifiers` stores a PEPPERED HASH
 *   only. The raw number is deliberately not retained, which is why the pepper
 *   is not rotatable (docs/security/… and 12-secret-management.md).
 *
 * Forward-only (ADR-008). `down` exists for local development and is never run
 * against staging or production.
 */

exports.shorthands = undefined;

exports.up = async (pgm) => {
  // citext gives case-insensitive UNIQUE for username and admin email without
  // a functional index, matching the ERD's `citext` columns.
  pgm.createExtension('citext', { ifNotExists: true });

  // ---------------------------------------------------------------- enums
  pgm.createType('identity_type', ['PHONE_PRIMARY']);
  pgm.createType('user_state', [
    'UNVERIFIED',
    'ACTIVE',
    'SUSPENDED',
    'BANNED',
    'PENDING_DELETION',
    'DELETED',
  ]);
  pgm.createType('account_type', ['INDIVIDUAL', 'ORGANIZATION']);
  pgm.createType('identifier_kind', ['PHONE', 'EMAIL']);
  pgm.createType('session_revoked_reason', [
    'LOGOUT',
    'PASSWORD_CHANGE',
    'PASSWORD_RESET',
    'SUSPENDED',
    'BANNED',
    'DELETED',
    'EVICTED',
    'ADMIN',
  ]);
  pgm.createType('otp_purpose', ['REGISTRATION', 'PASSWORD_RESET']);
  pgm.createType('admin_state', ['ACTIVE', 'DISABLED']);

  // ---------------------------------------------------------------- users
  pgm.createTable('users', {
    id: { type: 'uuid', primaryKey: true },
    // Only PHONE_PRIMARY exists in V1 (OD-021 Option C removed AUTH-FR-004).
    identity_type: { type: 'identity_type', notNull: true, default: 'PHONE_PRIMARY' },
    state: { type: 'user_state', notNull: true, default: 'UNVERIFIED' },
    account_type: { type: 'account_type', notNull: true, default: 'INDIVIDUAL' },
    // Immutable after creation (BR-005). Nullable until chosen at registration.
    username: { type: 'citext', notNull: false },
    password_hash: { type: 'text', notNull: true },
    date_of_birth: { type: 'date', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    state_changed_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    // Set when a suspension has an end date (BR-034).
    suspended_until: { type: 'timestamptz', notNull: false },
  });

  // BR-005: username uniqueness is a DATABASE constraint, so two concurrent
  // registrations racing for the same handle produce exactly one winner.
  pgm.addConstraint('users', 'users_username_unique', { unique: ['username'] });
  pgm.sql(`
    ALTER TABLE users ADD CONSTRAINT users_username_format
      CHECK (username IS NULL OR username ~ '^[a-z0-9_]{3,30}$');

    COMMENT ON COLUMN users.date_of_birth IS
      'PRIV-002: minimum age 13, never exposed in any public DTO.';
    COMMENT ON COLUMN users.password_hash IS
      'SEC-001: Argon2id. Never returned by any endpoint.';
    COMMENT ON COLUMN users.username IS
      'BR-005: immutable after creation. Case-insensitive unique via citext.';
  `);
  pgm.createIndex('users', 'state', { name: 'users_state_idx' });

  // ------------------------------------------------------ user_identifiers
  pgm.createTable('user_identifiers', {
    id: { type: 'uuid', primaryKey: true },
    user_id: {
      type: 'uuid',
      notNull: true,
      references: 'users',
      onDelete: 'CASCADE',
    },
    kind: { type: 'identifier_kind', notNull: true },
    // PRIV-003: E.164 form, never in a public DTO.
    value_normalized: { type: 'text', notNull: true },
    // Peppered hash — the lookup key, so a raw scan cannot reverse identifiers.
    value_hash: { type: 'bytea', notNull: true },
    is_primary: { type: 'boolean', notNull: true, default: false },
    verified_at: { type: 'timestamptz', notNull: false },
  });

  pgm.addConstraint('user_identifiers', 'user_identifiers_value_hash_unique', {
    unique: ['value_hash'],
  });
  pgm.sql(`
    -- OD-021 Option C: the PRIMARY identifier must be a phone in V1. This is
    -- the single line a future version relaxes to re-enable another identity.
    ALTER TABLE user_identifiers ADD CONSTRAINT user_identifiers_primary_is_phone
      CHECK (NOT is_primary OR kind = 'PHONE');

    -- Exactly one primary identifier per user.
    CREATE UNIQUE INDEX user_identifiers_one_primary
      ON user_identifiers (user_id) WHERE is_primary;

    COMMENT ON COLUMN user_identifiers.value_normalized IS
      'PRIV-003: normalized E.164. Never exposed outside the identity module.';
  `);
  pgm.createIndex('user_identifiers', 'user_id', { name: 'user_identifiers_user_idx' });

  // --------------------------------------------------- banned_identifiers
  pgm.createTable('banned_identifiers', {
    // BR-036 / ARCH-CONFLICT-005: peppered hash ONLY. The raw identifier is
    // deliberately never stored, which is why the pepper cannot be rotated —
    // rotating it would silently unban everyone.
    identifier_hash: { type: 'bytea', primaryKey: true },
    banned_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    reason: { type: 'text', notNull: false },
  });
  pgm.sql(`
    COMMENT ON TABLE banned_identifiers IS
      'BR-036: ban durability. Peppered hash only - the raw identifier is never retained.';
  `);

  // ------------------------------------------------------------- sessions
  pgm.createTable('sessions', {
    id: { type: 'uuid', primaryKey: true },
    user_id: { type: 'uuid', notNull: true, references: 'users', onDelete: 'CASCADE' },
    // ADR-008: opaque token. Only its hash is stored.
    token_hash: { type: 'bytea', notNull: true },
    device_label: { type: 'text', notNull: false },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    last_seen_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    expires_at: { type: 'timestamptz', notNull: true },
    revoked_at: { type: 'timestamptz', notNull: false },
    revoked_reason: { type: 'session_revoked_reason', notNull: false },
  });
  pgm.addConstraint('sessions', 'sessions_token_hash_unique', { unique: ['token_hash'] });
  pgm.sql(`
    -- BR-007 / SEC-005: at most five live devices. The application evicts the
    -- oldest inside the login transaction; this partial index makes counting
    -- and eviction cheap without scanning revoked rows.
    CREATE INDEX sessions_active_by_user
      ON sessions (user_id, created_at) WHERE revoked_at IS NULL;

    COMMENT ON COLUMN sessions.token_hash IS
      'ADR-008: hash of an opaque server-backed token. The token itself is never stored.';
  `);

  // ------------------------------------------------------- otp_challenges
  pgm.createTable('otp_challenges', {
    id: { type: 'uuid', primaryKey: true },
    identifier_hash: { type: 'bytea', notNull: true },
    purpose: { type: 'otp_purpose', notNull: true },
    code_hash: { type: 'bytea', notNull: true },
    // SEC-003: capped at 5.
    attempts: { type: 'smallint', notNull: true, default: 0 },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    expires_at: { type: 'timestamptz', notNull: true },
    consumed_at: { type: 'timestamptz', notNull: false },
  });
  pgm.sql(`
    ALTER TABLE otp_challenges ADD CONSTRAINT otp_challenges_attempts_cap
      CHECK (attempts >= 0 AND attempts <= 5);

    -- Resend must invalidate the previous challenge, so at most one live
    -- challenge may exist per identifier+purpose. Enforced in the database so a
    -- concurrent resend cannot leave two valid codes.
    CREATE UNIQUE INDEX otp_challenges_one_live
      ON otp_challenges (identifier_hash, purpose) WHERE consumed_at IS NULL;

    COMMENT ON COLUMN otp_challenges.code_hash IS
      'SEC-003: hash of the OTP. The code itself is never stored or logged.';
  `);
  pgm.createIndex('otp_challenges', 'expires_at', { name: 'otp_challenges_expiry_idx' });

  // --------------------------------------------------------------- admins
  // SEC-020: a SEPARATE credential store. Deliberately no FK to users, and no
  // shared column, so a user credential can never satisfy administrator auth.
  pgm.createTable('admins', {
    id: { type: 'uuid', primaryKey: true },
    email: { type: 'citext', notNull: true },
    password_hash: { type: 'text', notNull: true },
    state: { type: 'admin_state', notNull: true, default: 'ACTIVE' },
    display_name: { type: 'text', notNull: false },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('admins', 'admins_email_unique', { unique: ['email'] });
  pgm.sql(`
    COMMENT ON TABLE admins IS
      'SEC-020: administrator credential store, separate from users. Rows are created by the technical-owner CLI only (S2-CR-005) - there is no public admin-creation endpoint and no bootstrap route.';
  `);

  pgm.createTable('admin_sessions', {
    id: { type: 'uuid', primaryKey: true },
    admin_id: { type: 'uuid', notNull: true, references: 'admins', onDelete: 'CASCADE' },
    token_hash: { type: 'bytea', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    // SEC-024: 8-hour absolute lifetime.
    expires_at: { type: 'timestamptz', notNull: true },
    revoked_at: { type: 'timestamptz', notNull: false },
  });
  pgm.addConstraint('admin_sessions', 'admin_sessions_token_hash_unique', {
    unique: ['token_hash'],
  });
  pgm.createIndex('admin_sessions', ['admin_id', 'created_at'], {
    name: 'admin_sessions_active_idx',
    where: 'revoked_at IS NULL',
  });
};

exports.down = async (pgm) => {
  pgm.dropTable('admin_sessions');
  pgm.dropTable('admins');
  pgm.dropTable('otp_challenges');
  pgm.dropTable('sessions');
  pgm.dropTable('banned_identifiers');
  pgm.dropTable('user_identifiers');
  pgm.dropTable('users');
  pgm.dropType('admin_state');
  pgm.dropType('otp_purpose');
  pgm.dropType('session_revoked_reason');
  pgm.dropType('identifier_kind');
  pgm.dropType('account_type');
  pgm.dropType('user_state');
  pgm.dropType('identity_type');
};
