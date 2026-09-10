import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AdminApiError, AdminApiShapeError } from './admin-api/client';
import { apiFailure } from './admin-api/failure';
import { functionSource, readCode, readFile, readProse } from './test-support/read-source';

/**
 * Group 13 — the portal's security properties, as rules rather than intentions.
 *
 * Measured against the running portal before these were written:
 *
 *   - production sends a per-request nonce CSP with no `unsafe-inline` in
 *     `script-src`, and all 11 script tags carry the nonce
 *   - `connect-src`, `img-src` and `frame-src` fire real
 *     `securitypolicyviolation` events when an external fetch, image or frame
 *     is attempted
 *   - zero client chunks contain the session cookie name, `Bearer`,
 *     `readAdminToken`, `adminRequest` or any `/admin/...` path; they appear
 *     only in server chunks
 *   - an invalid session cookie lands the browser on `/login?expired=1` with
 *     the cookie cleared
 *   - an admin session token is refused (401) by user-authenticated API routes
 */

const ADMIN = process.cwd();

/** Every `.ts`/`.tsx` under the app, excluding build output and specs. */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(join(ADMIN, dir))) {
    if (entry === 'node_modules' || entry === '.next') continue;
    const rel = join(dir, entry);
    if (statSync(join(ADMIN, rel)).isDirectory()) {
      sourceFiles(rel, out);
    } else if (/\.tsx?$/.test(entry) && !entry.endsWith('.spec.ts')) {
      out.push(rel.split('\\').join('/'));
    }
  }
  return out;
}

describe('ADMIN-RUNTIME-004 — a catch handles what it recognises and nothing else', () => {
  it('re-throws anything that is not an API error', () => {
    // `redirect()` ends an expired session by THROWING. A catch written for a
    // failing API swallowed it, and a dead session was shown the signed-in
    // console with "Something went wrong" — measured as a 200 with the full
    // shell before the fix.
    const apiError = new AdminApiError(500, 'X', 'boom', 'cid');
    const shapeError = new AdminApiShapeError('/p', [], 'cid');

    expect(apiFailure(apiError)).toBe(apiError);
    expect(apiFailure(shapeError)).toBe(shapeError);

    // A redirect, and anything else nobody has considered yet.
    const redirect = Object.assign(new Error('NEXT_REDIRECT'), {
      digest: 'NEXT_REDIRECT;replace;/session-expired;307;',
    });
    expect(() => apiFailure(redirect)).toThrow(redirect);
    expect(() => apiFailure(new TypeError('a bug in this portal'))).toThrow(TypeError);
  });

  it('does not match on the framework’s internal redirect marker', () => {
    // Listing what IS handled needs no knowledge of how Next signals a
    // redirect, and stays correct if that changes. Matching on the digest
    // string would put session handling at the mercy of an internal.
    const source = readCode('lib/admin-api/failure.ts');

    expect(source).not.toContain('NEXT_REDIRECT');
    expect(source).not.toContain('digest');
    expect(source).toContain('instanceof AdminApiError');
    expect(source).toContain('throw error');
  });

  it('leaves no page rendering a raw caught value', () => {
    // Every screen that fetches must narrow. A single unnarrowed catch is one
    // screen where an ended session shows a signed-in portal.
    const offenders = sourceFiles('app')
      .filter((f) => f.endsWith('.tsx'))
      .filter((f) => readCode(f).includes('error={error}'));

    expect(offenders, 'these catches swallow the redirect').toEqual([]);
  });

  it('narrows in every page that calls the guarded client', () => {
    const pages = sourceFiles('app').filter((f) => readCode(f).includes('guardedRequest('));

    expect(pages.length).toBeGreaterThan(5);
    for (const page of pages) {
      const code = readCode(page);
      // A page either narrows in its catch, or is a server action file, which
      // re-throws at the end of its own failure mapper instead.
      const isAction = readFile(page).startsWith("'use server'");
      if (isAction) {
        expect(code, `${page} must re-throw what it does not recognise`).toContain('throw error;');
      } else {
        expect(code, `${page} must narrow its catch`).toContain('apiFailure(error)');
      }
    }
  });
});

describe('SEC-025 — the admin credential cannot reach a browser', () => {
  it('marks every module on the credential path server-only', () => {
    // `import 'server-only'` is a BUILD ERROR when a client component imports
    // it, which is the mechanism rather than the promise.
    for (const file of [
      'lib/admin-api/client.ts',
      'lib/admin-session.ts',
      'lib/admin-api/guarded.ts',
    ]) {
      expect(readFile(file), file).toContain("import 'server-only'");
    }
  });

  it('has no client component importing the credential path', () => {
    // Measured on the built bundle: zero client chunks contain the cookie
    // name, `Bearer`, `readAdminToken`, `adminRequest` or any admin path.
    // This is the source-level rule that keeps it so.
    const clientFiles = sourceFiles('app')
      .concat(sourceFiles('components'))
      .filter((f) => readFile(f).startsWith("'use client'"));

    expect(clientFiles.length).toBeGreaterThan(5);
    for (const file of clientFiles) {
      const code = readCode(file);
      for (const forbidden of ['admin-api/client', 'admin-session', 'admin-api/guarded']) {
        expect(code, `${file} must not import ${forbidden}`).not.toContain(forbidden);
      }
    }
  });
});

describe('the Content-Security-Policy', () => {
  // `proxy.ts`, not `middleware.ts`: Next 16 renamed the convention and warns
  // on the old name. The variable keeps the word `middleware` because that is
  // what the thing IS — a request-time hook — regardless of the filename.
  const middleware = readCode('proxy.ts');

  it('never allows inline script', () => {
    // A policy with `'unsafe-inline'` in script-src permits exactly the attack
    // it exists to stop. The portal renders user-generated content and is the
    // highest-value XSS target in the product.
    const scriptSrc = middleware.slice(middleware.indexOf('const scriptSrc'));
    const block = scriptSrc.slice(0, scriptSrc.indexOf('.join('));

    expect(block).not.toContain("'unsafe-inline'");
    expect(block).toContain(`'nonce-`);
    expect(block).toContain("'strict-dynamic'");
  });

  it('generates the nonce per request from a cryptographic source', () => {
    // A nonce that is not per-request is not a nonce, and a guessable one is
    // worse than none. Verified live: two responses carried different values.
    expect(middleware).toContain('crypto.randomUUID()');
    expect(middleware).not.toContain('Math.random');
  });

  it('sets the policy on the request as well as the response', () => {
    // Next reads it from the incoming headers to stamp its own scripts. A
    // policy set only on the way out yields a page whose scripts it forbids.
    expect(middleware).toContain("requestHeaders.set('content-security-policy'");
    expect(middleware).toContain("requestHeaders.set('x-nonce'");
    expect(middleware).toContain("response.headers.set('content-security-policy'");
  });

  it('confines the browser to this origin', () => {
    // No rendered client component fetches anything, so the browser has no
    // legitimate reason to reach another origin — which means script that
    // somehow ran could not send what it read anywhere. Verified live: a
    // cross-origin fetch fired a real connect-src violation.
    expect(middleware).toContain(`"'self'"`);
    expect(middleware).toContain("object-src 'none'");
    expect(middleware).toContain("base-uri 'none'");
    expect(middleware).toContain("form-action 'self'");
    expect(middleware).toContain("frame-ancestors 'none'");
    expect(middleware).toContain("frame-src 'none'");
  });

  it('loosens exactly two directives in development, and says which', () => {
    // Keeping the difference between what is tested locally and what ships to
    // one line each is the point.
    expect(middleware).toContain(`isDev ? ["'unsafe-eval'"] : []`);
    expect(middleware).toContain("isDev ? ['ws:', 'wss:'] : []");
    // And nothing else is conditional on the mode except the HTTPS upgrade.
    const devBranches = middleware.match(/isDev \?/g) ?? [];
    expect(devBranches).toHaveLength(3);
  });
});

describe('the constant security headers', () => {
  const config = readCode('next.config.mjs');

  it('sends the ones that do not need a per-request value', () => {
    for (const header of [
      'X-Frame-Options',
      'Referrer-Policy',
      'X-Content-Type-Options',
      'Permissions-Policy',
      'Cross-Origin-Opener-Policy',
      'Cross-Origin-Resource-Policy',
      'Strict-Transport-Security',
    ]) {
      expect(config, header).toContain(header);
    }
  });

  it('sends no referrer at all', () => {
    // A privacy decision, not a default: admin URLs carry case ids and account
    // ids, and any weaker policy hands those to the next origin visited.
    expect(config).toContain("value: 'no-referrer'");
    expect(config).not.toContain('origin-when-cross-origin');
    expect(config).not.toContain('strict-origin');
  });

  it('refuses to be framed', () => {
    expect(config).toContain("value: 'DENY'");
  });

  it('does not advertise the framework', () => {
    expect(config).toContain('poweredByHeader: false');
  });

  it('says why HSTS matters for this cookie in particular', () => {
    // The `__Host-` prefix REQUIRES Secure, so a downgrade does not merely
    // weaken the session — it breaks it.
    expect(readProse('next.config.mjs')).toContain('__Host-');
  });
});

describe('§12 — the two credential stores do not cross', () => {
  it('reads the session from one cookie and sends it as a bearer token', () => {
    // Measured against the live API: an admin token is refused with 401 by
    // user-authenticated routes, the admin credential cannot even be shaped
    // for the user login route (which takes a phone), and a user identifier at
    // /admin/login returns the same message as a wrong password.
    const client = readCode('lib/admin-api/client.ts');

    expect(client).toContain('readAdminToken()');
    expect(client).toContain('Bearer ${token}');
    // The portal has no route to the user API at all.
    expect(client).not.toContain('/auth/');
    expect(client).not.toContain('/login');
  });

  it('has no administrator provisioning surface anywhere', () => {
    // §12 and OD-020: no public admin signup, no Create Admin, no Invite
    // Admin, no bootstrap endpoint, no role selection.
    const all = sourceFiles('app').concat(sourceFiles('components'), sourceFiles('lib'));

    for (const file of all) {
      const code = readCode(file);
      for (const forbidden of [
        'createAdmin',
        'inviteAdmin',
        'bootstrapAdmin',
        '/admin/register',
        '/admin/invite',
      ]) {
        expect(code, `${file} must not offer ${forbidden}`).not.toContain(forbidden);
      }
    }
  });
});

describe('§40 — nothing internal reaches an administrator’s screen', () => {
  it('renders no stack trace and no raw envelope', () => {
    const all = sourceFiles('app').concat(sourceFiles('components'));

    for (const file of all) {
      const code = readCode(file);
      for (const forbidden of ['error.stack', '.stack}', 'JSON.stringify(error']) {
        expect(code, `${file} must not render ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it('renders copy from a code map rather than the server’s message', () => {
    // The contract says the envelope's `message` is "developer-facing English
    // ... NOT for display to users".
    const messages = readCode('lib/admin-api/messages.ts');
    expect(messages).toContain('export function messageForCode');

    const fallback = functionSource('lib/admin-api/messages.ts', 'messageForCode');
    expect(fallback).not.toContain('error.message');
    expect(fallback).toContain('Something went wrong');
  });
});
