import { describe, expect, it } from 'vitest';
import {
  functionSource,
  readCode,
  readFile,
  readLogic,
  readProse,
} from '../../../../lib/test-support/read-source';
import { sensitiveUserViewSchema } from '../../../../lib/admin-api/schemas';

/**
 * UX-ADM-006 — one account (ADMIN-FR-005).
 *
 * Almost every rule here is about the identifiers: that they are not fetched
 * until asked, that asking is the audited event, and that once shown they do
 * not end up anywhere the audit trail cannot see.
 */

const PAGE = 'app/(portal)/users/[userId]/page.tsx';
const PANEL = 'app/(portal)/users/[userId]/sensitive-panel.tsx';
const ACTIONS = 'app/(portal)/users/[userId]/actions.ts';
const STATE = 'app/(portal)/users/[userId]/sensitive-state.ts';

describe('§24 / PRIV-008 — the identifiers are not prefetched', () => {
  it('makes exactly one request while rendering, and it is the account view', () => {
    // Measured against the running API: three page loads left the
    // ADMIN_VIEWED_SENSITIVE_DATA count unchanged at 50, and one press took it
    // to 51. This test is what keeps that true.
    const page = readCode(PAGE);
    const calls = page.match(/guardedRequest\(/g) ?? [];

    expect(calls).toHaveLength(1);
    expect(page).toContain('/admin/users/${encodeURIComponent(userId)}');
    expect(page).not.toContain('sensitiveUserViewSchema');
    expect(page).not.toContain('revealIdentifiers');
  });

  it('starts closed, and the read is a form submission', () => {
    const state = readCode(STATE);
    expect(state).toContain("status: 'NOT_REQUESTED'");

    const panel = readCode(PANEL);
    expect(panel).toContain('useActionState(revealIdentifiers');
    expect(panel).toContain('<form action={submit}>');
    // No effect that would fire it on mount.
    expect(panel).not.toContain('useEffect');
  });

  it('says what pressing the button records, before it is pressed', () => {
    const copy = readProse(PANEL);
    expect(copy).toContain('records an entry in the audit log');
    expect(copy).toContain('cannot be edited or removed');
    // And that the entry holds field names rather than values.
    expect(copy).toContain('names the fields, never their values');
  });

  it('treats a second look as a second access', () => {
    // The panel holds the values in React state only, so a reload closes it
    // and reopening writes a new entry. That is correct: it IS a new access,
    // and an audit trail that recorded only the first would understate what
    // happened.
    const copy = readProse(PANEL);
    expect(copy).toContain('Reloading this page hides these fields again');
    expect(copy).toContain('records a new access');
  });
});

describe('a revealed identifier does not leak out of the page', () => {
  it('puts no value in storage, a URL, or an attribute', () => {
    // Verified in the browser after a real reveal: localStorage and
    // sessionStorage were empty, the URL contained neither value, and no
    // title attribute carried one. These are the ways it would have.
    const panel = readLogic(PANEL);

    for (const forbidden of [
      'localStorage',
      'sessionStorage',
      'document.cookie',
      'console.log',
      'router.push',
      'searchParams',
    ]) {
      expect(panel, `${forbidden} must not touch a revealed identifier`).not.toContain(forbidden);
    }
  });

  it('renders the phone as text rather than a tel: link', () => {
    // A `tel:` href hands the number to whatever application the
    // administrator's machine has registered for that scheme, which is one
    // more copy of it than the audit trail knows about.
    const panel = readCode(PANEL);
    expect(panel).not.toContain('tel:');
    expect(panel).not.toContain('mailto:');
    expect(panel).not.toContain('href');
  });

  it('never renders an identifier as markup', () => {
    expect(readCode(PANEL)).not.toContain('dangerouslySetInnerHTML');
  });

  it('carries exactly the two fields the route returns', () => {
    // PRIV-008 names phone, email and date of birth; this route returns two.
    // Asserted on the shape so an added field is a visible change here.
    expect(Object.keys(sensitiveUserViewSchema.shape).sort()).toEqual(['dateOfBirth', 'phone']);
  });

  it('says email is missing rather than letting its absence imply anything', () => {
    // Otherwise a reader concludes "this account has no email on file", which
    // is a different and unsupported claim. ADMIN-API-GAP-006.
    const copy = readProse(PANEL);
    expect(copy).toContain('ADMIN-API-GAP-006');
    expect(copy).toContain('not a statement about whether the account has one');
  });
});

describe('the missing enforcement history is stated, not implied', () => {
  it('names ADMIN-API-GAP-008 and says it is not a clean record', () => {
    // No route returns an account's enforcement history, and the audit log
    // filters by administrator, action and date — NOT by the account acted on.
    // So there is no way from any screen to ask "what has been done to this
    // person before?" On the screen where enforcement decisions get made, an
    // empty space would read as a clean record.
    const copy = readProse(PAGE);

    expect(copy).toContain('ADMIN-API-GAP-008');
    expect(copy).toContain('missing information, not a clean record');
    expect(copy).toContain('cannot be filtered by the account acted on');
    // And it points at the one screen that does carry a history.
    expect(copy).toContain('open a moderation case whose author it is');
  });
});

describe('§28 — an administrator is not reachable, and the UI is not the reason', () => {
  it('says the boundary is the server’s', () => {
    // Verified against the API: both `GET /admin/users/:id` and its
    // `/sensitive` route answer 404 for an administrator id, because an
    // administrator has no row in `users` and no `UserState` — the API's type
    // "itself refuses to express the action" BR-ADM-001 forbids.
    const copy = readProse(PAGE);

    expect(copy).toContain('Hiding a control is never the boundary');
    expect(copy).toContain('administrator accounts are not reachable through the portal');
  });

  it('never calls an enforcement route from the page itself', () => {
    // Group 09 added suspend, ban and reinstate, so the earlier version of
    // this test — "the page mentions no enforcement route" — became a
    // description of a placeholder rather than of a rule. The rule that
    // survives is that the PAGE renders and never acts: every enforcement
    // route is reached from a server action behind an explicit press, so
    // rendering an account can never change its state.
    const page = readCode(PAGE);

    for (const route of ['/suspend', '/ban', '/reinstate']) {
      expect(page, `${route} must not be called while rendering`).not.toContain(route);
    }
    // It delegates instead, and the panel is where the reason and the
    // confirmation live.
    expect(page).toContain('<EnforcementPanel');
  });
});

describe('the account view itself', () => {
  it('renders a missing profile as missing', () => {
    // 141 accounts in the local database have no profile row, so both name
    // fields are genuinely null.
    const copy = readProse(PAGE);
    expect(copy).toContain('Account with no profile');
    expect(copy).toContain('No username');
  });

  it('shows a suspension’s remaining time beside the state', () => {
    // EDGE-028 lifts a suspension with no administrator action, so the state
    // alone does not say whether anything is in force.
    const page = readCode(PAGE);
    expect(page).toContain('user.suspendedUntil !== null');
    expect(page).toContain('formatExpiry(user.suspendedUntil)');
  });

  it('explains what the two report counts mean', () => {
    // "Reports made" is the figure that shows a reporting pattern, and it is
    // the one most easily misread as an accusation against the account.
    const copy = readProse(PAGE);
    expect(copy).toContain('Reports received counts reports about this account');
    expect(copy).toContain('a high number is not by itself a finding');
  });

  it('does not claim the account is missing when the request merely failed', () => {
    const failure = functionSource(PAGE, 'AccountUnavailable');
    expect(failure).toContain('role="alert"');
    expect(failure).toContain('no identifier was read');
  });
});

describe('the reveal action', () => {
  it('is the only route to the identifiers and it is the audited one', () => {
    // SCOPED TO THE FUNCTION, not the file. `actions.ts` also holds Group 09's
    // enforcement action, so "this file makes one request" stopped being the
    // rule the moment a second action landed beside it. What must stay true is
    // that the REVEAL makes one request and reads nothing else — fetching the
    // account view alongside the identifiers is exactly what the API's two
    // separate types exist to prevent.
    const reveal = functionSource(ACTIONS, 'revealIdentifiers');

    expect(reveal).toContain('/sensitive');
    expect(reveal).toContain('sensitiveUserViewSchema');

    const calls = reveal.match(/guardedRequest\(/g) ?? [];
    expect(calls).toHaveLength(1);
    expect(reveal).not.toContain('adminUserViewSchema');
  });

  it('does not log or return the values anywhere but the panel', () => {
    // Also scoped to the function. The enforcement action next door DOES
    // revalidate, and should: it changes the account, so the page must re-read
    // it. A reveal changes nothing, so it must not.
    const reveal = functionSource(ACTIONS, 'revealIdentifiers');

    expect(reveal).not.toContain('console');
    expect(reveal).not.toContain('revalidatePath');
  });

  it('is a server action, so no admin credential reaches the browser', () => {
    // `lib/admin-api/client.ts` is `server-only`, which makes this a build
    // error rather than a convention if it is ever imported by a client
    // component. SEC-025.
    expect(readFile(ACTIONS)).toContain("'use server'");
    expect(readFile(PANEL)).toContain("'use client'");
    expect(readCode(PANEL)).not.toContain('admin-api/client');
  });
});
