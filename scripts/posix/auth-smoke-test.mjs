/**
 * EPIC-02 AUTH SMOKE TEST — boots the REAL application against the REAL
 * database and drives the whole flow over HTTP.
 *
 * WHY THIS EXISTS SEPARATELY FROM THE UNIT TESTS
 *
 * The unit tests prove the rules. They cannot prove the routes are mounted, the
 * guard is applied, the pipes run, the DI graph resolves, or that the error
 * envelope a client actually receives says what it should. The foundation
 * learned this the hard way: the Socket.IO gateway compiled, passed its unit
 * tests, and silently never mounted because NestJS was not told to use the
 * adapter. Everything below is the class of failure that only appears when a
 * real request hits a real server.
 *
 * It also checks the things a client can OBSERVE rather than the things a
 * service returns — status codes, error codes, and whether two different
 * failures look different from the outside (SEC-006).
 *
 * Uses only the deterministic fake SMS provider, so no message reaches a real
 * recipient (public-repository addendum). Test data is synthetic and generated
 * per run, so repeated runs do not collide on the UNIQUE identifier index.
 */
import { randomUUID } from 'node:crypto';

const results = [];
let failures = 0;

function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  if (!ok) failures += 1;
  const mark = ok ? 'PASS' : 'FAIL';
  console.log(`  ${mark}  ${name}${detail === '' ? '' : ` — ${detail}`}`);
}

/** A distinct synthetic 03xx number per run. Never a real subscriber. */
function syntheticPhone(seed) {
  // 0300 is a real prefix, so the SUFFIX is randomised per run and the number
  // is never printed in full by this script.
  const suffix = String(seed % 10_000_000).padStart(7, '0');
  return `+92300${suffix}`;
}

async function main() {
  // Imported dynamically so a configuration failure is reported by this script
  // rather than as an unhandled module-load error.
  const { NestFactory } = await import('@nestjs/core');
  const { AppModule } = await import('../../apps/api/dist/app.module.js');
  const { configureApp } = await import('../../apps/api/dist/configure-app.js');
  const { loadEnv } = await import('../../apps/api/dist/config/env.js');
  const { StructuredLogger } =
    await import('../../apps/api/dist/common/logging/structured.logger.js');

  const env = loadEnv();
  const logger = new StructuredLogger('smoke', 'error');
  const app = await NestFactory.create(AppModule, { logger, bufferLogs: false });

  // The SAME composition the deployed process uses. Booting AppModule alone
  // gives an application with the same routes but no error envelope and no
  // proxy handling - which is how the first run of this script reported
  // `error.code: undefined` against an app that was actually correct.
  configureApp(app, env, logger);

  await app.listen(0);
  const url = await app.getUrl();
  const base = url.replace('[::1]', '127.0.0.1');

  const post = async (path, body, token) =>
    fetch(`${base}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
      },
      body: JSON.stringify(body),
    });

  const phone = syntheticPhone(Date.now());
  const password = 'synthetic-Smoke-Passw0rd';
  const terms = 'terms-2026-01';

  console.log('\n--- routes are mounted ---');
  {
    const r = await fetch(`${base}/health/live`);
    check('health/live still reachable without a token', r.status === 200, `status ${r.status}`);
  }
  {
    // The single most valuable assertion here: a 404 would mean the controller
    // never mounted, and every unit test would still be green.
    const r = await post('/register', {});
    check('POST /register exists', r.status !== 404, `status ${r.status}`);
  }

  console.log('\n--- the guard is applied globally ---');
  {
    const r = await post('/logout', {});
    const body = await r.json();
    check(
      'a guarded route refuses an anonymous request',
      r.status === 401 && body?.error?.code === 'AUTHENTICATION_REQUIRED',
      `status ${r.status} code ${body?.error?.code}`,
    );
  }
  {
    const r = await post('/logout', {}, 'not-a-real-token');
    check('a guarded route refuses a bogus token', r.status === 401, `status ${r.status}`);
  }

  console.log('\n--- validation rejects shape, not content ---');
  {
    const r = await post('/register', { phone, password, dateOfBirth: '1995-06-15' });
    const body = await r.json();
    check(
      'a missing required field is a validation failure',
      r.status === 400 && body?.error?.code === 'VALIDATION_FAILED',
      `status ${r.status} code ${body?.error?.code}`,
    );
  }
  {
    const r = await post('/register', {
      phone,
      password,
      dateOfBirth: '1995-06-15',
      termsVersion: terms,
      unexpected: 'field',
    });
    check('an unexpected field is rejected, not ignored', r.status === 400, `status ${r.status}`);
  }

  console.log('\n--- registration is uniform (SEC-006) ---');
  let firstRegister;
  {
    const r = await post('/register', {
      phone,
      password,
      dateOfBirth: '1995-06-15',
      termsVersion: terms,
    });
    firstRegister = { status: r.status, body: await r.json() };
    check('a free number returns 202', r.status === 202, `status ${r.status}`);
  }
  {
    // Same number again. This is the enumeration test that matters: the client
    // must not be able to tell that the number is now taken.
    const r = await post('/register', {
      phone,
      password,
      dateOfBirth: '1995-06-15',
      termsVersion: terms,
    });
    const body = await r.json();
    check(
      'AN ALREADY-REGISTERED NUMBER IS INDISTINGUISHABLE',
      r.status === firstRegister.status &&
        JSON.stringify(body) === JSON.stringify(firstRegister.body),
      `status ${r.status} vs ${firstRegister.status}`,
    );
  }

  console.log('\n--- login before verification ---');
  {
    const r = await post('/login', { phone, password });
    const body = await r.json();
    check(
      'an unverified account is routed to OTP',
      r.status === 200 && body?.status === 'VERIFICATION_REQUIRED',
      `status ${r.status} body ${body?.status}`,
    );
  }

  console.log('\n--- login failures are one answer ---');
  const answers = [];
  for (const [label, attempt] of [
    ['wrong password', { phone, password: 'synthetic-Wrong-Passw0rd' }],
    ['unknown number', { phone: syntheticPhone(Date.now() + 7777), password }],
  ]) {
    const r = await post('/login', attempt);
    const body = await r.json();
    answers.push(`${r.status}:${body?.error?.code}`);
    check(
      `${label} returns 401 INVALID_CREDENTIALS`,
      r.status === 401 && body?.error?.code === 'INVALID_CREDENTIALS',
      `${r.status} ${body?.error?.code}`,
    );
  }
  check(
    'wrong password and unknown number are the SAME response',
    new Set(answers).size === 1,
    answers.join(' vs '),
  );

  console.log('\n--- OTP verification and the real session ---');
  {
    // The fake provider records rather than sends, so the code is readable from
    // the provider instance the running app is using.
    // Resolved by its PORT token: the provider is registered as SMS_PROVIDER
    // via `useClass`, so the class itself is not a resolvable token.
    const { SMS_PROVIDER } =
      await import('../../apps/api/dist/modules/platform/identity/ports/sms-provider.port.js');
    const sms = app.get(SMS_PROVIDER, { strict: false });
    const sent = sms?.lastTo?.(phone);
    const code = sent?.body?.match(/\b(\d{6})\b/)?.[1];
    check('the OTP was dispatched to the fake provider', code !== undefined);

    if (code !== undefined) {
      const wrong = await post('/otp/verify', { phone, code: '000000' });
      check('a wrong code is refused with 401', wrong.status === 401, `status ${wrong.status}`);

      const r = await post('/otp/verify', { phone, code });
      const body = await r.json();
      check(
        'the correct code verifies',
        r.status === 200 && body?.status === 'VERIFIED',
        `status ${r.status}`,
      );

      const replay = await post('/otp/verify', { phone, code });
      check('the code cannot be replayed', replay.status === 401, `status ${replay.status}`);
    }
  }

  let token;
  {
    const r = await post('/login', { phone, password, deviceLabel: 'smoke-test' });
    const body = await r.json();
    token = body?.token;
    check(
      'login now issues a session',
      r.status === 200 && body?.status === 'AUTHENTICATED' && typeof token === 'string',
      `status ${r.status}`,
    );
    check(
      'the session reports FULL capability',
      body?.capability === 'FULL',
      String(body?.capability),
    );
  }

  console.log('\n--- the session actually authenticates, and logout ends it ---');
  if (typeof token === 'string') {
    const r = await post('/logout', {}, token);
    check('logout accepts the session', r.status === 204, `status ${r.status}`);

    // EDGE-010: revocation must bite on the very next request.
    const after = await post('/logout', {}, token);
    check(
      'THE REVOKED TOKEN IS REFUSED ON THE NEXT REQUEST',
      after.status === 401,
      `status ${after.status}`,
    );
  }

  console.log('\n--- password reset is uniform too ---');
  {
    const known = await post('/password/forgot', { phone });
    const unknown = await post('/password/forgot', { phone: syntheticPhone(Date.now() + 31) });
    check(
      'forgot-password answers identically for known and unknown numbers',
      known.status === unknown.status &&
        JSON.stringify(await known.json()) === JSON.stringify(await unknown.json()),
      `${known.status} vs ${unknown.status}`,
    );
  }

  console.log('\n--- admin login is a separate store (SEC-020) ---');
  {
    const r = await post('/admin/login', { email: `${randomUUID()}@example.invalid`, password });
    const body = await r.json();
    check(
      'admin login refuses an unknown administrator with 401',
      r.status === 401 && body?.error?.code === 'INVALID_CREDENTIALS',
      `status ${r.status} code ${body?.error?.code}`,
    );
  }

  // A SYNTHETIC administrator row, seeded with the MIGRATION credential and
  // removed afterwards.
  //
  // This is NOT provisioning. The real path is the technical owner's CLI, which
  // remains blocked on OD-020 naming an accountable owner - a governance block
  // no engineer may clear. This is test data in a local database, and it exists
  // because the section 14 matrix requires proving that a user credential
  // cannot open the admin console and vice versa, which cannot be shown without
  // one administrator to try it against.
  //
  // It uses MIGRATION_DATABASE_URL, not the API's own connection, because
  // migration 0007 removed INSERT on `admins` from the runtime role: an
  // application-level flaw must not be able to mint an administrator. Seeding
  // here through the owner credential is the same route a real provisioning run
  // would take, so the test exercises the privilege boundary rather than
  // pretending it is not there.
  const adminEmail = `smoke-${randomUUID()}@example.invalid`;
  const adminPassword = 'synthetic-Admin-Smoke-Passw0rd';

  const { PASSWORD_HASHER } =
    await import('../../apps/api/dist/modules/platform/identity/ports/password-hasher.port.js');
  const hasher = app.get(PASSWORD_HASHER, { strict: false });

  const migrationUrl = process.env.MIGRATION_DATABASE_URL;
  let owner;
  let adminInserted = false;

  if (migrationUrl === undefined) {
    console.log('  SKIP  admin round-trip - MIGRATION_DATABASE_URL not set');
  } else {
    const { Client } = await import('pg');
    owner = new Client({ connectionString: migrationUrl });
    await owner.connect();

    // Confirm the boundary really is in force before relying on it. If the
    // runtime role can still insert here, migration 0007 has regressed and this
    // must be loud rather than silently still passing.
    const { DatabaseService } = await import('../../apps/api/dist/database/database.service.js');
    const runtimeDb = app.get(DatabaseService, { strict: false });
    let runtimeCouldInsert = false;
    try {
      await runtimeDb.query(
        'INSERT INTO admins (id, email, password_hash, state) VALUES ($1,$2,$3,$4)',
        [randomUUID(), `leak-${randomUUID()}@example.invalid`, 'x', 'ACTIVE'],
      );
      runtimeCouldInsert = true;
    } catch {
      runtimeCouldInsert = false;
    }
    check(
      'THE RUNTIME ROLE CANNOT CREATE AN ADMINISTRATOR (migration 0007)',
      !runtimeCouldInsert,
      runtimeCouldInsert ? 'INSERT on admins succeeded as runtime_app' : 'refused',
    );

    await owner.query(
      'INSERT INTO admins (id, email, password_hash, state, display_name) VALUES ($1,$2,$3,$4,$5)',
      [randomUUID(), adminEmail, await hasher.hash(adminPassword), 'ACTIVE', 'Smoke Admin'],
    );
    adminInserted = true;
  }

  if (adminInserted) {
    let adminToken;
    {
      const r = await post('/admin/login', { email: adminEmail, password: adminPassword });
      const body = await r.json();
      adminToken = body?.token;
      check(
        'a real administrator can sign in',
        r.status === 200 && typeof adminToken === 'string',
        `status ${r.status}`,
      );

      // SEC-024: 8 hours ABSOLUTE, not the 60-day user idle window.
      const hours = (new Date(body?.expiresAt).getTime() - Date.now()) / 3_600_000;
      check(
        'the admin session is ~8 hours, not 60 days',
        hours > 7.9 && hours < 8.1,
        `${hours.toFixed(2)}h`,
      );
    }

    if (typeof adminToken === 'string') {
      const asUser = await post('/logout', {}, adminToken);
      check(
        'AN ADMIN TOKEN DOES NOT WORK AS A USER SESSION',
        asUser.status === 401,
        `status ${asUser.status}`,
      );

      const out = await post('/admin/logout', {}, adminToken);
      check('admin logout accepts the admin session', out.status === 204, `status ${out.status}`);

      const again = await post('/admin/logout', {}, adminToken);
      check(
        'the admin session is dead after logout',
        again.status === 401,
        `status ${again.status}`,
      );
    }

    {
      const r = await post('/admin/login', { email: adminEmail, password });
      check(
        'a USER password does not open the admin console',
        r.status === 401,
        `status ${r.status}`,
      );
    }
    {
      const r = await post('/login', { phone, password: adminPassword });
      check(
        'AN ADMIN PASSWORD DOES NOT OPEN A USER SESSION',
        r.status === 401,
        `status ${r.status}`,
      );
    }

    // Remove the synthetic row so repeated runs leave nothing behind.
    await owner.query('DELETE FROM admins WHERE email = $1', [adminEmail]);
  }

  if (owner !== undefined) await owner.end().catch(() => undefined);

  console.log('\n--- no secret leaves the server ---');
  {
    const r = await post('/login', { phone, password: 'synthetic-Wrong-Passw0rd' });
    const text = await r.text();
    check(
      'an error body contains neither the password nor the number',
      !text.includes('synthetic-Wrong-Passw0rd') && !text.includes(phone.slice(3)),
    );
  }

  await app.close();

  console.log('\n═══════════════════ AUTH SMOKE SUMMARY ═══════════════════');
  console.log(
    `  ${results.length - failures} passed · ${failures} failed · ${results.length} total`,
  );
  if (failures > 0) {
    console.log('\nAUTH SMOKE: FAILED');
    process.exit(1);
  }
  console.log('\nAUTH SMOKE: ALL CHECKS PASSED');
}

main().catch((e) => {
  console.error('\nAUTH SMOKE: ERRORED');
  console.error(e instanceof Error ? e.stack : String(e));
  process.exit(2);
});
