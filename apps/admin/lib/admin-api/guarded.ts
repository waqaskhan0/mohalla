import 'server-only';

import { redirect } from 'next/navigation';
import type { z } from 'zod';
import { adminRequest, AdminApiError } from './client';

/**
 * An admin API call that handles a dead session properly.
 *
 * ADMIN-RUNTIME-001 — FOUND BY RUNNING IT, and it is the reason this module
 * exists.
 *
 * `requireAdminSession` checks that a session COOKIE is present. That is a
 * routing decision and it is deliberately not an authorization decision: the
 * API is the authority, and a portal that decided for itself whether a token
 * was still good would be a second, weaker copy of the guard.
 *
 * The gap is what happens when the cookie is present and the session behind it
 * is not. Measured against a revoked token: the dashboard returned **200 and
 * rendered its full content**, because the page checked the cookie and then
 * never asked the API anything. Somebody who had signed out — or whose 8-hour
 * session (SEC-024) had simply run out — was shown a signed-in console.
 *
 * So the answer is not to validate the token locally. It is to ASK, on every
 * protected page, as part of the data the page needs anyway, and to treat a 401
 * as what it is: this session is over. The cookie is cleared so the reader is
 * not bounced between a stale cookie and a login screen, and they land on
 * `/login`.
 *
 * §37 also requires that a session expiring mid-action must not record a
 * partial enforcement action. That falls out of this: a 401 means the server
 * did nothing, and the reader is returned to sign-in rather than shown a form
 * that appears to have half-worked.
 */
export async function guardedRequest<T>(args: {
  path: string;
  schema: z.ZodType<T>;
  method?: 'GET' | 'POST' | 'PUT';
  body?: unknown;
}): Promise<T> {
  try {
    return await adminRequest(args);
  } catch (error) {
    if (error instanceof AdminApiError && error.status === 401) {
      // THROUGH A ROUTE HANDLER, not by clearing the cookie here. Next refuses
      // to modify cookies during a render — "Cookies can only be modified in a
      // Server Action or Route Handler" — and the first version of this did
      // clear it inline, which turned a dead session into a 500 instead of a
      // sign-in screen. `/session-expired` deletes the cookie where that is
      // permitted and forwards to `/login?expired=1`.
      //
      // `redirect` throws, so nothing after it runs and the page never
      // continues with half-fetched state.
      redirect('/session-expired');
    }
    throw error;
  }
}
