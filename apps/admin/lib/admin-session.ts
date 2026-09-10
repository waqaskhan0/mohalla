import 'server-only';

import { cookies } from 'next/headers';

/**
 * Custody of the administrator session token.
 *
 * WHY THE TOKEN NEVER REACHES THE BROWSER BUNDLE.
 *
 * `POST /admin/login` returns the credential in its response body — ADR-008
 * describes an opaque, server-backed session, stored hashed, transported as a
 * bearer token over TLS. Where the *browser* keeps it is Stage 8's decision,
 * and two approved facts settle it:
 *
 *   - `05-admin-architecture.md` §6: "The portal renders user-generated content
 *     and is the highest-value XSS target."
 *   - Stage 8 §36: posts, comments, usernames, bios, report notes and reported
 *     conversation excerpts must all be assumed hostile.
 *
 * A token in `localStorage` or `sessionStorage` is readable by any script that
 * executes on the page. An 8-hour administrator session held there, on the one
 * surface deliberately built to display attacker-controlled strings, turns a
 * single XSS into a moderation-account takeover — the reporter's own content
 * stealing the credential of the person reviewing it.
 *
 * So the token lives in an httpOnly cookie that JavaScript cannot read, and
 * every admin API call is made server-side. This IMPLEMENTS ADR-008's bearer
 * transport rather than departing from it: the `Authorization: Bearer` header
 * still goes to the API. Only the custody moved.
 *
 * `import 'server-only'` makes that a BUILD ERROR rather than a convention — a
 * client component importing this module fails the build instead of quietly
 * shipping the cookie helpers into the bundle.
 */

/**
 * The cookie name.
 *
 * PREFIXED `__Host-` DELIBERATELY. That prefix is enforced by the browser: it
 * refuses the cookie unless it is Secure, has no `Domain` attribute and is
 * pathed at `/`. It cannot be set or overwritten by a subdomain, which closes
 * session fixation from any other host under the same registrable domain — and
 * §100 of the architecture puts the public interstitial and the policy pages in
 * this same deployment, so a sibling surface is not hypothetical.
 *
 * The prefix requires Secure, which requires HTTPS. Local development over
 * plain HTTP therefore uses the unprefixed name — see `sessionCookieName`.
 */
const SECURE_COOKIE_NAME = '__Host-mohalla_admin_session';
const DEV_COOKIE_NAME = 'mohalla_admin_session';

/** Serving over HTTPS? Local development is the only case that is not. */
function isSecureDeployment(): boolean {
  return process.env.NODE_ENV === 'production';
}

export function sessionCookieName(): string {
  return isSecureDeployment() ? SECURE_COOKIE_NAME : DEV_COOKIE_NAME;
}

export interface AdminSession {
  token: string;
  /** ISO instant. The API sets an 8-hour absolute lifetime (SEC-024). */
  expiresAt: string;
}

/**
 * Store the session.
 *
 * `maxAge` is derived from the API's own `expiresAt` rather than a constant, so
 * the cookie cannot outlive the server-side session it points at. If the API's
 * absolute timeout ever changes, this follows without an edit — and a cookie
 * that survived its session would present a reader with a portal that looks
 * signed in and 401s on every action.
 */
export async function writeAdminSession(session: AdminSession): Promise<void> {
  const remainingMs = Date.parse(session.expiresAt) - Date.now();

  // A already-expired or unparseable value is refused rather than stored with a
  // guessed lifetime: the caller has been handed something it cannot rely on.
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) {
    throw new Error('Refusing to store an admin session that is already expired');
  }

  const store = await cookies();
  store.set(sessionCookieName(), session.token, {
    httpOnly: true,
    secure: isSecureDeployment(),
    // STRICT, not Lax. Nothing in the portal is reached by following a link
    // from another site, so there is no flow for `Lax` to enable — and Strict
    // is most of the CSRF answer §38 asks for, since a cross-site form post
    // arrives without the cookie at all.
    sameSite: 'strict',
    path: '/',
    maxAge: Math.floor(remainingMs / 1000),
  });
}

/** The token, or `null` when there is no session. */
export async function readAdminToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(sessionCookieName())?.value ?? null;
}

/**
 * Forget the session locally.
 *
 * SERVER-SIDE REVOCATION IS SEPARATE and happens first — see `logoutAdmin`.
 * Deleting the cookie alone would leave a valid session alive on the server for
 * up to eight hours, which is not a logout.
 */
export async function clearAdminSession(): Promise<void> {
  const store = await cookies();
  store.delete(sessionCookieName());
}
