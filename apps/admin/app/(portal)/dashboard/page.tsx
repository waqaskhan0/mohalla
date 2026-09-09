import { guardedRequest } from '../../../lib/admin-api/guarded';
import { dashboardCountsSchema } from '../../../lib/admin-api/schemas';

export const metadata = {
  title: 'Dashboard · Mohalla Admin',
};

/**
 * UX-ADM-002 — the dashboard.
 *
 * GROUP 03 SCOPE. The metric tiles are Group 04, with open reports as the
 * primary operational signal. What this page does today is fetch the seven
 * aggregate figures and validate their shape.
 *
 * THE FETCH IS NOT DECORATION. It is the fix for ADMIN-RUNTIME-001: a protected
 * page that never asks the API cannot discover that the session behind its
 * cookie is dead, and the first version of this page rendered its full content
 * to a revoked token. `guardedRequest` turns the API's 401 into a cleared
 * cookie and a redirect, so the authority stays with the server.
 *
 * NO SESSION CHECK HERE — the shell layout does it once for every route in the
 * group, which is one place to get right instead of one per page to forget.
 *
 * NO SIGN-OUT BUTTON HERE either; the top bar owns it now.
 */
export default async function DashboardPage() {
  const counts = await guardedRequest({
    path: '/admin/dashboard',
    schema: dashboardCountsSchema,
  });

  return (
    <>
      <h1>Dashboard</h1>
      <p className="page-lead">
        The session is live: this page fetched {Object.keys(counts).length} aggregate figures from
        the API and validated their shape.
      </p>

      <p className="not-built">
        Not built yet — the metric tiles (ADMIN-FR-001 / ADMIN-FR-011) are implemented in Group 04,
        with open reports as the primary figure. The numbers are deliberately not rendered here
        rather than shown as placeholders.
      </p>
    </>
  );
}
