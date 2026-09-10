import Link from 'next/link';
import { guardedRequest } from '../../../lib/admin-api/guarded';
import { apiFailure } from '../../../lib/admin-api/failure';
import { AdminApiError, AdminApiShapeError } from '../../../lib/admin-api/client';
import { auditLogPageSchema, type AuditEntry } from '../../../lib/admin-api/schemas';
import { messageForCode } from '../../../lib/admin-api/messages';
import { exactInstant, formatAge } from '../../../lib/format-age';
import { AUDIT_ACTION_GROUPS, auditActionDescription } from '../../../lib/audit-actions';

export const metadata = {
  title: 'Audit log · Mohalla Admin',
};

const PAGE_SIZE = 50;

/** The API's own bounds: `offset` 0–10000, `limit` 1–200. */
const MAX_OFFSET = 10_000;

/**
 * UX-ADM-009 — the audit log (ADMIN-FR-012).
 *
 * READ ONLY, AND THERE IS NO SERVER ACTION IN THIS DIRECTORY. §33 forbids edit,
 * delete, clear, truncate, correct, bulk delete and export, and BR-039 puts it
 * as a property of the system rather than of the interface: "the log is
 * append-only and NO INTERFACE, PERMISSION OR ADMINISTRATOR can edit or delete
 * an entry." The API satisfies that by having no route at any layer that
 * writes, and this screen satisfies it the same way — one `guardedRequest` on a
 * GET, no `'use server'` file, no form that posts anything. There is nothing
 * here to disable, because there is nothing here.
 *
 * NO EXPORT. §33 lists it among the forbidden operations "unless specifically
 * approved", and it has not been. ADMIN-FR-011 independently rules out data
 * export in V1. So there is no download, no CSV and no copy-all.
 *
 * THE FILTERS ARE A GET FORM, so a search is a place: linkable, back-button
 * safe, and reloadable without re-posting. That matters more here than
 * elsewhere — an audit query is the sort of thing somebody pastes into a
 * ticket.
 *
 * THE ACTION FILTER IS AN EXACT MATCH and the screen says so. Measured:
 * `action=ADMIN_SUSPEND` returns 105 entries, `action=suspend` returns 0. A
 * bare text box would turn a typo into "there is no record of this", which on
 * this screen is the worst thing it could say wrongly — so the field is backed
 * by a suggestion list of the actions the API actually emits.
 *
 * AND THE SAME FALSE ZERO AS THE QUEUE. `total` is `COUNT(*) OVER ()` with a
 * `?? 0` fallback, so an offset past the end reports zero entries out of zero
 * — measured at `?offset=9999` against 1,691 entries. "There is no record" is
 * a claim only page one can make.
 */
export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<{
    action?: string;
    adminId?: string;
    from?: string;
    to?: string;
    offset?: string;
  }>;
}) {
  const params = await searchParams;
  const action = (params.action ?? '').trim();
  const adminId = (params.adminId ?? '').trim();
  const from = (params.from ?? '').trim();
  const to = (params.to ?? '').trim();

  const parsed = Number.parseInt(params.offset ?? '0', 10);
  const offset = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 0), MAX_OFFSET) : 0;

  // Built here rather than passed through, so a hand-edited value cannot reach
  // the API as a 400 the reader has to interpret. An `adminId` that is not a
  // UUID is dropped with a note rather than sent.
  const adminIdLooksValid =
    adminId === '' ||
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(adminId);

  const query = new URLSearchParams();
  query.set('limit', String(PAGE_SIZE));
  query.set('offset', String(offset));
  if (action !== '') query.set('action', action);
  if (adminId !== '' && adminIdLooksValid) query.set('adminId', adminId);
  // A `date` input gives YYYY-MM-DD; the API wants an ISO instant. `from` is
  // the start of that day and `to` the end, so a single day chosen in both
  // fields means that whole day rather than one instant at midnight.
  const fromInstant = dayBoundary(from, 'start');
  const toInstant = dayBoundary(to, 'end');
  if (fromInstant !== null) query.set('from', fromInstant);
  if (toInstant !== null) query.set('to', toInstant);

  const filtered = action !== '' || adminId !== '' || from !== '' || to !== '';

  let page;
  try {
    page = await guardedRequest({
      path: `/admin/audit-log?${query.toString()}`,
      schema: auditLogPageSchema,
    });
  } catch (error) {
    return <LogUnavailable error={apiFailure(error)} />;
  }

  const shown = page.entries.length;
  const from1 = shown === 0 ? 0 : offset + 1;
  const to1 = offset + shown;
  const pagedPastTheEnd = offset > 0 && shown === 0;
  const genuinelyEmpty = offset === 0 && shown === 0 && page.total === 0;

  const search = (next: number) => {
    const q = new URLSearchParams();
    if (action !== '') q.set('action', action);
    if (adminId !== '') q.set('adminId', adminId);
    if (from !== '') q.set('from', from);
    if (to !== '') q.set('to', to);
    if (next > 0) q.set('offset', String(next));
    const s = q.toString();
    return s === '' ? '/audit-log' : `/audit-log?${s}`;
  };

  return (
    <>
      <h1>Audit log</h1>
      <p className="page-lead">
        Every enforcement action, moderation decision, publication, verification change and
        administrator look at private data. Newest first.
      </p>

      {/*
        §33 / BR-039, said on the screen because it is the property that makes
        the log worth having. If it could be edited it would be a report, not
        evidence.
      */}
      <p className="not-built">
        This log is append-only and read only. Nothing here can be edited, corrected, deleted or
        exported — not from this screen, and not from any other interface or permission level. That
        is what makes it usable as a record.
      </p>

      <form className="audit-filters" method="GET" action="/audit-log" role="search">
        <div className="field">
          <label htmlFor="action">Action</label>
          <input
            id="action"
            name="action"
            type="text"
            list="audit-actions"
            defaultValue={action}
            placeholder="e.g. ADMIN_SUSPEND"
            autoComplete="off"
            maxLength={80}
            aria-describedby="action-note"
          />
          <datalist id="audit-actions">
            {AUDIT_ACTION_GROUPS.map((group) => (
              <optgroup key={group.label} label={group.label}>
                {group.actions.map((a) => (
                  <option key={a} value={a}>
                    {auditActionDescription(a) ?? a}
                  </option>
                ))}
              </optgroup>
            ))}
          </datalist>
          <p className="field-note" id="action-note">
            An exact, case-sensitive match — <code>suspend</code> finds nothing;{' '}
            <code>ADMIN_SUSPEND</code> finds the suspensions. The suggestions are the actions this
            portal knows about; the log may hold others, and any value can be typed.
          </p>
        </div>

        <div className="field">
          <label htmlFor="adminId">Administrator id</label>
          <input
            id="adminId"
            name="adminId"
            type="text"
            defaultValue={adminId}
            placeholder="UUID"
            autoComplete="off"
            maxLength={36}
            aria-invalid={adminIdLooksValid ? undefined : true}
            aria-describedby="admin-note"
          />
          <p className="field-note" id="admin-note">
            The API filters by id, not by name — there is no route that lists administrators, so
            take the id from an entry below.
          </p>
          {!adminIdLooksValid && (
            <p className="field-error" role="alert">
              That is not a UUID, so it was not used as a filter. The results below are unfiltered
              by administrator.
            </p>
          )}
        </div>

        <div className="field">
          <label htmlFor="from">From</label>
          <input id="from" name="from" type="date" defaultValue={from} />
        </div>

        <div className="field">
          <label htmlFor="to">To</label>
          <input id="to" name="to" type="date" defaultValue={to} />
          <p className="field-note">Both dates are inclusive whole days.</p>
        </div>

        <div className="audit-filter-actions">
          <button type="submit">Search the log</button>
          {filtered && (
            <Link href="/audit-log" className="row-link">
              Clear the filters
            </Link>
          )}
        </div>
      </form>

      {genuinelyEmpty ? (
        <div className="queue-clear">
          <p className="queue-clear-headline">
            {filtered ? 'No entry matches those filters.' : 'The log holds no entries.'}
          </p>
          <p className="muted">
            {filtered
              ? 'Check the action spelling — the match is exact and case-sensitive — and widen the dates.'
              : 'Nothing has been recorded yet. Entries appear here as administrators act.'}
          </p>
        </div>
      ) : pagedPastTheEnd ? (
        <div className="queue-clear">
          <p className="queue-clear-headline">There is nothing on this page.</p>
          <p className="muted">
            This is entry {offset.toLocaleString('en')} onward, which is past the end of these
            results. THAT IS NOT A STATEMENT THAT NO SUCH ENTRY EXISTS — at this offset the API
            reports a total of zero whether or not the log is empty (ADMIN-API-GAP-003), so nothing
            can be concluded from this page. Start from the beginning.
          </p>
          <p>
            <Link href={search(0)} className="row-link">
              Go to the first page
            </Link>
          </p>
        </div>
      ) : (
        <>
          <p className="page-lead">
            {page.total.toLocaleString('en')} {page.total === 1 ? 'entry' : 'entries'}
            {filtered ? ' match these filters' : ' in the log'}. Showing{' '}
            {from1.toLocaleString('en')}–{to1.toLocaleString('en')}.
          </p>

          <div className="table-scroll">
            <table className="data-table">
              <caption className="table-caption">
                Audit entries, newest first. This table cannot be edited, and there is no route that
                would allow it.
              </caption>
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">Action</th>
                  <th scope="col">Actor</th>
                  <th scope="col">Subject</th>
                  <th scope="col">Detail</th>
                </tr>
              </thead>
              <tbody>
                {page.entries.map((entry) => (
                  <Row key={entry.id} entry={entry} />
                ))}
              </tbody>
            </table>
          </div>

          <nav className="pager" aria-label="Audit log pages">
            <span className="muted">
              {from1.toLocaleString('en')}–{to1.toLocaleString('en')} of{' '}
              {page.total.toLocaleString('en')}
            </span>
            <span className="pager-controls">
              {offset > 0 ? (
                <Link href={search(Math.max(offset - PAGE_SIZE, 0))}>← Newer</Link>
              ) : (
                <span className="muted">← Newer</span>
              )}
              {to1 < page.total && offset + PAGE_SIZE <= MAX_OFFSET ? (
                <Link href={search(offset + PAGE_SIZE)}>Older →</Link>
              ) : (
                <span className="muted">Older →</span>
              )}
            </span>
          </nav>

          {offset + PAGE_SIZE > MAX_OFFSET && to1 < page.total && (
            <p className="not-built">
              The API pages to {MAX_OFFSET.toLocaleString('en')} entries. Beyond that, narrow the
              search by action or date rather than paging — the filters reach entries the pager
              cannot.
            </p>
          )}
        </>
      )}
    </>
  );
}

/**
 * One entry.
 *
 * THE ACTOR IS AN ID, AND A MISSING ONE IS SAID OUT LOUD. `actorId` is null
 * "for SYSTEM, and for an actor who could not be identified" — two different
 * things, and neither is a blank cell. There is no route that resolves an
 * administrator id to a name (the API has no administrator listing at all), so
 * the id is what there is.
 */
function Row({ entry }: { entry: AuditEntry }) {
  const description = auditActionDescription(entry.action);
  const details = Object.entries(entry.metadata);

  return (
    <tr>
      <td title={exactInstant(entry.occurredAt)}>{formatAge(entry.occurredAt)} ago</td>
      <td>
        {/* The wire value stays visible: it is what gets pasted into a filter
            or a ticket. The description explains it rather than replacing it. */}
        <span className="mono">{entry.action}</span>
        {description !== null && (
          <>
            <br />
            <span className="muted small">{description}</span>
          </>
        )}
      </td>
      <td>
        <span className="muted small">{entry.actorType}</span>
        <br />
        {entry.actorId === null ? (
          <span className="muted">
            {entry.actorType === 'SYSTEM' ? 'No actor — automatic' : 'Actor not identified'}
          </span>
        ) : (
          <span className="mono small">{entry.actorId}</span>
        )}
      </td>
      <td>
        <span className="muted small">{entry.entityType}</span>
        <br />
        {entry.entityId === null ? (
          <span className="muted">None recorded</span>
        ) : (
          <span className="mono small">{entry.entityId}</span>
        )}
      </td>
      <td>
        {details.length === 0 ? (
          <span className="muted">None</span>
        ) : (
          /*
            RENDERED AS KEY AND VALUE, NOT AS JSON. §40 keeps raw JSON off an
            administrator's screen, and metadata routinely carries another
            administrator's free-text reason — which §34 names as something
            never to pass through `dangerouslySetInnerHTML`. Every value here
            goes through React as text.
          */
          <dl className="metadata">
            {details.map(([key, value]) => (
              <div key={key}>
                <dt>{key}</dt>
                <dd>{renderValue(value)}</dd>
              </div>
            ))}
          </dl>
        )}
      </td>
    </tr>
  );
}

/**
 * A metadata value as text.
 *
 * NOTHING IS FORMATTED CLEVERLY. An audit value is evidence; a value the portal
 * reshaped is a value somebody has to reason about twice. Arrays are joined
 * because `{"fields":["phone","dateOfBirth"]}` reads better as a list than as a
 * bracketed literal, and everything else is stringified plainly.
 */
function renderValue(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return value.map((v) => String(v)).join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/** `YYYY-MM-DD` to an ISO instant at the start or end of that day, or null. */
function dayBoundary(raw: string, edge: 'start' | 'end'): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (match === null) return null;

  const [, year, month, day] = match;
  const date =
    edge === 'start'
      ? new Date(Number(year), Number(month) - 1, Number(day), 0, 0, 0, 0)
      : new Date(Number(year), Number(month) - 1, Number(day), 23, 59, 59, 999);

  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

/**
 * The log, when it could not be read.
 *
 * IT DOES NOT SAY THE LOG IS EMPTY. On this screen more than any other, the
 * difference between "nothing was recorded" and "nothing could be read" is the
 * difference between a finding and a failure.
 */
function LogUnavailable({ error }: { error: unknown }) {
  const isShape = error instanceof AdminApiShapeError;
  const apiError = error instanceof AdminApiError ? error : null;
  const reference = apiError?.correlationId ?? (isShape ? error.correlationId : undefined);

  return (
    <>
      <h1>Audit log</h1>

      <div role="alert" className="notice notice-error">
        <p>
          {isShape
            ? 'The API answered, but not in a shape this portal understands. The log is not shown rather than shown wrongly.'
            : messageForCode(apiError?.code ?? 'UNKNOWN')}
        </p>
        <p className="muted small">
          This is not an empty log. Nothing could be read, so nothing is claimed about what is
          recorded.
        </p>
        {reference !== undefined && <p className="mono muted small">Reference: {reference}</p>}
      </div>
    </>
  );
}
