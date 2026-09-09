export const metadata = {
  title: 'Users · Mohalla Admin',
};

/**
 * UX-ADM-005 — ADMIN-FR-005.
 *
 * GROUP 03 SCOPE: this route exists so the sidebar is real. Navigation that
 * links to nothing is not navigation, and a shell whose items 404 cannot be
 * tested for active state, keyboard order or the icon rail.
 *
 * THE SCREEN ITSELF IS GROUP 07. What is here says so plainly and shows
 * no invented data — no empty table, no zeroed figures, no sample rows.
 * Stage 7’s eighteen runtime defects were almost all features that looked
 * finished, and a placeholder is how that starts.
 */
export default function Page() {
  return (
    <>
      <h1>Users</h1>
      <p className="page-lead">
        Lookup by username, display name, phone or email. Phone and email are privileged moderation
        data and appear only on user detail, through the audited reveal.
      </p>

      <p className="not-built">
        Not built yet — UX-ADM-005 is implemented in Group 07. This route exists so the sidebar
        links somewhere real; nothing on it is a placeholder for the data that will arrive.
      </p>
    </>
  );
}
