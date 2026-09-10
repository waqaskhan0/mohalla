import { NextResponse } from 'next/server';
import { clearAdminSession } from '../../lib/admin-session';

/**
 * Clear a dead session and send the reader to sign in.
 *
 * WHY A ROUTE HANDLER AND NOT JUST A REDIRECT. Next refuses to modify cookies
 * during a Server Component render — "Cookies can only be modified in a Server
 * Action or Route Handler" — and the first attempt at ADMIN-RUNTIME-001's fix
 * did exactly that, from inside the page's data fetch. The page 500'd. The
 * message was precise and the fix is to do the clearing where it is allowed.
 *
 * WHY THE COOKIE MUST BE CLEARED AT ALL, rather than simply redirecting: the
 * login page sends an already-signed-in reader on to the dashboard, so a stale
 * cookie plus a bare redirect is an infinite bounce — dashboard 401s to login,
 * login sees a cookie and returns to the dashboard. Removing the cookie on the
 * way through is what breaks that cycle, and it is also just correct: the
 * session is over and the browser should not keep presenting it.
 *
 * GET RATHER THAN POST, deliberately, even though it changes state. It is
 * reached by a redirect from a failed page render, which can only be a GET —
 * and what it changes is the reader's OWN dead cookie, which is not a state
 * anybody can be tricked into altering to their detriment. §38's rule against
 * state-changing GETs is about mutations on the product's data; this deletes a
 * credential that the server has already stopped honouring.
 */
export async function GET(request: Request) {
  await clearAdminSession();

  const url = new URL('/login?expired=1', request.url);
  // 303, so the browser follows with a GET regardless of how it arrived.
  return NextResponse.redirect(url, 303);
}
