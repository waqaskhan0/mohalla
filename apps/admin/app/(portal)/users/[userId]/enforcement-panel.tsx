'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { enforce } from './actions';
import {
  DURATIONS,
  DURATION_LABELS,
  IDLE_ENFORCEMENT,
  REASON_LIMITS,
  type Duration,
} from './enforcement-state';
import { formatExpiry } from '../../../../lib/format-age';
import { userStateLabel } from '../../../../lib/wire-labels';

/**
 * Suspend, ban and reinstate — ADMIN-FR-006, 007, 008.
 *
 * THESE THREE ARE NOT PEERS THE WAY RESTORE AND DELETE ARE, and the difference
 * is deliberate rather than sloppy. §43's peer rule is about the two outcomes
 * for a piece of CONTENT, where leaning toward removal makes RSK-010 worse.
 * Here the three actions are not alternative answers to one question:
 *
 *   - Suspend is a pause. BR-034 keeps READ access, because "somebody who
 *     cannot read cannot see the banner explaining why".
 *   - Ban is permanent, adds the registered number to the ban list (BR-036),
 *     and HIDES content rather than deleting it, "so that it remains available
 *     to the audit trail if the ban is later disputed".
 *   - Reinstate is a CORRECTION, and ADMIN-FR-008 gives the reason it is
 *     always available: "administrators make mistakes and the product must let
 *     them be corrected". So it is never hidden, never behind a confirmation,
 *     and never harder to reach than the action it undoes.
 *
 * What IS carried over from §43: nothing is preselected, nothing is
 * autofocused, no action gets a red button, and ban is not in the last
 * position of a row. Ban asks for a second confirmation, which is friction
 * against the irreversible action rather than toward it.
 *
 * EDGE-027 IS STATED ON THE SCREEN. Re-suspending REPLACES the duration
 * instead of accumulating, because "two administrators independently applying
 * 30 days would otherwise produce 60, which neither of them decided". An
 * administrator looking at an account already suspended for a week needs to
 * know that choosing 30 days sets thirty from now — not thirty-seven.
 */
export function EnforcementPanel({
  userId,
  state: accountState,
  suspendedUntil,
}: {
  userId: string;
  state: string;
  suspendedUntil: string | null;
}) {
  const [result, submit, pending] = useActionState(enforce, IDLE_ENFORCEMENT);
  const [reason, setReason] = useState('');
  const [confirmingBan, setConfirmingBan] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const confirmRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (confirmingBan) confirmRef.current?.focus();
  }, [confirmingBan]);

  const trimmed = reason.trim();
  const reasonError =
    localError ??
    (result.status === 'INVALID' && result.field === 'reason' ? result.message : null);

  // The API refuses every action against a deleted account
  // (`CANNOT_ACT_ON_DELETED`), and its reason is a good one: an action against
  // an account already gone records something nobody can experience, and
  // reinstating it would resurrect what that person asked to remove. Said here
  // rather than drawn as three buttons that always fail — but the refusal
  // itself is the server's, not this branch's (§28).
  if (accountState === 'DELETED') {
    return (
      <section className="panel" aria-labelledby="enforcement-heading">
        <h2 id="enforcement-heading">Enforcement</h2>
        <p className="not-built">
          This account has been deleted, so no enforcement action is available. The API refuses
          suspend, ban and reinstate against a deleted account: an action against an account that is
          already gone would record something nobody can experience, and reinstating it would
          restore what that person asked to remove.
        </p>
      </section>
    );
  }

  if (result.status === 'APPLIED') {
    return (
      <section className="panel" aria-labelledby="enforcement-heading">
        <h2 id="enforcement-heading">Enforcement</h2>
        <div className="notice notice-success" role="status">
          <p>{appliedSentence(result.action, result.expiresAt)}</p>
          {/*
            BR-035 made visible. "All sessions are invalidated" is a claim; the
            count is the evidence, and zero is informative too — it means the
            account had nobody signed in.
          */}
          <p className="muted small">
            {result.sessionsRevoked === 0
              ? 'No active sessions were signed out — the account had none.'
              : `${result.sessionsRevoked.toLocaleString('en')} ${
                  result.sessionsRevoked === 1 ? 'session was' : 'sessions were'
                } signed out.`}{' '}
            Your reason is recorded in the audit log with your name and this action.
          </p>
          <p className="muted small">Reload the account to see its current state.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="panel" aria-labelledby="enforcement-heading">
      <h2 id="enforcement-heading">Enforcement</h2>

      <form action={submit} className="decision-form">
        <input type="hidden" name="userId" value={userId} />

        <div className="field">
          <label htmlFor="enforce-reason">Reason</label>
          <p className="field-note" id="enforce-reason-note">
            Required, {REASON_LIMITS.min}–{REASON_LIMITS.max} characters. It is recorded in the
            audit log with your name and this action, and it is what the person affected can later
            have explained to them.
          </p>
          <textarea
            id="enforce-reason"
            name="reason"
            rows={3}
            maxLength={REASON_LIMITS.max}
            value={reason}
            readOnly={confirmingBan}
            onChange={(event) => {
              setReason(event.target.value);
              setLocalError(null);
            }}
            aria-describedby={
              reasonError === null
                ? 'enforce-reason-note'
                : 'enforce-reason-note enforce-reason-error'
            }
            aria-invalid={reasonError === null ? undefined : true}
            required
          />
          <p className="muted small">
            {trimmed.length} of {REASON_LIMITS.max}
          </p>
          {reasonError !== null && (
            <p className="field-error" id="enforce-reason-error" role="alert">
              {reasonError}
            </p>
          )}
        </div>

        {confirmingBan ? (
          <div className="confirm-delete" role="group" aria-labelledby="confirm-ban-heading">
            <h3 id="confirm-ban-heading" ref={confirmRef} tabIndex={-1}>
              Ban this account permanently?
            </h3>
            <p>
              The account is banned with no expiry. Its registered number is added to the ban list,
              so it cannot register again — and the refusal a returning person meets is neutral and
              does not disclose the ban.
            </p>
            <p>
              Their content is HIDDEN rather than deleted, so it remains available to the audit
              trail if the ban is later disputed. Nothing is destroyed by this action.
            </p>
            <p className="muted small">
              A ban can be reversed with Reinstate, which also takes the number off the ban list.
            </p>
            <p className="muted small">
              Your reason, as it will be recorded: <q>{trimmed}</q>
            </p>
            <div className="decision-row">
              <button type="submit" name="action" value="ban" disabled={pending}>
                {pending ? 'Banning…' : 'Ban permanently'}
              </button>
              <button type="button" onClick={() => setConfirmingBan(false)} disabled={pending}>
                Go back
              </button>
            </div>
          </div>
        ) : (
          <>
            <fieldset className="duration-set">
              <legend>Suspend for</legend>
              {accountState === 'SUSPENDED' && suspendedUntil !== null && (
                <p className="notice notice-info">
                  This account is already suspended, ending {formatExpiry(suspendedUntil)}. A new
                  suspension REPLACES that — it does not add to it, so choosing 30 days sets thirty
                  days from now.
                </p>
              )}
              {/*
                Three buttons, one selector, nothing preselected. A default
                duration would be a recommendation, and this screen has none to
                give.
              */}
              <div className="decision-row">
                {DURATIONS.map((duration: Duration) => (
                  <button
                    key={duration}
                    type="submit"
                    name="action"
                    value="suspend"
                    disabled={pending}
                    onClick={(event) => {
                      // The duration rides in a hidden field the button sets,
                      // because a submit button carries only one name/value
                      // pair and `action` is the one the server needs first.
                      const form = event.currentTarget.form;
                      const field = form?.elements.namedItem('duration');
                      if (field instanceof HTMLInputElement) field.value = duration;
                    }}
                  >
                    {DURATION_LABELS[duration]}
                  </button>
                ))}
              </div>
              <input type="hidden" name="duration" defaultValue="" />
              <p className="field-note">
                A suspension is a pause, not an eviction: the person keeps READ access, so they can
                see why. It lifts on its own — no administrator has to do anything when the time is
                up.
              </p>
            </fieldset>

            <div className="decision-row">
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  if (trimmed.length < REASON_LIMITS.min) {
                    setLocalError(
                      `A reason of at least ${REASON_LIMITS.min} characters is required before banning.`,
                    );
                    return;
                  }
                  setConfirmingBan(true);
                }}
              >
                Ban permanently
              </button>
              {/*
                REINSTATE IS ALWAYS HERE. ADMIN-FR-008: "administrators make
                mistakes and the product must let them be corrected." It is not
                hidden when the account looks fine, because an account can be
                on the ban list for a number that was never its own, and it is
                not behind a confirmation, because undoing an enforcement
                should never be harder than applying one.
              */}
              <button type="submit" name="action" value="reinstate" disabled={pending}>
                Reinstate
              </button>
            </div>

            <p className="field-note">
              Reinstating lifts a suspension or a ban and takes the registered number off the ban
              list — a reinstatement that left somebody unable to register would not be a
              correction. It is available whatever state the account is in
              {accountState === 'ACTIVE' ? ', including this one' : ''}. This account is currently{' '}
              <strong>{userStateLabel(accountState)}</strong>.
            </p>
          </>
        )}

        {result.status === 'INVALID' && result.field !== 'reason' && (
          <p className="field-error" role="alert">
            {result.message}
          </p>
        )}

        {result.status === 'REFUSED' && (
          <div className="notice notice-warn" role="alert">
            <p>{result.message}</p>
            <p className="muted small">
              Nothing was changed. This is the server&apos;s decision, not a limit of this screen.
            </p>
            {result.reference !== undefined && (
              <p className="mono muted small">Reference: {result.reference}</p>
            )}
          </div>
        )}

        {result.status === 'FAILED' && (
          <div className="notice notice-error" role="alert">
            <p>{result.message}</p>
            {result.reference !== undefined && (
              <p className="mono muted small">Reference: {result.reference}</p>
            )}
          </div>
        )}
      </form>
    </section>
  );
}

/** What happened, in the API's terms rather than the form's. */
function appliedSentence(action: string, expiresAt: string | null): string {
  if (action === 'suspend') {
    return expiresAt === null
      ? 'The account is suspended.'
      : `The account is suspended, ending ${formatExpiry(expiresAt)}. It lifts on its own.`;
  }
  if (action === 'ban') {
    return 'The account is banned and its registered number is on the ban list. Its content is hidden, not deleted.';
  }
  return 'The account is reinstated and its registered number is off the ban list.';
}
