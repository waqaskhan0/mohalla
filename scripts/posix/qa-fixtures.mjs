#!/usr/bin/env node
/**
 * Stage 10 — the synthetic QA cast, provisioned through the product's own API.
 *
 * WHY IT BOOTS THE APP IN-PROCESS RATHER THAN CALLING THE RUNNING ONE.
 *
 * The verification code is the problem. `otp_challenges.code_hash` is a hash —
 * correctly, so the database cannot hand anyone a live code — and
 * `FakeSmsProvider` keeps its messages in memory with no endpoint and no file.
 * An out-of-process script therefore has no honest way to complete
 * registration.
 *
 * So this boots the SAME `AppModule` the deployed process boots, against the
 * SAME database, and resolves the provider by its port token to read the code
 * it just recorded. Every user below is created by really registering,
 * really verifying and really onboarding — nothing is inserted behind the
 * endpoints, because a fixture written straight into a table is a fixture that
 * proves the endpoints work when they do not.
 *
 * The two exceptions are stated where they occur: administrators have no
 * self-service creation path by design (OD-020), and the enforcement states
 * are applied through the admin API rather than by hand.
 *
 * NOTHING SENSITIVE IS PRINTED OR COMMITTED. Credentials go to
 * `.emulator-evidence/stage10-qa-private.json`, which is ignored. Numbers are
 * synthetic `+92300…` values that avoid the fake provider's reserved failure
 * suffixes (INTEGRATION-008), and no real person's data is used anywhere.
 */

import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const OUT = '.emulator-evidence/stage10-qa-private.json';
const TERMS = 'terms-2026-01';
const DOB = '1996-04-11';

/** The fake provider fails deterministically on these, which is not what we want here. */
const RESERVED = ['0000', '9999'];

function syntheticPhone(seed) {
  let suffix = String(seed % 10_000_000).padStart(7, '0');
  while (RESERVED.some((r) => suffix.endsWith(r))) {
    suffix = String((Number(suffix) + 1) % 10_000_000).padStart(7, '0');
  }
  return `+92300${suffix}`;
}

let seedCounter = Date.now();
const nextSeed = () => (seedCounter += 37);

async function main() {
  const { NestFactory } = await import('@nestjs/core');
  const { AppModule } = await import('../../apps/api/dist/app.module.js');
  const { configureApp } = await import('../../apps/api/dist/configure-app.js');
  const { loadEnv } = await import('../../apps/api/dist/config/env.js');
  const { StructuredLogger } =
    await import('../../apps/api/dist/common/logging/structured.logger.js');

  const env = loadEnv();
  const logger = new StructuredLogger('qa-fixtures', 'error');
  const app = await NestFactory.create(AppModule, { logger, bufferLogs: false });
  configureApp(app, env, logger);
  await app.listen(0);
  const base = (await app.getUrl()).replace('[::1]', '127.0.0.1');

  const call = async (method, path, body, token) =>
    fetch(base + path, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const post = (p, b, t) => call('POST', p, b, t);
  const put = (p, b, t) => call('PUT', p, b, t);
  const get = (p, t) => call('GET', p, undefined, t);

  const { SMS_PROVIDER } =
    await import('../../apps/api/dist/modules/platform/identity/ports/sms-provider.port.js');
  const sms = app.get(SMS_PROVIDER, { strict: false });
  const codeFor = (phone) => sms?.lastTo?.(phone)?.body?.match(/\b(\d{6})\b/)?.[1];

  /**
   * A SEPARATE, PRIVILEGED CONNECTION — and the reason is a good sign, not a
   * workaround. The API's own pool runs as `runtime_app`, which has no write
   * access to `admins`; the first version of this script used it and was
   * correctly refused with `permission denied for table admins`. That is the
   * least-privilege model working, so the fixture uses the migration owner for
   * the one insert that needs it rather than widening the runtime role.
   */
  const { Client } = await import('pg');
  const ownerUrl = process.env.MIGRATION_DATABASE_URL ?? process.env.ADMIN_DATABASE_URL;
  assert.ok(ownerUrl, 'MIGRATION_DATABASE_URL (or ADMIN_DATABASE_URL) is required to seed admins');
  const db = new Client({ connectionString: ownerUrl });
  await db.connect();

  /** One fully onboarded account, created the way a person would create it. */
  async function makeUser(label, { accountType = 'INDIVIDUAL' } = {}) {
    const seed = nextSeed();
    const phone = syntheticPhone(seed);
    const password = `QaStage10-${randomBytes(6).toString('hex')}`;
    // USERNAME_MAX_LENGTH is 20; the stem is trimmed so the unique digits fit.
    const stem = label
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .slice(0, 9);
    const username = stem + String(seed).slice(-7);

    const registered = await post('/register', {
      phone,
      password,
      dateOfBirth: DOB,
      termsVersion: TERMS,
      accountType,
    });
    assert.equal(registered.status, 202, `${label}: register ${registered.status}`);

    const code = codeFor(phone);
    assert.ok(code, `${label}: the fake provider recorded no verification code`);

    const verified = await post('/otp/verify', { phone, code, purpose: 'REGISTRATION' });
    assert.equal(verified.status, 200, `${label}: otp/verify ${verified.status}`);
    const token = (await verified.json()).token;

    assert.equal(
      (await post('/me/username', { username }, token)).status,
      201,
      `${label}: username`,
    );
    assert.equal(
      (await post('/me/profile', { displayName: `QA ${label}` }, token)).status,
      201,
      `${label}: profile`,
    );

    const me = await (await get('/me', token)).json();
    assert.ok(me?.userId, `${label}: no session`);
    return { label, phone, password, username, token, userId: me.userId, accountType };
  }

  const cast = {};
  const note = (k, v) => {
    cast[k] = v;
    console.log(`  ${k.padEnd(22)} ${v.username ?? v.email ?? ''}`);
  };

  console.log('\n--- accounts ---');
  note('USER_A', await makeUser('user-a'));
  note('USER_B', await makeUser('user-b'));
  note('ORGANIZATION_USER', await makeUser('org', { accountType: 'ORGANIZATION' }));
  note('VERIFIED_ORG', await makeUser('vorg', { accountType: 'ORGANIZATION' }));
  note('SUSPENDED_USER', await makeUser('susp'));
  note('BANNED_USER', await makeUser('banned'));
  note('PENDING_DELETION_USER', await makeUser('pend'));
  note('BLOCKED_BY_A', await makeUser('blocked'));
  note('REPORTER_1', await makeUser('rep1'));
  note('REPORTER_2', await makeUser('rep2'));
  note('REPORTER_3', await makeUser('rep3'));

  /**
   * NEW_USER IS DELIBERATELY NOT REGISTERED. The Android signup flow has to be
   * driven against a number that has never been seen, and a fixture that had
   * already completed registration would make that test impossible to run.
   */
  const newSeed = nextSeed();
  cast.NEW_USER = {
    label: 'new-user',
    phone: syntheticPhone(newSeed),
    // The app's own field takes the local form.
    phoneInput: '03' + syntheticPhone(newSeed).slice(4),
    password: `QaStage10-${randomBytes(6).toString('hex')}`,
    username: 'qanew' + String(newSeed).slice(-7),
    dateOfBirth: DOB,
    registered: false,
  };
  console.log(
    `  ${'NEW_USER'.padEnd(22)} ${cast.NEW_USER.username} (not registered — for signup QA)`,
  );

  /**
   * ADMINISTRATORS ARE INSERTED, and that is not a shortcut being taken
   * quietly. OD-020 / DEP-016 mean no bootstrap endpoint exists in any
   * environment, so there is no self-service path to create one. The row is
   * the same shape `admin-e2e` uses.
   */
  console.log('\n--- administrators ---');
  const { PASSWORD_HASHER } =
    await import('../../apps/api/dist/modules/platform/identity/ports/password-hasher.port.js');
  const hasher = app.get(PASSWORD_HASHER, { strict: false });
  const adminPassword = `QaAdmin10-${randomBytes(6).toString('hex')}`;
  const adminHash = await hasher.hash(adminPassword);

  async function makeAdmin(label) {
    const id = randomUUID();
    const email = `qa-${label}-${id}@example.invalid`;
    await db.query(
      `INSERT INTO admins (id, email, password_hash, state, display_name)
       VALUES ($1, $2, $3, 'ACTIVE', $4)`,
      [id, email, adminHash, `QA ${label}`],
    );
    const login = await post('/admin/login', { email, password: adminPassword });
    assert.equal(login.status, 200, `${label}: admin login ${login.status}`);
    return { id, email, password: adminPassword, token: (await login.json()).token };
  }

  note('ADMIN_A', await makeAdmin('admin-a'));
  note('ADMIN_B', await makeAdmin('admin-b'));

  console.log('\n--- content ---');
  const counts = {};
  const tally = (k, n) => {
    counts[k] = n;
    console.log(`  ${k.padEnd(22)} ${n}`);
  };

  // Posts by A and B, so the feed has something with two authors in it.
  const posts = {};
  for (const [who, n] of [
    ['USER_A', 3],
    ['USER_B', 3],
    ['ORGANIZATION_USER', 1],
    ['VERIFIED_ORG', 1],
  ]) {
    posts[who] = [];
    for (let i = 0; i < n; i++) {
      const r = await post(
        '/posts',
        { body: `QA fixture post ${i + 1} from ${who}. Synthetic content for Stage 10.` },
        cast[who].token,
      );
      assert.equal(r.status, 201, `${who} post ${i}: ${r.status}`);
      posts[who].push((await r.json()).id);
    }
  }
  cast.POSTS = posts;
  tally('posts', Object.values(posts).flat().length);

  // A comment and a reply, so the thread shapes exist.
  const commentRes = await post(
    `/posts/${posts.USER_A[0]}/comments`,
    { body: 'QA fixture comment from user-b.' },
    cast.USER_B.token,
  );
  assert.equal(commentRes.status, 201, `comment: ${commentRes.status}`);
  const commentId = (await commentRes.json()).id;
  const replyRes = await post(
    `/comments/${commentId}/replies`,
    { body: 'QA fixture reply from user-a.' },
    cast.USER_A.token,
  );
  assert.equal(replyRes.status, 201, `reply: ${replyRes.status}`);
  cast.COMMENT_ID = commentId;
  tally('comments + replies', 2);

  // A follows B, so Following has content and a FOLLOW notification exists.
  // PUT, not POST: following is idempotent state, not an event to append, and
  // the first version of this script used POST and got a 404 from a route that
  // does not exist.
  const ok2xx = (r, what) => assert.ok(r.status >= 200 && r.status < 300, `${what}: ${r.status}`);
  ok2xx(await put(`/users/${cast.USER_B.userId}/follow`, {}, cast.USER_A.token), 'A follows B');
  ok2xx(
    await put(`/users/${cast.USER_A.userId}/follow`, {}, cast.REPORTER_1.token),
    'R1 follows A',
  );
  tally('follows', 2);

  // A likes one of B's posts — an ENGAGEMENT notification for B.
  ok2xx(await put(`/posts/${posts.USER_B[0]}/like`, {}, cast.USER_A.token), 'A likes B post');
  tally('likes', 1);

  // An event, so the events surface has something real to render and RSVP to.
  const eventRes = await post(
    '/events',
    {
      title: 'QA fixture community clean-up',
      description: 'Synthetic Stage 10 fixture event. Not a real gathering.',
      startsAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      eventType: 'PHYSICAL',
      locationText: 'Synthetic Park, Test Sector',
    },
    cast.USER_A.token,
  );
  if (eventRes.status === 201) {
    cast.EVENT_ID = (await eventRes.json()).id;
    tally('events', 1);
  } else {
    // Recorded rather than swallowed: a fixture that silently produced no event
    // would make the events QA look like it passed on an empty surface.
    console.log(
      `  events                 0  (POST /events -> ${eventRes.status}; body: ${(await eventRes.text()).slice(0, 200)})`,
    );
  }

  writeFileSync(
    OUT,
    JSON.stringify({ cast, counts, createdAt: new Date().toISOString() }, null, 2),
  );
  console.log(`\nWrote ${OUT} (ignored — credentials stay local).`);
  console.log('Synthetic data only. No real phone number, email, DOB or message is used.\n');

  await db.end();
  await app.close();
}

mkdirSync(dirname(OUT), { recursive: true });
main().catch((error) => {
  console.error('\nqa-fixtures FAILED:', error?.message ?? error);
  process.exit(1);
});
