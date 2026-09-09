import Link from 'next/link';
import { guardedRequest } from '../../../../lib/admin-api/guarded';
import { AdminApiError, AdminApiShapeError } from '../../../../lib/admin-api/client';
import { adminUserViewSchema, type AdminUserView } from '../../../../lib/admin-api/schemas';
import { messageForCode } from '../../../../lib/admin-api/messages';
import { exactInstant, formatAge, formatExpiry } from '../../../../lib/format-age';
import { accountTypeLabel, userStateLabel } from '../../../../lib/wire-labels';
import { SensitivePanel } from './sensitive-panel';

export const metadata = {
  title: 'Account · Mohalla Admin',
};

/**
 * UX-ADM-006 — one account (ADMIN-FR-005).
 *
 * The profile, the state, when it registered, what it has posted, and what has
 * been reported about it — plus the identifiers, behind an audited request.
 *
 * WHAT AN ADMINISTRATOR CANNOT SEE FROM HERE, AND IT MATTERS.
 *
 * There is no route that returns an account's enforcement history. The
 * repository has the query and `EnforcementService.history()` calls it, but the
 * only place it is exposed is the moderation CASE detail, for the author of
 * that case. `GET /admin/users/:id` does not carry it, and the audit log
 * filters by administrator, action and date range — NOT by the account acted
 * on. So there is no way, from this screen or any other, to ask "what has been
 * done to this person before?" Recorded as ADMIN-API-GAP-008.
 *
 * That is stated on the page rather than left implicit, because this is the
 * screen where enforcement decisions get made, and BR-037's whole point is
 * proportionality: "an administrator deciding whether a first offence warrants
 * 30 days should not have to open another screen to find out it is the fourth"
 * — and here they cannot open any screen that would tell them. An empty space
 * where a history would go reads as a clean record, which is exactly the
 * inference nothing supports.
 *
 * NO IDENTIFIER IS FETCHED WHILE THIS PAGE RENDERS. See `SensitivePanel`.
 *
 * AN ADMINISTRATOR ACCOUNT CANNOT BE LOOKED UP HERE AT ALL, and not because
 * this page hides it: administrators have no row in `users` and no `UserState`,
 * so the API returns "not available" for one. SEC-020 keeps the two credential
 * stores apart and BR-ADM-001 forbids acting on an administrator through the
 * product — and the type in the API "itself refuses to express the action".
 * Hiding a control is never the boundary (§28); this is what the boundary
 * actually looks like.
 */
export default async function AccountPage({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;

  let user: AdminUserView;
  try {
    user = await guardedRequest({
      path: `/admin/users/${encodeURIComponent(userId)}`,
      schema: adminUserViewSchema,
    });
  } catch (error) {
    return <AccountUnavailable userId={userId} error={error} />;
  }

  return (
    <>
      <p className="crumb">
        <Link href="/users">← Accounts</Link>
      </p>

      {/*
        Somebody's chosen name, as TEXT. §34 names usernames among the things
        never to pass through `dangerouslySetInnerHTML`, and a display name is
        user-generated content that arrives on this screen by that person's
        choice.
      */}
      <h1>
        {user.displayName ?? <span className="muted">Account with no profile</span>}
        {user.verifiedBadge && <span className="flag flag-verified">Verified</span>}
      </h1>
      <p className="page-lead mono">
        {user.username === null ? 'No username' : `@${user.username}`}
      </p>

      <dl className="fact-list fact-grid">
        <div>
          <dt>State</dt>
          <dd>
            {userStateLabel(user.state)}
            {/*
              EDGE-028 — a suspension lifts automatically with no
              administrator action, so the state on its own does not say
              whether anything is currently in force.
            */}
            {user.suspendedUntil !== null && (
              <>
                <br />
                <span className="muted small" title={exactInstant(user.suspendedUntil)}>
                  {formatExpiry(user.suspendedUntil)}
                </span>
              </>
            )}
          </dd>
        </div>
        <div>
          <dt>Account type</dt>
          <dd>{accountTypeLabel(user.accountType)}</dd>
        </div>
        <div>
          <dt>Registered</dt>
          <dd title={exactInstant(user.createdAt)}>{formatAge(user.createdAt)} ago</dd>
        </div>
        <div>
          <dt>Posts</dt>
          <dd className="numeric">{user.postCount.toLocaleString('en')}</dd>
        </div>
        <div>
          <dt>Reports received</dt>
          <dd className="numeric">{user.reportsReceived.toLocaleString('en')}</dd>
        </div>
        <div>
          <dt>Reports made</dt>
          <dd className="numeric">{user.reportsMade.toLocaleString('en')}</dd>
        </div>
      </dl>

      <p className="muted small">
        Reports received counts reports about this account. Reports made counts reports it has
        submitted — a high number is not by itself a finding, but it is the figure that shows a
        reporting pattern.
      </p>

      <div className="mono muted small">Account {user.userId}</div>

      <SensitivePanel userId={user.userId} />

      {/* ADMIN-API-GAP-008 — see the note at the top of this file. */}
      <section className="panel" aria-labelledby="history-heading">
        <h2 id="history-heading">Enforcement history</h2>
        <p className="not-built">
          The admin API exposes an account&apos;s enforcement history only on a moderation case, for
          the author of that case. There is no route that returns it for an account, and the audit
          log cannot be filtered by the account acted on — only by administrator, action and date
          (ADMIN-API-GAP-008).
        </p>
        <p className="not-built">
          So this is missing information, not a clean record. If you need to know what has been done
          to this account before, open a moderation case whose author it is; that screen carries the
          history and the repeat-offender flag.
        </p>
      </section>

      <section className="panel" aria-labelledby="enforcement-heading">
        <h2 id="enforcement-heading">Enforcement</h2>
        <p className="not-built">
          Not built yet — suspend, ban and reinstate are implemented in Group 09, each with a
          mandatory reason recorded in the audit log. The API already refuses every one of them
          against an administrator account, whether or not this page draws a control.
        </p>
      </section>
    </>
  );
}

/**
 * The account, when it could not be read.
 *
 * A 404 HERE COVERS THREE DIFFERENT THINGS and the copy does not guess between
 * them: an id that never existed, an account since deleted, and an
 * ADMINISTRATOR id — administrators have no row in `users`, so the API answers
 * the same way for one. That last case is not concealment for its own sake;
 * it falls out of SEC-020 keeping the two credential stores apart, and it is
 * the reason an administrator cannot be reached through this screen even by
 * typing an id into the address bar.
 */
function AccountUnavailable({ userId, error }: { userId: string; error: unknown }) {
  const apiError = error instanceof AdminApiError ? error : null;
  const isShape = error instanceof AdminApiShapeError;
  const missing = apiError?.status === 404;
  const reference = apiError?.correlationId ?? (isShape ? error.correlationId : undefined);

  return (
    <>
      <p className="crumb">
        <Link href="/users">← Accounts</Link>
      </p>
      <h1>Account</h1>

      <div role="alert" className="notice notice-error">
        <p>
          {missing
            ? 'No account is available for that id. It may never have existed, it may have been deleted, or the id may belong to an administrator — administrator accounts are not reachable through the portal.'
            : isShape
              ? 'The API answered, but not in a shape this portal understands. The account is not shown rather than shown wrongly.'
              : messageForCode(apiError?.code ?? 'UNKNOWN')}
        </p>
        <p className="muted small">Nothing has been changed, and no identifier was read.</p>
        <p className="mono muted small">Requested {userId}</p>
        {reference !== undefined && <p className="mono muted small">Reference: {reference}</p>}
      </div>
    </>
  );
}
