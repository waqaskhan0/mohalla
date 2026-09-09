/**
 * The case detail while it loads (§41).
 *
 * WHY THIS FILE EXISTS AT ALL. `loading.tsx` in the `moderation` segment
 * applies to that segment AND ITS CHILDREN, so without this file, opening a
 * case showed the QUEUE's skeleton: the heading "Moderation queue", the words
 * "Loading the queue…", and six placeholder rows in a six-column table. A
 * moderator who clicked Review was told the queue was loading, on a page that
 * was never going to become a queue. Found by opening a case in a browser.
 *
 * A CASE-SHAPED SKELETON, and deliberately a plain one: the fact list, and
 * nothing where the decision controls go. A skeleton in the shape of three
 * buttons would be worse than none, because the one thing that must never look
 * ready before it is ready is a row of enforcement actions.
 *
 * NO COUNTS, NO SEVERITY, NO STATE. Every figure on this screen is one an
 * administrator may act on, and a placeholder that resolves into a different
 * value is how somebody reads "Low" and decides before the page has finished
 * telling them it is "Critical".
 */
export default function CaseLoading() {
  return (
    <>
      <p className="crumb">Moderation queue</p>
      <h1>Loading the case…</h1>

      <dl className="fact-list fact-grid" aria-busy="true">
        {['Reported by', 'Opened', 'Currently', 'Case state', 'Target', 'Author'].map((label) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>
              <span className="skeleton-value" />
            </dd>
          </div>
        ))}
      </dl>
    </>
  );
}
