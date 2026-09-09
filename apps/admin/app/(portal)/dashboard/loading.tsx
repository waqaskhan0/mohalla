/**
 * The dashboard while its figures are in flight (§41).
 *
 * A SKELETON THAT MATCHES THE REAL LAYOUT, so the page does not jump when the
 * numbers land. Four tiles in the same grid, at the same size.
 *
 * IT SHOWS NO NUMBERS AT ALL — not zeros, not dashes styled to look like
 * values. A skeleton whose placeholder reads as data is how somebody
 * screenshots an empty dashboard and believes it.
 *
 * `aria-busy` and a polite live region, so a screen-reader user is told the
 * figures are loading rather than being read four unlabelled boxes.
 */
export default function DashboardLoading() {
  return (
    <>
      <h1>Dashboard</h1>
      <p className="page-lead">Loading the figures…</p>

      <div className="tile-grid" aria-busy="true" aria-live="polite">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className={i === 0 ? 'metric-tile metric-tile-primary' : 'metric-tile'}>
            <span className="skeleton-line skeleton-label" />
            <span className="skeleton-line skeleton-value" />
          </div>
        ))}
      </div>
    </>
  );
}
