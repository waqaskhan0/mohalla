/**
 * API SMOKE TEST — boots the REAL application against the REAL database and
 * drives each epic's flow over HTTP.
 *
 * Covers EPIC-02 (authentication and sessions) and EPIC-04 (profiles). Later
 * epics append their own section rather than starting a new file: the value is
 * in one process exercising the whole surface, and a per-epic file would let
 * two epics pass separately while conflicting when mounted together.
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

  const send = async (method, path, body, token) =>
    fetch(`${base}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const get = (path, token) => send('GET', path, undefined, token);

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

  /**
   * Register, verify, sign in, claim a handle and create a profile.
   *
   * Returns a fully onboarded user, because that is what every social-graph
   * check needs and repeating six requests inline would bury the assertions.
   */
  const onboard = async (seed) => {
    const { SMS_PROVIDER } =
      await import('../../apps/api/dist/modules/platform/identity/ports/sms-provider.port.js');
    const provider = app.get(SMS_PROVIDER, { strict: false });

    const number = syntheticPhone(seed);
    await post('/register', {
      phone: number,
      password,
      dateOfBirth: '1995-06-15',
      termsVersion: terms,
    });
    const otp = provider?.lastTo?.(number)?.body?.match(/\b(\d{6})\b/)?.[1];
    await post('/otp/verify', { phone: number, code: otp, purpose: 'REGISTRATION' });

    const login = await post('/login', { phone: number, password });
    const token = (await login.json())?.token;

    const handle = `u${String(seed).slice(-9)}`;
    await post('/me/username', { username: handle }, token);
    await post('/me/profile', { displayName: `Person ${handle}` }, token);

    const me = await (await get('/me', token)).json();
    return { token, userId: me?.userId, handle, phone: number };
  };

  console.log('\n--- profiles: the full onboarding flow (EPIC-04) ---');
  {
    // A fresh verified account, so this section does not depend on the state
    // the auth section left behind.
    const p2 = syntheticPhone(Date.now() + 4242);
    await post('/register', {
      phone: p2,
      password,
      dateOfBirth: '1995-06-15',
      termsVersion: terms,
    });

    const { SMS_PROVIDER } =
      await import('../../apps/api/dist/modules/platform/identity/ports/sms-provider.port.js');
    const smsForProfile = app.get(SMS_PROVIDER, { strict: false });
    const code = smsForProfile?.lastTo?.(p2)?.body?.match(/\b(\d{6})\b/)?.[1];
    await post('/otp/verify', { phone: p2, code, purpose: 'REGISTRATION' });

    const login = await post('/login', { phone: p2, password });
    const session = (await login.json())?.token;
    check('a verified account can sign in for the profile flow', typeof session === 'string');

    // ---- routes exist ------------------------------------------------
    const handle = `n${String(Date.now()).slice(-8)}`;
    {
      const r = await get(`/username/available?u=${handle}`, session);
      const body = await r.json();
      check('GET /username/available exists', r.status === 200, `status ${r.status}`);
      check('a fresh handle is available', body?.available === true, JSON.stringify(body));
    }
    {
      // The reserved list must not be distinguishable from "taken".
      const reserved = await get('/username/available?u=shehersaaz', session);
      const rb = await reserved.json();
      check(
        'A RESERVED HANDLE REPORTS UNAVAILABLE WITH NO REASON',
        rb?.available === false && rb?.malformed === false && rb?.reason === undefined,
        JSON.stringify(rb),
      );
    }
    {
      const r = await get('/username/available?u=ab', session);
      const body = await r.json();
      check(
        'a malformed handle reports its reason',
        body?.reason === 'TOO_SHORT',
        JSON.stringify(body),
      );
    }

    // ---- profile requires a username first ---------------------------
    {
      const early = await post('/me/profile', { displayName: 'Too Early' }, session);
      check(
        'creating a profile before a username is refused',
        early.status === 409,
        `status ${early.status}`,
      );
    }

    // ---- claim, then create ------------------------------------------
    {
      const r = await post('/me/username', { username: handle }, session);
      check('POST /me/username claims the handle', r.status === 201, `status ${r.status}`);

      const again = await post('/me/username', { username: handle }, session);
      check(
        'A SECOND CLAIM IS REFUSED - the username is immutable (BR-005)',
        again.status === 409,
        `status ${again.status}`,
      );

      const taken = await get(`/username/available?u=${handle}`, session);
      const tb = await taken.json();
      check('the handle now reports as taken', tb?.available === false, JSON.stringify(tb));
      check(
        'and alternatives are suggested (PROFILE-FR-002 A1)',
        Array.isArray(tb?.suggestions) && tb.suggestions.length > 0,
        JSON.stringify(tb?.suggestions),
      );
    }
    {
      const r = await post(
        '/me/profile',
        { displayName: 'عائشہ خان', city: 'کراچی', bio: 'محلے کی رہائشی' },
        session,
      );
      const body = await r.json();
      check('POST /me/profile creates the profile', r.status === 201, `status ${r.status}`);
      check(
        'AN URDU DISPLAY NAME SURVIVES THE ROUND TRIP',
        body?.displayName === 'عائشہ خان',
        String(body?.displayName),
      );
      check('the Urdu city survives too', body?.city === 'کراچی', String(body?.city));
    }

    // ---- the projection, over the wire -------------------------------
    let myUserId;
    {
      const r = await get('/me', session);
      const own = await r.json();
      myUserId = own?.userId;
      check('GET /me returns the owner view', r.status === 200, `status ${r.status}`);
      check('it carries the account state', own?.state === 'ACTIVE', String(own?.state));

      const serialized = JSON.stringify(own);
      check(
        'THE OWNER VIEW CARRIES NO PHONE NUMBER AND NO DATE OF BIRTH',
        !serialized.includes(p2.slice(3)) && !serialized.includes('1995-06-15'),
      );
    }

    // ---- editing ------------------------------------------------------
    {
      const r = await send('PATCH', '/me/profile', { bio: null }, session);
      const body = await r.json();
      check(
        'PATCH clears an optional field when sent null',
        r.status === 200 && body?.bio === null,
        `status ${r.status}`,
      );
      check('and leaves an unmentioned field alone', body?.city === 'کراچی', String(body?.city));
    }
    {
      // BR-005 again, this time at the transport boundary: the edit DTO is
      // strict, so a username field must be rejected rather than ignored.
      const r = await send('PATCH', '/me/profile', { username: 'something_else' }, session);
      check(
        'PATCH REJECTS A USERNAME FIELD rather than ignoring it',
        r.status === 400,
        `status ${r.status}`,
      );
    }
    {
      const r = await send('PATCH', '/me/profile', { bio: 'x'.repeat(300) }, session);
      check('an over-long bio is refused', r.status === 400, `status ${r.status}`);
    }

    // ---- interests ----------------------------------------------------
    {
      const r = await get('/categories', session);
      const body = await r.json();
      check(
        'GET /categories returns the eleven seeded rows (BR-017)',
        r.status === 200 && body?.categories?.length === 11,
        `status ${r.status} count ${body?.categories?.length}`,
      );
      check(
        'each category carries both language names',
        body?.categories?.every((c) => c.nameEn && c.nameUr) === true,
      );
    }
    {
      const r = await send('PUT', '/me/interests', { slugs: ['health', 'education'] }, session);
      const body = await r.json();
      check('PUT /me/interests stores a selection', r.status === 200, `status ${r.status}`);
      check(
        'read back in taxonomy order',
        JSON.stringify(body?.interests) === JSON.stringify(['education', 'health']),
        JSON.stringify(body?.interests),
      );

      const empty = await send('PUT', '/me/interests', { slugs: [] }, session);
      check(
        'an empty selection is valid, since interests are optional',
        empty.status === 200,
        `status ${empty.status}`,
      );

      const bad = await send('PUT', '/me/interests', { slugs: ['not-a-category'] }, session);
      check(
        'an unknown slug is reported, not silently dropped',
        bad.status === 400,
        `status ${bad.status}`,
      );
    }

    // ---- viewing someone else ----------------------------------------
    {
      const viewer = await post('/login', { phone, password }, undefined);
      const viewerToken = (await viewer.json())?.token;

      if (typeof viewerToken === 'string' && typeof myUserId === 'string') {
        const r = await get(`/users/${myUserId}`, viewerToken);
        const pub = await r.json();
        check(
          'GET /users/{id} returns the public projection',
          r.status === 200,
          `status ${r.status}`,
        );

        // §162: display name, username, photo, city, bio, badge and counts -
        // "and nothing else".
        const keys = Object.keys(pub ?? {}).sort();
        check(
          'THE PUBLIC PROJECTION IS EXACTLY THE APPROVED FIELD SET',
          JSON.stringify(keys) ===
            JSON.stringify([
              'accountType',
              'bio',
              'city',
              'displayName',
              'followerCount',
              'followingCount',
              'photoMediaId',
              'postCount',
              'userId',
              'username',
              'verifiedBadge',
            ]),
          keys.join(','),
        );
      } else {
        console.log('  SKIP  public profile view - could not establish a second session');
      }
    }
    {
      // BR-025 / UX-STATE-001: one neutral state. An id that does not exist
      // must look exactly like a blocked or banned one.
      const r = await get('/users/00000000-0000-4000-8000-000000000000', session);
      const body = await r.json();
      check(
        'an unknown profile is one neutral 404 RESOURCE_UNAVAILABLE',
        r.status === 404 && body?.error?.code === 'RESOURCE_UNAVAILABLE',
        `status ${r.status} code ${body?.error?.code}`,
      );
    }
    {
      const anon = await get('/me');
      check(
        'the profile routes are guarded like everything else',
        anon.status === 401,
        `status ${anon.status}`,
      );
    }
  }

  console.log('\n--- social graph: follows and blocking (EPIC-05) ---');
  {
    const alice = await onboard(Date.now() + 11);
    const bob = await onboard(Date.now() + 22);
    check(
      'two onboarded users for the social checks',
      typeof alice.userId === 'string' && typeof bob.userId === 'string',
    );

    // ---- follow ------------------------------------------------------
    {
      const r = await send('PUT', `/users/${bob.userId}/follow`, undefined, alice.token);
      check('PUT /users/{id}/follow exists and succeeds', r.status === 204, `status ${r.status}`);

      const again = await send('PUT', `/users/${bob.userId}/follow`, undefined, alice.token);
      check(
        'A REPEAT FOLLOW IS IDEMPOTENT (EDGE-015)',
        again.status === 204,
        `status ${again.status}`,
      );

      // SOCIAL-FR-001 AC: exactly one relationship, count unchanged.
      const bobProfile = await (await get(`/users/${bob.userId}`, alice.token)).json();
      check(
        'THE FOLLOWER COUNT IS 1 AFTER TWO IDENTICAL FOLLOWS',
        bobProfile?.followerCount === 1,
        `followerCount ${bobProfile?.followerCount}`,
      );

      const aliceProfile = await (await get(`/users/${alice.userId}`, bob.token)).json();
      check(
        'and the following count moved too',
        aliceProfile?.followingCount === 1,
        `followingCount ${aliceProfile?.followingCount}`,
      );
    }
    {
      const r = await send('PUT', `/users/${alice.userId}/follow`, undefined, alice.token);
      check('a self-follow is refused (BR-019)', r.status === 400, `status ${r.status}`);
    }

    // ---- lists -------------------------------------------------------
    {
      const r = await get(`/users/${bob.userId}/followers`, alice.token);
      const body = await r.json();
      check(
        'GET followers returns full profiles, not bare ids',
        r.status === 200 && body?.users?.[0]?.username !== undefined,
        `status ${r.status}`,
      );
      check(
        'and alice is in the list',
        body?.users?.some((u) => u.userId === alice.userId) === true,
      );
    }
    {
      const r = await get(`/users/${alice.userId}/following`, alice.token);
      const body = await r.json();
      check(
        'GET following lists the accounts followed',
        body?.users?.some((u) => u.userId === bob.userId) === true,
      );
    }
    {
      const r = await get('/suggestions', alice.token);
      const body = await r.json();
      check(
        'GET /suggestions works with no interests selected',
        r.status === 200,
        `status ${r.status}`,
      );
      check(
        'and never suggests self or an account already followed',
        body?.users?.every((u) => u.userId !== alice.userId && u.userId !== bob.userId) === true,
      );
    }

    // ---- unfollow ----------------------------------------------------
    {
      const r = await send('DELETE', `/users/${bob.userId}/follow`, undefined, alice.token);
      check('DELETE removes the follow', r.status === 204, `status ${r.status}`);

      const bobProfile = await (await get(`/users/${bob.userId}`, alice.token)).json();
      check(
        'the count went back down (PROFILE-FR-009)',
        bobProfile?.followerCount === 0,
        `followerCount ${bobProfile?.followerCount}`,
      );

      const again = await send('DELETE', `/users/${bob.userId}/follow`, undefined, alice.token);
      check(
        'an unfollow with no relationship is idempotent',
        again.status === 204,
        `status ${again.status}`,
      );
    }

    // ---- blocking, and BR-024 ----------------------------------------
    {
      // Re-establish follows in BOTH directions, so the removal is visible.
      await send('PUT', `/users/${bob.userId}/follow`, undefined, alice.token);
      await send('PUT', `/users/${alice.userId}/follow`, undefined, bob.token);

      const before = await (await get(`/users/${bob.userId}`, alice.token)).json();
      check(
        'both directions established',
        before?.followerCount === 1,
        `followerCount ${before?.followerCount}`,
      );

      const r = await send('PUT', `/users/${bob.userId}/block`, undefined, alice.token);
      check('PUT /users/{id}/block exists and succeeds', r.status === 204, `status ${r.status}`);

      // ---- the whole point of EPIC-05 -------------------------------
      const asAlice = await get(`/users/${bob.userId}`, alice.token);
      check(
        'THE BLOCKER CANNOT SEE THE BLOCKED PROFILE',
        asAlice.status === 404,
        `status ${asAlice.status}`,
      );

      const asBob = await get(`/users/${alice.userId}`, bob.token);
      check(
        'AND THE BLOCKED USER CANNOT SEE THE BLOCKER (BR-025, mutual in effect)',
        asBob.status === 404,
        `status ${asBob.status}`,
      );

      const body = await asBob.json();
      check(
        'the refusal is the SAME neutral code as a missing profile',
        body?.error?.code === 'RESOURCE_UNAVAILABLE',
        String(body?.error?.code),
      );

      const missing = await get('/users/00000000-0000-4000-8000-000000000000', bob.token);
      const missingBody = await missing.json();
      check(
        'blocked and never-existed are indistinguishable over the wire',
        asBob.status === missing.status && body?.error?.code === missingBody?.error?.code,
      );

      // BR-024: follows removed in both directions, in the same transaction.
      const bobsFollowers = await get(`/users/${bob.userId}/followers`, bob.token);
      const bf = await bobsFollowers.json();
      check(
        'BLOCKING REMOVED THE FOLLOWS IN BOTH DIRECTIONS (BR-024)',
        bf?.users?.some((u) => u.userId === alice.userId) !== true,
      );

      // And a follow across the block is refused, neutrally.
      const crossFollow = await send('PUT', `/users/${bob.userId}/follow`, undefined, alice.token);
      check(
        'a follow across a block is refused with a neutral 404 (BR-023)',
        crossFollow.status === 404,
        `status ${crossFollow.status}`,
      );

      // The blocked user is not told, and cannot enumerate.
      const bobsBlockList = await (await get('/me/blocks', bob.token)).json();
      check(
        'THE BLOCKED USER IS NOT TOLD - their own block list is empty',
        Array.isArray(bobsBlockList?.blocks) && bobsBlockList.blocks.length === 0,
        JSON.stringify(bobsBlockList?.blocks),
      );

      const alicesBlockList = await (await get('/me/blocks', alice.token)).json();
      check(
        'the blocker sees their own list',
        alicesBlockList?.blocks?.[0]?.blockedUserId === bob.userId,
        JSON.stringify(alicesBlockList?.blocks),
      );
    }

    // ---- unblocking ---------------------------------------------------
    {
      const r = await send('DELETE', `/users/${bob.userId}/block`, undefined, alice.token);
      check('DELETE lifts the block', r.status === 204, `status ${r.status}`);

      const visible = await get(`/users/${bob.userId}`, alice.token);
      check('and the profile is visible again', visible.status === 200, `status ${visible.status}`);

      const followers = await (await get(`/users/${bob.userId}/followers`, alice.token)).json();
      check(
        'UNBLOCKING DOES NOT RESTORE THE FOLLOWS',
        followers?.users?.some((u) => u.userId === alice.userId) !== true,
      );

      const again = await send('DELETE', `/users/${bob.userId}/block`, undefined, alice.token);
      check('unblocking twice is idempotent', again.status === 204, `status ${again.status}`);
    }
    {
      const r = await send('PUT', `/users/${alice.userId}/block`, undefined, alice.token);
      check('a self-block is refused', r.status === 400, `status ${r.status}`);
    }
  }

  console.log('\n--- media and posts (EPIC-06) ---');
  {
    const author = await onboard(Date.now() + 33);
    const reader = await onboard(Date.now() + 44);

    /** A real PNG header, so content inspection has something genuine. */
    const png = (w = 64, h = 64) => {
      const out = new Uint8Array(24);
      out.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
      out.set(
        [...'IHDR'].map((c) => c.charCodeAt(0)),
        12,
      );
      const view = new DataView(out.buffer);
      view.setUint32(16, w, false);
      view.setUint32(20, h, false);
      return out;
    };

    const putBytes = (url, bytes, token) =>
      fetch(`${base}${url}`, {
        method: 'PUT',
        headers: {
          'content-type': 'application/octet-stream',
          authorization: `Bearer ${token}`,
        },
        body: bytes,
      });

    /** Slot -> upload -> complete. Returns the media id, or a rejection. */
    const uploadImage = async (token, bytes) => {
      const slot = await post(
        '/media/upload-slot',
        { kind: 'IMAGE', declaredBytes: bytes.length },
        token,
      );
      if (slot.status !== 201) return { failed: `slot ${slot.status}` };
      const { mediaId, upload } = await slot.json();

      const put = await putBytes(upload.url, bytes, token);
      if (put.status !== 204) return { failed: `upload ${put.status}` };

      const done = await post(`/media/${mediaId}/complete`, {}, token);
      return done.status === 200 ? { mediaId } : { failed: `complete ${done.status}`, mediaId };
    };

    // ---- the media pipeline over HTTP --------------------------------
    let readyMediaId;
    {
      const r = await uploadImage(author.token, png(1600, 900));
      readyMediaId = r.mediaId;
      check(
        'a genuine PNG completes the ADR-013 pipeline',
        r.failed === undefined,
        String(r.failed),
      );

      if (readyMediaId !== undefined) {
        const served = await fetch(`${base}/media/${readyMediaId}`, {
          headers: { authorization: `Bearer ${author.token}` },
        });
        check('READY media is served', served.status === 200, `status ${served.status}`);
        check(
          'with the VERIFIED content type, not a client claim',
          served.headers.get('content-type')?.includes('image/png') === true,
          String(served.headers.get('content-type')),
        );
        check(
          'and nosniff, so a browser cannot second-guess it',
          served.headers.get('x-content-type-options') === 'nosniff',
        );
      }
    }
    {
      // SEC-013 / EDGE-014 over the wire: the bytes are what decide.
      const exe = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00]);
      const r = await uploadImage(author.token, exe);
      check(
        'AN EXECUTABLE IS REFUSED AT COMPLETE (SEC-013)',
        r.failed?.startsWith('complete 400') === true,
        String(r.failed),
      );

      if (r.mediaId !== undefined) {
        const served = await fetch(`${base}/media/${r.mediaId}`, {
          headers: { authorization: `Bearer ${author.token}` },
        });
        check(
          'and the rejected object is not servable',
          served.status === 404,
          `status ${served.status}`,
        );
      }
    }
    {
      const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00]);
      const r = await uploadImage(author.token, zip);
      check(
        'a ZIP is refused however it is labelled (EDGE-014)',
        r.failed?.startsWith('complete 400') === true,
        String(r.failed),
      );
    }
    {
      const r = await post(
        '/media/upload-slot',
        { kind: 'IMAGE', declaredBytes: 40 * 1024 * 1024 },
        author.token,
      );
      check(
        'a 40 MB declaration is refused before bytes move (MEDIA-FR-005)',
        r.status === 400,
        `status ${r.status}`,
      );
    }
    {
      const r = await post(
        '/media/upload-slot',
        { kind: 'DOCUMENT', declaredBytes: 1000 },
        author.token,
      );
      check(
        'PDF is gated off by default (ADR-013 Technical Lead gate)',
        r.status === 400,
        `status ${r.status}`,
      );
    }

    // ---- posts --------------------------------------------------------
    let postId;
    {
      const r = await post(
        '/posts',
        {
          body: 'محلے میں پانی کا مسئلہ ہے۔ کل سے سپلائی بند ہے۔',
          categorySlug: 'water-sanitation',
        },
        author.token,
      );
      const body = await r.json();
      postId = body?.id;
      check('POST /posts publishes a post', r.status === 201, `status ${r.status}`);
      check(
        'AN URDU BODY SURVIVES THE ROUND TRIP',
        body?.body?.startsWith('محلے میں پانی') === true,
        String(body?.body).slice(0, 30),
      );
      check(
        'the category is attached',
        body?.categorySlug === 'water-sanitation',
        String(body?.categorySlug),
      );
      check(
        'and the author is the full public projection',
        body?.author?.username === author.handle,
        String(body?.author?.username),
      );
    }
    {
      // BR-012 counted in GRAPHEME CLUSTERS: 3,000 Urdu characters with
      // diacritics is more than 3,000 code points and must still be accepted.
      const urdu3000 = 'کِ'.repeat(3000);
      const r = await post('/posts', { body: urdu3000 }, author.token);
      check('3,000 URDU GRAPHEMES ARE ACCEPTED (BR-012)', r.status === 201, `status ${r.status}`);

      const tooLong = await post('/posts', { body: 'x'.repeat(3001) }, author.token);
      check(
        '3,001 characters are refused with the client bypassed',
        tooLong.status === 400,
        `status ${tooLong.status}`,
      );
    }
    {
      const empty = await post('/posts', { body: '   ' }, author.token);
      check(
        'an empty post with no attachment is refused',
        empty.status === 400,
        `status ${empty.status}`,
      );

      if (readyMediaId !== undefined) {
        const attachmentOnly = await post(
          '/posts',
          { body: '', mediaIds: [readyMediaId] },
          author.token,
        );
        check(
          'but an attachment-only post is fine (§12)',
          attachmentOnly.status === 201,
          `status ${attachmentOnly.status}`,
        );
      }
    }

    // ---- ADR-013 step 7, over the wire --------------------------------
    {
      const slot = await post(
        '/media/upload-slot',
        { kind: 'IMAGE', declaredBytes: 100 },
        author.token,
      );
      const { mediaId } = await slot.json();
      // Never uploaded, so still PENDING_UPLOAD.
      const r = await post(
        '/posts',
        { body: 'with a pending image', mediaIds: [mediaId] },
        author.token,
      );
      const body = await r.json();
      check(
        'A POST CANNOT REFERENCE MEDIA THAT IS NOT READY (ADR-013 step 7)',
        r.status === 409 && body?.error?.code === 'MEDIA_NOT_READY',
        `status ${r.status} code ${body?.error?.code}`,
      );
    }
    {
      // The reader uploads their own image; the author must not be able to
      // staple it to their post.
      const theirs = await uploadImage(reader.token, png(32, 32));
      if (theirs.mediaId !== undefined) {
        const r = await post(
          '/posts',
          { body: 'not mine', mediaIds: [theirs.mediaId] },
          author.token,
        );
        check("AND CANNOT USE SOMEONE ELSE'S MEDIA", r.status === 409, `status ${r.status}`);
      }
    }
    {
      const r = await post(
        '/posts',
        { body: 'nonexistent', mediaIds: ['00000000-0000-4000-8000-000000000000'] },
        author.token,
      );
      check(
        'a nonexistent media id is an answer, not a 500',
        r.status === 409,
        `status ${r.status}`,
      );
    }

    // ---- read, edit, delete -------------------------------------------
    if (typeof postId === 'string') {
      {
        const r = await get(`/posts/${postId}`, reader.token);
        check('another user can read the post', r.status === 200, `status ${r.status}`);
      }
      {
        const r = await send(
          'PATCH',
          `/posts/${postId}`,
          { body: 'محلے میں پانی بحال ہو گیا ہے۔' },
          author.token,
        );
        const body = await r.json();
        check('PATCH edits the body', r.status === 200, `status ${r.status}`);
        check(
          'and sets the "edited" marker (POST-FR-008)',
          typeof body?.editedAt === 'string',
          String(body?.editedAt),
        );
      }
      {
        // BR-014 at the transport boundary.
        const r = await send('PATCH', `/posts/${postId}`, { mediaIds: [] }, author.token);
        check(
          'PATCH REJECTS mediaIds rather than ignoring it (BR-014)',
          r.status === 400,
          `status ${r.status}`,
        );
      }
      {
        const r = await send('PATCH', `/posts/${postId}`, { body: 'hijacked' }, reader.token);
        check(
          'another user cannot edit the post, and gets the neutral 404',
          r.status === 404,
          `status ${r.status}`,
        );
      }
      {
        const r = await get(`/users/${author.userId}/posts`, reader.token);
        const body = await r.json();
        check(
          'GET /users/{id}/posts lists them (PROF-API-007)',
          r.status === 200,
          `status ${r.status}`,
        );
        check('newest first', Array.isArray(body?.posts) && body.posts.length > 0);
      }
      {
        const r = await send('DELETE', `/posts/${postId}`, undefined, reader.token);
        check('another user cannot delete the post', r.status === 404, `status ${r.status}`);
      }
      {
        const r = await send('DELETE', `/posts/${postId}`, undefined, author.token);
        check('the author can delete it', r.status === 204, `status ${r.status}`);

        const gone = await get(`/posts/${postId}`, reader.token);
        const goneBody = await gone.json();
        check(
          'A DELETED POST IS THE SAME NEUTRAL 404 AS ONE THAT NEVER EXISTED',
          gone.status === 404 && goneBody?.error?.code === 'RESOURCE_UNAVAILABLE',
          `status ${gone.status} code ${goneBody?.error?.code}`,
        );

        const missing = await get('/posts/00000000-0000-4000-8000-000000000000', reader.token);
        const missingBody = await missing.json();
        check(
          'byte-identical to a missing one',
          gone.status === missing.status && goneBody?.error?.code === missingBody?.error?.code,
        );

        const again = await send('DELETE', `/posts/${postId}`, undefined, author.token);
        // POST-FR-007's error case is "post already deleted -> idempotent
        // no-op", so the AUTHOR gets 204 again. A 404 would be wrong: they
        // asked for a state, and that state holds.
        check(
          'deleting twice is idempotent for the author',
          again.status === 204,
          `status ${again.status}`,
        );
      }
    }
    {
      const anon = await get('/posts/00000000-0000-4000-8000-000000000000');
      check(
        'post routes are guarded like everything else',
        anon.status === 401,
        `status ${anon.status}`,
      );
    }
  }

  console.log('\n--- engagement and feeds (EPIC-07) ---');
  {
    const writer = await onboard(Date.now() + 55);
    const reader = await onboard(Date.now() + 66);
    const stranger = await onboard(Date.now() + 77);

    // The reader follows the writer; the stranger follows nobody.
    await send('PUT', `/users/${writer.userId}/follow`, undefined, reader.token);

    /** Publish `n` posts and return their ids, oldest first. */
    const publish = async (token, n, prefix, category) => {
      const ids = [];
      for (let i = 0; i < n; i += 1) {
        const r = await post(
          '/posts',
          { body: `${prefix} ${i}`, ...(category === undefined ? {} : { categorySlug: category }) },
          token,
        );
        const body = await r.json();
        if (body?.id !== undefined) ids.push(body.id);
      }
      return ids;
    };

    const posted = await publish(writer.token, 25, 'notice');
    check('the writer published 25 posts', posted.length === 25, `${posted.length}`);

    // ---- likes -------------------------------------------------------
    const target = posted[0];
    {
      const r = await send('PUT', `/posts/${target}/like`, undefined, reader.token);
      check('PUT /posts/{id}/like works', r.status === 204, `status ${r.status}`);

      // ENGAGE-FR-001 AC: six rapid taps change the count by at most one.
      await Promise.all(
        Array.from({ length: 6 }, () =>
          send('PUT', `/posts/${target}/like`, undefined, reader.token),
        ),
      );
      const view = await (await get(`/posts/${target}`, reader.token)).json();
      check(
        'SIX RAPID TAPS CHANGE THE COUNT BY AT MOST ONE (ENGAGE-FR-001)',
        view?.likeCount === 1,
        `likeCount ${view?.likeCount}`,
      );

      const un = await send('DELETE', `/posts/${target}/like`, undefined, reader.token);
      check('DELETE unlikes', un.status === 204, `status ${un.status}`);
      const after = await (await get(`/posts/${target}`, reader.token)).json();
      check(
        'and the count goes back down',
        after?.likeCount === 0,
        `likeCount ${after?.likeCount}`,
      );

      const again = await send('DELETE', `/posts/${target}/like`, undefined, reader.token);
      check('unliking twice is idempotent', again.status === 204, `status ${again.status}`);
    }
    {
      const own = await send('PUT', `/posts/${target}/like`, undefined, writer.token);
      check('a user may like their OWN post', own.status === 204, `status ${own.status}`);
      await send('DELETE', `/posts/${target}/like`, undefined, writer.token);
    }

    // ---- comments and one-level nesting -------------------------------
    let topCommentId;
    {
      const r = await post(
        '/posts/' + target + '/comments',
        { body: 'شکریہ، بہت مفید' },
        reader.token,
      );
      const body = await r.json();
      topCommentId = body?.id;
      check('POST a comment', r.status === 201, `status ${r.status}`);
      check(
        'AN URDU COMMENT SURVIVES THE ROUND TRIP',
        body?.body === 'شکریہ، بہت مفید',
        String(body?.body),
      );

      const empty = await post(`/posts/${target}/comments`, { body: '   ' }, reader.token);
      check('an empty comment is refused', empty.status === 400, `status ${empty.status}`);

      const tooLong = await post(
        `/posts/${target}/comments`,
        { body: 'x'.repeat(1001) },
        reader.token,
      );
      check('an over-long comment is refused', tooLong.status === 400, `status ${tooLong.status}`);
    }
    let replyId;
    if (typeof topCommentId === 'string') {
      const r = await post(`/comments/${topCommentId}/replies`, { body: 'a reply' }, writer.token);
      const body = await r.json();
      replyId = body?.id;
      check('POST a reply', r.status === 201, `status ${r.status}`);
      check(
        'it attaches to the top-level comment',
        body?.parentCommentId === topCommentId,
        String(body?.parentCommentId),
      );
    }
    if (typeof replyId === 'string') {
      const r = await post(
        `/comments/${replyId}/replies`,
        { body: 'reply to reply' },
        reader.token,
      );
      const body = await r.json();
      check(
        'A REPLY-TO-A-REPLY ATTACHES TO THE SAME THREAD, never a third level (BR-033)',
        r.status === 201 && body?.parentCommentId === topCommentId,
        `status ${r.status} parent ${body?.parentCommentId}`,
      );
    }
    {
      const r = await get(`/posts/${target}/comments`, reader.token);
      const body = await r.json();
      check(
        'GET comments returns them oldest-first',
        r.status === 200 && body?.comments?.[0]?.body === 'شکریہ، بہت مفید',
        `status ${r.status}`,
      );
      check('with full author projections', body?.comments?.[0]?.author?.username !== undefined);
    }

    // ---- who may delete a comment (BR-020) ----------------------------
    if (typeof topCommentId === 'string') {
      const byStranger = await send(
        'DELETE',
        `/comments/${topCommentId}`,
        undefined,
        stranger.token,
      );
      check(
        'a third party cannot delete a comment',
        byStranger.status === 404,
        `status ${byStranger.status}`,
      );

      // The POST's author may delete any comment on it (ENGAGE-FR-005).
      const byPostAuthor = await send(
        'DELETE',
        `/comments/${topCommentId}`,
        undefined,
        writer.token,
      );
      check(
        "THE POST'S AUTHOR MAY DELETE ANY COMMENT ON IT (BR-020)",
        byPostAuthor.status === 204,
        `status ${byPostAuthor.status}`,
      );

      const after = await (await get(`/posts/${target}/comments`, reader.token)).json();
      check(
        'and its replies went with it (ENGAGE-FR-004)',
        Array.isArray(after?.comments) && after.comments.length === 0,
        `${after?.comments?.length} left`,
      );
    }

    // ---- feeds --------------------------------------------------------
    {
      const r = await get('/feed/following?limit=20', reader.token);
      const body = await r.json();
      check('GET /feed/following works', r.status === 200, `status ${r.status}`);
      check(
        'and returns 20 per page (FEED-FR-004)',
        body?.items?.length === 20,
        `${body?.items?.length}`,
      );

      // BR-026: strictly reverse-chronological.
      const times = (body?.items ?? []).map((i) => new Date(i.createdAt).getTime());
      const descending = times.every((t, i) => i === 0 || times[i - 1] >= t);
      check('STRICTLY NEWEST-FIRST, never ranked (BR-026)', descending);

      check(
        'items carry the viewer like state',
        typeof body?.items?.[0]?.viewerHasLiked === 'boolean',
      );
      check('and a cursor for the next page', body?.nextCursor?.id !== undefined);
    }
    {
      // FEED-FR-004 AC: paging while new posts are created must not repeat or
      // skip an item. Keyset pagination is what makes that true.
      const seen = new Set();
      let cursor;
      let duplicates = 0;
      for (let page = 0; page < 3; page += 1) {
        const qs =
          cursor === undefined
            ? ''
            : `&cursorCreatedAt=${encodeURIComponent(cursor.createdAt)}&cursorId=${cursor.id}`;
        const r = await get(`/feed/following?limit=10${qs}`, reader.token);
        const body = await r.json();
        for (const item of body?.items ?? []) {
          if (seen.has(item.id)) duplicates += 1;
          seen.add(item.id);
        }
        cursor = body?.nextCursor ?? undefined;
        // A new post lands mid-scroll, which is what breaks OFFSET.
        await post('/posts', { body: `interleaved ${page}` }, writer.token);
        if (cursor === undefined) break;
      }
      check(
        'KEYSET PAGING REPEATS NOTHING WHILE POSTS ARE CREATED (EDGE-017)',
        duplicates === 0,
        `${duplicates} duplicates`,
      );
    }
    {
      const r = await get('/feed/discover?limit=5', stranger.token);
      const body = await r.json();
      check(
        'GET /feed/discover works for an account following NOBODY',
        r.status === 200,
        `status ${r.status}`,
      );
      check(
        'and it is not empty - the cold-start answer (FEED-FR-003)',
        (body?.items?.length ?? 0) > 0,
        `${body?.items?.length} items`,
      );
    }
    {
      const empty = await get('/feed/following', stranger.token);
      const body = await empty.json();
      check(
        'the following feed of someone following nobody is empty, not an error',
        empty.status === 200 && body?.items?.length === 0,
        `status ${empty.status} items ${body?.items?.length}`,
      );
    }
    {
      const r = await get('/feed/featured', stranger.token);
      const body = await r.json();
      check(
        'GET /feed/featured resolves independently (RSK-001)',
        r.status === 200,
        `status ${r.status}`,
      );
      check(
        'and returns an array so the client hides an empty section',
        Array.isArray(body?.announcements),
        JSON.stringify(body?.announcements),
      );
    }
    {
      await publish(writer.token, 2, 'health notice', 'health');
      const r = await get('/feed/discover?category=health&limit=20', reader.token);
      const body = await r.json();
      const allHealth = (body?.items ?? []).every((i) => i.categorySlug === 'health');
      check(
        'FILTERING BY CATEGORY RETURNS ONLY THAT CATEGORY (FEED-FR-006)',
        r.status === 200 && (body?.items?.length ?? 0) > 0 && allHealth,
        `status ${r.status} items ${body?.items?.length}`,
      );
    }
    {
      const bad = await get('/feed/following?limit=20&cursorId=not-a-uuid', reader.token);
      check(
        'a malformed cursor is rejected, not silently ignored',
        bad.status === 400,
        `status ${bad.status}`,
      );
    }

    // ---- blocking removes content from the feed -----------------------
    {
      await send('PUT', `/users/${writer.userId}/block`, undefined, reader.token);
      const r = await get('/feed/discover?limit=50', reader.token);
      const body = await r.json();
      const fromWriter = (body?.items ?? []).filter((i) => i.author?.userId === writer.userId);
      check(
        'A BLOCKED AUTHOR VANISHES FROM THE FEED (BR-027)',
        fromWriter.length === 0,
        `${fromWriter.length} still present`,
      );
      await send('DELETE', `/users/${writer.userId}/block`, undefined, reader.token);
    }

    // ---- saved posts ---------------------------------------------------
    {
      const r = await send('PUT', `/posts/${target}/save`, undefined, reader.token);
      check('PUT /posts/{id}/save works', r.status === 204, `status ${r.status}`);

      const saved = await (await get('/me/saved', reader.token)).json();
      check('the post appears in /me/saved', saved?.items?.some((i) => i.id === target) === true);

      const theirs = await (await get('/me/saved', writer.token)).json();
      check(
        'SAVING IS PRIVATE - the author does not see it',
        theirs?.items?.some((i) => i.id === target) !== true,
      );

      await send('DELETE', `/posts/${target}/save`, undefined, reader.token);
      const gone = await (await get('/me/saved', reader.token)).json();
      check('and unsaving removes it', gone?.items?.some((i) => i.id === target) !== true);
    }
    {
      const anon = await get('/feed/discover');
      check(
        'feed routes are guarded like everything else',
        anon.status === 401,
        `status ${anon.status}`,
      );
    }
  }

  console.log('\n--- search, including cross-script (EPIC-08) ---');
  {
    const searcher = await onboard(Date.now() + 88);
    const hidden = await onboard(Date.now() + 99);

    // Two posts about the same thing, one in each script.
    await post('/posts', { body: 'ہمارے محلے میں پانی کی سپلائی بند ہے' }, searcher.token);
    await post('/posts', { body: 'hamare mohalle mein pani ki supply band hai' }, searcher.token);
    await post('/posts', { body: 'بجلی کا مسئلہ تین دن سے جاری ہے' }, searcher.token);
    const blockedPost = await (
      await post('/posts', { body: 'پانی کے بارے میں ایک اور پوسٹ' }, hidden.token)
    ).json();

    const searchPosts = async (q, token) => {
      const r = await get(`/search/posts?q=${encodeURIComponent(q)}`, token);
      return { status: r.status, body: await r.json() };
    };

    // ---- SEARCH-FR-003's acceptance criterion, over HTTP -------------
    {
      const r = await searchPosts('pani', searcher.token);
      const bodies = (r.body?.results ?? []).map((x) => x.body);
      check('GET /search/posts works', r.status === 200, `status ${r.status}`);
      check(
        'A ROMAN QUERY FINDS THE URDU POST (SEARCH-FR-003 AC)',
        bodies.some((b) => b.includes('پانی')),
        `${bodies.length} results`,
      );
      check(
        'and the Roman post too',
        bodies.some((b) => b.includes('pani')),
      );
    }
    {
      const r = await searchPosts('پانی', searcher.token);
      const bodies = (r.body?.results ?? []).map((x) => x.body);
      check(
        'AN URDU QUERY FINDS THE ROMAN POST (the reverse criterion)',
        bodies.some((b) => b.includes('pani')),
        `${bodies.length} results`,
      );
    }
    {
      const r = await searchPosts('paani', searcher.token);
      check(
        'a spelling variant still finds it (BR-042 common variants)',
        (r.body?.results?.length ?? 0) > 0,
        `${r.body?.results?.length} results`,
      );
    }
    {
      const r = await searchPosts('bijli', searcher.token);
      check(
        'Roman "bijli" finds the Urdu بجلی post',
        (r.body?.results ?? []).some((x) => x.body.includes('بجلی')),
      );
    }

    // ---- people search --------------------------------------------------
    {
      await send('PATCH', '/me/profile', { displayName: 'عائشہ خان' }, searcher.token);
      const byRoman = await get('/search/people?q=ayesha', searcher.token);
      const rb = await byRoman.json();
      check(
        'A ROMAN NAME FINDS AN URDU DISPLAY NAME (SEARCH-FR-001)',
        byRoman.status === 200 && (rb?.results ?? []).some((p) => p.displayName === 'عائشہ خان'),
        `status ${byRoman.status} results ${rb?.results?.length}`,
      );

      const byUrdu = await get(`/search/people?q=${encodeURIComponent('عائشہ')}`, searcher.token);
      const ub = await byUrdu.json();
      check(
        'and the Urdu query finds it too',
        (ub?.results ?? []).some((p) => p.displayName === 'عائشہ خان'),
      );

      const byUsername = await get(`/search/people?q=${searcher.handle}`, searcher.token);
      const nb = await byUsername.json();
      check(
        'an exact username is found (SEARCH-FR-001)',
        (nb?.results ?? []).some((p) => p.username === searcher.handle),
      );

      check(
        'results carry the public projection, not raw rows',
        rb?.results?.[0]?.username !== undefined && rb?.results?.[0]?.phone === undefined,
      );
    }

    // ---- exclusions -----------------------------------------------------
    {
      await send('PUT', `/users/${hidden.userId}/block`, undefined, searcher.token);

      const r = await searchPosts('پانی', searcher.token);
      check(
        'A BLOCKED AUTHOR’S POST IS NOT FOUND (SEARCH-FR-002)',
        (r.body?.results ?? []).every((x) => x.id !== blockedPost?.id),
      );

      const people = await get(`/search/people?q=${hidden.handle}`, searcher.token);
      const pb = await people.json();
      check(
        'AND A BLOCKED USER IS NOT FOUND BY THEIR EXACT USERNAME (SEARCH-FR-001 AC)',
        (pb?.results ?? []).every((p) => p.userId !== hidden.userId),
        `${pb?.results?.length} results`,
      );

      await send('DELETE', `/users/${hidden.userId}/block`, undefined, searcher.token);
    }
    {
      const deleted = await (
        await post('/posts', { body: 'یہ پوسٹ حذف ہو جائے گی pani' }, searcher.token)
      ).json();
      await send('DELETE', `/posts/${deleted.id}`, undefined, searcher.token);

      const r = await searchPosts('pani', searcher.token);
      check(
        'a DELETED post is not found by its own text',
        (r.body?.results ?? []).every((x) => x.id !== deleted.id),
      );
    }

    // ---- the empty-vs-broken distinction (SEARCH-FR-003 E2/E3) ---------
    {
      const r = await searchPosts('zzzznotathing', searcher.token);
      check(
        'no results is a 200 with an empty list, not an error',
        r.status === 200 && r.body?.results?.length === 0,
        `status ${r.status} results ${r.body?.results?.length}`,
      );
    }
    {
      const r = await get('/search/posts?q=a', searcher.token);
      const body = await r.json();
      check(
        'A ONE-CHARACTER QUERY IS REFUSED WITH THE MINIMUM STATED (E2)',
        r.status === 400 && body?.error?.code === 'SEARCH_QUERY_TOO_SHORT',
        `status ${r.status} code ${body?.error?.code}`,
      );
      check(
        'and the message says what the minimum is',
        /at least 2/.test(String(body?.error?.message)),
        String(body?.error?.message),
      );
    }
    {
      const anon = await get('/search/posts?q=pani');
      check(
        'search routes are guarded like everything else',
        anon.status === 401,
        `status ${anon.status}`,
      );
    }
  }

  console.log('\n--- messaging over HTTP (EPIC-09) ---');
  {
    const sender = await onboard(Date.now() + 111);
    const recipient = await onboard(Date.now() + 222);

    const openConversation = async (targetUserId, token) => {
      const r = await post('/conversations', { userId: targetUserId }, token);
      return { status: r.status, body: await r.json() };
    };

    // ---- MSG-FR-001: one conversation per pair, ever ---------------------
    let conversationId;
    {
      const first = await openConversation(recipient.userId, sender.token);
      check(
        'POST /conversations opens a thread',
        first.status === 200,
        `status ${first.status} ${JSON.stringify(first.body).slice(0, 120)}`,
      );
      conversationId = first.body?.conversationId;

      const second = await openConversation(recipient.userId, sender.token);
      check(
        'THE EXISTING THREAD REOPENS RATHER THAN A SECOND BEING CREATED (MSG-FR-001 AC)',
        second.body?.conversationId === conversationId,
        `${conversationId} vs ${second.body?.conversationId}`,
      );

      const fromOtherSide = await openConversation(sender.userId, recipient.token);
      check(
        'and approaching from the OTHER SIDE finds the same one (BR-024)',
        fromOtherSide.body?.conversationId === conversationId,
        `${conversationId} vs ${fromOtherSide.body?.conversationId}`,
      );

      const self = await openConversation(sender.userId, sender.token);
      check('a user cannot message themselves', self.status === 400, `status ${self.status}`);
    }

    // ---- MSG-FR-002 / EDGE-020 / EDGE-021: idempotency -------------------
    {
      const clientMessageId = randomUUID();
      const sendSame = () =>
        post(
          `/conversations/${conversationId}/messages`,
          { clientMessageId, body: 'salaam, pani ka masla hai' },
          sender.token,
        );

      const first = await sendSame();
      const firstBody = await first.json();
      check(
        'a message is created with 201',
        first.status === 201,
        `status ${first.status} ${JSON.stringify(firstBody).slice(0, 120)}`,
      );

      const retry = await sendSame();
      const retryBody = await retry.json();
      check(
        'A RETRY WITH THE SAME CLIENT ID RETURNS THE ORIGINAL, WITH 200 (EDGE-020/021)',
        retry.status === 200 && retryBody?.id === firstBody?.id,
        `status ${retry.status} ${firstBody?.id} vs ${retryBody?.id}`,
      );

      const third = await sendSame();
      check('and a third attempt still returns it', third.status === 200);

      const history = await (
        await get(`/conversations/${conversationId}/messages`, sender.token)
      ).json();
      check(
        'EXACTLY ONE MESSAGE IS DELIVERED (MSG-FR-002 AC)',
        history?.messages?.length === 1,
        `${history?.messages?.length} messages`,
      );
    }
    {
      const r = await post(
        `/conversations/${conversationId}/messages`,
        { clientMessageId: randomUUID(), body: '   ' },
        sender.token,
      );
      const body = await r.json();
      check(
        'a whitespace-only message is refused',
        r.status === 400 && body?.error?.code === 'VALIDATION_FAILED',
        `status ${r.status} code ${body?.error?.code}`,
      );
    }
    {
      const r = await post(
        `/conversations/${conversationId}/messages`,
        { clientMessageId: randomUUID(), body: 'a'.repeat(2001) },
        sender.token,
      );
      check('over 2,000 characters is refused', r.status === 400, `status ${r.status}`);
    }

    // ---- MSG-FR-005: it landed as a REQUEST ------------------------------
    {
      const requests = await (await get('/conversations?section=REQUESTS', recipient.token)).json();
      check(
        'A FIRST MESSAGE FROM A NON-FOLLOWER IS A MESSAGE REQUEST (MSG-FR-005)',
        requests?.conversations?.some((c) => c.conversationId === conversationId),
        `${requests?.conversations?.length} requests`,
      );

      const inbox = await (await get('/conversations', recipient.token)).json();
      check(
        'and it is NOT in the ordinary inbox - a separate section',
        (inbox?.conversations ?? []).every((c) => c.conversationId !== conversationId),
      );

      const senderInbox = await (await get('/conversations', sender.token)).json();
      check(
        'THE SENDER SEES AN ORDINARY THREAD, not a request (the BR-028 mechanism)',
        senderInbox?.conversations?.some(
          (c) => c.conversationId === conversationId && c.requestState === 'ACCEPTED',
        ),
      );

      const counts = await (await get('/conversations/unread', recipient.token)).json();
      check(
        'the request count is separate from the conversation count',
        counts?.requests === 1 && counts?.conversations === 0,
        JSON.stringify(counts),
      );
    }

    // ---- MSG-FR-009: reading a request signals nothing --------------------
    {
      const marked = await post(
        `/conversations/${conversationId}/read`,
        undefined,
        recipient.token,
      );
      check('a request can be read', marked.status === 204, `status ${marked.status}`);

      const senderView = await (
        await get(`/conversations/${conversationId}/messages`, sender.token)
      ).json();
      check(
        'READING A MESSAGE REQUEST PRODUCES NO READ RECEIPT (MSG-FR-009 AC)',
        senderView?.messages?.[0]?.readAt === null,
        `readAt ${senderView?.messages?.[0]?.readAt}`,
      );
    }

    // ---- accepting turns receipts on -------------------------------------
    {
      const accepted = await post(
        `/conversations/${conversationId}/accept`,
        undefined,
        recipient.token,
      );
      check('a request can be accepted', accepted.status === 204, `status ${accepted.status}`);

      const inbox = await (await get('/conversations', recipient.token)).json();
      check(
        'and it moves to the main inbox',
        inbox?.conversations?.some((c) => c.conversationId === conversationId),
      );

      await post(`/conversations/${conversationId}/read`, undefined, recipient.token);
      const senderView = await (
        await get(`/conversations/${conversationId}/messages`, sender.token)
      ).json();
      check(
        'NOW a read receipt appears for the sender',
        typeof senderView?.messages?.[0]?.readAt === 'string',
        `readAt ${senderView?.messages?.[0]?.readAt}`,
      );

      const recipientView = await (
        await get(`/conversations/${conversationId}/messages`, recipient.token)
      ).json();
      check(
        'but not on the reader own view of the same message',
        recipientView?.messages?.[0]?.readAt === null,
      );
    }

    // ---- MSG-FR-004 E1: reconnect ----------------------------------------
    {
      const boundary = new Date().toISOString();
      await post(
        `/conversations/${conversationId}/messages`,
        { clientMessageId: randomUUID(), body: 'after the boundary' },
        sender.token,
      );

      const missed = await (
        await get(
          `/conversations/${conversationId}/messages/since?since=${encodeURIComponent(boundary)}`,
          recipient.token,
        )
      ).json();
      check(
        'the reconnect path returns only what was missed (MSG-FR-004 E1)',
        missed?.messages?.length === 1 && missed.messages[0].body === 'after the boundary',
        `${missed?.messages?.length} messages`,
      );
    }

    // ---- MSG-FR-006 / EDGE-019: blocking ---------------------------------
    {
      await send('PUT', `/users/${sender.userId}/block`, undefined, recipient.token);

      const inbox = await (await get('/conversations', recipient.token)).json();
      check(
        'A BLOCK HIDES THE CONVERSATION FROM THE BLOCKER (MSG-FR-003 AC)',
        (inbox?.conversations ?? []).every((c) => c.conversationId !== conversationId),
        `${inbox?.conversations?.length} conversations`,
      );

      const refused = await post(
        `/conversations/${conversationId}/messages`,
        { clientMessageId: randomUUID(), body: 'are you there?' },
        sender.token,
      );
      const refusedBody = await refused.json();
      check(
        'THE BLOCKED SENDER IS REFUSED WITHOUT BEING TOLD (MSG-FR-006 AC)',
        refused.status === 404 && refusedBody?.error?.code === 'RESOURCE_UNAVAILABLE',
        `status ${refused.status} code ${refusedBody?.error?.code}`,
      );

      const nonexistent = await post(
        `/conversations/${randomUUID()}/messages`,
        { clientMessageId: randomUUID(), body: 'anything' },
        sender.token,
      );
      const nonexistentBody = await nonexistent.json();
      check(
        'and the refusal is IDENTICAL to a conversation that never existed',
        nonexistent.status === refused.status &&
          nonexistentBody?.error?.code === refusedBody?.error?.code,
        `${nonexistent.status}/${nonexistentBody?.error?.code}`,
      );

      const history = await get(`/conversations/${conversationId}/messages`, sender.token);
      check('history is unreachable across a block', history.status === 404);

      // ---- SAFETY-FR-006: unblocking restores it intact ------------------
      await send('DELETE', `/users/${sender.userId}/block`, undefined, recipient.token);

      const restored = await (await get('/conversations', recipient.token)).json();
      check(
        'UNBLOCKING RESTORES THE CONVERSATION WITH ITS HISTORY INTACT (MSG-FR-003 AC)',
        restored?.conversations?.some((c) => c.conversationId === conversationId),
      );

      const messages = await (
        await get(`/conversations/${conversationId}/messages`, recipient.token)
      ).json();
      check(
        'and nothing was lost while it was hidden',
        (messages?.messages?.length ?? 0) >= 2,
        `${messages?.messages?.length} messages`,
      );
    }

    // ---- MSG-FR-005 A1: a decline is silent -------------------------------
    {
      const stranger = await onboard(Date.now() + 333);
      const opened = await (
        await post('/conversations', { userId: recipient.userId }, stranger.token)
      ).json();
      await post(
        `/conversations/${opened.conversationId}/messages`,
        { clientMessageId: randomUUID(), body: 'hello neighbour' },
        stranger.token,
      );

      const before = await (await get('/conversations', stranger.token)).json();
      await post(`/conversations/${opened.conversationId}/decline`, undefined, recipient.token);
      const after = await (await get('/conversations', stranger.token)).json();

      check(
        'A DECLINE CHANGES NOTHING THE SENDER CAN SEE (BR-028)',
        JSON.stringify(before) === JSON.stringify(after),
        'the sender view differs after the decline',
      );

      const followUp = await post(
        `/conversations/${opened.conversationId}/messages`,
        { clientMessageId: randomUUID(), body: 'still here' },
        stranger.token,
      );
      check(
        'a further message is ACCEPTED, not refused - refusing would disclose the decline',
        followUp.status === 201,
        `status ${followUp.status}`,
      );

      const requests = await (await get('/conversations?section=REQUESTS', recipient.token)).json();
      check(
        'but it raises NO NEW REQUEST (MSG-FR-005 A1)',
        (requests?.conversations ?? []).every((c) => c.conversationId !== opened.conversationId),
      );
    }

    // ---- MSG-FR-005 A3: following promotes a pending request --------------
    {
      const admirer = await onboard(Date.now() + 444);
      const opened = await (
        await post('/conversations', { userId: recipient.userId }, admirer.token)
      ).json();
      await post(
        `/conversations/${opened.conversationId}/messages`,
        { clientMessageId: randomUUID(), body: 'assalam o alaikum' },
        admirer.token,
      );

      const asRequest = await (
        await get('/conversations?section=REQUESTS', recipient.token)
      ).json();
      check(
        'it starts as a request',
        asRequest?.conversations?.some((c) => c.conversationId === opened.conversationId),
      );

      await send('PUT', `/users/${admirer.userId}/follow`, undefined, recipient.token);

      const inbox = await (await get('/conversations', recipient.token)).json();
      check(
        'FOLLOWING THE SENDER PROMOTES THE REQUEST TO THE INBOX (MSG-FR-005 A3)',
        inbox?.conversations?.some((c) => c.conversationId === opened.conversationId),
        `${inbox?.conversations?.length} conversations`,
      );
    }

    // ---- opening a thread notifies nobody ---------------------------------
    {
      const shy = await onboard(Date.now() + 555);
      const quiet = await onboard(Date.now() + 666);
      await post('/conversations', { userId: quiet.userId }, shy.token);

      const counts = await (await get('/conversations/unread', quiet.token)).json();
      check(
        'OPENING A THREAD AND SAYING NOTHING RAISES NO REQUEST BADGE',
        counts?.requests === 0 && counts?.conversations === 0,
        JSON.stringify(counts),
      );
    }

    // ---- the routes are guarded -------------------------------------------
    {
      const anon = await get('/conversations');
      check('messaging routes are guarded like everything else', anon.status === 401);

      const stranger = await onboard(Date.now() + 777);
      const peek = await get(`/conversations/${conversationId}/messages`, stranger.token);
      check(
        'a non-participant cannot read a conversation (SEC-011)',
        peek.status === 404,
        `status ${peek.status}`,
      );

      const intrude = await post(
        `/conversations/${conversationId}/messages`,
        { clientMessageId: randomUUID(), body: 'let me in' },
        stranger.token,
      );
      check('nor write to one', intrude.status === 404, `status ${intrude.status}`);
    }
  }

  console.log('\n--- messaging over the socket (ADR-009) ---');
  {
    const { io } = await import('socket.io-client');
    const socketPath = process.env.SOCKET_IO_PATH ?? '/realtime';
    const connect = (token) =>
      io(`${base}/messaging`, {
        path: socketPath,
        transports: ['websocket'],
        timeout: 5000,
        reconnection: false,
        ...(token === undefined ? {} : { auth: { token } }),
      });

    const settle = (socket, extra) =>
      new Promise((done) => {
        const timer = setTimeout(() => done('no answer'), 5000);
        socket.on('connect_error', () => {
          clearTimeout(timer);
          done('refused');
        });
        socket.on('disconnect', () => {
          clearTimeout(timer);
          done('disconnected');
        });
        socket.on('connect', () => {
          if (extra === undefined) {
            clearTimeout(timer);
            done('connected');
          }
        });
      });

    // ---- ADR-009: the handshake is authenticated --------------------------
    {
      const anon = connect(undefined);
      const outcome = await settle(anon);
      anon.close();
      check(
        'AN UNAUTHENTICATED SOCKET IS REFUSED AT HANDSHAKE (ADR-009)',
        outcome === 'refused' || outcome === 'disconnected',
        `outcome ${outcome}`,
      );
    }
    {
      const bogus = connect('not-a-real-token');
      const outcome = await settle(bogus);
      bogus.close();
      check(
        'and so is a bogus token',
        outcome === 'refused' || outcome === 'disconnected',
        `outcome ${outcome}`,
      );
    }

    // ---- delivery within 3 seconds (NFR-PERF-007) -------------------------
    {
      const a = await onboard(Date.now() + 888);
      const b = await onboard(Date.now() + 999);
      // Followed, so the thread is an ordinary conversation rather than a
      // request - a request is deliberately quieter, and this assertion is
      // about the transport rather than about the request rules.
      await send('PUT', `/users/${a.userId}/follow`, undefined, b.token);

      const socketA = connect(a.token);
      const socketB = connect(b.token);

      const connected = await Promise.all(
        [socketA, socketB].map(
          (s) =>
            new Promise((done) => {
              const timer = setTimeout(() => done(false), 5000);
              s.on('connect', () => {
                clearTimeout(timer);
                done(true);
              });
              s.on('connect_error', () => {
                clearTimeout(timer);
                done(false);
              });
            }),
        ),
      );
      check(
        'an authenticated socket connects',
        connected.every(Boolean),
        JSON.stringify(connected),
      );

      const clientMessageId = randomUUID();
      const delivered = new Promise((done) => {
        const timer = setTimeout(() => done(null), 3000);
        socketB.on('message:new', (m) => {
          clearTimeout(timer);
          done(m);
        });
      });

      const ack = await new Promise((done) => {
        const timer = setTimeout(() => done(null), 5000);
        socketA.emit(
          'message:send',
          { recipientId: b.userId, clientMessageId, body: 'socket salaam' },
          (answer) => {
            clearTimeout(timer);
            done(answer);
          },
        );
      });
      check(
        'the socket acknowledges a send',
        ack?.ok === true,
        JSON.stringify(ack ?? null).slice(0, 160),
      );

      const received = await delivered;
      check(
        'A MESSAGE REACHES THE RECIPIENT WITHIN 3 SECONDS (NFR-PERF-007)',
        received?.clientMessageId === clientMessageId,
        `received ${JSON.stringify(received ?? null).slice(0, 160)}`,
      );

      // ---- the SAME id over REST does not duplicate (ADR-009 step 6) ------
      const overRest = await post(
        `/conversations/${received?.conversationId}/messages`,
        { clientMessageId, body: 'socket salaam' },
        a.token,
      );
      const overRestBody = await overRest.json();
      check(
        'SWITCHING TRANSPORT WITH THE SAME CLIENT ID CANNOT DUPLICATE (ADR-009 step 6)',
        overRest.status === 200 && overRestBody?.id === received?.id,
        `status ${overRest.status} ${received?.id} vs ${overRestBody?.id}`,
      );

      // ---- per-event re-authorisation (BR-035) ----------------------------
      await post('/logout', {}, a.token);
      const afterRevoke = await new Promise((done) => {
        const timer = setTimeout(() => done('no answer'), 5000);
        socketA.on('disconnect', () => {
          clearTimeout(timer);
          done('disconnected');
        });
        socketA.emit(
          'message:send',
          { recipientId: b.userId, clientMessageId: randomUUID(), body: 'after logout' },
          (answer) => {
            clearTimeout(timer);
            done(answer?.ok === true ? 'accepted' : 'refused');
          },
        );
      });
      check(
        'A REVOKED SESSION STOPS WORKING MID-STREAM (BR-035, ADR-009)',
        afterRevoke === 'refused' || afterRevoke === 'disconnected',
        `outcome ${afterRevoke}`,
      );

      socketA.close();
      socketB.close();
    }
  }

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

  console.log('\n═══════════════════ API SMOKE SUMMARY ═══════════════════');
  console.log(
    `  ${results.length - failures} passed · ${failures} failed · ${results.length} total`,
  );
  if (failures > 0) {
    console.log('\nAPI SMOKE: FAILED');
    process.exit(1);
  }
  console.log('\nAPI SMOKE: ALL CHECKS PASSED');
}

main().catch((e) => {
  console.error('\nAPI SMOKE: ERRORED');
  console.error(e instanceof Error ? e.stack : String(e));
  process.exit(2);
});
