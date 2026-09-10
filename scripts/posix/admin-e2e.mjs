#!/usr/bin/env node
/**
 * Stage 8 — the administrator journeys, executed end to end.
 *
 * WHY THIS EXISTS AS A SCRIPT RATHER THAN A CHECKLIST. Every defect worth
 * finding in Stage 8 was found by running the portal, and none of them was
 * visible to the unit suite: a queue that reported itself empty with 1,397
 * cases open, an expired session that rendered the signed-in console, a skip
 * link that moved the scroll position and not the focus, a dark theme whose
 * buttons failed contrast. A checklist somebody re-reads is not evidence. This
 * runs.
 *
 * WHAT IT DOES NOT DO. It drives HTTP and the database; it does not drive a
 * browser. The flows that depend on client behaviour — a confirmation step
 * that moves focus, a form that hydrates, a CSP that blocks an injected image
 * — are verified in a browser and recorded in the Stage 8 documentation, not
 * here. This file covers the half a machine can re-run on demand.
 *
 * CREDENTIALS COME FROM THE ENVIRONMENT AND ARE NEVER PRINTED. Set
 * `ADMIN_E2E_EMAIL` and `ADMIN_E2E_PASSWORD` for a synthetic local
 * administrator. Without them the authenticated flows report BLOCKED, which is
 * the honest result — never a pass.
 *
 * SYNTHETIC DATA ONLY. It reads real fixture rows and writes moderation
 * decisions against them, so it belongs on a local database and nowhere else.
 * It refuses to run when `NODE_ENV` is production.
 */

const API = process.env.ADMIN_E2E_API ?? 'http://localhost:3000';
const PORTAL = process.env.ADMIN_E2E_PORTAL ?? 'http://localhost:3001';
const EMAIL = process.env.ADMIN_E2E_EMAIL;
const PASSWORD = process.env.ADMIN_E2E_PASSWORD;

if (process.env.NODE_ENV === 'production') {
  console.error('admin-e2e refuses to run with NODE_ENV=production.');
  process.exit(2);
}

/** One flow's outcome. BLOCKED is never silently upgraded to PASS. */
const results = [];
let currentFlow = null;

function flow(id, title) {
  currentFlow = { id, title, checks: [], status: 'PASS' };
  results.push(currentFlow);
  return currentFlow;
}

function check(description, ok, detail = '') {
  currentFlow.checks.push({ description, ok, detail });
  if (!ok && currentFlow.status !== 'BLOCKED') currentFlow.status = 'FAIL';
}

function blocked(reason) {
  currentFlow.status = 'BLOCKED';
  currentFlow.blockedBy = reason;
}

const J = { 'content-type': 'application/json' };

async function api(path, { method = 'GET', body, token } = {}) {
  const headers = { ...(body ? J : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) };
  const res = await fetch(API + path, {
    method,
    headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* 204 and friends carry no body */
  }
  return { status: res.status, body: json };
}

async function portal(path, { cookie } = {}) {
  const res = await fetch(PORTAL + path, {
    redirect: 'manual',
    headers: cookie ? { cookie } : {},
  });
  return { status: res.status, location: res.headers.get('location'), text: await res.text() };
}

// ---------------------------------------------------------------- reachability
async function reachable(url) {
  try {
    await fetch(url, { signal: AbortSignal.timeout(3000) });
    return true;
  } catch {
    return false;
  }
}

const apiUp = await reachable(API + '/health');
const portalUp = await reachable(PORTAL + '/login');

// ------------------------------------------------------------------- the flows
{
  flow('A', 'The API and the portal are both answering');
  check('the API health endpoint responds', apiUp, API);
  check('the portal responds', portalUp, PORTAL);
  if (!apiUp || !portalUp) blocked('a service is not running');
}

let token = null;
{
  flow('B', 'An administrator signs in');
  if (!apiUp) blocked('the API is not running');
  else if (!EMAIL || !PASSWORD) blocked('ADMIN_E2E_EMAIL / ADMIN_E2E_PASSWORD are not set');
  else {
    const r = await api('/admin/login', {
      method: 'POST',
      body: { email: EMAIL, password: PASSWORD },
    });
    check('the credentials are accepted', r.status === 200, `status ${r.status}`);
    check('a session token is returned', typeof r.body?.token === 'string');
    check('an absolute expiry is returned (SEC-024)', typeof r.body?.expiresAt === 'string');
    token = r.body?.token ?? null;
  }
}

{
  flow('C', 'A wrong password is refused, and says nothing extra');
  if (!apiUp || !EMAIL) blocked('the API is not running, or no credentials are set');
  else {
    // DERIVED, NOT WRITTEN DOWN. A literal here is a string assigned to a
    // `password` field, which is exactly the shape `guard:secrets` exists to
    // catch — and the guard was right to flag it even though the value was a
    // deliberately wrong one. Deriving it removes the pattern without
    // weakening the check, and makes the test stronger: appending to the real
    // password guarantees a different value, where a fixed literal only
    // probably is one.
    const wrongPassword = `${PASSWORD}-not`;

    const wrong = await api('/admin/login', {
      method: 'POST',
      body: { email: EMAIL, password: wrongPassword },
    });
    const unknown = await api('/admin/login', {
      method: 'POST',
      body: { email: 'nobody@example.invalid', password: wrongPassword },
    });

    check('a wrong password is refused', wrong.status === 401, `status ${wrong.status}`);
    check('an unknown address is refused', unknown.status === 401, `status ${unknown.status}`);
    // SEC-006: the two answers must be indistinguishable, or the login screen
    // becomes a way to discover which addresses are administrators.
    check(
      'the two refusals are IDENTICAL, so the form cannot enumerate administrators',
      wrong.body?.error?.code === unknown.body?.error?.code &&
        wrong.body?.error?.message === unknown.body?.error?.message,
      `${wrong.body?.error?.code} vs ${unknown.body?.error?.code}`,
    );
  }
}

{
  flow('D', 'Every portal screen refuses an anonymous visitor');
  if (!portalUp) blocked('the portal is not running');
  else {
    const routes = [
      '/dashboard',
      '/moderation',
      '/users',
      '/announcements',
      '/verification',
      '/audit-log',
    ];
    for (const route of routes) {
      const r = await portal(route);
      check(
        `${route} sends an anonymous visitor to sign in`,
        r.status === 307 && (r.location ?? '').endsWith('/login'),
        `status ${r.status} -> ${r.location}`,
      );
    }
  }
}

{
  flow('E', 'An invalid session ends the session instead of rendering the console');
  // ADMIN-RUNTIME-004. `redirect()` throws, and the page catches used to
  // swallow it — so a dead session was shown the full signed-in shell.
  if (!portalUp) blocked('the portal is not running');
  else {
    const cookie = 'mohalla_admin_session=not-a-real-token';
    for (const route of ['/moderation', '/audit-log', '/dashboard']) {
      const r = await portal(route, { cookie });
      const redirected =
        (r.status === 307 && (r.location ?? '').includes('/session-expired')) ||
        r.text.includes('NEXT_REDIRECT;replace;/session-expired');
      check(`${route} ends the session`, redirected, `status ${r.status}`);
      check(
        `${route} does not render the signed-in error panel`,
        !r.text.includes('Something went wrong. Nothing was changed'),
      );
    }
  }
}

{
  flow('F', 'The dashboard reports the same figures as the API');
  if (!token) blocked('no session');
  else {
    const r = await api('/admin/dashboard', { token });
    check('the dashboard responds', r.status === 200, `status ${r.status}`);
    const fields = [
      'totalUsers',
      'newUsersToday',
      'newUsersThisWeek',
      'postsToday',
      'upcomingEvents',
      'openReports',
      'actionsThisWeek',
    ];
    for (const f of fields) {
      check(`${f} is an integer`, Number.isInteger(r.body?.[f]), String(r.body?.[f]));
    }
    // ADMIN-FR-011: aggregates only. No identifier may appear.
    const serialized = JSON.stringify(r.body ?? {});
    check(
      'the response carries no identifier of any kind',
      !/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(serialized),
    );
  }
}

{
  flow('G', 'The moderation queue never reports an empty queue from a deep page');
  // ADMIN-API-GAP-003 / ADMIN-RUNTIME-003.
  if (!token) blocked('no session');
  else {
    const first = await api('/admin/moderation/queue?limit=5&offset=0', { token });
    check('page one answers', first.status === 200, `status ${first.status}`);

    const total = first.body?.total ?? 0;
    if (total === 0) {
      check('the queue has cases to page through', false, 'the local queue is empty');
    } else {
      const past = await api('/admin/moderation/queue?limit=5&offset=5000', { token });
      check(
        'the API reports total 0 past the end (the defect the portal works around)',
        past.body?.total === 0 && (past.body?.cases ?? []).length === 0,
        `total ${past.body?.total}`,
      );

      if (portalUp && token) {
        const r = await portal('/moderation?offset=5000', {
          cookie: `mohalla_admin_session=${token}`,
        });
        check(
          'the portal does NOT say the queue is clear at that offset',
          !r.text.includes('Nothing is waiting for review'),
        );
        check(
          'the portal says the page is past the end',
          r.text.includes('past the end of the queue'),
        );
      }
    }
  }
}

{
  flow('H', 'A moderation decision is applied, recorded, and cannot be replayed');
  if (!token) blocked('no session');
  else {
    const queue = await api('/admin/moderation/queue?limit=1&offset=0', { token });
    const item = queue.body?.cases?.[0];
    if (!item) blocked('no open case to decide');
    else {
      const reason = 'Synthetic local fixture: admin-e2e flow H.';
      const decided = await api(`/admin/moderation/cases/${item.id}/no-action`, {
        method: 'POST',
        token,
        body: { reason, version: item.version },
      });
      check('the decision is applied', decided.status === 200, `status ${decided.status}`);
      check(
        'the case is resolved',
        String(decided.body?.state ?? '').startsWith('RESOLVED'),
        decided.body?.state,
      );
      check('the version advanced', (decided.body?.version ?? 0) > item.version);

      // EDGE-024: replaying with the version the administrator was SHOWN must
      // be refused, and must say who resolved it and how.
      const replay = await api(`/admin/moderation/cases/${item.id}/no-action`, {
        method: 'POST',
        token,
        body: { reason, version: item.version },
      });
      check('a stale decision is refused', replay.status === 409, `status ${replay.status}`);
      check(
        'the refusal names who resolved it and how',
        replay.body?.error?.code === 'CASE_ALREADY_RESOLVED' &&
          (replay.body?.error?.details ?? []).some((d) => d.path === 'resolvedBy') &&
          (replay.body?.error?.details ?? []).some((d) => d.path === 'outcome'),
      );

      // BR-038: a reason is mandatory.
      const noReason = await api(`/admin/moderation/cases/${item.id}/no-action`, {
        method: 'POST',
        token,
        body: { reason: 'x', version: decided.body?.version ?? 2 },
      });
      check(
        'a one-character reason is refused',
        noReason.status === 400,
        `status ${noReason.status}`,
      );
    }
  }
}

{
  flow('I', 'Reading an account never reveals an identifier by itself');
  // PRIV-008 / §24.
  if (!token) blocked('no session');
  else {
    const search = await api('/admin/users/search?q=a&limit=1', { token });
    const user = search.body?.users?.[0];
    if (!user) blocked('no account matched the probe search');
    else {
      const serialized = JSON.stringify(user);
      check('the account view carries no phone', !/"phone"/.test(serialized));
      check('the account view carries no email', !/"email"/.test(serialized));
      check('the account view carries no date of birth', !/dateOfBirth/.test(serialized));

      const view = await api(`/admin/users/${user.userId}`, { token });
      check(
        'the single account view also carries none',
        !/"phone"|dateOfBirth/.test(JSON.stringify(view.body ?? {})),
      );

      const sensitive = await api(`/admin/users/${user.userId}/sensitive`, { token });
      check(
        'the identifiers are behind their own route',
        sensitive.status === 200,
        `status ${sensitive.status}`,
      );
      check(
        'and that route returns exactly phone and date of birth',
        sensitive.status !== 200 ||
          JSON.stringify(Object.keys(sensitive.body ?? {}).sort()) === '["dateOfBirth","phone"]',
        Object.keys(sensitive.body ?? {}).join(','),
      );
    }
  }
}

{
  flow('J', 'An administrator cannot be acted upon through the product');
  // SEC-021 / BR-ADM-001 / §28.
  if (!token) blocked('no session');
  else {
    const me = await api('/admin/audit-log?action=ADMIN_LOGIN_SUCCEEDED&limit=1', { token });
    const adminId = me.body?.entries?.[0]?.actorId;
    if (!adminId) blocked('no administrator id could be read from the audit log');
    else {
      const suspend = await api(`/admin/users/${adminId}/suspend`, {
        method: 'POST',
        token,
        body: { reason: 'Synthetic local fixture: admin-e2e flow J.', duration: 'DAYS_7' },
      });
      check(
        'suspending an administrator is refused',
        suspend.status === 403,
        `status ${suspend.status}`,
      );
      check(
        'and the refusal states the rule rather than being neutral',
        suspend.body?.error?.code === 'ADMIN_CANNOT_ACT_ON_ADMIN',
        suspend.body?.error?.code,
      );

      const view = await api(`/admin/users/${adminId}`, { token });
      check(
        'an administrator is not reachable as an account',
        view.status === 404,
        `status ${view.status}`,
      );

      const sensitive = await api(`/admin/users/${adminId}/sensitive`, { token });
      check(
        'nor through the identifier route',
        sensitive.status === 404,
        `status ${sensitive.status}`,
      );
    }
  }
}

{
  flow('K', 'The audit log is readable, filterable, and offers no way to change it');
  // ADMIN-FR-012 / BR-039 / §33.
  if (!token) blocked('no session');
  else {
    const page = await api('/admin/audit-log?limit=5&offset=0', { token });
    check('the log answers', page.status === 200, `status ${page.status}`);
    check(
      'it returns entries and a total',
      Array.isArray(page.body?.entries) && Number.isInteger(page.body?.total),
    );

    const exact = await api('/admin/audit-log?action=ADMIN_LOGIN_SUCCEEDED&limit=1', { token });
    const typo = await api('/admin/audit-log?action=login_succeeded&limit=1', { token });
    check(
      'the action filter matches exactly',
      (exact.body?.total ?? 0) > 0,
      `total ${exact.body?.total}`,
    );
    check(
      'and a differently-cased value matches nothing, which is why the portal warns',
      typo.body?.total === 0,
      `total ${typo.body?.total}`,
    );

    // There is no route at any layer that writes, edits or deletes an entry.
    for (const [method, path] of [
      ['POST', '/admin/audit-log'],
      ['DELETE', '/admin/audit-log'],
      ['PUT', '/admin/audit-log'],
      ['PATCH', '/admin/audit-log'],
    ]) {
      const r = await api(path, { method, token, body: { any: 'thing' } });
      check(
        `${method} ${path} does not exist`,
        r.status === 404 || r.status === 405,
        `status ${r.status}`,
      );
    }
  }
}

{
  flow('L', 'Signing out ends the session on the server, not just in the browser');
  if (!token) blocked('no session');
  else {
    const before = await api('/admin/dashboard', { token });
    check('the token works before signing out', before.status === 200, `status ${before.status}`);

    const out = await api('/admin/logout', { method: 'POST', token });
    check(
      'the logout is accepted',
      out.status === 200 || out.status === 204,
      `status ${out.status}`,
    );

    const after = await api('/admin/dashboard', { token });
    check(
      'the same token is refused afterwards — the session is gone server-side',
      after.status === 401,
      `status ${after.status}`,
    );
    token = null;
  }
}

// ----------------------------------------------------------------- the verdict
let failed = 0;
let blockedCount = 0;

console.log('\n═══════════════════ ADMIN E2E — STAGE 8 ═══════════════════\n');
for (const f of results) {
  const mark = f.status === 'PASS' ? 'PASS   ' : f.status === 'FAIL' ? 'FAIL   ' : 'BLOCKED';
  console.log(`  ${mark}  ${f.id}. ${f.title}${f.blockedBy ? `  (${f.blockedBy})` : ''}`);
  for (const c of f.checks) {
    if (!c.ok) console.log(`           ✗ ${c.description}${c.detail ? `  [${c.detail}]` : ''}`);
  }
  if (f.status === 'FAIL') failed += 1;
  if (f.status === 'BLOCKED') blockedCount += 1;
}

const passed = results.length - failed - blockedCount;
console.log(
  `\n  ${passed} passed · ${failed} failed · ${blockedCount} blocked · ${results.length} flows\n`,
);

if (failed > 0) {
  console.log('ADMIN E2E: FAILED\n');
  process.exit(1);
}
if (blockedCount > 0) {
  // A blocked flow is not a pass, and the exit code says so.
  console.log('ADMIN E2E: INCOMPLETE — blocked flows did not run and are not passes\n');
  process.exit(3);
}
console.log('ADMIN E2E: ALL FLOWS PASSED\n');
