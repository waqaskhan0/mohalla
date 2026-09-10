/**
 * The queue while it loads (§41).
 *
 * SIX SKELETON ROWS IN THE REAL TABLE, so the header and the column widths are
 * already in place when the rows arrive and nothing jumps under the pointer —
 * on a screen where the first click is a navigation into a decision, a shifting
 * row is how the wrong case gets opened.
 *
 * NO COUNTS AND NO ROWS THAT READ AS DATA. Not "0 open cases", not dashes in
 * the severity column. A skeleton that resolves to "nothing is waiting" would
 * be the most misleading possible placeholder here.
 */
export default function QueueLoading() {
  return (
    <>
      <h1>Moderation queue</h1>
      <p className="page-lead">Loading the queue…</p>

      <div className="table-scroll">
        <table className="data-table" aria-busy="true">
          {/*
            A CAPTION EVEN ON THE SKELETON. Found by auditing the streamed
            HTML: this table had `aria-busy` and no caption, so a screen reader
            reaching it while the queue loaded met an unlabelled table. The
            real table's caption describes the ordering; this one says only
            that there is nothing to read yet, which is the true statement at
            that moment.
          */}
          <caption className="table-caption">
            The moderation queue is loading. No cases are listed yet.
          </caption>
          <thead>
            <tr>
              <th scope="col">Severity</th>
              <th scope="col">Reporters</th>
              <th scope="col">Age</th>
              <th scope="col">Type</th>
              <th scope="col">Content</th>
              <th scope="col">
                <span className="visually-hidden">Open the case</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {[0, 1, 2, 3, 4, 5].map((row) => (
              <tr key={row}>
                {[0, 1, 2, 3, 4, 5].map((cell) => (
                  <td key={cell}>
                    <span className="skeleton-line skeleton-cell" />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
