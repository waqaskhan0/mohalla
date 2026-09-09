'use server';

import { revalidatePath } from 'next/cache';
import { AdminApiError, AdminApiShapeError } from '../../../../lib/admin-api/client';
import { guardedRequest } from '../../../../lib/admin-api/guarded';
import { messageForCode } from '../../../../lib/admin-api/messages';
import { caseSchema, conversationExcerptSchema } from '../../../../lib/admin-api/schemas';
import {
  OUTCOMES,
  REASON_MAX,
  REASON_MIN,
  type ConversationState,
  type DecisionState,
  type Outcome,
} from './decision-state';

/**
 * The moderation decisions, and the one audited read.
 *
 * WHY THESE ARE SERVER ACTIONS AND NOT CLIENT FETCHES. The admin credential
 * lives in an httpOnly cookie and `lib/admin-api/client.ts` is `server-only`,
 * so a browser here has no way to call the API at all. That is the point: the
 * portal renders user-generated content and is the highest-value XSS target in
 * the product, and a token no script can read is worth more than any amount of
 * care about where it is kept.
 *
 * NO OUTCOME IS EVER INFERRED. `outcome` is matched against the three names and
 * anything else is refused — see `readOutcome`. A missing or mangled field must
 * not be able to fall through to a route, and of the three the one it must
 * never fall through to is delete.
 *
 * THE VERSION IS THE ONE THE ADMINISTRATOR WAS SHOWN. It rides in the form as a
 * hidden field and the API compares it under an optimistic lock (EDGE-024). It
 * is deliberately not re-read from the server here: re-reading would make the
 * check pass against whatever the case looks like NOW, which is precisely the
 * collision the lock exists to catch.
 */

const PATHS: Record<Outcome, string> = {
  restore: 'restore',
  delete: 'delete',
  'no-action': 'no-action',
};

export async function decideCase(_previous: DecisionState, form: FormData): Promise<DecisionState> {
  const caseId = String(form.get('caseId') ?? '');
  const outcome = readOutcome(form.get('outcome'));
  const reason = String(form.get('reason') ?? '').trim();
  const version = Number(form.get('version'));

  if (outcome === null) {
    // Reached only by a mangled submission — the form offers three buttons and
    // nothing else. Refused rather than defaulted, and said out loud.
    return {
      status: 'INVALID',
      field: 'outcome',
      message: 'Choose Restore, Delete or No action. Nothing has been changed.',
    };
  }

  // BR-038: "a reason is mandatory on every moderation and enforcement
  // action". Checked here as well as by the API so the reader gets a field
  // error instead of a round trip — and checked on the SERVER as well as in the
  // browser, because the browser check is a convenience and this one is the
  // rule.
  if (reason.length < REASON_MIN) {
    return {
      status: 'INVALID',
      field: 'reason',
      message: `A reason of at least ${REASON_MIN} characters is required. It is recorded in the audit log with this decision.`,
    };
  }
  if (reason.length > REASON_MAX) {
    return {
      status: 'INVALID',
      field: 'reason',
      message: `A reason can be at most ${REASON_MAX} characters. This one is ${reason.length}.`,
    };
  }

  if (!Number.isInteger(version) || version < 1) {
    return {
      status: 'FAILED',
      message:
        'This page did not carry the case version it was showing, so no decision was sent. Reload the case and try again.',
    };
  }

  try {
    await guardedRequest({
      path: `/admin/moderation/cases/${encodeURIComponent(caseId)}/${PATHS[outcome]}`,
      method: 'POST',
      body: { reason, version },
      schema: caseSchema,
    });
  } catch (error) {
    return decisionFailure(error);
  }

  // The detail page re-reads the case and renders the resolution it now
  // carries, so the administrator sees the recorded outcome rather than a
  // toast that vanishes. The queue changes too: this case has left it.
  revalidatePath(`/moderation/${caseId}`);
  revalidatePath('/moderation');
  revalidatePath('/dashboard');

  return { status: 'APPLIED', outcome };
}

/**
 * Read the reported conversation — MSG-FR-007 / PRIV-009.
 *
 * THIS FUNCTION IS THE AUDIT EVENT. The API writes
 * `ADMIN_READ_REPORTED_CONVERSATION` before it reads anything, naming the
 * administrator and the conversation, in the same transaction — so calling it
 * is not "loading data". It is an administrator looking at private messages,
 * and it happens only because somebody pressed the button that says so.
 *
 * PRIV-009's limits are the API's to enforce and are not re-implemented here:
 * only a conversation that was REPORTED can be read, and only that
 * conversation. The portal has no conversation search, no inbox view and no
 * route that accepts a conversation id — this is the single path, and it runs
 * through a case.
 */
export async function readReportedConversation(
  _previous: ConversationState,
  form: FormData,
): Promise<ConversationState> {
  const caseId = String(form.get('caseId') ?? '');

  try {
    const excerpt = await guardedRequest({
      path: `/admin/moderation/cases/${encodeURIComponent(caseId)}/conversation`,
      schema: conversationExcerptSchema,
    });
    return { status: 'READ', messages: excerpt.messages };
  } catch (error) {
    if (error instanceof AdminApiError) {
      return {
        status: 'FAILED',
        message: messageForCode(error.code),
        ...(error.correlationId ? { reference: error.correlationId } : {}),
      };
    }
    if (error instanceof AdminApiShapeError) {
      return {
        status: 'FAILED',
        message:
          'The API answered, but not in a shape this portal understands. Nothing is shown rather than shown wrongly.',
        ...(error.correlationId ? { reference: error.correlationId } : {}),
      };
    }
    throw error;
  }
}

// ------------------------------------------------------------------ internals

/** One of the three, or nothing. Never a default. */
function readOutcome(raw: FormDataEntryValue | null): Outcome | null {
  const value = typeof raw === 'string' ? raw : '';
  return (OUTCOMES as readonly string[]).includes(value) ? (value as Outcome) : null;
}

function decisionFailure(error: unknown): DecisionState {
  if (error instanceof AdminApiError) {
    if (error.code === 'CASE_ALREADY_RESOLVED') {
      // EDGE-024. The API puts the three facts in `details`, and they are
      // passed through as facts: the panel that renders this is titled as
      // information rather than as a failure, because from the reader's point
      // of view the case IS handled.
      return {
        status: 'ALREADY_RESOLVED',
        resolvedBy: error.details.resolvedBy ?? 'another administrator',
        outcome: error.details.outcome ?? 'unknown',
        version: error.details.version ?? 'unknown',
      };
    }

    // A rejected reason comes back as VALIDATION_FAILED with the rule in
    // `details.reason`. Shown on the field, because that is where it can be
    // fixed.
    if (error.code === 'VALIDATION_FAILED' && error.details.reason !== undefined) {
      return {
        status: 'INVALID',
        field: 'reason',
        message: 'The API would not accept that reason. Nothing has been changed.',
      };
    }

    return {
      status: 'FAILED',
      message: messageForCode(error.code),
      ...(error.correlationId ? { reference: error.correlationId } : {}),
    };
  }

  if (error instanceof AdminApiShapeError) {
    // The action may well have SUCCEEDED — the response simply did not parse.
    // So this one does not claim nothing changed, because that would be a
    // guess, and on a delete it would be the worst possible guess.
    return {
      status: 'FAILED',
      message:
        'The API answered in a shape this portal does not understand, so the outcome could not be confirmed. Reload the case to see its current state before deciding again.',
      ...(error.correlationId ? { reference: error.correlationId } : {}),
    };
  }

  throw error;
}
