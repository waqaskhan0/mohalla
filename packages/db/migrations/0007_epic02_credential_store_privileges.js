/**
 * 0007 — EPIC-02 · least privilege on the credential stores.
 *
 * `roles.sql` grants SELECT/INSERT/UPDATE/DELETE on every new table in `public`
 * via ALTER DEFAULT PRIVILEGES, which is the right default for ordinary product
 * tables. It is the wrong default for `admins`.
 *
 * WHAT THIS CLOSES. The runtime role could INSERT into `admins`. Nothing in the
 * application does — provisioning is the technical owner's CLI running as
 * `migration_owner` (S2-CR-005), and there is no admin-creation endpoint in any
 * environment. So that privilege serves no feature and exists only as
 * capability: any SQL-injection or code-execution flaw in the API process could
 * mint itself an administrator, and administrators can act on other people's
 * accounts. Removing it means the same flaw has to also compromise the owner's
 * migration credential, which the runtime never holds.
 *
 * This was found by the auth smoke test, which inserted a synthetic admin row
 * as `runtime_app` and succeeded — it should not have been able to.
 *
 * WHAT REMAINS, and why:
 *
 *   admins            runtime_app SELECT only. It must read the row to verify a
 *                     password; it never writes one. `runtime_worker` loses
 *                     access entirely — the worker authenticates nobody.
 *
 *   admin_sessions    runtime_app keeps SELECT/INSERT/UPDATE: it creates a
 *                     session on login and sets `revoked_at` on logout. No
 *                     DELETE, so a session's history cannot be erased, only
 *                     revoked — same reasoning as the audit log.
 *
 * Deliberately NOT tightened here: `users` and `user_identifiers`. Registration
 * genuinely writes them from the API process, so a REVOKE would break the
 * feature rather than remove idle capability. The asymmetry is the point —
 * least privilege means removing what is unused, not removing what is needed.
 */

exports.shorthands = undefined;

exports.up = async (pgm) => {
  pgm.sql(`
    -- Administrator credentials: readable by the API so it can authenticate,
    -- writable by nobody except the migration owner.
    REVOKE ALL ON admins FROM runtime_app, runtime_worker;
    GRANT SELECT ON admins TO runtime_app;

    -- Stated explicitly as well as implied by the REVOKE above, because this is
    -- the sentence a future reader needs to find: the application cannot create
    -- or modify an administrator.
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON admins FROM runtime_app, runtime_worker;
    REVOKE ALL ON admins FROM PUBLIC;

    -- Admin sessions: created and revoked by the API, never deleted.
    REVOKE ALL ON admin_sessions FROM runtime_app, runtime_worker;
    GRANT SELECT, INSERT, UPDATE ON admin_sessions TO runtime_app;
    REVOKE DELETE, TRUNCATE ON admin_sessions FROM runtime_app, runtime_worker;
    REVOKE ALL ON admin_sessions FROM PUBLIC;

    COMMENT ON TABLE admins IS
      'SEC-020: administrator credential store, separate from users. Rows are created by the technical-owner CLI only (S2-CR-005) - there is no public admin-creation endpoint and no bootstrap route. The runtime role holds SELECT only, so an application-level flaw cannot mint an administrator (migration 0007).';
  `);
};

exports.down = async (pgm) => {
  // Restores the roles.sql default. Only for a clean rollback - it re-opens the
  // capability this migration exists to remove.
  pgm.sql(`
    GRANT SELECT, INSERT, UPDATE, DELETE ON admins TO runtime_app, runtime_worker;
    GRANT SELECT, INSERT, UPDATE, DELETE ON admin_sessions TO runtime_app, runtime_worker;
  `);
};
