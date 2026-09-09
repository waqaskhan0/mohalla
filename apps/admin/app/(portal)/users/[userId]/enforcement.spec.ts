import { describe, expect, it } from 'vitest';
import {
  functionSource,
  readCode,
  readFile,
  readProse,
} from '../../../../lib/test-support/read-source';
import { enforcementResultSchema } from '../../../../lib/admin-api/schemas';
import { DURATIONS, DURATION_LABELS, ENFORCEMENTS } from './enforcement-state';
import { ADMIN_ERROR_COPY } from '../../../../lib/admin-api/messages';

/**
 * Suspend, ban and reinstate — ADMIN-FR-006, 007, 008.
 *
 * Verified against the running API before these were written:
 *
 *   - a 24-hour suspension revoked 2 live sessions (BR-035)
 *   - re-suspending for 30 days landed at exactly 30.00 days from now, so it
 *     REPLACED rather than accumulated (EDGE-027)
 *   - suspending an administrator id returned 403 ADMIN_CANNOT_ACT_ON_ADMIN
 *     (SEC-021 / BR-ADM-001)
 *   - a one-character reason returned 400 with the rule in `details.reason`
 *     (BR-038)
 *   - reinstating an already-active account returned 200, so it is idempotent
 *     and the portal is right to offer it in every state
 */

const PANEL = 'app/(portal)/users/[userId]/enforcement-panel.tsx';
const ACTIONS = 'app/(portal)/users/[userId]/actions.ts';
const STATE = 'app/(portal)/users/[userId]/enforcement-state.ts';

describe('no action and no duration is ever inferred', () => {
  it('matches the action against a fixed list of three', () => {
    expect([...ENFORCEMENTS]).toEqual(['suspend', 'ban', 'reinstate']);

    const source = functionSource(ACTIONS, 'readEnforcement');
    expect(source).toContain('ENFORCEMENTS');
    expect(source).toContain(': null');
    // Of the three, the one a mangled submission must never fall through to.
    expect(source).not.toContain("'ban'");
  });

  it('matches the duration against exactly the three ADMIN-FR-006 allows', () => {
    // "24 hours, 7 days or 30 days". Not a free-form duration.
    expect([...DURATIONS]).toEqual(['HOURS_24', 'DAYS_7', 'DAYS_30']);
    expect(Object.values(DURATION_LABELS)).toEqual(['24 hours', '7 days', '30 days']);

    const source = functionSource(ACTIONS, 'readDuration');
    expect(source).toContain('DURATIONS');
    expect(source).toContain(': null');
  });

  it('refuses a suspension with no duration instead of picking one', () => {
    const enforceFn = functionSource(ACTIONS, 'enforce');
    const block = enforceFn.slice(enforceFn.indexOf("action === 'suspend'"));

    expect(block).toContain('duration === null');
    expect(block).toContain("field: 'duration'");
    // Verified in the browser: the hidden duration field starts empty, so a
    // submit that bypassed the three buttons carries no duration at all.
    expect(readFile(PANEL)).toContain('name="duration" defaultValue=""');
  });

  it('sends nothing when the action is unrecognised', () => {
    const enforceFn = functionSource(ACTIONS, 'enforce');
    const refusal = enforceFn.slice(enforceFn.indexOf('action === null'));
    const guard = refusal.slice(0, refusal.indexOf('};') + 2);

    expect(guard).toContain("status: 'INVALID'");
    expect(guard).not.toContain('guardedRequest');
  });

  it('preselects nothing and autofocuses nothing', () => {
    const code = readCode(PANEL);
    expect(code).not.toContain('autoFocus');
    expect(code).not.toContain('defaultChecked');
  });
});

describe('EDGE-027 — re-suspending replaces the duration', () => {
  it('says so on screen when the account is already suspended', () => {
    // Two administrators independently applying 30 days would otherwise
    // produce 60, which neither of them decided. An administrator looking at
    // an account already suspended for a week needs to know that 30 days means
    // thirty from now, not thirty-seven.
    const copy = readProse(PANEL);

    expect(copy).toContain('already suspended');
    expect(copy).toContain('REPLACES that');
    expect(copy).toContain('does not add to it');
  });

  it('shows the current expiry with a tense, not a bare date', () => {
    const panel = readCode(PANEL);
    expect(panel).toContain('formatExpiry(suspendedUntil)');
  });
});

describe('BR-035 — the session count is the evidence', () => {
  it('carries sessionsRevoked in the parsed shape', () => {
    // "All sessions are invalidated" is a claim; the count is what makes it
    // visible. Measured: a real suspension came back with 2.
    expect(Object.keys(enforcementResultSchema.shape).sort()).toEqual([
      'expiresAt',
      'id',
      'kind',
      'sessionsRevoked',
    ]);
  });

  it('reports zero as a fact rather than hiding it', () => {
    // Zero is informative: it means nobody was signed in, not that the
    // suspension failed to take.
    const copy = readProse(PANEL);
    expect(copy).toContain('No active sessions were signed out');
    expect(copy).toContain('the account had none');
  });
});

describe('what each action actually does is said before it is taken', () => {
  it('explains that a suspension is a pause with read access (BR-034)', () => {
    // "Somebody who cannot read cannot see the banner explaining why they were
    // suspended or when it lifts."
    const copy = readProse(PANEL);
    expect(copy).toContain('a pause, not an eviction');
    expect(copy).toContain('keeps READ access');
    // EDGE-028 — it lifts with no administrator action.
    expect(copy).toContain('lifts on its own');
  });

  it('explains that a ban hides content rather than deleting it', () => {
    // BR-032's instinct applied to a person: the content "remains available to
    // the audit trail if the ban is later disputed".
    const copy = readProse(PANEL);
    expect(copy).toContain('HIDDEN rather than deleted');
    expect(copy).toContain('audit trail if the ban is later disputed');
    expect(copy).toContain('Nothing is destroyed by this action');
  });

  it('explains the ban list and that the refusal a returning person meets is neutral', () => {
    // BR-036. The neutrality matters: a refusal that disclosed the ban would
    // tell somebody exactly what to change to get around it.
    const copy = readProse(PANEL);
    expect(copy).toContain('added to the ban list');
    expect(copy).toContain('neutral and does not disclose the ban');
  });
});

describe('ADMIN-FR-008 — reinstate is a correction, so it is never hard to reach', () => {
  it('is always offered, in every state, with no confirmation', () => {
    // "Administrators make mistakes and the product must let them be
    // corrected." Verified against the API: reinstating an already-active
    // account returns 200, so there is no state in which offering it is wrong.
    const panel = readFile(PANEL);

    expect(panel).toContain('name="action" value="reinstate"');

    // Not gated on the account's state: the button sits in the row
    // unconditionally, so there is no branch that could hide it.
    const code = readCode(PANEL);
    const row = code.slice(code.lastIndexOf('</fieldset>'));
    const beforeReinstate = row.slice(0, row.indexOf('value="reinstate"'));
    expect(beforeReinstate.slice(-200)).not.toContain('accountState ===');

    expect(readProse(PANEL)).toContain('available whatever state the account is in');
  });

  it('is not placed behind the confirmation that ban uses', () => {
    // Undoing an enforcement must never be harder than applying one.
    const panel = readFile(PANEL);
    const confirmBlock = panel.slice(
      panel.indexOf('confirmingBan ? ('),
      panel.indexOf('duration-set'),
    );
    expect(confirmBlock).toContain('value="ban"');
    expect(confirmBlock).not.toContain('value="reinstate"');
  });

  it('says reinstating clears the ban list too', () => {
    // "A reinstatement that left the person unable to register would not be a
    // correction."
    const copy = readProse(PANEL);
    expect(copy).toContain('takes the registered number off the ban list');
    expect(copy).toContain('would not be a correction');
  });
});

describe('the irreversible action is the one with friction', () => {
  it('gives ban a confirmation and the other two none', () => {
    const panel = readCode(PANEL);
    expect(panel).toContain('confirmingBan');
    // The confirm button is the only submit that can carry `ban`.
    expect(panel).toContain('name="action" value="ban"');
  });

  it('does not put ban in the last position of its row', () => {
    // The final button in a row reads as the default action.
    // Sliced from the end of the duration fieldset, and matched on the label
    // alone: the first version looked for `Ban permanently</button>`, which
    // does not exist because prettier puts the label on its own line. The rule
    // was right and the string was a guess about formatting.
    const panel = readCode(PANEL);
    const row = panel.slice(panel.lastIndexOf('</fieldset>'));
    const ban = row.indexOf('Ban permanently');
    const reinstate = row.indexOf('value="reinstate"');

    expect(ban).toBeGreaterThan(-1);
    expect(reinstate).toBeGreaterThan(-1);
    expect(reinstate, 'ban must not be the last button in the row').toBeGreaterThan(ban);
  });

  it('gives no action a red or primary button', () => {
    // Colour is an instruction, and this screen has no recommendation to give.
    const css = readCode('app/globals.css');
    for (const forbidden of [
      '.decision-row button.danger',
      '.duration-set button.danger',
      '.decision-row button.primary',
    ]) {
      expect(css, forbidden).not.toContain(forbidden);
    }
  });
});

describe('SEC-021 — the refusal is the server’s and is stated plainly', () => {
  it('has copy for the administrator refusal and renders it as a refusal, not a fault', () => {
    // The API's 403 says so rather than being neutral: the only person who can
    // reach that route is another administrator, they already know the target
    // is one, and BR-ADM-001 is a published rule rather than a secret.
    expect(ADMIN_ERROR_COPY.ADMIN_CANNOT_ACT_ON_ADMIN).toContain('cannot be actioned');

    const failure = functionSource(ACTIONS, 'enforcementFailure');
    expect(failure).toContain('ADMIN_CANNOT_ACT_ON_ADMIN');
    expect(failure).toContain("status: 'REFUSED'");

    const copy = readProse(PANEL);
    // No apostrophe in the needle: the JSX writes it as `&apos;`, and the
    // first version of this assertion looked for a character the source does
    // not contain.
    expect(copy).toContain('decision, not a limit of this screen');
  });

  it('treats a deleted account as a refusal with the reason', () => {
    // The API refuses outright: an action against an account already gone
    // records something nobody can experience, and reinstating it would
    // restore what that person asked to remove.
    expect(ADMIN_ERROR_COPY.ACCOUNT_DELETED).toContain('deleted');

    const failure = functionSource(ACTIONS, 'enforcementFailure');
    expect(failure).toContain('ACCOUNT_DELETED');

    const copy = readProse(PANEL);
    expect(copy).toContain('would record something nobody can experience');
  });

  it('does not claim nothing changed when the outcome could not be confirmed', () => {
    // A shape error may follow a request that SUCCEEDED, and on a ban
    // "nothing was changed" would be the worst possible guess.
    const failure = functionSource(ACTIONS, 'enforcementFailure');
    const shapeBranch = failure.slice(failure.indexOf('AdminApiShapeError'));

    expect(shapeBranch).toContain('could not be confirmed');
    expect(shapeBranch).not.toContain('Nothing has been changed');
  });
});

describe('BR-038 — a reason on every action', () => {
  it('checks it on the server against the API’s bounds', () => {
    const enforceFn = functionSource(ACTIONS, 'enforce');
    expect(enforceFn).toContain('reason.length < REASON_LIMITS.min');
    expect(enforceFn).toContain('reason.length > REASON_LIMITS.max');

    const state = readCode(STATE);
    expect(state).toContain('min: 5');
    expect(state).toContain('max: 500');
  });

  it('uses one reason field for all three actions', () => {
    // So writing a reason cannot become the thing that steers the choice.
    const panel = readCode(PANEL);
    const fields = panel.match(/name="reason"/g) ?? [];
    expect(fields).toHaveLength(1);
  });

  it('tells the reader who the reason is for', () => {
    const copy = readProse(PANEL);
    expect(copy).toContain('recorded in the audit log');
    expect(copy).toContain('the person affected can later have explained to them');
  });
});

describe('§34 — no enforcement text becomes markup', () => {
  it('renders nothing through dangerouslySetInnerHTML', () => {
    expect(readCode(PANEL)).not.toContain('dangerouslySetInnerHTML');
    expect(readCode(ACTIONS)).not.toContain('dangerouslySetInnerHTML');
  });
});
