export const metadata = {
  title: 'Moderation queue · Mohalla Admin',
};

/**
 * UX-ADM-003 — ADMIN-FR-002.
 *
 * GROUP 03 SCOPE: this route exists so the sidebar is real. Navigation that
 * links to nothing is not navigation, and a shell whose items 404 cannot be
 * tested for active state, keyboard order or the icon rail.
 *
 * THE SCREEN ITSELF IS GROUP 05. What is here says so plainly and shows
 * no invented data — no empty table, no zeroed figures, no sample rows.
 * Stage 7’s eighteen runtime defects were almost all features that looked
 * finished, and a placeholder is how that starts.
 */
export default function Page() {
  return (
    <>
      <h1>Moderation queue</h1>
      <p className="page-lead">
        Open items ordered by severity, then distinct report count, then age ascending. The ordering
        is the server’s and is rendered as given.
      </p>

      <p className="not-built">
        Not built yet — UX-ADM-003 is implemented in Group 05. This route exists so the sidebar
        links somewhere real; nothing on it is a placeholder for the data that will arrive.
      </p>
    </>
  );
}
