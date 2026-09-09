'use client';

import { useActionState, useState } from 'react';
import { setVerification } from './actions';
import { IDLE_VERIFICATION, REASON_LIMITS } from './verification-state';

/**
 * Grant or revoke the organization badge — ADMIN-FR-010.
 *
 * ONLY ORGANIZATIONS CAN BE GRANTED IT, and the screen says so before the
 * button rather than after. The API enforces it — `canHoldVerifiedBadge` runs
 * on the grant path — and its refusal STATES the rule, because ADMIN-FR-010 is
 * explicit that an administrator verifying an individual "has made a category
 * error, not a security probe". A neutral refusal would leave them retrying.
 *
 * REVOKING IS ALLOWED WHATEVER THE ACCOUNT TYPE, which is deliberate in the
 * API and worth preserving here: if a badge sits on an account that should not
 * hold one, the way to remove it must not be blocked by the same eligibility
 * check that should have prevented it.
 *
 * THE BADGE IS A STATEMENT TO EVERY READER, not an internal flag — it says the
 * platform has checked that this organization is what it claims to be. So
 * granting asks for a reason like every other administrative action, and the
 * reason is what makes the decision reviewable when somebody later asks why an
 * account was vouched for.
 *
 * NOTHING IS PRESELECTED. Grant and revoke are two buttons of the same weight,
 * and neither is a default: the account is already in one of the two states,
 * and the useful action depends on which.
 */
export function VerificationPanel({
  userId,
  accountType,
  verified,
  displayName,
}: {
  userId: string;
  accountType: string;
  verified: boolean;
  displayName: string;
}) {
  const [state, submit, pending] = useActionState(setVerification, IDLE_VERIFICATION);
  const [reason, setReason] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  const isOrganization = accountType === 'ORGANIZATION';
  const trimmed = reason.trim();
  const reasonError =
    localError ?? (state.status === 'INVALID' && state.field === 'reason' ? state.message : null);

  if (state.status === 'APPLIED') {
    return (
      <div className="notice notice-success" role="status">
        <p>
          {state.granted
            ? 'The verified badge was granted. It appears beside this account everywhere in the app.'
            : 'The verified badge was revoked. It is removed everywhere in the app immediately.'}
        </p>
        <p className="muted small">
          Your reason is recorded in the audit log with your name. Reload this account to see its
          current state.
        </p>
      </div>
    );
  }

  return (
    <form action={submit} className="decision-form">
      <input type="hidden" name="userId" value={userId} />

      <h2>Verification</h2>

      <dl className="fact-list fact-grid">
        <div>
          <dt>Account type</dt>
          <dd>
            {isOrganization ? 'Organization' : 'Individual'}
            {!isOrganization && (
              <>
                <br />
                <span className="muted small">Not eligible for the badge</span>
              </>
            )}
          </dd>
        </div>
        <div>
          <dt>Badge now</dt>
          <dd>
            {verified ? (
              <span className="flag flag-verified">Verified</span>
            ) : (
              <span className="muted">Not verified</span>
            )}
          </dd>
        </div>
      </dl>

      {!isOrganization && (
        <p className="notice notice-info">
          This is an individual account, so the badge cannot be granted — the API refuses it, and it
          would refuse a request made any other way. Only organization accounts are eligible.
          {verified && ' The badge currently on this account can still be revoked.'}
        </p>
      )}

      <div className="field">
        <label htmlFor="verify-reason">Reason</label>
        <p className="field-note" id="verify-reason-note">
          Required, {REASON_LIMITS.min}–{REASON_LIMITS.max} characters. The badge tells every reader
          that the platform has checked this organization, so the reason is what makes that decision
          reviewable later.
        </p>
        <textarea
          id="verify-reason"
          name="reason"
          rows={3}
          maxLength={REASON_LIMITS.max}
          value={reason}
          onChange={(event) => {
            setReason(event.target.value);
            setLocalError(null);
          }}
          aria-describedby={
            reasonError === null ? 'verify-reason-note' : 'verify-reason-note verify-reason-error'
          }
          aria-invalid={reasonError === null ? undefined : true}
          required
        />
        <p className="muted small">
          {trimmed.length} of {REASON_LIMITS.max}
        </p>
        {reasonError !== null && (
          <p className="field-error" id="verify-reason-error" role="alert">
            {reasonError}
          </p>
        )}
      </div>

      {/*
        Two buttons of equal weight, nothing preselected. The account is
        already in one of the two states, so which action is useful depends on
        that rather than on a recommendation this screen could give.
      */}
      <div className="decision-row">
        <button
          type="submit"
          name="decision"
          value="grant"
          disabled={pending || !isOrganization || verified}
          onClick={(event) => {
            // preventDefault, because this is a SUBMIT button. The first
            // version set the error and let the request go anyway, so a
            // three-character reason showed a validation message and made a
            // round trip at the same time — and the server's message then
            // replaced the local one. A local check that does not stop the
            // submission is not a check.
            if (trimmed.length < REASON_LIMITS.min) {
              event.preventDefault();
              setLocalError(`A reason of at least ${REASON_LIMITS.min} characters is required.`);
            }
          }}
        >
          {pending ? 'Working…' : 'Grant the badge'}
        </button>
        <button
          type="submit"
          name="decision"
          value="revoke"
          disabled={pending || !verified}
          onClick={(event) => {
            if (trimmed.length < REASON_LIMITS.min) {
              event.preventDefault();
              setLocalError(`A reason of at least ${REASON_LIMITS.min} characters is required.`);
            }
          }}
        >
          {pending ? 'Working…' : 'Revoke the badge'}
        </button>
      </div>

      <p className="field-note">
        {verified
          ? `${displayName} holds the badge. Revoking removes it from every screen in the app immediately.`
          : isOrganization
            ? 'Granting adds the badge beside this account everywhere in the app.'
            : 'There is nothing to grant here, and nothing to revoke.'}
      </p>

      {state.status === 'NOT_ELIGIBLE' && (
        <div className="notice notice-warn" role="alert">
          <p>{state.message}</p>
          <p className="muted small">
            Nothing was changed. This is the eligibility rule, not a permission problem.
          </p>
        </div>
      )}

      {state.status === 'INVALID' && state.field === 'decision' && (
        <p className="field-error" role="alert">
          {state.message}
        </p>
      )}

      {state.status === 'FAILED' && (
        <div className="notice notice-error" role="alert">
          <p>{state.message}</p>
          {state.reference !== undefined && (
            <p className="mono muted small">Reference: {state.reference}</p>
          )}
        </div>
      )}
    </form>
  );
}
