import 'server-only';

import { redirect } from 'next/navigation';
import { readAdminToken } from './admin-session';

/**
 * The gate every authenticated admin route passes through.
 *
 * WHAT THIS IS AND IS NOT. It is a routing decision: does this request have a
 * session cookie, and if not, where does the reader go? It is **not** the
 * authorization boundary. The server is, on every single request — the
 * `@RequiresAdmin()` guard rejects a request whose token is missing, expired,
 * revoked or belongs to a user rather than an administrator, and SEC-021 is
 * enforced there and unreachable from here.
 *
 * That distinction is why this function checks only for the cookie's presence
 * and does not try to validate it. A portal that decided for itself whether a
 * token was good would be inventing a second, weaker copy of the guard, and the
 * two would eventually disagree. An invalid token gets past this and is refused
 * by the API, which is the correct outcome: the refusal comes from the authority
 * that owns it.
 *
 * §11 puts it as a rule — "no authorization logic that exists only in UI", and
 * "no admin privilege decisions based solely on hidden buttons".
 */
export async function requireAdminSession(): Promise<string> {
  const token = await readAdminToken();

  if (token === null) {
    // `redirect` throws, so nothing after this line runs — which is the point.
    // An unauthenticated request must not reach a data fetch, because a fetch
    // that 401s after the page has begun rendering leaves a half-built screen.
    redirect('/login');
  }

  return token;
}

/**
 * Has a session cookie, without redirecting.
 *
 * For the few places that need to branch rather than bounce — the login page
 * sending an already-signed-in reader onward, and the shell deciding whether to
 * show a sign-out control.
 */
export async function hasAdminSession(): Promise<boolean> {
  return (await readAdminToken()) !== null;
}
