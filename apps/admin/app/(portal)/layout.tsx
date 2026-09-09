import type { ReactNode } from 'react';
import { requireAdminSession } from '../../lib/require-admin';
import { AdminSidebar } from '../../components/admin-sidebar';
import { signOut } from '../login/actions';

/**
 * The authenticated shell (UI/UX §27).
 *
 * THE GRID IS THE SPEC'S, not a preference:
 *
 *   | Sidebar      | 240px fixed, always visible above 1024px; a 64px icon
 *   |              | rail between 768 and 1024                              |
 *   | Main content | fluid, capped at 1200px, LEFT-ALIGNED against the
 *   |              | sidebar — not centred, "so the eye returns to a
 *   |              | consistent left edge when scanning tables"             |
 *   | Top bar      | 64px                                                   |
 *   | Page         | capped at 1440px; beyond that the ground extends       |
 *
 * The left-alignment is the one that would be easy to get wrong and hard to
 * notice: centring the content looks tidier on a wide monitor and makes every
 * table in the portal start at a different x-position depending on how many
 * columns it has. A moderator scanning a queue reads down a fixed edge.
 *
 * THE GUARD RUNS HERE, ONCE, for every route in the group. A per-page check
 * would be one `await` that a new screen could forget, and forgetting it would
 * not look like anything — the page would simply render to whoever asked.
 *
 * IT IS NOT THE AUTHORIZATION BOUNDARY, and the pages below still fetch through
 * `guardedRequest`. This confirms a session cookie is present; the API decides
 * on every request whether the session behind it is real. ADMIN-RUNTIME-001 was
 * exactly the gap between those two statements.
 */
export default async function PortalLayout({ children }: { children: ReactNode }) {
  await requireAdminSession();

  return (
    <div className="admin-shell">
      {/*
        A skip link, first in the DOM and visible on focus. Six sidebar links
        stand between the top of every page and its content, and a keyboard-only
        administrator should not tab through them on each navigation (§44).
      */}
      <a href="#admin-main" className="skip-link">
        Skip to content
      </a>

      <header className="admin-topbar">
        <span className="admin-brand">Mohalla Admin</span>

        <div className="admin-topbar-end">
          {/*
            NO ADMINISTRATOR NAME IS SHOWN, and that is a gap rather than a
            choice: `POST /admin/login` returns only a token and an expiry, and
            Stage 6 has no `/admin/me`. The alternatives were to invent a
            label or to display nothing, and displaying nothing is the honest
            one — a portal that showed "Administrator" to everybody would be
            decoration pretending to be identity. Recorded as
            ADMIN-API-GAP-002. The UI/UX spec's admin component list does not
            require an identity chip, so nothing approved is unmet.
          */}
          <form action={signOut}>
            <button type="submit" className="topbar-button">
              Sign out
            </button>
          </form>
        </div>
      </header>

      <AdminSidebar />

      <main id="admin-main" className="admin-main">
        {children}
      </main>
    </div>
  );
}
