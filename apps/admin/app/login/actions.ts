'use server';

import { redirect } from 'next/navigation';
import { loginAdmin, logoutAdmin } from '../../lib/admin-api/auth';
import { hasCopyFor, messageForCode } from '../../lib/admin-api/messages';
import type { LoginFormState } from './form-state';

/**
 * The sign-in and sign-out actions (UX-ADM-001).
 *
 * SERVER ACTIONS RATHER THAN ROUTE HANDLERS, for three reasons that all matter
 * here:
 *
 *   - The credential is submitted to code that runs on the server and is never
 *     bundled for the browser, so the token it receives has nowhere to leak to.
 *   - Next's action mechanism carries its own origin check, which is §38's
 *     anti-CSRF requirement met by the framework rather than by hand — and
 *     `SameSite=Strict` on the session cookie is the second layer.
 *   - The form works before any JavaScript loads. On the one screen an
 *     administrator needs during an incident, a progressively-enhanced form is
 *     worth more than a fetch call.
 */

/**
 * Validate, sign in, and go to the dashboard.
 *
 * VALIDATION HAPPENS HERE AS WELL AS IN THE BROWSER. `required` on an input is
 * a convenience, not a check — it is absent the moment somebody submits the
 * form with JavaScript disabled or a crafted request. The server is where the
 * answer has to be right.
 *
 * The two field checks are deliberately the API's own bounds
 * (`adminLoginBody`: an email of 3–254 characters, and a password), so the
 * portal refuses locally exactly what the server would refuse remotely rather
 * than inventing a stricter rule. A regex that rejects valid addresses is worse
 * than one round trip.
 */
export async function signIn(
  _previous: LoginFormState,
  formData: FormData,
): Promise<LoginFormState> {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');

  const fields: Record<string, string> = {};
  if (email.length < 3 || email.length > 254) {
    fields.email = 'Enter the email address for your administrator account.';
  }
  if (password.length === 0) {
    fields.password = 'Enter your password.';
  }

  if (Object.keys(fields).length > 0) {
    return { error: null, correlationId: null, fields };
  }

  const outcome = await loginAdmin(email, password);

  if (!outcome.ok) {
    return {
      error: messageForCode(outcome.code),
      // ONLY FOR A CODE THE PORTAL HAS NO COPY FOR. A reference beside "that
      // email or password is not right" reads as a system fault, and sends
      // somebody who simply mistyped their password looking for a technical
      // problem that is not there. An unmapped code is the opposite case: the
      // reader cannot act on it and needs something the logs contain.
      correlationId: hasCopyFor(outcome.code) ? null : outcome.correlationId,
      fields: {},
    };
  }

  // OUTSIDE THE TRY/RETURN PATH. `redirect` works by throwing, so it must not
  // sit inside a `try` that catches — a caught redirect turns a successful
  // sign-in into a silent no-op, which is a genuinely confusing bug to read.
  redirect('/dashboard');
}

/** Sign out and return to the login screen. */
export async function signOut(): Promise<void> {
  await logoutAdmin();
  redirect('/login');
}
