export const metadata = {
  title: 'Queue item · Mohalla Admin',
};

/**
 * UX-ADM-004 — the queue item detail.
 *
 * GROUP 05 SCOPE: this route exists so a queue row links somewhere real. The
 * decision workspace — full content, every report, author enforcement history,
 * and Restore/Delete as equal peers with a mandatory reason — is Group 06.
 *
 * IT SHOWS THE CASE ID AND NOTHING ELSE ABOUT THE CASE. Fetching the case here
 * would be the wrong kind of head start: `GET /admin/moderation/cases/:id` is
 * one of the two endpoints whose access is audited when it touches a reported
 * conversation (PRIV-009), and calling it to render a page that cannot act on
 * the result would write audit entries for accesses nobody made.
 */
export default async function QueueItemPage({ params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;

  return (
    <>
      <h1>Queue item</h1>
      <p className="page-lead mono">{caseId}</p>

      <p className="not-built">
        Not built yet — UX-ADM-004 is implemented in Group 06, with the full content, every report,
        the author&apos;s enforcement history, and Restore and Delete as equal peers. The case is
        deliberately not fetched here: that endpoint is audited, and reading a case to render a page
        that cannot act on it would record accesses nobody made.
      </p>
    </>
  );
}
