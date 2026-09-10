import { describe, expect, it } from 'vitest';
import {
  functionSource,
  readCode,
  readFile,
  readLogic,
  readProse,
} from '../../../../lib/test-support/read-source';
import { formatExpiry } from '../../../../lib/format-age';
import {
  enforcementKindLabel,
  moderationStateLabel,
  targetTypeLabel,
} from '../../../../lib/wire-labels';

/**
 * UX-ADM-004 — the decision workspace.
 *
 * The rules here are the ones that are load-bearing for safety rather than for
 * appearance: that no outcome is ever inferred, that restore and delete are
 * peers, that private messages are not read without an audit entry, and that
 * another administrator's free text never becomes markup.
 */

const PAGE = 'app/(portal)/moderation/[caseId]/page.tsx';
const ACTIONS = 'app/(portal)/moderation/[caseId]/actions.ts';
const PANEL = 'app/(portal)/moderation/[caseId]/decision-panel.tsx';
const CONVERSATION = 'app/(portal)/moderation/[caseId]/conversation-panel.tsx';

describe('§43 — restore and delete are peers', () => {
  it('gives all three outcomes one shared button selector and no primary', () => {
    // §43: "same visual hierarchy, same weight... The UI must not
    // psychologically bias administrators toward deletion." RSK-010 is the
    // reason: coordinated reporting is used to silence legitimate criticism.
    // `readCode`, not `readFile`: the stylesheet's own comment says "there is
    // deliberately no .decision-row button.danger rule to reach for", and the
    // first version of this test matched that sentence and failed. The rule
    // was right and its input was the prose.
    const css = readCode('app/globals.css');

    expect(css).toContain('.decision-row button');
    // No per-outcome styling hook exists to reach for. If one is ever added,
    // this is the test that should stop it.
    for (const forbidden of [
      '.decision-row button.danger',
      '.decision-row button.primary',
      '.decision-row button.destructive',
      '.decision-row .delete',
    ]) {
      expect(css, `${forbidden} would break the peer rule`).not.toContain(forbidden);
    }
  });

  it('preselects nothing and autofocuses nothing', () => {
    // A moderator pressing Enter out of habit must submit nothing at all.
    const code = readCode(PANEL);

    expect(code).not.toContain('autoFocus');
    expect(code).not.toContain('defaultChecked');
    expect(code).not.toContain('defaultValue');
  });

  it('does not put delete in the last position of the button row', () => {
    // The final button in a row reads as the default action.
    const code = readCode(PANEL);
    const restore = code.indexOf('value="restore"');
    const remove = code.indexOf('value="delete"');
    const none = code.indexOf('value="no-action"');

    expect(restore).toBeGreaterThan(-1);
    expect(remove).toBeGreaterThan(-1);
    expect(none).toBeGreaterThan(-1);
    expect(none, 'delete must not be the last of the three').toBeGreaterThan(remove);
  });

  it('describes restoring at no less length than deleting', () => {
    // A one-line restore beside a paragraph on deletion is a thumb on the
    // scale even when both buttons look identical.
    const source = readFile(PAGE.replace('page.tsx', 'decision-panel.tsx'));
    const restoreNote = source.slice(source.indexOf('<dt>Restore content</dt>'));
    const deleteNote = source.slice(source.indexOf('<dt>Delete content</dt>'));
    const restoreLen = restoreNote.slice(0, restoreNote.indexOf('</dd>')).length;
    const deleteLen = deleteNote.slice(0, deleteNote.indexOf('</dd>')).length;

    expect(restoreLen).toBeGreaterThanOrEqual(deleteLen * 0.75);
  });
});

describe('no outcome is ever inferred', () => {
  it('matches the outcome against a fixed list and refuses anything else', () => {
    const source = functionSource(ACTIONS, 'readOutcome');

    expect(source).toContain('OUTCOMES');
    expect(source).toContain('includes(value)');
    // The refusal path returns null rather than falling through to a route,
    // and of the three the one it must never fall through to is delete.
    expect(source).toContain(': null');
    expect(source).not.toContain("'delete'");
  });

  it('sends no request at all when the outcome is unrecognised', () => {
    const decide = functionSource(ACTIONS, 'decideCase');
    const refusal = decide.slice(decide.indexOf('outcome === null'));
    const guardBlock = refusal.slice(0, refusal.indexOf('};') + 2);

    expect(guardBlock).toContain("status: 'INVALID'");
    expect(guardBlock).not.toContain('guardedRequest');
  });
});

describe('EDGE-024 — the version the administrator was shown', () => {
  it('carries the version in the form rather than re-reading it', () => {
    const panel = readFile(PANEL);
    expect(panel).toContain('name="version"');

    // The action must take the version from the submission. Re-reading the
    // case here would make the optimistic lock compare the case against
    // itself, which is exactly the collision it exists to catch.
    const decide = functionSource(ACTIONS, 'decideCase');
    expect(decide).toContain("form.get('version')");
    expect(decide).not.toContain('caseDetailSchema');
  });

  it('renders a conflict as who resolved it and how, not as an error', () => {
    // "the second administrator is told the item was already resolved, BY WHOM
    // AND HOW - not shown a generic error".
    const failure = functionSource(ACTIONS, 'decisionFailure');
    expect(failure).toContain('CASE_ALREADY_RESOLVED');
    expect(failure).toContain('details.resolvedBy');
    expect(failure).toContain('details.outcome');

    const panel = readFile(PANEL);
    expect(panel).toContain('This case was already resolved');
    expect(panel).toContain('Resolved by');
    // Not styled or announced as a failure: from this reader's point of view
    // the case IS handled.
    const block = panel.slice(panel.indexOf("state.status === 'ALREADY_RESOLVED'"));
    const panelBlock = block.slice(0, block.indexOf('</div>'));
    expect(panelBlock).toContain('notice-info');
    expect(panelBlock).not.toContain('notice-error');
    expect(panelBlock).not.toContain('role="alert"');
  });
});

describe('PRIV-009 — a private conversation is not read without an audit entry', () => {
  it('does not fetch the conversation while the page renders', () => {
    // Requesting the excerpt WRITES `ADMIN_READ_REPORTED_CONVERSATION` before
    // the API reads a single message. A page that loaded it on render would
    // record a look at somebody's private messages every time a case was
    // opened for any reason at all.
    const code = readCode(PAGE);

    // Counted rather than string-matched. Looking for '/conversation' matched
    // the IMPORT of './conversation-panel' — a rule about an API path applied
    // to a module path. The real invariant is that this page makes exactly one
    // request, and it is the case itself.
    const calls = code.match(/guardedRequest\(/g) ?? [];
    expect(calls).toHaveLength(1);
    expect(code).toContain('/admin/moderation/cases/${encodeURIComponent(caseId)}');

    expect(code).not.toContain('conversationExcerptSchema');
    expect(code).not.toContain('readReportedConversation(');
  });

  it('starts closed, and the read happens in a form submission', () => {
    const state = readCode('app/(portal)/moderation/[caseId]/decision-state.ts');
    expect(state).toContain("status: 'NOT_REQUESTED'");

    const panel = readCode(CONVERSATION);
    // `useActionState`, so the excerpt arrives only as the result of a submit.
    expect(panel).toContain('useActionState(readReportedConversation');
    expect(panel).toContain('<form action={submit}>');
    // And no effect that would fire it on mount.
    expect(panel).not.toContain('useEffect');
  });

  it('says what pressing the button will record, before it is pressed', () => {
    const panel = readFile(CONVERSATION);
    expect(panel).toContain('records an entry in the audit log');
    expect(panel).toContain('cannot be edited or removed');
  });

  it('offers no way to reach a conversation other than through a case', () => {
    // §21 forbids conversation search, arbitrary DM browsing, inbox viewing
    // and any "view all messages" surface. The portal's only route to a
    // message takes a CASE id, which is the API's proof that a report exists.
    const panel = readLogic(CONVERSATION);
    expect(panel).toContain('name="caseId"');
    expect(panel).not.toContain('conversationId=');

    const actions = readLogic(ACTIONS);
    expect(actions).toContain('/conversation');
    expect(actions).toContain('cases/${encodeURIComponent(caseId)}/conversation');
  });
});

describe('§34 — administrator free text is never markup', () => {
  it('uses no dangerouslySetInnerHTML anywhere on this screen', () => {
    // `readCode`: two of these files carry a comment naming the thing they
    // must never do, and the first version of this test matched those
    // comments. §34 names message excerpts, report notes, reasons and
    // usernames — every one of which this screen renders.
    for (const file of [PAGE, PANEL, CONVERSATION]) {
      expect(readCode(file), file).not.toContain('dangerouslySetInnerHTML');
    }
  });
});

describe('the gaps are stated, not left blank', () => {
  it('names both missing pieces where the content would have been', () => {
    // A blank panel would read as "there are no reports", which is a
    // different and false statement — the same class of lie as
    // ADMIN-RUNTIME-003 on the queue.
    // `readProse`: prettier breaks this sentence across a line at whatever
    // column the print width lands on, so the source contains a newline in
    // the middle of a sentence the reader sees whole.
    const copy = readProse(PAGE);
    expect(copy).toContain('ADMIN-API-GAP-004');
    expect(copy).toContain('ADMIN-API-GAP-005');
    expect(copy).toContain('not a summary of an empty list');
  });

  it('distinguishes an empty history from an unknown author', () => {
    // The API skips the history lookup entirely when `targetOwnerId` is null,
    // so an empty list there is missing information rather than a clean
    // record — and only one of those supports leniency.
    const copy = readProse(PAGE);
    expect(copy).toContain('authorKnown');
    expect(copy).toContain('missing information, not a clean record');
    expect(copy).toContain('No prior enforcement action against this account');
  });
});

describe('formatExpiry states the tense', () => {
  const now = new Date('2026-09-09T12:00:00.000Z');

  it('reads a live suspension as time remaining', () => {
    // `formatAge` answers a FUTURE instant with "just now", which on the
    // expiry column would be a plain falsehood. That is why this exists.
    expect(formatExpiry('2026-09-16T12:00:00.000Z', now)).toBe('in 7d');
    expect(formatExpiry('2026-09-09T15:00:00.000Z', now)).toBe('in 3h');
  });

  it('reads a lifted suspension as past', () => {
    // EDGE-028: a suspension lifts automatically with no administrator
    // action, so "ended" is a state the history genuinely shows.
    expect(formatExpiry('2026-09-06T12:00:00.000Z', now)).toBe('ended 3d ago');
    expect(formatExpiry('2026-09-09T11:00:00.000Z', now)).toBe('ended 1h ago');
  });

  it('reports an unparseable instant rather than guessing', () => {
    expect(formatExpiry('not a date', now)).toBe('unknown');
    expect(formatExpiry('', now)).toBe('unknown');
  });
});

describe('wire labels never invent a value', () => {
  it('renders an unrecognised value as itself', () => {
    // The portal is a separate deployable. A case shown as a "post" because
    // the portal did not recognise "STORY" is worse than one shown as "STORY".
    expect(targetTypeLabel('STORY')).toBe('STORY');
    expect(moderationStateLabel('RESOLVED_SOMEHOW')).toBe('RESOLVED_SOMEHOW');
    expect(enforcementKindLabel('SHADOWBAN')).toBe('SHADOWBAN');
  });

  it('labels the values the API actually has', () => {
    expect(targetTypeLabel('POST')).toBe('post');
    expect(targetTypeLabel('CONVERSATION')).toBe('conversation');
    expect(moderationStateLabel('OPEN')).toContain('waiting for a decision');
    expect(moderationStateLabel('RESOLVED_DELETED')).toContain('permanently');
  });

  it('covers exactly the four enforcement kinds the API declares', () => {
    // The first draft of this map invented VERIFY_GRANT and VERIFY_REVOKE.
    // `EnforcementKind` is SUSPEND | BAN | REINSTATE | CONTENT_DELETED, and a
    // label map with entries the API cannot produce is dead code that reads
    // as a feature.
    for (const kind of ['SUSPEND', 'BAN', 'REINSTATE', 'CONTENT_DELETED']) {
      expect(enforcementKindLabel(kind), kind).not.toBe(kind);
    }
    for (const invented of ['VERIFY_GRANT', 'VERIFY_REVOKE', 'WARN', 'MUTE']) {
      expect(enforcementKindLabel(invented), invented).toBe(invented);
    }
  });
});

describe('BR-038 — the reason is mandatory on the server', () => {
  it('checks the length against the API’s own bounds before sending', () => {
    const decide = functionSource(ACTIONS, 'decideCase');
    expect(decide).toContain('reason.length < REASON_MIN');
    expect(decide).toContain('reason.length > REASON_MAX');

    const state = readCode('app/(portal)/moderation/[caseId]/decision-state.ts');
    expect(state).toContain('REASON_MIN = 5');
    expect(state).toContain('REASON_MAX = 500');
  });

  it('tells the reader the reason is recorded, on the field itself', () => {
    const panel = readFile(PANEL);
    expect(panel).toContain('stored in the audit log');
  });
});

describe('a resolved case offers no decision controls', () => {
  it('renders the resolution instead of the form', () => {
    const source = readFile(PAGE);
    expect(source).toContain('isOpen ? (');
    expect(source).toContain('<Resolution detail={detail} />');
  });

  it('says the audit record cannot be changed from the portal', () => {
    // §33: the audit log is read only. Said here because this is the screen
    // where somebody would look for a way to amend a decision.
    const resolution = functionSource(PAGE, 'Resolution');
    expect(resolution).toContain('cannot be edited or removed');
    // And hiding the controls is not the security boundary (§28).
    expect(readFile(PAGE)).toContain('hiding the controls is not the security boundary');
  });
});
