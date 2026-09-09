import 'server-only';

import { z } from 'zod';
import { adminRequest, AdminApiError } from './client';
import { adminLoginResultSchema } from './schemas';
import { clearAdminSession, readAdminToken, writeAdminSession } from '../admin-session';

/**
 * Administrator sign-in and sign-out (UX-ADM-001 · AUTH-FR-011).
 *
 * WHAT THIS DELIBERATELY DOES NOT CONTAIN, because none of it exists in the
 * product and `05-admin-architecture.md` §1 says the absence is the point:
 *
 *   - no sign-up, no "create administrator", no invitation
 *   - no bootstrap route, in any environment
 *   - no password reset for an administrator
 *   - no role selection
 *
 * Administrators are provisioned by the technical owner via CLI against the
 * database, over an out-of-band channel, using the migration credential the
 * runtime never holds. A public bootstrap route is the classic takeover vector,
 * and OD-020 means there is currently no named owner to hold that credential —
 * so no administrator may be provisioned at all today. That is a governance
 * fact, not a gap for this code to close.
 */

/** The shape of a login attempt's outcome, for the screen to render. */
export type LoginOutcome = { ok: true } | { ok: false; code: string; correlationId: string };

/**
 * Sign in and store the session.
 *
 * ONE FAILURE SHAPE FOR EVERY REJECTION. The API returns `FAILED` for a wrong
 * password AND for a locked-out account — `admin-auth.service.ts` records
 * `ADMIN_LOGIN_BLOCKED_LOCKOUT` in the audit log and then returns exactly what
 * a wrong password returns. This function does not attempt to tell them apart,
 * and the screen shows one message: distinguishing them would reveal whether an
 * address belongs to a real administrator, which is the enumeration that
 * uniformity prevents. AUTH-FR-011's lockout is enforced and audited
 * server-side; the portal's part is to not leak it.
 */
export async function loginAdmin(email: string, password: string): Promise<LoginOutcome> {
  try {
    const result = await adminRequest({
      path: '/admin/login',
      method: 'POST',
      body: { email, password },
      schema: adminLoginResultSchema,
      // The one call that must not carry a credential: there isn't one yet.
      anonymous: true,
    });

    await writeAdminSession({ token: result.token, expiresAt: result.expiresAt });
    return { ok: true };
  } catch (error) {
    if (error instanceof AdminApiError) {
      return { ok: false, code: error.code, correlationId: error.correlationId };
    }
    // A shape error is a portal/API contract drift, not a credential problem.
    // Rethrown so it reaches the error boundary as the developer-facing fault
    // it is, rather than being shown to an administrator as "wrong password" —
    // which would send somebody hunting for a password that was correct.
    throw error;
  }
}

/**
 * Sign out.
 *
 * THE SERVER FIRST, THEN THE COOKIE. Deleting the cookie alone would leave a
 * valid session alive on the server for up to eight hours (SEC-024) — a reader
 * who signed out on a shared machine would still have a live credential in the
 * database. `POST /admin/logout` revokes it.
 *
 * THE COOKIE IS CLEARED EVEN IF THE REVOCATION CALL FAILS. If the API is
 * unreachable, refusing to sign out locally would strand the administrator in a
 * session they have asked to end, which is the worse of the two failures. The
 * server-side session then expires on its own schedule.
 */
export async function logoutAdmin(): Promise<void> {
  const hadSession = (await readAdminToken()) !== null;

  if (hadSession) {
    try {
      await adminRequest({ path: '/admin/logout', method: 'POST', schema: z.void() });
    } catch {
      // Intentionally swallowed — see above. The local session goes regardless.
    }
  }

  await clearAdminSession();
}
