/**
 * The account while it loads (§41).
 *
 * NOTHING WHERE THE IDENTIFIER PANEL GOES. A skeleton in the shape of a button
 * that writes an audit entry would be an invitation to press something before
 * the page can say what pressing it records.
 *
 * AND NO STATE, because "Active" resolving into "Banned" is how somebody reads
 * the wrong answer and acts on it. The skeleton names the fields and leaves
 * every value blank.
 */
export default function AccountLoading() {
  return (
    <>
      <p className="crumb">Accounts</p>
      <h1>Loading the account…</h1>

      <dl className="fact-list fact-grid" aria-busy="true">
        {['State', 'Account type', 'Registered', 'Posts', 'Reports received', 'Reports made'].map(
          (label) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>
                <span className="skeleton-value" />
              </dd>
            </div>
          ),
        )}
      </dl>
    </>
  );
}
