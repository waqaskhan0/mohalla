import Link from 'next/link';
import { guardedRequest } from '../../../lib/admin-api/guarded';
import { AdminApiError, AdminApiShapeError } from '../../../lib/admin-api/client';
import {
  adminUserViewSchema,
  userSearchResultSchema,
  type AdminUserView,
} from '../../../lib/admin-api/schemas';
import { messageForCode } from '../../../lib/admin-api/messages';
import { accountTypeLabel, userStateLabel } from '../../../lib/wire-labels';
import { VerificationPanel } from './verification-panel';

export const metadata = {
  title: 'Verification · Mohalla Admin',
};

const LIMIT = 20;

/**
 * UX-ADM-008 — organization verification (ADMIN-FR-010).
 *
 * THERE IS NO QUEUE, AND THAT IS THE FIRST THING THIS SCREEN HAS TO SAY.
 * Verification is by invitation in V1 (S2-CR-006): there is no in-app request
 * flow, no endpoint that lists organizations awaiting a decision, and nothing
 * that accumulates here. An administrator who opened this expecting a worklist
 * would conclude the feature was broken when it showed nothing — so the screen
 * is built as a lookup and says why.
 *
 * ONE ROUTE, TWO STATES. `?q=` searches; `?user=` shows one account with the
 * grant and revoke controls. Keeping it in one route means the search that
 * found the account and the decision made about it share a URL and a back
 * button, and it avoids a second copy of the account view.
 *
 * ONLY ORGANIZATIONS ARE ELIGIBLE, and the eligibility check belongs to the
 * API — `canHoldVerifiedBadge` runs there and only on the grant path. This
 * screen disables the grant button for an individual account, which is a
 * courtesy rather than a boundary: the same request made any other way is
 * refused, and the refusal states the rule (§28).
 */
export default async function VerificationPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; user?: string }>;
}) {
  const { q: rawQuery, user: userId } = await searchParams;
  const query = (rawQuery ?? '').trim();

  return (
    <>
      <h1>Verification</h1>
      <p className="page-lead">
        Grant or revoke the organization badge, with a reason. Only organization accounts are
        eligible.
      </p>

      {/* S2-CR-006 — said before anybody waits for a list to appear. */}
      <p className="not-built">
        There is no request queue. Verification is by invitation in V1: organizations do not apply
        through the app, and the admin API has no route that lists accounts awaiting a decision.
        Nothing collects on this screen — look up the account you were asked about.
      </p>

      <form className="search-form" method="GET" action="/verification" role="search">
        <label htmlFor="q">Find an account by username or display name</label>
        <div className="search-row">
          <input
            id="q"
            name="q"
            type="search"
            defaultValue={query}
            autoComplete="off"
            maxLength={120}
            required
          />
          <button type="submit">Search</button>
        </div>
      </form>

      {userId !== undefined && userId !== '' ? (
        <OneAccount userId={userId} />
      ) : query === '' ? (
        <p className="muted">Search above for the organization you were asked to verify.</p>
      ) : (
        <Matches query={query} />
      )}
    </>
  );
}

/**
 * The search results.
 *
 * ORGANIZATIONS ARE NOT FILTERED OUT. It would be tidier to show only eligible
 * accounts, and it would be wrong: an administrator searching for an
 * organization that was registered as an individual needs to SEE that, because
 * that is the answer to why it cannot be verified. A filtered list would just
 * appear to have no such account.
 */
async function Matches({ query }: { query: string }) {
  let result;
  try {
    result = await guardedRequest({
      path: `/admin/users/search?q=${encodeURIComponent(query)}&limit=${LIMIT}`,
      schema: userSearchResultSchema,
    });
  } catch (error) {
    return <Unavailable error={error} what="search" />;
  }

  if (result.users.length === 0) {
    return (
      <div className="queue-clear">
        <p className="queue-clear-headline">No account matches that.</p>
        <p className="muted">
          Nothing was found for <q>{query}</q>. The search matches username and display name only.
        </p>
      </div>
    );
  }

  const capped = result.users.length === LIMIT;

  return (
    <>
      {capped && (
        <p className="notice notice-info">
          This list is capped at {LIMIT} and the API does not report how many accounts matched.
          Narrow the search rather than reading this as the complete set.
        </p>
      )}

      <div className="table-scroll">
        <table className="data-table">
          <caption className="table-caption">
            Accounts matching the search, newest first. Individual accounts are listed too — an
            organization registered as an individual is the answer to why it cannot be verified.
          </caption>
          <thead>
            <tr>
              <th scope="col">Account</th>
              <th scope="col">Type</th>
              <th scope="col">Badge</th>
              <th scope="col">State</th>
              <th scope="col">
                <span className="visually-hidden">Open for verification</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {result.users.map((user) => (
              <tr key={user.userId}>
                {/* Somebody's chosen name, as text (§34). */}
                <td>
                  <span className="account-name">
                    {user.displayName ?? <em className="muted">No name</em>}
                  </span>
                  <br />
                  <span className="muted small mono">
                    {user.username === null ? 'no username' : `@${user.username}`}
                  </span>
                </td>
                <td>{accountTypeLabel(user.accountType)}</td>
                <td>
                  {user.verifiedBadge ? (
                    <span className="flag flag-verified">Verified</span>
                  ) : (
                    <span className="muted">No</span>
                  )}
                </td>
                <td>{userStateLabel(user.state)}</td>
                <td>
                  <Link href={`/verification?user=${user.userId}`} className="row-link">
                    Open
                    <span className="visually-hidden">
                      {' '}
                      verification for {user.displayName ?? user.userId}
                    </span>
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/** One account, with the controls. */
async function OneAccount({ userId }: { userId: string }) {
  let user: AdminUserView;
  try {
    user = await guardedRequest({
      path: `/admin/users/${encodeURIComponent(userId)}`,
      schema: adminUserViewSchema,
    });
  } catch (error) {
    return <Unavailable error={error} what="account" />;
  }

  return (
    <>
      <h2 className="section-heading">
        {user.displayName ?? <span className="muted">Account with no profile</span>}
      </h2>
      <p className="mono muted small">
        {user.username === null ? 'No username' : `@${user.username}`} · {user.userId}
      </p>
      <p>
        <Link href={`/users/${user.userId}`} className="row-link">
          Open the full account
        </Link>
      </p>

      <VerificationPanel
        userId={user.userId}
        accountType={user.accountType}
        verified={user.verifiedBadge}
        displayName={user.displayName ?? 'This account'}
      />
    </>
  );
}

function Unavailable({ error, what }: { error: unknown; what: 'search' | 'account' }) {
  const isShape = error instanceof AdminApiShapeError;
  const apiError = error instanceof AdminApiError ? error : null;
  const missing = apiError?.status === 404;
  const reference = apiError?.correlationId ?? (isShape ? error.correlationId : undefined);

  return (
    <div role="alert" className="notice notice-error">
      <p>
        {missing
          ? 'No account is available for that id. It may never have existed, it may have been deleted, or the id may belong to an administrator.'
          : isShape
            ? 'The API answered, but not in a shape this portal understands. Nothing is shown rather than shown wrongly.'
            : messageForCode(apiError?.code ?? 'UNKNOWN')}
      </p>
      <p className="muted small">
        {what === 'search'
          ? 'This is not an empty result — the search could not be run.'
          : 'No badge was granted or revoked, and nothing has been changed.'}
      </p>
      {reference !== undefined && <p className="mono muted small">Reference: {reference}</p>}
    </div>
  );
}
