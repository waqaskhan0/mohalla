import { afterEach, describe, expect, it } from 'vitest';
import { sessionCookieName } from './admin-session';
import { readCode, readFile } from './test-support/read-source';

/**
 * QA-002 — the approved policy: THE PRODUCTION ADMIN PORTAL REQUIRES HTTPS.
 *
 * The portal names its session cookie by build: `__Host-mohalla_admin_session`
 * for a production build, the unprefixed name for `next dev`. Stage 10 found
 * the surrounding documentation describing that as a plain-HTTP escape hatch
 * for production, which it never was — Next constant-folds
 * `process.env.NODE_ENV` at build time, so no runtime variable reaches the
 * decision, and a browser refuses a `__Host-` cookie on an insecure origin
 * anyway.
 *
 * The owner's disposition was to REMOVE THE PROMISE, not to weaken the cookie.
 * These tests are what stops it coming back. They are behaviour, not source
 * prose, wherever behaviour can reach — `sessionCookieName` does not touch
 * request-scoped `cookies()`, so it is directly callable here.
 *
 * The one thing they cannot prove is a live HTTPS deployment; that is a release
 * environment concern and is recorded as NOT EXECUTED rather than asserted.
 */

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

afterEach(() => {
  // Restored by assignment rather than `delete`, so a later spec in the same
  // worker sees exactly what it saw before.
  process.env.NODE_ENV = ORIGINAL_NODE_ENV;
});

describe('QA-002 · the admin session cookie cannot be silently downgraded', () => {
  it('A. a production build uses the __Host- prefixed name', () => {
    process.env.NODE_ENV = 'production';
    expect(sessionCookieName()).toBe('__Host-mohalla_admin_session');
  });

  it('B. a development build uses the unprefixed name', () => {
    process.env.NODE_ENV = 'development';
    expect(sessionCookieName()).toBe('mohalla_admin_session');
  });

  it('C. no other environment variable can reach the decision', () => {
    // The plausible shapes of a downgrade switch, including the one Stage 10
    // explicitly declined to add. If any of these ever starts working, this
    // fails — which is the point: the refusal has to be enforced, not just
    // written down in a comment.
    const downgradeAttempts = {
      ADMIN_INSECURE_COOKIE: '1',
      ADMIN_COOKIE_INSECURE: 'true',
      ADMIN_DISABLE_SECURE_COOKIE: 'yes',
      ADMIN_ALLOW_HTTP: '1',
      COOKIE_SECURE: 'false',
      HTTPS: 'false',
      // A forwarded-proto claim is the classic way this gets reintroduced.
      // There is no approved proxy model for trusting it, so it must not work.
      'X-Forwarded-Proto': 'http',
      X_FORWARDED_PROTO: 'http',
    };

    process.env.NODE_ENV = 'production';
    for (const [key, value] of Object.entries(downgradeAttempts)) {
      process.env[key] = value;
    }

    try {
      expect(sessionCookieName()).toBe('__Host-mohalla_admin_session');
    } finally {
      for (const key of Object.keys(downgradeAttempts)) delete process.env[key];
    }
  });

  it('C. and the module reads NODE_ENV and nothing else for it', () => {
    // The behavioural check above can only disprove the switches it thought of.
    // This one closes the rest: if the decision ever consults a second variable,
    // the source will show a `process.env.<SOMETHING>` that is not NODE_ENV.
    const source = readCode('lib/admin-session.ts');
    const envReads = [...source.matchAll(/process\.env\.([A-Z0-9_]+)/g)].map((m) => m[1]);

    expect(envReads.length).toBeGreaterThan(0);
    expect([...new Set(envReads)]).toEqual(['NODE_ENV']);
  });

  it('C. and the secure flag is tied to the same decision, not set independently', () => {
    // `secure: true` written as a literal would drift from the cookie NAME the
    // moment somebody edited one and not the other, and a `__Host-` cookie
    // without Secure is refused outright by the browser.
    const source = readCode('lib/admin-session.ts');
    expect(source).toContain('secure: isSecureDeployment()');
    expect(source).not.toMatch(/secure:\s*(true|false)\b/);
  });

  it('documents HTTPS as required for production rather than optional', () => {
    // The defect was the PROMISE, so the promise is what is pinned — and a
    // promise lives in a comment, which is exactly what `readCode` strips. The
    // first version of this test used `readCode` and failed against a file that
    // already said the right thing; the test was wrong, not the source.
    const source = readFile('lib/admin-session.ts');
    expect(source).toContain('PRODUCTION ADMIN PORTAL REQUIRES HTTPS');
    expect(source).not.toMatch(/plain HTTP therefore uses the unprefixed name/);
  });
});
