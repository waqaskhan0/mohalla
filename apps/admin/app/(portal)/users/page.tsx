import Link from 'next/link';
import { guardedRequest } from '../../../lib/admin-api/guarded';
import { AdminApiError, AdminApiShapeError } from '../../../lib/admin-api/client';
import { userSearchResultSchema, type AdminUserView } from '../../../lib/admin-api/schemas';
import { messageForCode } from '../../../lib/admin-api/messages';
import { exactInstant, formatAge, formatExpiry } from '../../../lib/format-age';
import { accountTypeLabel, userStateLabel } from '../../../lib/wire-labels';

export const metadata = {
  title: 'Users · Mohalla Admin',
};

/** The API's own bounds: `limit` 1–50. Twenty is its default. */
const LIMIT = 20;

/**
 * UX-ADM-005 — accounts (ADMIN-FR-005).
 *
 * A LOOKUP, NOT A DIRECTORY, and that is the most important thing about this
 * screen.
 *
 * The API offers `GET /admin/users/search?q=` and nothing that lists accounts.
 * There is no "all users" route to call, so this page cannot become a
 * browsable register of every citizen on the platform — and it should not, so
 * the resting state is a search box rather than the first page of everybody.
 * An administrator arrives here with somebody in mind; the screen is built for
 * that and for nothing else.
 *
 * THE ROW CARRIES NO IDENTIFIER. No phone, no email, no date of birth. The
 * API's description gives the reasoning and it is worth restating: "a lookup
 * must not itself be a sensitive-data view, or PRIV-008 would be audited on
 * every screen and mean nothing." The identifiers are a second, deliberate
 * request on UX-ADM-006 that writes an audit entry before it reads.
 *
 * WHAT IT CAN AND CANNOT SEARCH BY. Username and display name, as substrings.
 * ADMIN-FR-005 also lists phone as a search key, and the API explains why that
 * is not a substring search: the number is stored as a peppered hash, "and a
 * hash has no substrings, so there is no partial-number search to build". The
 * exact-lookup path exists in the identity module but is not exposed on an
 * admin route, so the portal cannot search by phone at all. Recorded as
 * ADMIN-API-GAP-007, and said on the screen rather than left for somebody to
 * discover by typing a number and getting nothing.
 *
 * A useful side effect: because the only searchable fields are the two that
 * already appear publicly in the app, no identifier ever enters this page's
 * URL — which a phone-number search would have done on every query.
 *
 * NO PAGING, AND THE SCREEN SAYS SO. The route takes `q` and `limit` and
 * returns a bare array: no total, no offset. So twenty results might be twenty
 * matches or the first twenty of two hundred, and the API cannot tell the
 * difference. Showing them without a word would let a reader conclude they had
 * seen everything — ADMIN-RUNTIME-003's mistake in a different column. When
 * the results fill the limit, this page says the list is capped and asks for a
 * narrower search.
 */
export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q: rawQuery } = await searchParams;
  const query = (rawQuery ?? '').trim();

  return (
    <>
      <h1>Accounts</h1>
      <p className="page-lead">
        Search by username or display name. This is a lookup rather than a directory: there is no
        list of all accounts, and a result carries no phone number, email or date of birth.
      </p>

      {/*
        A GET form, so the search is in the URL. That makes a result linkable,
        makes the back button work, and means a reload does not re-submit
        anything — and none of the searchable fields is an identifier, so
        nothing sensitive lands in the address bar.
      */}
      <form className="search-form" method="GET" action="/users" role="search">
        <label htmlFor="q">Username or display name</label>
        <div className="search-row">
          <input
            id="q"
            name="q"
            type="search"
            defaultValue={query}
            placeholder="e.g. aisha or Aisha Khan"
            autoComplete="off"
            maxLength={120}
            required
          />
          <button type="submit">Search</button>
        </div>
        <p className="field-note">
          Part of a name is enough. Searching by phone number is not available — the number is
          stored as a hash, which has no substrings (ADMIN-API-GAP-007).
        </p>
      </form>

      {query === '' ? <NoSearchYet /> : <Results query={query} />}
    </>
  );
}

/**
 * The resting state.
 *
 * DELIBERATELY NOT A LIST OF ACCOUNTS. Nothing is fetched, because the screen
 * has not been asked anything yet — and an empty search is not a request to see
 * everybody.
 */
function NoSearchYet() {
  return (
    <div className="queue-clear">
      <p className="queue-clear-headline">Nothing searched yet.</p>
      <p className="muted">
        Enter a username or display name above. Accounts are not listed until you look one up.
      </p>
    </div>
  );
}

async function Results({ query }: { query: string }) {
  let result;
  try {
    result = await guardedRequest({
      path: `/admin/users/search?q=${encodeURIComponent(query)}&limit=${LIMIT}`,
      schema: userSearchResultSchema,
    });
  } catch (error) {
    return <SearchUnavailable error={error} />;
  }

  if (result.users.length === 0) {
    return (
      <div className="queue-clear">
        <p className="queue-clear-headline">No account matches that.</p>
        <p className="muted">
          Nothing was found for <q>{query}</q>. Try part of the name, or a different spelling — the
          search matches username and display name only.
        </p>
      </div>
    );
  }

  // The API returns a bare array with no total, so a full page is the one case
  // where the portal genuinely does not know what it is not showing.
  const capped = result.users.length === LIMIT;

  return (
    <>
      <p className="page-lead">
        {capped ? `The first ${LIMIT} accounts` : `${result.users.length} `}
        {capped ? '' : result.users.length === 1 ? 'account' : 'accounts'} matching <q>{query}</q>.
        Newest accounts first — the search does not rank by how well a name matches.
      </p>

      {capped && (
        <p className="notice notice-info">
          This list is capped at {LIMIT} and the API does not report how many accounts matched, so
          there may be more. Narrow the search rather than reading this as the complete set.
        </p>
      )}

      <div className="table-scroll">
        <table className="data-table">
          <caption className="table-caption">
            Accounts matching the search, newest first. No phone number, email or date of birth
            appears here — those require a separate, audited request on the account&apos;s own page.
          </caption>
          <thead>
            <tr>
              <th scope="col">Account</th>
              <th scope="col">Type</th>
              <th scope="col">State</th>
              <th scope="col">Joined</th>
              <th scope="col">Posts</th>
              <th scope="col">Reports received</th>
              <th scope="col">Reports made</th>
              <th scope="col">
                <span className="visually-hidden">Open the account</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {result.users.map((user) => (
              <UserRow key={user.userId} user={user} />
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function UserRow({ user }: { user: AdminUserView }) {
  return (
    <tr>
      <td>
        {/*
          Somebody else's chosen name, rendered as TEXT. §34 names usernames
          explicitly among the things never to pass through
          `dangerouslySetInnerHTML` — a display name is user-generated content
          that arrives on an administrator's screen by that person's choice.
        */}
        <span className="account-name">
          {user.displayName ?? <em className="muted">No name</em>}
        </span>
        {user.verifiedBadge && (
          <span className="flag flag-verified" title="Verified organization">
            Verified
          </span>
        )}
        <br />
        <span className="muted small mono">
          {user.username === null ? 'no username' : `@${user.username}`}
        </span>
      </td>
      <td>{accountTypeLabel(user.accountType)}</td>
      <td>
        {userStateLabel(user.state)}
        {/*
          A suspension that is still running is a different fact from one that
          has lifted, and EDGE-028 lifts them automatically with no
          administrator action — so the state alone does not say whether
          anything is currently in force.
        */}
        {user.suspendedUntil !== null && (
          <>
            <br />
            <span className="muted small" title={exactInstant(user.suspendedUntil)}>
              {formatExpiry(user.suspendedUntil)}
            </span>
          </>
        )}
      </td>
      <td className="numeric" title={exactInstant(user.createdAt)}>
        {formatAge(user.createdAt)} ago
      </td>
      <td className="numeric">{user.postCount.toLocaleString('en')}</td>
      <td className="numeric">{user.reportsReceived.toLocaleString('en')}</td>
      <td className="numeric">{user.reportsMade.toLocaleString('en')}</td>
      <td>
        <Link href={`/users/${user.userId}`} className="row-link">
          Open
          <span className="visually-hidden">
            {' '}
            the account for {user.displayName ?? user.userId}
          </span>
        </Link>
      </td>
    </tr>
  );
}

/**
 * The search, when it could not be run.
 *
 * IT DOES NOT SAY "NO ACCOUNT MATCHES". A failed request and an empty result
 * are different answers, and on this screen the wrong one sends an
 * administrator away believing an account does not exist.
 */
function SearchUnavailable({ error }: { error: unknown }) {
  const isShape = error instanceof AdminApiShapeError;
  const apiError = error instanceof AdminApiError ? error : null;
  const reference = apiError?.correlationId ?? (isShape ? error.correlationId : undefined);

  return (
    <div role="alert" className="notice notice-error">
      <p>
        {isShape
          ? 'The API answered, but not in a shape this portal understands. No results are shown rather than shown wrongly.'
          : messageForCode(apiError?.code ?? 'UNKNOWN')}
      </p>
      <p className="muted small">
        This is not an empty result — the search could not be run, so nothing is claimed about
        whether the account exists.
      </p>
      {reference !== undefined && <p className="mono muted small">Reference: {reference}</p>}
    </div>
  );
}
