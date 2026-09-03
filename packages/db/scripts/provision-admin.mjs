import { Client } from 'pg';

/**
 * ADMINISTRATOR PROVISIONING — MECHANISM ONLY.
 *
 * This is the technical-owner-controlled CLI path for creating the FIRST
 * administrator. Stage 5 builds the mechanism; it does NOT create an admin.
 *
 * WHAT THIS DELIBERATELY IS NOT (and must never become):
 *   - a /bootstrap-admin HTTP endpoint       — an unauthenticated admin-creation
 *                                               route is a standing back door
 *   - a /admin/register self-service route    — admins are provisioned, not self-served
 *   - a default/seeded admin account          — a known default credential is a breach
 *   - hardcoded credentials of any kind
 *
 * It runs from a shell the technical owner controls, against a database only the
 * owner can reach. That is the entire security model: possession of the owner's
 * database credential, not a network-reachable endpoint.
 *
 * IT IS BLOCKED ON OD-020. No administrator can actually be created until
 * Shehersaaz names the technical owner (DEP-016), because there is otherwise no
 * accountable human to own that account. Until then this script REFUSES to run
 * outside development, and even in development it only demonstrates the shape
 * using dev/test data.
 *
 * STATUS AS OF EPIC-02: the `admins` table now EXISTS (migration 0003), so the
 * only remaining blocker is the governance one — OD-020 has still not named a
 * technical owner. That distinction matters, because the two blocks are not
 * interchangeable: a missing table is something an engineer can fix, while a
 * missing accountable human is not, and creating an administrator that belongs
 * to nobody is worse than having none.
 *
 * So this still validates its inputs and its guards, prints exactly what it
 * WOULD do, and stops. It is not unblocked here, because agreeing that an
 * organization has authorized something is not an engineering decision.
 */

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, '').split('=');
    return [k, v.join('=')];
  }),
);

function fail(msg, code = 2) {
  console.error(`FAIL: ${msg}`);
  process.exit(code);
}

// ---- guard 1: environment ------------------------------------------------
const nodeEnv = process.env.NODE_ENV ?? 'development';
if (nodeEnv === 'production') {
  fail(
    'administrator provisioning is BLOCKED in production until OD-020 names the technical owner (DEP-016). ' +
      'No production admin is created in Stage 5.',
  );
}

// ---- guard 2: an owner must be named to run for real ---------------------
const ownerHandle = process.env.TECHNICAL_OWNER_HANDLE;
if (!ownerHandle) {
  console.error('BLOCKED: OD-020 is unresolved — TECHNICAL_OWNER_HANDLE is not set.');
  console.error('');
  console.error('This CLI is the mechanism for provisioning the first administrator, but an');
  console.error('administrator must belong to a named, accountable technical owner. Until');
  console.error('Shehersaaz names that person, no admin account is created — by design, not by');
  console.error('omission. See docs/foundation/12-secret-management.md and the OD-020 register.');
  process.exit(3);
}

// ---- guard 3: inputs -----------------------------------------------------
const username = args.username;
const displayName = args['display-name'];
if (!username || !displayName) {
  fail('usage: node provision-admin.mjs --username=<name> --display-name="<name>" [--dry-run]');
}
if (!/^[a-z0-9_]{3,30}$/.test(username)) {
  fail('username must be 3–30 chars of [a-z0-9_]');
}

// ---- guard 4: report readiness without acting on it ---------------------
const url = process.env.MIGRATION_DATABASE_URL ?? process.env.ADMIN_DATABASE_URL;

/**
 * Does the table exist?
 *
 * Asked through the `pg` client the repo already depends on, NOT by shelling
 * out to `psql`. The original shelled out, and on a host without the psql
 * binary a missing TOOL was indistinguishable from a missing TABLE - so this
 * script reported `adminsTableExists: false` long after migration 0003 created
 * it. A diagnostic that quietly reports the wrong thing is worse than one that
 * admits it cannot tell, hence the three-way answer below.
 */
async function adminsTablePresent() {
  if (!url) return null; // no credential: genuinely unknown
  const client = new Client({ connectionString: url });
  try {
    await client.connect();
    const r = await client.query("SELECT to_regclass('public.admins') IS NOT NULL AS present");
    return r.rows[0]?.present === true;
  } catch {
    return null; // unreachable: unknown, not absent
  } finally {
    await client.end().catch(() => undefined);
  }
}

const adminsTableExists = await adminsTablePresent();

console.log(
  JSON.stringify(
    {
      mechanism: 'admin-provisioning-cli',
      wouldCreate: { username, displayName, ownedBy: ownerHandle },
      passwordPolicy: 'set out-of-band via the identity module; never passed on the CLI',
      adminsTableExists: adminsTableExists ?? 'unknown — no reachable database credential',
      action:
        adminsTableExists === true
          ? 'schema ready — still BLOCKED on OD-020 naming the technical owner'
          : adminsTableExists === false
            ? 'the admins table does not exist yet — run the migrations'
            : 'could not determine schema state; set MIGRATION_DATABASE_URL to check',
      created: false,
      note:
        'The mechanism exists and the schema is in place. No administrator is created because ' +
        'OD-020 has not named an accountable owner (DEP-016) - a governance block, not a ' +
        'technical one, and not one an engineer may clear.',
    },
    null,
    2,
  ),
);

// Never create an account in Stage 5, regardless of flags.
process.exit(0);
