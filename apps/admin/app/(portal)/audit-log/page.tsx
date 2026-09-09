export const metadata = {
  title: 'Audit log · Mohalla Admin',
};

/**
 * UX-ADM-009 — ADMIN-FR-012.
 *
 * GROUP 03 SCOPE: this route exists so the sidebar is real. Navigation that
 * links to nothing is not navigation, and a shell whose items 404 cannot be
 * tested for active state, keyboard order or the icon rail.
 *
 * THE SCREEN ITSELF IS GROUP 12. What is here says so plainly and shows
 * no invented data — no empty table, no zeroed figures, no sample rows.
 * Stage 7’s eighteen runtime defects were almost all features that looked
 * finished, and a placeholder is how that starts.
 */
export default function Page() {
  return (
    <>
      <h1>Audit log</h1>
      <p className="page-lead">
        Append-only and read-only, searchable by administrator, action and date. No interface offers
        to edit or delete an entry (BR-039).
      </p>

      <p className="not-built">
        Not built yet — UX-ADM-009 is implemented in Group 12. This route exists so the sidebar
        links somewhere real; nothing on it is a placeholder for the data that will arrive.
      </p>
    </>
  );
}
