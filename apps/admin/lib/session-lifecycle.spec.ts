import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The two defects the browser found in Group 02, pinned.
 *
 * Both were invisible to the type checker, the unit tests and the build — all
 * three were green while a signed-out administrator was shown a signed-in
 * console. Stage 7's lesson, arriving on the first authenticated screen of
 * Stage 8.
 *
 * ADMIN-RUNTIME-001 — a REVOKED session rendered the dashboard. Measured: 200,
 * full content, against a token that had been logged out. `requireAdminSession`
 * checks that a cookie is present, which is a routing decision and deliberately
 * not an authorization one; the page then rendered static text and never asked
 * the API anything, so nothing ever refused it.
 *
 * ADMIN-RUNTIME-002 — the fix for the first one bounced. Measured in the server
 * log: `/dashboard` 307 → `/session-expired` 303 → `/login?expired=1` 307 →
 * `/dashboard` 307, five times over, because `/login` sent anybody holding a
 * cookie to the dashboard and the just-cleared cookie was still arriving.
 *
 * THESE ARE SOURCE-LEVEL CHECKS, for the same reason five of Stage 7's
 * regression tests were: what they guard cannot be called from a unit test.
 * These modules are `server-only` and depend on Next's request-scoped `cookies()`
 * and `redirect()`, so importing them here would fail on the import rather than
 * on the behaviour. A source rule catches the SHAPE of the defect returning; the
 * behaviour itself was verified in a browser and is recorded in
 * `16-admin-test-report.md`.
 */

const ADMIN = process.cwd();
const read = (relative: string) => readFileSync(join(ADMIN, relative), 'utf8');

/**
 * The file with its comments removed.
 *
 * NEEDED BECAUSE TWO EARLIER VERSIONS OF THESE TESTS READ PROSE INSTEAD OF
 * CODE. One searched for the word "token" and failed on a comment explaining
 * that no token is handled; another searched for "invite" and failed on a
 * comment saying there is no invitation flow. Both times the assertion was
 * right and the input was wrong. These files carry long explanations on
 * purpose, so any rule about what the code contains has to look at the code.
 */
const readCode = (relative: string) =>
  read(relative)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');

describe('ADMIN-RUNTIME-001 — a dead session must not render a protected page', () => {
  it('the shell guards every route in the group, in one place', () => {
    // The session check moved to the layout in Group 03. One place to get
    // right beats one per page to forget — and a page added without it would
    // not look wrong, it would simply render to whoever asked.
    const layout = read('app/(portal)/layout.tsx');
    expect(layout).toContain('requireAdminSession');
  });

  it('every page that shows API data fetches through the guarded client', () => {
    // The defect was a page that checked the cookie and then rendered without
    // asking the API. Only a call can discover that the session died, so any
    // page displaying server data has to make one through `guardedRequest`.
    //
    // The five routes that display nothing yet are excluded deliberately: they
    // exist so the sidebar links somewhere real, and they have no data to
    // fetch. The layout's guard still covers them.
    const dataPages = ['app/(portal)/dashboard/page.tsx'];

    for (const page of dataPages) {
      expect(read(page), `${page} must ask the API, not just check the cookie`).toContain(
        'guardedRequest',
      );
    }
  });

  it('the guarded client turns a 401 into the expiry route', () => {
    const source = read('lib/admin-api/guarded.ts');

    expect(source).toContain('error.status === 401');
    expect(source).toContain("redirect('/session-expired')");
  });

  it('THE GUARDED CLIENT DOES NOT CLEAR THE COOKIE ITSELF', () => {
    // The first attempt at the fix did, from inside a page render, and Next
    // refused: "Cookies can only be modified in a Server Action or Route
    // Handler". The dashboard 500'd instead of showing a sign-in screen. The
    // clearing has to happen in the route handler.
    const source = read('lib/admin-api/guarded.ts');
    expect(source).not.toContain('clearAdminSession');
  });

  it('the expiry route clears the session and forwards to sign-in', () => {
    const source = read('app/session-expired/route.ts');

    expect(source).toContain('clearAdminSession');
    expect(source).toContain('/login?expired=1');
    // 303, so the browser follows with a GET however it arrived.
    expect(source).toContain('303');
  });
});

describe('ADMIN-RUNTIME-002 — the expiry path must not bounce', () => {
  it('the login page does not redirect away when it was reached from expiry', () => {
    // The marker is authoritative because only `/session-expired` sets it, and
    // it sets it immediately after clearing the session. Without this guard the
    // page redirects on a cookie that is already dead, and the two screens
    // ping-pong.
    const source = read('app/login/page.tsx');

    expect(source).toContain("expired !== '1'");
    expect(source).toContain('readAdminToken');
  });

  it('the login page still redirects an ordinary signed-in visitor', () => {
    // The other half: a reader with a live session must not be shown a login
    // form. Breaking the loop must not break that.
    const source = read('app/login/page.tsx');
    expect(source).toContain("redirect('/dashboard')");
  });
});

describe('the session cookie', () => {
  it('is httpOnly, Secure-in-production, SameSite=Strict and path-scoped', () => {
    // Verified in the browser too — `document.cookie` came back empty and both
    // web storages were empty — but asserted here so a later edit that drops
    // `httpOnly` fails a test rather than silently exposing an 8-hour
    // administrator credential to any script on the page (SEC-025).
    const source = read('lib/admin-session.ts');

    expect(source).toContain('httpOnly: true');
    expect(source).toContain("sameSite: 'strict'");
    expect(source).toContain("path: '/'");
    expect(source).toContain('secure: isSecureDeployment()');
  });

  it('derives its lifetime from the API rather than a constant', () => {
    // A cookie outliving its server-side session presents a console that looks
    // signed in and 401s on every action.
    const source = read('lib/admin-session.ts');
    expect(source).toContain('Date.parse(session.expiresAt)');
  });

  it('refuses to store an already-expired session', () => {
    const source = read('lib/admin-session.ts');
    expect(source).toContain('Refusing to store an admin session that is already expired');
  });
});

describe('sign-out', () => {
  it('revokes on the server before clearing locally', () => {
    // Verified in Postgres: after the portal's Sign out, 0 live admin sessions
    // and 7 revoked. Deleting the cookie alone would leave a live credential in
    // the database for up to eight hours (SEC-024).
    const source = readCode('lib/admin-api/auth.ts');

    // THE CALL SITES, not the import. The first version of this compared the
    // index of `clearAdminSession` — which matched the import line at the top
    // of the file — against the logout call, and reported the order backwards.
    const revokeAt = source.indexOf("path: '/admin/logout'");
    const clearAt = source.indexOf('await clearAdminSession()');

    expect(revokeAt, 'the logout call must exist').toBeGreaterThan(-1);
    expect(clearAt, 'the local clear must exist').toBeGreaterThan(-1);
    expect(revokeAt, 'the server is revoked first').toBeLessThan(clearAt);
  });

  it('clears locally even when the revocation call fails', () => {
    // Refusing to sign out because the API is unreachable strands the
    // administrator in a session they asked to end — the worse failure.
    const source = read('lib/admin-api/auth.ts');
    expect(source).toContain('Intentionally swallowed');
  });
});

describe('the login screen offers no way in but a credential', () => {
  it('has no sign-up, invitation, reset or bootstrap affordance', () => {
    // `05-admin-architecture.md` §1: these are absent, not hidden.
    // Administrators are provisioned by the technical owner via CLI, and a
    // public bootstrap route is the classic takeover vector.
    const source = readCode('app/login/page.tsx') + readCode('app/login/login-form.tsx');

    for (const forbidden of ['sign up', 'signup', 'register', 'forgot', 'invite', 'bootstrap']) {
      expect(source.toLowerCase(), `no ${forbidden} affordance`).not.toContain(forbidden);
    }
  });

  it('says where an account comes from instead', () => {
    // Rendered copy, so `read` rather than `readCode` is correct here.
    expect(read('app/login/page.tsx')).toContain('created by the technical owner');
  });
});
