import { describe, expect, it } from 'vitest';
import {
  functionSource,
  readCode,
  readFile,
  readProse,
} from '../../../lib/test-support/read-source';
import { adminUserViewSchema, userSearchResultSchema } from '../../../lib/admin-api/schemas';
import { accountTypeLabel, userStateLabel } from '../../../lib/wire-labels';

/**
 * UX-ADM-005 — account lookup (ADMIN-FR-005).
 *
 * The rules that matter here are about what this screen must NOT become: a
 * browsable register of every citizen, a sensitive-data view, or a list that
 * lets a reader believe they have seen everything.
 */

const PAGE = 'app/(portal)/users/page.tsx';

describe('a lookup, not a directory', () => {
  it('fetches nothing until something has been searched for', () => {
    // There is no route that lists accounts, and an empty search is not a
    // request to see everybody. The resting state renders no table at all,
    // which is also how the browser check confirmed no request was made.
    const page = readCode(PAGE);

    expect(page).toContain("query === '' ? <NoSearchYet /> : <Results query={query} />");

    const resting = functionSource(PAGE, 'NoSearchYet');
    expect(resting).not.toContain('guardedRequest');
    expect(resting).not.toContain('<table');
    expect(resting).toContain('Nothing searched yet');
  });

  it('makes exactly one request, to the search route', () => {
    const page = readCode(PAGE);
    const calls = page.match(/guardedRequest\(/g) ?? [];

    expect(calls).toHaveLength(1);
    expect(page).toContain('/admin/users/search?q=');
    // No "all users" call, and nothing that would fetch the identifiers.
    expect(page).not.toContain('/sensitive');
  });

  it('offers no phone search, because the number is stored as a hash', () => {
    // ADMIN-FR-005 lists phone as a search key; the API explains that a
    // peppered hash "has no substrings, so there is no partial-number search
    // to build", and the exact-lookup path is not on an admin route.
    // ADMIN-API-GAP-007 — said on the screen rather than left to be found by
    // typing a number and getting nothing.
    const copy = readProse(PAGE);
    expect(copy).toContain('ADMIN-API-GAP-007');
    expect(copy).toContain('Searching by phone number is not available');

    // And there is no field for one.
    const page = readCode(PAGE);
    expect(page).not.toContain('name="phone"');
    expect(page).not.toContain('type="tel"');
  });
});

describe('PRIV-008 — a lookup is not a sensitive-data view', () => {
  it('has no identifier in the shape the portal parses', () => {
    // The privacy rule is enforced by the RESPONSE carrying no identifier,
    // not by the portal choosing not to render one — so the schema is the
    // place to assert it. If the API ever adds a phone to this route, the
    // portal still will not display one, but this test is what makes the
    // change visible.
    const shape = Object.keys(adminUserViewSchema.shape);

    for (const forbidden of ['phone', 'email', 'dateOfBirth', 'dob', 'phoneNumber']) {
      expect(shape, `${forbidden} must not be in the account view`).not.toContain(forbidden);
    }
    // What it does carry, so the assertion above cannot pass on an empty shape.
    expect(shape).toContain('userId');
    expect(shape).toContain('state');
    expect(shape).toContain('reportsReceived');
  });

  it('renders no identifier and says so on the screen', () => {
    const copy = readProse(PAGE);
    expect(copy).toContain('no phone number, email or date of birth');
    expect(copy).toContain('a separate, audited request');
  });
});

describe('the list never implies it is complete', () => {
  it('warns when the results fill the limit', () => {
    // The route returns a bare array: no total, no offset. Twenty rows might
    // be twenty matches or the first twenty of five thousand, and the API
    // cannot tell the difference — so the screen must not let a reader
    // conclude they have seen everything. ADMIN-RUNTIME-003 in another column.
    const page = readCode(PAGE);
    expect(page).toContain('const capped = result.users.length === LIMIT');

    const copy = readProse(PAGE);
    expect(copy).toContain('the API does not report how many accounts matched');
    expect(copy).toContain('there may be more');
    expect(copy).toContain('rather than reading this as the complete set');
  });

  it('has no total and no offset to page with', () => {
    // Asserted on the schema so a future API change is a visible failure here
    // rather than a silently wrong "of N" on the screen.
    expect(Object.keys(userSearchResultSchema.shape)).toEqual(['users']);

    const page = readCode(PAGE);
    expect(page).not.toContain('offset');
    expect(page).not.toContain('result.total');
  });

  it('states the ordering, which is not relevance', () => {
    // `ORDER BY u.created_at DESC` in the repository. A reader who assumes the
    // best match is first will stop at the first row.
    const copy = readProse(PAGE);
    expect(copy).toContain('Newest accounts first');
    expect(copy).toContain('does not rank by how well a name matches');
  });
});

describe('a failed search is not an empty result', () => {
  it('says nothing is claimed about whether the account exists', () => {
    // The wrong one of these two answers sends an administrator away believing
    // an account does not exist.
    const failure = functionSource(PAGE, 'SearchUnavailable');

    expect(failure).toContain('role="alert"');
    expect(failure).toContain('This is not an empty result');
    expect(failure).not.toContain('No account matches');
  });
});

describe('§34 — a display name is somebody else’s text', () => {
  it('never renders account text as markup', () => {
    // §34 names usernames explicitly. A display name reaches an
    // administrator's screen because that person chose it.
    expect(readCode(PAGE)).not.toContain('dangerouslySetInnerHTML');
  });

  it('renders a missing name as missing rather than inventing one', () => {
    // 141 accounts in the local database have no profile row at all, so both
    // name fields are genuinely null. A fabricated placeholder that looked
    // like a name would be worse than an empty one.
    const row = functionSource(PAGE, 'UserRow');
    expect(row).toContain('No name');
    expect(row).toContain("'no username'");
  });
});

describe('account labels', () => {
  it('keeps deletion requested and deleted apart', () => {
    // PENDING_DELETION is somebody inside the grace period; DELETED is
    // somebody gone, and the API refuses enforcement on them outright. An
    // administrator must not read one as the other.
    expect(userStateLabel('PENDING_DELETION')).toBe('Deletion requested');
    expect(userStateLabel('DELETED')).toBe('Deleted');
    expect(userStateLabel('PENDING_DELETION')).not.toBe(userStateLabel('DELETED'));
  });

  it('labels every state the API declares', () => {
    for (const state of [
      'UNVERIFIED',
      'ACTIVE',
      'SUSPENDED',
      'BANNED',
      'PENDING_DELETION',
      'DELETED',
    ]) {
      expect(userStateLabel(state), state).not.toBe(state);
    }
  });

  it('renders an unrecognised value as itself', () => {
    expect(userStateLabel('SHADOWED')).toBe('SHADOWED');
    expect(accountTypeLabel('GOVERNMENT')).toBe('GOVERNMENT');
  });

  it('labels both account types', () => {
    expect(accountTypeLabel('INDIVIDUAL')).toBe('Individual');
    expect(accountTypeLabel('ORGANIZATION')).toBe('Organization');
  });
});

describe('a suspension in force reads differently from one that lifted', () => {
  it('shows the expiry with a tense beside the state', () => {
    // EDGE-028: a suspension lifts automatically with no administrator
    // action, so `state` alone does not say whether anything is in force.
    const row = functionSource(PAGE, 'UserRow');
    expect(row).toContain('user.suspendedUntil !== null');
    expect(row).toContain('formatExpiry(user.suspendedUntil)');
  });
});

describe('the search is a GET, so a result is a place', () => {
  it('puts the query in the URL and nothing sensitive with it', () => {
    // Linkable, back-button-safe, and no re-submission on reload. Safe to do
    // precisely because the only searchable fields are the two that already
    // appear publicly in the app — a phone search would have put an
    // identifier in the address bar on every query.
    const page = readFile(PAGE);
    expect(page).toContain('method="GET"');
    expect(page).toContain('role="search"');
    expect(page).toContain('name="q"');
    expect(page).not.toContain('method="POST"');
  });
});
