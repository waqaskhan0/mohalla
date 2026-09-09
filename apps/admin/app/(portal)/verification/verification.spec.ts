import { describe, expect, it } from 'vitest';
import {
  functionSource,
  readCode,
  readFile,
  readProse,
} from '../../../lib/test-support/read-source';
import { noContentSchema } from '../../../lib/admin-api/schemas';
import { REASON_LIMITS } from './verification-state';
import { ADMIN_ERROR_COPY } from '../../../lib/admin-api/messages';

/**
 * UX-ADM-008 — organization verification (ADMIN-FR-010, S2-CR-006).
 *
 * Verified against the running API before these were written:
 *
 *   - granting to an INDIVIDUAL returned 400 NOT_ELIGIBLE_FOR_VERIFICATION,
 *     "Only organization accounts can be verified."
 *   - granting to an ORGANIZATION returned 204 and the account view then
 *     reported verifiedBadge true
 *   - REVOKING on an individual returned 204 — the eligibility gate is on the
 *     grant path only, so a badge can always be removed
 *   - both wrote ADMIN_GRANTED_VERIFICATION / ADMIN_REVOKED_VERIFICATION
 */

const PAGE = 'app/(portal)/verification/page.tsx';
const PANEL = 'app/(portal)/verification/verification-panel.tsx';
const ACTIONS = 'app/(portal)/verification/actions.ts';

describe('S2-CR-006 — there is no request queue, and the screen says so first', () => {
  it('states that verification is by invitation and nothing accumulates here', () => {
    // An administrator who opened this expecting a worklist would conclude the
    // feature was broken when it showed nothing. There is no endpoint that
    // lists accounts awaiting a decision, so the screen is a lookup and
    // explains why.
    const copy = readProse(PAGE);

    expect(copy).toContain('There is no request queue');
    expect(copy).toContain('by invitation in V1');
    expect(copy).toContain('Nothing collects on this screen');
  });

  it('fetches nothing until something is searched for or an account is named', () => {
    const page = readCode(PAGE);

    expect(page).toContain("query === '' ? (");
    // The resting state is a prompt, not a list.
    expect(readProse(PAGE)).toContain('Search above for the organization you were asked to verify');
  });
});

describe('ADMIN-FR-010 — only organizations, and the refusal states the rule', () => {
  it('has copy that names the eligibility rule rather than being neutral', () => {
    // "An administrator verifying an individual has made a category error, not
    // a security probe." A neutral refusal would leave them retrying.
    expect(ADMIN_ERROR_COPY.NOT_ELIGIBLE_FOR_VERIFICATION).toContain('Only organization accounts');

    const failure = functionSource(ACTIONS, 'verificationFailure');
    expect(failure).toContain('NOT_ELIGIBLE_FOR_VERIFICATION');
    expect(failure).toContain("status: 'NOT_ELIGIBLE'");
  });

  it('renders the refusal as a rule, not a permission problem', () => {
    const copy = readProse(PANEL);
    expect(copy).toContain('This is the eligibility rule, not a permission problem');
  });

  it('says on the panel, before any button is pressed, that an individual is not eligible', () => {
    const copy = readProse(PANEL);
    expect(copy).toContain('This is an individual account, so the badge cannot be granted');
    // And that the boundary is the server's (§28) — the disabled button is a
    // courtesy, not the enforcement.
    expect(copy).toContain('it would refuse a request made any other way');
  });

  it('still allows revoking whatever the account type', () => {
    // Deliberate in the API and preserved here: if a badge sits on an account
    // that should not hold one, removing it must not be blocked by the same
    // check that should have prevented it. Measured: revoke on an individual
    // returned 204.
    const panel = readCode(PANEL);

    // Grant is gated on being an organization; revoke is gated only on the
    // badge actually being there.
    expect(panel).toContain('disabled={pending || !isOrganization || verified}');
    expect(panel).toContain('disabled={pending || !verified}');

    expect(readProse(PANEL)).toContain('the way to remove it must not be blocked');
  });
});

describe('the search results are not filtered to eligible accounts', () => {
  it('lists individuals too, and says why', () => {
    // It would be tidier to show only organizations, and it would be wrong: an
    // administrator searching for an organization that was REGISTERED as an
    // individual needs to see that, because that is the answer to why it
    // cannot be verified. Confirmed against the fixtures — "Masjid Noor Trust"
    // is an individual account.
    const page = readCode(PAGE);
    expect(page).not.toContain("accountType === 'ORGANIZATION' &&");
    expect(page).not.toContain('.filter(');

    const copy = readProse(PAGE);
    expect(copy).toContain('Individual accounts are listed too');
    expect(copy).toContain('is the answer to why it cannot be verified');
  });

  it('shows the badge state in the list', () => {
    const page = readCode(PAGE);
    expect(page).toContain('user.verifiedBadge');
  });

  it('warns when the result list is capped', () => {
    // Same rule as the users screen: the route returns a bare array with no
    // total, so twenty rows might not be all of them.
    const copy = readProse(PAGE);
    expect(copy).toContain('does not report how many accounts matched');
  });
});

describe('no decision is ever inferred', () => {
  it('accepts exactly grant or revoke', () => {
    // A mangled submission that fell through to `granted: true` would put a
    // verification badge on an account nobody approved — and the badge is a
    // statement to every reader that the platform vouches for this
    // organization.
    const set = functionSource(ACTIONS, 'setVerification');

    expect(set).toContain("decision !== 'grant' && decision !== 'revoke'");
    expect(set).toContain("field: 'decision'");
    expect(set).toContain("const granted = decision === 'grant'");
  });

  it('sends nothing when the decision is unrecognised', () => {
    const set = functionSource(ACTIONS, 'setVerification');
    const refusal = set.slice(set.indexOf("decision !== 'grant'"));
    const guard = refusal.slice(0, refusal.indexOf('};') + 2);

    expect(guard).toContain("status: 'INVALID'");
    expect(guard).not.toContain('guardedRequest');
  });

  it('preselects nothing', () => {
    const panel = readCode(PANEL);
    expect(panel).not.toContain('autoFocus');
    expect(panel).not.toContain('defaultChecked');
    expect(panel).not.toContain('defaultValue');
  });
});

describe('the local reason check actually stops the request', () => {
  it('calls preventDefault on a submit button', () => {
    // THE DEFECT THIS REPLACES. The first version set the error and let the
    // request go anyway, so a three-character reason — which passes the
    // `required` attribute — showed a validation message AND made a round
    // trip, after which the server's message replaced the local one. A local
    // check that does not stop the submission is not a check.
    //
    // Measured after the fix: clicking grant with "abc" left the verification
    // audit count unchanged at 3.
    const panel = readCode(PANEL);
    const clicks = panel.match(/event\.preventDefault\(\)/g) ?? [];

    expect(clicks).toHaveLength(2);
    expect(panel).toContain('trimmed.length < REASON_LIMITS.min');
  });

  it('checks the reason on the server as well', () => {
    // The browser check is a convenience; BR-038 is the rule.
    const set = functionSource(ACTIONS, 'setVerification');
    expect(set).toContain('reason.length < REASON_LIMITS.min');
    expect(set).toContain('reason.length > REASON_LIMITS.max');
    expect(REASON_LIMITS).toEqual({ min: 5, max: 500 });
  });
});

describe('a 204 is confirmed by re-reading, not by the absence of an error', () => {
  it('parses the empty response as void', () => {
    expect(noContentSchema.safeParse(undefined).success).toBe(true);
    // And a body would not be silently accepted as meaningful.
    expect(noContentSchema.safeParse({ granted: true }).success).toBe(false);
  });

  it('revalidates so the badge shown is the one the server holds', () => {
    const set = functionSource(ACTIONS, 'setVerification');
    expect(set).toContain("revalidatePath('/verification')");
    expect(set).toContain('revalidatePath(`/users/${userId}`)');
  });

  it('does not claim the badge changed when the outcome is unknown', () => {
    const failure = functionSource(ACTIONS, 'verificationFailure');
    const shape = failure.slice(failure.indexOf('AdminApiShapeError'));

    expect(shape).toContain('not certain whether the badge changed');
    expect(shape).toContain('Reload the account before deciding again');
  });
});

describe('the badge is described as what it is', () => {
  it('says it is visible to every reader, not an internal flag', () => {
    // Which is why granting takes a reason: it is what makes the decision
    // reviewable when somebody later asks why an account was vouched for.
    const copy = readProse(PANEL);
    expect(copy).toContain('tells every reader that the platform has checked');
    expect(copy).toContain('reviewable');
  });

  it('says revocation takes effect everywhere immediately', () => {
    const copy = readProse(PANEL);
    expect(copy).toContain('removes it from every screen in the app immediately');
  });
});

describe('§34 — account names are never markup', () => {
  it('renders nothing through dangerouslySetInnerHTML', () => {
    for (const file of [PAGE, PANEL, ACTIONS]) {
      expect(readCode(file), file).not.toContain('dangerouslySetInnerHTML');
    }
  });

  it('renders a missing display name as missing', () => {
    const page = readFile(PAGE);
    expect(page).toContain('No name');
    expect(page).toContain('Account with no profile');
  });
});
