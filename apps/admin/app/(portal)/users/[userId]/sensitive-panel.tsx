'use client';

import { useActionState } from 'react';
import { revealIdentifiers } from './actions';
import { HIDDEN_IDENTIFIERS } from './sensitive-state';
import { exactInstant } from '../../../../lib/format-age';

/**
 * The account's identifiers — PRIV-008, SEC-022, §24.
 *
 * CLOSED UNTIL ASKED, and that is the whole design.
 *
 * §24 requires that viewing a phone number, email or date of birth "must
 * itself produce the required backend audit event", and adds the rule that
 * makes it work: "do not prefetch sensitive fields unnecessarily." Those two
 * sentences are one idea. If the panel fetched on render, every visit to an
 * account — a mistaken click, a refresh, a bookmark, opening it to check
 * whether somebody is suspended — would write an entry saying an administrator
 * read that person's phone number. The log would fill with accesses nobody
 * made, and the entries that mattered would be lost among them. An audit trail
 * that records everything records nothing.
 *
 * So the resting state says what pressing the button will write, and names the
 * fields it will show. An administrator with a support call in front of them
 * is delayed by one press. An administrator idly browsing never generates the
 * entry at all — which is the behaviour the requirement is trying to produce.
 *
 * THE VALUES ARE NEVER PUT ANYWHERE ELSE. Not in the URL, not in a title
 * attribute, not in a data attribute, not in browser storage, and not in a
 * console line. This component renders them into the page and holds them in
 * React state for as long as it is mounted; a reload closes the panel again,
 * and reopening it writes a new entry, which is correct — it is a new access.
 */
export function SensitivePanel({ userId }: { userId: string }) {
  const [state, submit, pending] = useActionState(revealIdentifiers, HIDDEN_IDENTIFIERS);

  return (
    <section className="panel" aria-labelledby="identifiers-heading">
      <h2 id="identifiers-heading">Registered identifiers</h2>

      {state.status === 'NOT_REQUESTED' && (
        <form action={submit}>
          <input type="hidden" name="userId" value={userId} />
          <p>
            This account&apos;s phone number and date of birth are not shown, and have not been
            loaded.
          </p>
          <p className="muted">
            Showing them records an entry in the audit log naming you, this account, the fields you
            read and the time. That record is permanent and cannot be edited or removed. The entry
            names the fields, never their values.
          </p>
          <button type="submit" disabled={pending}>
            {pending ? 'Recording…' : 'Show phone number and date of birth'}
          </button>
        </form>
      )}

      {state.status === 'REVEALED' && (
        <>
          <p className="muted small">
            This access is recorded in the audit log. Reloading this page hides these fields again,
            and showing them once more records a new access — because it is one.
          </p>

          <dl className="fact-list fact-grid">
            <div>
              <dt>Phone number</dt>
              {/*
                As text. The registered number is the account's login
                credential, so it is rendered and nothing more — no `tel:`
                link, which would hand it to whatever application the
                administrator's machine has registered for that scheme.
              */}
              <dd className="mono">
                {state.view.phone ?? <span className="muted">Not recorded</span>}
              </dd>
            </div>
            <div>
              <dt>Date of birth</dt>
              <dd>
                {state.view.dateOfBirth === null ? (
                  <span className="muted">Not recorded</span>
                ) : (
                  <span className="mono">{exactInstant(state.view.dateOfBirth).slice(0, 10)}</span>
                )}
              </dd>
            </div>
          </dl>

          {/*
            ADMIN-API-GAP-006. PRIV-008 names three fields and this route
            returns two, so the screen says which — otherwise an
            administrator would reasonably read the absence of an email row as
            "this account has no email on file", which is a different and
            unsupported claim.
          */}
          <p className="not-built">
            Email is not returned by this endpoint (ADMIN-API-GAP-006). Its absence here is not a
            statement about whether the account has one.
          </p>
        </>
      )}

      {state.status === 'FAILED' && (
        <div className="notice notice-error" role="alert">
          <p>{state.message}</p>
          <p className="muted small">
            Nothing is shown. Whether the audit log recorded an attempted read is the API&apos;s
            record to answer, not this page&apos;s.
          </p>
          {state.reference !== undefined && (
            <p className="mono muted small">Reference: {state.reference}</p>
          )}
        </div>
      )}
    </section>
  );
}
