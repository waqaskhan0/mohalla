import Link from 'next/link';
import { guardedRequest } from '../../../lib/admin-api/guarded';
import { AdminApiError, AdminApiShapeError } from '../../../lib/admin-api/client';
import { queuePageSchema } from '../../../lib/admin-api/schemas';
import { messageForCode } from '../../../lib/admin-api/messages';
import { SeverityIndicator, VisibilityFlag } from '../../../components/severity-indicator';
import { exactInstant, formatAge } from '../../../lib/format-age';

export const metadata = {
  title: 'Moderation queue · Mohalla Admin',
};

/**
 * UX-ADM-003 — the moderation queue (ADMIN-FR-002).
 *
 * "The daily workspace", and the screen the whole portal exists to serve.
 *
 * THE ORDER IS THE SERVER'S AND IS NEVER TOUCHED HERE. Severity, then distinct
 * report count, then age ascending — and the API explains the last one: the
 * oldest of equal cases first, "because a queue that surfaced the newest would
 * let an item at the bottom wait forever". §16 forbids re-sorting client-side,
 * so this page renders `cases` in the order it receives them and offers no
 * column sorting at all. A sortable header here would be a second ordering
 * policy competing with the one the server enforces.
 *
 * THE HEADER STATES THE ORDER, because the spec asks for exactly that: ordering
 * "stated in the column header so the ordering is never a mystery. A Critical
 * item reported once outranks a Low item reported five times." A moderator who
 * cannot tell why row three is above row four will eventually decide the queue
 * is wrong and start scanning past it.
 *
 * NO AUTHOR COLUMN, and that is the API's shape rather than an omission. The
 * queue response carries `targetOwnerId` and nothing else about the author — no
 * handle, no display name. §16 says "author summary as approved", and what is
 * approved puts the author on the DETAIL screen: UX-ADM-004 is "full content,
 * every report, author history". Rendering a bare UUID in a column a moderator
 * scans would be noise, and fetching a profile per row would be a query per
 * row. Recorded as an observation rather than a gap, because nothing approved
 * asks for it here.
 *
 * PAGING IS OFFSET-BASED because the API's is, and the API says why: the
 * ordering key is mutable, so a new report changes a case's severity or count
 * and moves it. Keyset paging over a moving key would skip and repeat rows.
 */

const PAGE_SIZE = 20;

/** The API's own bounds — `limit` 1–50, `offset` 0–5000. */
const MAX_OFFSET = 5000;

export default async function ModerationQueuePage({
  searchParams,
}: {
  searchParams: Promise<{ offset?: string }>;
}) {
  const { offset: rawOffset } = await searchParams;

  // Clamped here rather than passed through. A hand-edited `?offset=99999`
  // would otherwise reach the API and come back a validation error, which is a
  // confusing answer to a URL somebody typed — and `offset=-1` would be worse,
  // because a negative page is not a thing anybody meant.
  const parsed = Number.parseInt(rawOffset ?? '0', 10);
  const offset = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 0), MAX_OFFSET) : 0;

  let page;
  try {
    page = await guardedRequest({
      path: `/admin/moderation/queue?limit=${PAGE_SIZE}&offset=${offset}`,
      schema: queuePageSchema,
    });
  } catch (error) {
    return <QueueUnavailable error={error} />;
  }

  const shown = page.cases.length;
  const from = shown === 0 ? 0 : offset + 1;
  const to = offset + shown;
  const hasPrevious = offset > 0;
  const hasNext = to < page.total && offset + PAGE_SIZE <= MAX_OFFSET;

  // ADMIN-RUNTIME-003 — "THE QUEUE IS CLEAR" IS ONLY EVER TRUE ON PAGE ONE.
  //
  // The first version of this page rendered `QueueClear` whenever
  // `page.total === 0`, and told a moderator "Nothing is waiting for review"
  // while 1,397 cases were open. Measured: `?offset=1400` returns
  // `{"cases":[],"total":0}`.
  //
  // The API's total is a window function — `COUNT(*) OVER ()` — so it is
  // carried on each row and is genuinely the pre-LIMIT count. But an offset
  // past the end returns NO rows, so there is no row to carry it, and the
  // repository falls back to `Number(r.rows[0]?.total ?? 0)`. The zero is a
  // missing value dressed as a real one. Recorded as ADMIN-API-GAP-003.
  //
  // A portal should not depend on that being fixed. An empty result at a
  // non-zero offset means "you have paged past the end", which is a different
  // statement from "there is nothing here" — and only one of them is safe to
  // put in front of somebody whose job is to clear the queue.
  const queueIsGenuinelyClear = offset === 0 && page.total === 0 && shown === 0;
  const pagedPastTheEnd = offset > 0 && shown === 0;

  return (
    <>
      <h1>Moderation queue</h1>

      {queueIsGenuinelyClear ? (
        <QueueClear />
      ) : pagedPastTheEnd ? (
        <PastTheEnd offset={offset} />
      ) : (
        <>
          <p className="page-lead">
            {page.total.toLocaleString('en')} open {page.total === 1 ? 'case' : 'cases'}. Ordered by
            severity, then number of distinct reporters, then age — oldest first among equals, so
            nothing waits indefinitely at the bottom.
          </p>

          {/*
            The table scrolls inside its own container, so the PAGE never
            scrolls sideways (§27). A horizontally scrolling page loses the
            sidebar, which is how somebody ends up unable to get back.
          */}
          <div className="table-scroll">
            <table className="data-table">
              <caption className="table-caption">
                Open moderation cases, ordered by severity, then distinct report count, then age
                ascending. This order is set by the server and cannot be changed here.
              </caption>
              <thead>
                <tr>
                  {/* The ordering is named in the headers themselves, in rank
                      order, so the reason row three sits above row four is on
                      screen rather than in a document. */}
                  <th scope="col">
                    Severity <span className="rank">1st</span>
                  </th>
                  <th scope="col">
                    Reporters <span className="rank">2nd</span>
                  </th>
                  <th scope="col">
                    Age <span className="rank">3rd</span>
                  </th>
                  <th scope="col">Type</th>
                  <th scope="col">Content</th>
                  <th scope="col">
                    <span className="visually-hidden">Open the case</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {page.cases.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <SeverityIndicator severity={item.maxSeverity} />
                    </td>
                    <td className="numeric">{item.distinctReportCount.toLocaleString('en')}</td>
                    <td className="numeric" title={exactInstant(item.createdAt)}>
                      {formatAge(item.createdAt)}
                    </td>
                    <td>{item.targetType}</td>
                    <td>
                      <VisibilityFlag autoHidden={item.autoHidden} />
                    </td>
                    <td>
                      {/*
                        The row's link is an explicit control rather than a
                        click handler on the whole row. A row-wide handler
                        cannot be reached by keyboard, does not appear in the
                        tab order, and gives a screen reader nothing to
                        announce — and this is the one navigation every
                        moderation decision starts with.
                      */}
                      <Link href={`/moderation/${item.id}`} className="row-link">
                        Review<span className="visually-hidden"> case {item.id}</span>
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <nav className="pager" aria-label="Queue pages">
            <span className="muted">
              Showing {from.toLocaleString('en')}–{to.toLocaleString('en')} of{' '}
              {page.total.toLocaleString('en')}
            </span>

            <span className="pager-controls">
              {hasPrevious ? (
                <Link href={`/moderation?offset=${Math.max(offset - PAGE_SIZE, 0)}`}>
                  ← Previous
                </Link>
              ) : (
                <span className="muted">← Previous</span>
              )}
              {hasNext ? (
                <Link href={`/moderation?offset=${offset + PAGE_SIZE}`}>Next →</Link>
              ) : (
                <span className="muted">Next →</span>
              )}
            </span>
          </nav>

          {offset + PAGE_SIZE > MAX_OFFSET && to < page.total && (
            /*
              The API caps `offset` at 5000, so past that point the remaining
              cases cannot be reached by paging. Said out loud rather than
              leaving a dead "Next" — a moderator who cannot get to page 251
              needs to know the limit exists, not wonder whether the button is
              broken. It is also not a practical problem: a queue this deep is
              a staffing signal long before it is a paging one.
            */
            <p className="not-built">
              The API pages to {MAX_OFFSET.toLocaleString('en')} cases. Beyond that, work through
              the cases above — the order puts the most urgent first, so the queue drains from the
              top.
            </p>
          )}
        </>
      )}
    </>
  );
}

/**
 * A page beyond the end of the queue.
 *
 * REACHED BY A HAND-EDITED URL, or by a bookmark to a deep page after the queue
 * drained. It is not an error and it is not an empty queue, so it says what it
 * is and offers the one thing the reader wants — the top of the queue.
 *
 * IT MAKES NO CLAIM ABOUT HOW MANY CASES ARE OPEN, because at this offset the
 * API cannot tell us: `total` comes back as 0 for want of a row to carry it
 * (ADMIN-API-GAP-003). Printing "0 open cases" here is precisely the mistake
 * this component exists to undo.
 */
function PastTheEnd({ offset }: { offset: number }) {
  return (
    <div className="queue-clear">
      <p className="queue-clear-headline">There is nothing on this page.</p>
      <p className="muted">
        This is case {offset.toLocaleString('en')} onward, which is past the end of the queue as it
        stands now. That does not mean the queue is empty — start from the beginning to see what is
        waiting.
      </p>
      <p>
        <Link href="/moderation" className="row-link">
          Go to the first page
        </Link>
      </p>
    </div>
  );
}

/**
 * An empty queue.
 *
 * §16: "Treat as a positive operational state, not an error." Nothing is
 * waiting, which on this screen is the best possible answer — so it is phrased
 * as one. An empty table with a grey "No data" would read as a tool that had
 * failed to load, and a moderator's first instinct would be to refresh it.
 */
function QueueClear() {
  return (
    <div className="queue-clear">
      <p className="queue-clear-headline">Nothing is waiting for review.</p>
      <p className="muted">
        Every reported item has been dealt with. New reports appear here automatically, ordered by
        severity.
      </p>
    </div>
  );
}

/**
 * The queue, when it could not be fetched.
 *
 * IT DOES NOT RENDER AN EMPTY TABLE. "Nothing is waiting for review" when the
 * request actually failed is the same lie as a zero on the dashboard, and on
 * this screen it would send a moderator away from a queue that is full.
 */
function QueueUnavailable({ error }: { error: unknown }) {
  const isShape = error instanceof AdminApiShapeError;
  const apiError = error instanceof AdminApiError ? error : null;
  const reference = apiError?.correlationId ?? (isShape ? error.correlationId : undefined);

  return (
    <>
      <h1>Moderation queue</h1>

      <div role="alert" className="notice notice-error">
        <p>
          {isShape
            ? 'The API answered, but not in a shape this portal understands. The queue is not shown rather than shown wrongly.'
            : messageForCode(apiError?.code ?? 'UNKNOWN')}
        </p>
        <p className="muted small">
          This is not an empty queue — nothing could be read, so nothing is claimed about what is
          waiting.
        </p>
        {reference !== undefined && <p className="mono muted small">Reference: {reference}</p>}
      </div>
    </>
  );
}
