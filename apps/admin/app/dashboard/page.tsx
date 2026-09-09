import { requireAdminSession } from '../../lib/require-admin';
import { guardedRequest } from '../../lib/admin-api/guarded';
import { dashboardCountsSchema } from '../../lib/admin-api/schemas';
import { signOut } from '../login/actions';

export const metadata = {
  title: 'Dashboard · Mohalla Admin',
};

/**
 * UX-ADM-002 — the dashboard.
 *
 * GROUP 02 SCOPE. The metric tiles (ADMIN-FR-001/011) and the shell around them
 * arrive in Groups 03 and 04. What is here is the authenticated landing target
 * that makes sign-in, the route guard, session expiry and sign-out testable end
 * to end.
 *
 * IT MAKES A REAL API CALL, and that is the fix for ADMIN-RUNTIME-001 rather
 * than a head start on Group 04. The first version of this page checked the
 * session cookie and then rendered static text, so a REVOKED session got a 200
 * and the full page: measured, against a token that had been logged out. A
 * protected page that never asks the API cannot know whether the session behind
 * its cookie is still alive.
 *
 * So the page fetches through `guardedRequest`, which turns the API's 401 into
 * a cleared cookie and a redirect to sign-in. The authority stays where it
 * belongs — the portal asks rather than deciding.
 *
 * THE FIGURES ARE NOT RENDERED YET, deliberately. Group 04 designs the tiles,
 * with open reports as the primary operational signal. Showing a bare number
 * here would be a placeholder pretending to be a feature, which is the exact
 * habit Stage 7 spent eighteen defects unlearning. The count of fields received
 * is shown instead: it proves the call and the schema, and claims nothing more.
 */
export default async function DashboardPage() {
  await requireAdminSession();

  const counts = await guardedRequest({
    path: '/admin/dashboard',
    schema: dashboardCountsSchema,
  });

  return (
    <main>
      <h1>Dashboard</h1>
      <p className="muted">
        Signed in, and the session is live — this page fetched {Object.keys(counts).length}{' '}
        aggregate figures from the API and validated their shape. The tiles themselves (ADMIN-FR-001
        / ADMIN-FR-011) are built in Group 04; placeholder numbers are deliberately not shown here.
      </p>

      <form action={signOut}>
        <button type="submit" className="secondary">
          Sign out
        </button>
      </form>
    </main>
  );
}
