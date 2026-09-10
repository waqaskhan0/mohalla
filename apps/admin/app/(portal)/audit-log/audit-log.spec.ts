import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { functionSource, readCode, readProse } from '../../../lib/test-support/read-source';
import { auditEntrySchema, auditLogPageSchema } from '../../../lib/admin-api/schemas';
import {
  AUDIT_ACTION_GROUPS,
  KNOWN_AUDIT_ACTIONS,
  auditActionDescription,
} from '../../../lib/audit-actions';

/**
 * UX-ADM-009 — the audit log (ADMIN-FR-012, BR-039, §33).
 *
 * Verified against the running API and log before these were written:
 *
 *   - page one reports 1,691 entries and renders 50
 *   - `?offset=9999` returns `{"entries":[],"total":0}` — the same false zero
 *     as the moderation queue
 *   - `action=ADMIN_SUSPEND` returns 105 entries; `action=suspend` and
 *     `action=SUSPEND` both return 0, so the match is exact and case-sensitive
 *   - `action=ADMIN_VIEWED_SENSITIVE_DATA` returns 52, and their metadata
 *     renders as "fields: phone, dateOfBirth"
 *   - a non-UUID administrator filter is dropped with a note, and the rows
 *     shown are unfiltered
 */

const PAGE = 'app/(portal)/audit-log/page.tsx';
const DIR = 'app/(portal)/audit-log';

describe('§33 / BR-039 — read only, and nothing here could change that', () => {
  it('has no server action file in the directory', () => {
    // BR-039 puts it as a property of the system rather than of the interface:
    // "the log is append-only and NO INTERFACE, PERMISSION OR ADMINISTRATOR can
    // edit or delete an entry." The API satisfies that by having no route at
    // any layer that writes; this screen satisfies it the same way. There is
    // nothing to disable, because there is nothing here.
    expect(existsSync(join(process.cwd(), DIR, 'actions.ts'))).toBe(false);

    const page = readCode(PAGE);
    expect(page).not.toContain('use server');
    expect(page).not.toContain('revalidatePath');
  });

  it('makes exactly one request, and it is a GET', () => {
    const page = readCode(PAGE);
    const calls = page.match(/guardedRequest\(/g) ?? [];

    expect(calls).toHaveLength(1);
    expect(page).toContain('/admin/audit-log?');
    // No method is passed, so it is the client's GET default; and none of the
    // mutating verbs appears anywhere on the screen.
    for (const verb of ["method: 'POST'", "method: 'PUT'", "method: 'DELETE'", "method: 'PATCH'"]) {
      expect(page, verb).not.toContain(verb);
    }
  });

  it('offers no edit, delete, clear, correct or bulk operation', () => {
    // §33 names every one of these.
    const page = readCode(PAGE);
    for (const forbidden of [
      'Delete entry',
      'Clear the log',
      'Truncate',
      'Correct',
      'Bulk',
      'Edit entry',
    ]) {
      expect(page, forbidden).not.toContain(forbidden);
    }
  });

  it('offers no export', () => {
    // §33 forbids it "unless specifically approved", and it has not been.
    // ADMIN-FR-011 independently rules out data export in V1. Verified in the
    // browser: no control on the page carries a `download` attribute.
    const page = readCode(PAGE);
    for (const forbidden of ['download', 'csv', 'Csv', 'CSV', 'toBlob', 'createObjectURL']) {
      expect(page, forbidden).not.toContain(forbidden);
    }
  });

  it('says on the screen that the log cannot be changed', () => {
    // It is the property that makes the log worth having: if it could be
    // edited it would be a report rather than evidence.
    const copy = readProse(PAGE);
    expect(copy).toContain('append-only and read only');
    expect(copy).toContain('not from any other interface or permission level');
  });
});

describe('ADMIN-API-GAP-003 again — an empty page is not an empty log', () => {
  it('claims the log is empty only at offset zero', () => {
    // `total` is `COUNT(*) OVER ()` with a `?? 0` fallback, exactly as on the
    // queue. On a queue that produced ADMIN-RUNTIME-003; on an AUDIT LOG the
    // same zero would say "there is no record of this", which is a worse thing
    // to say wrongly.
    const page = readCode(PAGE);

    expect(page).toContain('offset === 0 && shown === 0 && page.total === 0');
    expect(page).toContain('offset > 0 && shown === 0');
  });

  it('says explicitly that a past-the-end page proves nothing', () => {
    const copy = readProse(PAGE);
    expect(copy).toContain('THAT IS NOT A STATEMENT THAT NO SUCH ENTRY EXISTS');
    expect(copy).toContain('reports a total of zero whether or not the log is empty');
    expect(copy).toContain('ADMIN-API-GAP-003');
  });

  it('clamps a hand-typed offset to the API’s bound', () => {
    const page = readCode(PAGE);
    expect(page).toContain('Math.min(Math.max(parsed, 0), MAX_OFFSET)');
    expect(page).toContain('MAX_OFFSET = 10_000');
  });

  it('distinguishes a failed read from an empty log', () => {
    // On this screen more than any other, the difference between "nothing was
    // recorded" and "nothing could be read" is the difference between a
    // finding and a failure.
    const failure = functionSource(PAGE, 'LogUnavailable');

    expect(failure).toContain('role="alert"');
    expect(failure).toContain('This is not an empty log');
    expect(failure).not.toContain('holds no entries');
  });
});

describe('the action filter is an exact match, and the screen makes that usable', () => {
  it('says the match is exact and case-sensitive', () => {
    // Measured: ADMIN_SUSPEND finds 105, suspend finds 0. A bare text box
    // would turn a typo into "there is no record of this".
    const copy = readProse(PAGE);
    expect(copy).toContain('An exact, case-sensitive match');
    expect(copy).toContain('finds nothing');
  });

  it('backs the field with a suggestion list without constraining it', () => {
    const page = readCode(PAGE);
    expect(page).toContain('list="audit-actions"');
    expect(page).toContain('<datalist id="audit-actions">');
    // A datalist suggests; it does not restrict. An action the portal has not
    // heard of is still searchable.
    expect(page).not.toContain('<select');
    expect(readProse(PAGE)).toContain('any value can be typed');
  });

  it('suggests only actions the API actually emits', () => {
    // Every literal was read from `apps/api/src` and cross-checked against the
    // distinct values in the local log. The infrastructure markers the log
    // carries (foundation.test, role.test, rehearsal.marker) are deliberately
    // absent, because they are not product actions.
    for (const action of KNOWN_AUDIT_ACTIONS) {
      expect(action, `${action} should be UPPER_SNAKE`).toMatch(/^[A-Z][A-Z_]+$/);
    }
    expect(KNOWN_AUDIT_ACTIONS).toContain('ADMIN_SUSPEND');
    expect(KNOWN_AUDIT_ACTIONS).toContain('MODERATION_RESOLVED_DELETED');
    expect(KNOWN_AUDIT_ACTIONS).not.toContain('foundation.test');
    expect(KNOWN_AUDIT_ACTIONS).not.toContain('rehearsal.marker');
  });

  it('groups the two entries that make PRIV-008 and PRIV-009 checkable', () => {
    // "Viewing is auditable, not only acting" is what turns those rules from
    // aspirations into something an investigator can verify.
    const group = AUDIT_ACTION_GROUPS.find((g) => g.label.includes('private data'));

    expect(group).toBeDefined();
    expect(group?.actions).toContain('ADMIN_VIEWED_SENSITIVE_DATA');
    expect(group?.actions).toContain('ADMIN_READ_REPORTED_CONVERSATION');
  });

  it('describes a known action and refuses to describe an unknown one', () => {
    // Inventing a description for an action the portal does not know would be
    // putting words into the record.
    expect(auditActionDescription('ADMIN_SUSPEND')).toBe('Suspended an account');
    expect(auditActionDescription('SOMETHING_NEW')).toBeNull();
    expect(auditActionDescription('foundation.test')).toBeNull();
  });

  it('keeps the wire value visible beside the description', () => {
    // The raw value is what gets pasted into a filter or a ticket, so the
    // label explains it rather than replacing it.
    const row = functionSource(PAGE, 'Row');
    expect(row).toContain('{entry.action}');
    expect(row).toContain('description !== null');
  });
});

describe('an entry is rendered as evidence, not as a formatted summary', () => {
  it('renders metadata as key and value rather than JSON', () => {
    // §40 keeps raw JSON off an administrator's screen, and metadata routinely
    // carries another administrator's free-text reason — which §34 names as
    // something never to pass through dangerouslySetInnerHTML.
    const row = functionSource(PAGE, 'Row');

    expect(row).toContain('<dl className="metadata">');
    expect(row).toContain('renderValue(value)');
    expect(readCode(PAGE)).not.toContain('dangerouslySetInnerHTML');

    // AND NO RAW DUMP BESIDE IT. Asserting the `<dl>` exists was not enough: a
    // mutation added `<pre>{JSON.stringify(entry.metadata)}</pre>` next to it
    // and the test passed. `renderValue` may stringify a NESTED object — that
    // is the fallback for a value it cannot flatten — but the metadata object
    // itself must never be dumped.
    expect(row).not.toContain('JSON.stringify(entry.metadata)');
    expect(row).not.toContain('<pre>');
  });

  it('joins an array so a field list reads as one', () => {
    // `{"fields":["phone","dateOfBirth"]}` reads better as a list than as a
    // bracketed literal, and that is the metadata on every PRIV-008 entry.
    const render = functionSource(PAGE, 'renderValue');

    expect(render).toContain('Array.isArray(value)');
    expect(render).toContain("join(', ')");
    // And nothing else is reshaped: a value the portal rewrote is a value
    // somebody has to reason about twice.
    expect(render).toContain('String(value)');
  });

  it('says what a missing actor means instead of leaving a blank', () => {
    // `actorId` is null "for SYSTEM, and for an actor who could not be
    // identified" — two different things, and neither is an empty cell.
    const row = functionSource(PAGE, 'Row');

    expect(row).toContain('No actor — automatic');
    expect(row).toContain('Actor not identified');
    expect(row).toContain('None recorded');
  });

  it('parses both nullable id fields as nullable', () => {
    const shape = auditEntrySchema.shape;
    expect(shape.actorId.safeParse(null).success).toBe(true);
    expect(shape.entityId.safeParse(null).success).toBe(true);
    // And metadata is always present, as the NOT NULL column guarantees.
    expect(shape.metadata.safeParse(undefined).success).toBe(false);
    expect(shape.metadata.safeParse({}).success).toBe(true);
  });

  it('accepts the page shape the API returns', () => {
    expect(Object.keys(auditLogPageSchema.shape).sort()).toEqual(['entries', 'total']);
  });
});

describe('the filters are a GET, so an audit query is a place', () => {
  it('uses a GET form and preserves the filters when paging', () => {
    // Linkable, back-button safe and reloadable without re-posting. It matters
    // more here than elsewhere: an audit query is the sort of thing somebody
    // pastes into a ticket.
    const page = readCode(PAGE);

    expect(page).toContain('method="GET"');
    expect(page).toContain('role="search"');
    expect(page).not.toContain('method="POST"');

    // The pager rebuilds every active filter, so page two of a filtered search
    // is still that search.
    const search = functionSource(PAGE, 'AuditLogPage');
    expect(search).toContain("if (action !== '') q.set('action', action)");
    expect(search).toContain("if (adminId !== '') q.set('adminId', adminId)");
  });

  it('drops a malformed administrator id rather than sending it', () => {
    // The API takes a UUID and would answer 400, which is a confusing reply to
    // something somebody typed. Verified in the browser: the field is marked
    // invalid, the note says the filter was not applied, and the unfiltered
    // rows are still shown.
    // THE COMPLETE GUARDED LINE. Asserting that `adminIdLooksValid` appears
    // somewhere and that `query.set('adminId', …)` appears somewhere passed
    // even when the guard was removed from the call — both fragments survived
    // the mutation. The rule is that the two are in the same statement.
    const page = readCode(PAGE);

    expect(page).toContain(
      "if (adminId !== '' && adminIdLooksValid) query.set('adminId', adminId);",
    );
    expect(readProse(PAGE)).toContain('it was not used as a filter');
  });

  it('reads both dates as inclusive whole days', () => {
    const boundary = functionSource(PAGE, 'dayBoundary');

    expect(boundary).toContain('0, 0, 0, 0');
    expect(boundary).toContain('23, 59, 59, 999');
    // Parsed by parts, for the same UTC-versus-local reason as the
    // announcement expiry.
    expect(boundary).not.toContain('new Date(raw)');
    expect(readProse(PAGE)).toContain('Both dates are inclusive whole days');
  });

  it('says why the administrator filter takes an id and not a name', () => {
    // There is no route that lists administrators, so an id is what there is.
    const copy = readProse(PAGE);
    expect(copy).toContain('no route that lists administrators');
  });
});
