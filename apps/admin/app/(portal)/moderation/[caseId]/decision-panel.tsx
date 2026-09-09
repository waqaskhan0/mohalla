'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { decideCase } from './actions';
import { IDLE_DECISION, REASON_MAX, REASON_MIN } from './decision-state';

/**
 * The three peer outcomes — ADMIN-FR-003 / ADMIN-FR-004, and §43.
 *
 * RESTORE AND DELETE ARE PEERS, AND THIS IS THE FILE WHERE THAT IS EITHER TRUE
 * OR NOT. §43: "RESTORE and DELETE are peers. Same visual hierarchy, same
 * weight... The UI must not psychologically bias administrators toward
 * deletion." The API says the same thing about itself — "sibling states, equal
 * API weight, equal visual weight, NO DEFAULT" — and gives the reason, which is
 * RSK-010: coordinated reporting is used to silence legitimate criticism, and
 * "a system that leans toward removal makes that risk worse".
 *
 * So, concretely, in this component:
 *
 *   - The three buttons share ONE class. There is no primary and no danger
 *     colour, because a red button is an instruction and this screen has no
 *     recommendation to give.
 *   - Nothing is preselected and nothing is autofocused. A moderator pressing
 *     Enter out of habit submits nothing.
 *   - Delete does not sit in the last position, which in a button row reads as
 *     the default action.
 *   - Each outcome carries one line saying what it does, and the restore line
 *     is not shorter or quieter than the delete line.
 *
 * THE ONE ASYMMETRY IS DELIBERATE AND RUNS THE OTHER WAY. Delete asks for a
 * second confirmation; restore and no-action do not. That is not a thumb on the
 * scale for deletion — it is a thumb against it, which is the direction RSK-010
 * and BR-032 both point. Delete is the only irreversible outcome in the
 * product, and the only one no automatic process is ever allowed to perform.
 *
 * THE REASON IS MANDATORY (BR-038) and it is the same field for all three
 * outcomes, so writing a reason cannot become the thing that steers the choice.
 * It is checked here for the reader's sake and again in the server action,
 * which is where the rule actually lives.
 */
export function DecisionPanel({ caseId, version }: { caseId: string; version: number }) {
  const [state, submit, pending] = useActionState(decideCase, IDLE_DECISION);
  const [reason, setReason] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const confirmRef = useRef<HTMLDivElement>(null);

  // Focus follows the confirmation, or somebody using a keyboard is left at the
  // bottom of a form whose buttons have just been replaced by different ones.
  useEffect(() => {
    if (confirmingDelete) confirmRef.current?.focus();
  }, [confirmingDelete]);

  const trimmed = reason.trim();
  const reasonError =
    localError ?? (state.status === 'INVALID' && state.field === 'reason' ? state.message : null);

  if (state.status === 'ALREADY_RESOLVED') {
    return (
      <div className="notice notice-info" role="status">
        <h2>This case was already resolved</h2>
        {/*
          EDGE-024, and the requirement is specific about the shape: the second
          administrator is told the case was already resolved "BY WHOM AND HOW —
          not shown a generic error". So the two facts are named, and the panel
          is information rather than a failure, because from this reader's point
          of view the case IS handled and their decision was simply not needed.
        */}
        <dl className="fact-list">
          <div>
            <dt>Resolved by</dt>
            <dd className="mono">{state.resolvedBy}</dd>
          </div>
          <div>
            <dt>Outcome</dt>
            <dd>{state.outcome}</dd>
          </div>
        </dl>
        <p className="muted small">
          Nothing was changed by your decision. Reload the case to see its current state.
        </p>
      </div>
    );
  }

  if (state.status === 'APPLIED') {
    // Deliberately brief: the page re-reads the case, so the authoritative
    // account of what happened is the resolution panel above this one, written
    // from the server's copy of the case rather than from what this form
    // believes it sent.
    return (
      <div className="notice notice-success" role="status">
        <p>Your decision was recorded, with your reason, in the audit log.</p>
      </div>
    );
  }

  return (
    <form action={submit} className="decision-form">
      <input type="hidden" name="caseId" value={caseId} />
      {/*
        EDGE-024 — THE VERSION THE ADMINISTRATOR WAS SHOWN, not the current one.
        The API compares it under an optimistic lock, so if somebody else
        resolved this case while this page was open, this decision is refused
        and its author is told who got there first. Re-reading the version at
        submit time would defeat the entire mechanism.
      */}
      <input type="hidden" name="version" value={version} />

      <h2>Decision</h2>
      <p className="muted">
        Restore, delete and no action are equal outcomes. Nothing is recommended, and nothing is
        preselected.
      </p>

      <div className="field">
        <label htmlFor="reason">Reason</label>
        <p className="field-note" id="reason-note">
          Required, {REASON_MIN}–{REASON_MAX} characters. It is stored in the audit log with your
          name and this decision, and it is what makes the decision reviewable later.
        </p>
        <textarea
          id="reason"
          name="reason"
          rows={3}
          maxLength={REASON_MAX}
          value={reason}
          readOnly={confirmingDelete}
          onChange={(event) => {
            setReason(event.target.value);
            setLocalError(null);
          }}
          aria-describedby={reasonError === null ? 'reason-note' : 'reason-note reason-error'}
          aria-invalid={reasonError === null ? undefined : true}
          required
        />
        <p className="muted small">
          {trimmed.length} of {REASON_MAX}
        </p>
        {reasonError !== null && (
          <p className="field-error" id="reason-error" role="alert">
            {reasonError}
          </p>
        )}
      </div>

      {confirmingDelete ? (
        <div className="confirm-delete" role="group" aria-labelledby="confirm-heading">
          <h3 id="confirm-heading" ref={confirmRef} tabIndex={-1}>
            Delete this content permanently?
          </h3>
          <p>
            This cannot be undone. The content is removed from the platform for everyone. The audit
            log keeps a record of what was deleted, by whom and why, so the decision remains
            reviewable — but the content itself does not come back.
          </p>
          <p className="muted small">
            Your reason, as it will be recorded: <q>{trimmed}</q>
          </p>
          <div className="decision-row">
            <button type="submit" name="outcome" value="delete" disabled={pending}>
              {pending ? 'Deleting…' : 'Delete permanently'}
            </button>
            <button type="button" onClick={() => setConfirmingDelete(false)} disabled={pending}>
              Go back
            </button>
          </div>
        </div>
      ) : (
        <>
          {/*
            ONE CLASS, THREE BUTTONS, NO PRIMARY. See the note at the top of
            this file: the styling is identical on purpose, and delete is not
            in the position a button row reads as the default.
          */}
          <div className="decision-row">
            <button type="submit" name="outcome" value="restore" disabled={pending}>
              Restore content
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                // Checked before the confirmation rather than after, so nobody
                // reads an irreversible warning only to be sent back for a
                // reason they were never asked for.
                if (trimmed.length < REASON_MIN) {
                  setLocalError(
                    `A reason of at least ${REASON_MIN} characters is required before deleting.`,
                  );
                  return;
                }
                setConfirmingDelete(true);
              }}
            >
              Delete content
            </button>
            <button type="submit" name="outcome" value="no-action" disabled={pending}>
              Close, no action
            </button>
          </div>

          <dl className="outcome-notes">
            <div>
              <dt>Restore content</dt>
              <dd>
                Puts the content back and RESETS the report count, so the same reporters cannot
                immediately re-hide it. This is what protects legitimate civic criticism from
                coordinated reporting.
              </dd>
            </div>
            <div>
              <dt>Delete content</dt>
              <dd>
                Removes it permanently. Irreversible, and the only way anything is ever deleted — no
                automatic process deletes content.
              </dd>
            </div>
            <div>
              <dt>Close, no action</dt>
              <dd>
                Leaves the content untouched and clears the reports, so one more report cannot
                re-hide something you have just examined and approved.
              </dd>
            </div>
          </dl>
        </>
      )}

      {state.status === 'INVALID' && state.field === 'outcome' && (
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
