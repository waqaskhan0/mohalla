import { describe, expect, it } from 'vitest';
import { functionSource, readCode, readFile } from '../../../lib/test-support/read-source';

/**
 * UX-ADM-003's rules (ADMIN-FR-002), and the defect that made them necessary.
 *
 * ADMIN-RUNTIME-003 — THE QUEUE SAID IT WAS CLEAR WHILE 1,397 CASES WERE OPEN.
 *
 * The first version of this page rendered the "Nothing is waiting for review"
 * state whenever `total === 0`. Measured: `GET
 * /admin/moderation/queue?offset=1400` returns `{"cases":[],"total":0}`, and
 * the portal duly told a moderator the queue was empty.
 *
 * The API's total is a window function — `COUNT(*) OVER ()` — so it is the
 * genuine pre-LIMIT count, but it rides on each ROW. An offset past the end
 * returns no rows, so there is nothing to carry it, and the repository falls
 * back to `Number(r.rows[0]?.total ?? 0)`. The zero is a missing value dressed
 * as a real one (ADMIN-API-GAP-003).
 *
 * The portal's rule is now the safe one: "the queue is clear" is a claim only
 * page one can make. Everything else at an empty page says "you have paged past
 * the end", which is a different statement and the true one.
 */

const QUEUE = 'app/(portal)/moderation/page.tsx';

describe('ADMIN-RUNTIME-003 — an empty page is not an empty queue', () => {
  it('only claims the queue is clear at offset zero', () => {
    const code = readCode(QUEUE);

    // All three conditions, together: first page, no total, no rows. Any one
    // of them alone is what produced the false claim.
    expect(code).toContain('offset === 0 && page.total === 0 && shown === 0');
  });

  it('has a distinct state for paging past the end', () => {
    const code = readCode(QUEUE);

    expect(code).toContain('pagedPastTheEnd');
    expect(code).toContain('offset > 0 && shown === 0');
  });

  it('the past-the-end state makes no claim about how many cases are open', () => {
    // At that offset the API cannot tell us, so printing "0 open cases" would
    // be repeating the same mistake in smaller type.
    const component = functionSource(QUEUE, 'PastTheEnd');

    expect(component).not.toContain('page.total');
    expect(component).not.toContain('open cases');
    // And it offers the way back, because that is the only thing the reader
    // wants from this screen.
    expect(component).toContain('Go to the first page');
  });

  it('clamps a hand-typed offset instead of forwarding it', () => {
    // `?offset=99999` would come back a validation error from the API, which
    // is a confusing answer to a URL somebody typed; `?offset=-1` is not a
    // page anybody meant.
    const code = readCode(QUEUE);

    expect(code).toContain('Math.min(Math.max(parsed, 0), MAX_OFFSET)');
    expect(code).toContain('MAX_OFFSET = 5000');
  });
});

describe('the queue renders the order the server chose', () => {
  it('does not sort, reverse or re-rank the cases', () => {
    // §16 forbids re-sorting client-side, because the ordering is a policy the
    // server owns: severity, then distinct report count, then age ascending.
    // A sortable header here would be a second policy competing with it.
    const code = readCode(QUEUE);

    for (const forbidden of ['.sort(', '.reverse(', 'localeCompare']) {
      expect(code, `${forbidden} would contradict the server's ordering`).not.toContain(forbidden);
    }
  });

  it('states the ordering in the column headers', () => {
    // The spec asks for exactly this: ordering "stated in the column header so
    // the ordering is never a mystery". A moderator who cannot tell why row
    // three is above row four decides the queue is wrong and scans past it.
    const source = readFile(QUEUE);

    expect(source).toContain('>1st<');
    expect(source).toContain('>2nd<');
    expect(source).toContain('>3rd<');
    expect(source).toContain('Severity');
    expect(source).toContain('Reporters');
    expect(source).toContain('Age');
  });

  it('the table scrolls inside its own container, not the page', () => {
    // §27. A page that scrolls sideways takes the sidebar off screen, which is
    // how somebody ends up unable to navigate back.
    expect(readFile(QUEUE)).toContain('table-scroll');
  });
});

describe('the queue’s states', () => {
  it('an empty queue reads as good news, not as an error', () => {
    // §16: "Treat as a positive operational state, not an error." A grey "No
    // data" would read as a tool that failed to load, and the first instinct
    // would be to refresh it.
    // `functionSource`, not a slice to end-of-file: the first version of this
    // read every function below QueueClear and failed on the error state's
    // `role="alert"`.
    const clear = functionSource(QUEUE, 'QueueClear');

    expect(clear).toContain('Nothing is waiting for review');
    expect(clear).not.toContain('role="alert"');
    expect(clear).not.toContain('notice-error');
  });

  it('THE FAILURE STATE IS NOT AN EMPTY QUEUE', () => {
    // The same class of lie as ADMIN-RUNTIME-003, from the other direction:
    // "nothing is waiting" when the request failed would send a moderator away
    // from a queue that is full.
    const failure = functionSource(QUEUE, 'QueueUnavailable');

    expect(failure).toContain('role="alert"');
    expect(failure).toContain('This is not an empty queue');
    expect(failure).not.toContain('Nothing is waiting');
  });

  it('the loading skeleton shows no counts and no rows that read as data', () => {
    // `readCode` — the comment in that file legitimately says "0 open cases"
    // while explaining why no such text is rendered.
    const loading = readCode('app/(portal)/moderation/loading.tsx');

    expect(loading).toContain('skeleton-cell');
    expect(loading).toContain('aria-busy');
    expect(loading).not.toContain('open cases');
    expect(loading).not.toContain('Nothing is waiting');
  });
});

describe('severity is never colour alone', () => {
  it('renders a label beside the dot', () => {
    // NFR-ACC-005, and the spec says it twice: "severity is a coloured dot
    // plus a text label, never colour alone". Roughly one man in twelve has
    // some colour vision deficiency, and this is the column that decides what
    // gets opened first.
    const indicator = readFile('components/severity-indicator.tsx');

    expect(indicator).toContain('severity-label');
    expect(indicator).toContain('aria-hidden="true"');
  });

  it('shows an unrecognised severity as itself', () => {
    // The portal is a separate deployable. If Stage 6 adds a level, a case
    // shown as "Low" because the portal did not recognise "Severe" is worse
    // than one shown as "Severe" with a plain dot.
    const indicator = readFile('components/severity-indicator.tsx');
    expect(indicator).toContain('known ? label(severity) : severity');
  });
});
