'use server';

import { revalidatePath } from 'next/cache';
import { AdminApiError, AdminApiShapeError } from '../../../../lib/admin-api/client';
import { guardedRequest } from '../../../../lib/admin-api/guarded';
import { messageForCode } from '../../../../lib/admin-api/messages';
import {
  enforcementResultSchema,
  sensitiveUserViewSchema,
} from '../../../../lib/admin-api/schemas';
import {
  DURATIONS,
  ENFORCEMENTS,
  REASON_LIMITS,
  type Duration,
  type Enforcement,
  type EnforcementState,
} from './enforcement-state';
import type { SensitiveState } from './sensitive-state';

/**
 * Reveal an account's identifiers — PRIV-008, SEC-022, ADMIN-FR-005.
 *
 * THIS FUNCTION IS THE AUDIT EVENT. ADMIN-FR-005's acceptance criterion is
 * exactly that: "GIVEN an administrator views a user's phone number, WHEN the
 * audit log is inspected, THEN an entry records that access." The API writes
 * the entry BEFORE the read and inside the same transaction, so a read that
 * happened cannot lack a record — and it names the fields rather than their
 * values, because an audit log holding the number to prove somebody looked at
 * the number would be a second, worse copy of it.
 *
 * WHICH MEANS CALLING THIS IS NOT "LOADING DATA". It is an administrator
 * looking at somebody's phone number and date of birth, and it happens only
 * because they pressed the button that says so. Nothing on the account page
 * calls it while rendering.
 *
 * THERE IS NO OTHER ROUTE TO THESE FIELDS. The account view carries no
 * identifier at all, so this is the single path, and it is audited.
 */
export async function revealIdentifiers(
  _previous: SensitiveState,
  form: FormData,
): Promise<SensitiveState> {
  const userId = String(form.get('userId') ?? '');

  try {
    const view = await guardedRequest({
      path: `/admin/users/${encodeURIComponent(userId)}/sensitive`,
      schema: sensitiveUserViewSchema,
    });
    return { status: 'REVEALED', view };
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

/**
 * Suspend, ban or reinstate — ADMIN-FR-006/007/008, BR-038.
 *
 * NO ACTION IS EVER INFERRED. `action` is matched against the three names and
 * anything else is refused; a suspension additionally requires one of the three
 * approved durations. A mangled submission must not be able to fall through to
 * a route, and of these three the one it must never fall through to is ban.
 *
 * THE REASON IS MANDATORY (BR-038) and one field serves all three, so writing
 * a reason cannot become the thing that steers the choice.
 *
 * WHAT THIS FUNCTION DOES NOT DECIDE. Whether the target is an administrator,
 * whether the account is deleted, and whether the reason passes in the end —
 * the API decides all three, and SEC-021 requires the prohibition to hold
 * "regardless of interface state". The checks here exist so a reader gets a
 * field error instead of a round trip. They are a convenience; the server is
 * the rule.
 */
export async function enforce(
  _previous: EnforcementState,
  form: FormData,
): Promise<EnforcementState> {
  const userId = String(form.get('userId') ?? '');
  const action = readEnforcement(form.get('action'));
  const reason = String(form.get('reason') ?? '').trim();

  if (action === null) {
    return {
      status: 'INVALID',
      field: 'action',
      message: 'Choose suspend, ban or reinstate. Nothing has been changed.',
    };
  }

  if (reason.length < REASON_LIMITS.min) {
    return {
      status: 'INVALID',
      field: 'reason',
      message: `A reason of at least ${REASON_LIMITS.min} characters is required. It is recorded in the audit log with this action.`,
    };
  }
  if (reason.length > REASON_LIMITS.max) {
    return {
      status: 'INVALID',
      field: 'reason',
      message: `A reason can be at most ${REASON_LIMITS.max} characters. This one is ${reason.length}.`,
    };
  }

  let duration: Duration | null = null;
  if (action === 'suspend') {
    duration = readDuration(form.get('duration'));
    if (duration === null) {
      return {
        status: 'INVALID',
        field: 'duration',
        message: 'Choose 24 hours, 7 days or 30 days. Nothing has been changed.',
      };
    }
  }

  try {
    const result = await guardedRequest({
      path: `/admin/users/${encodeURIComponent(userId)}/${action}`,
      method: 'POST',
      body: duration === null ? { reason } : { reason, duration },
      schema: enforcementResultSchema,
    });

    // The account page re-reads the account, so the state shown afterwards is
    // the server's rather than what this form believes it asked for.
    revalidatePath(`/users/${userId}`);
    revalidatePath('/dashboard');

    return {
      status: 'APPLIED',
      action,
      kind: result.kind,
      expiresAt: result.expiresAt,
      sessionsRevoked: result.sessionsRevoked,
    };
  } catch (error) {
    return enforcementFailure(error);
  }
}

/** One of the three, or nothing. Never a default. */
function readEnforcement(raw: FormDataEntryValue | null): Enforcement | null {
  const value = typeof raw === 'string' ? raw : '';
  return (ENFORCEMENTS as readonly string[]).includes(value) ? (value as Enforcement) : null;
}

/** One of the three approved durations, or nothing. */
function readDuration(raw: FormDataEntryValue | null): Duration | null {
  const value = typeof raw === 'string' ? raw : '';
  return (DURATIONS as readonly string[]).includes(value) ? (value as Duration) : null;
}

function enforcementFailure(error: unknown): EnforcementState {
  if (error instanceof AdminApiError) {
    // SEC-021 / BR-ADM-001, and the API's 403 SAYS SO rather than being
    // neutral: the only person who can reach that route is another
    // administrator, they already know the target is one, and the rule is
    // published. REFUSED rather than FAILED, because nothing went wrong — the
    // answer is no.
    if (error.code === 'ADMIN_CANNOT_ACT_ON_ADMIN' || error.code === 'ACCOUNT_DELETED') {
      return {
        status: 'REFUSED',
        message: messageForCode(error.code),
        ...(error.correlationId ? { reference: error.correlationId } : {}),
      };
    }

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
    // The action may well have SUCCEEDED and only the response failed to
    // parse, so this does not claim nothing changed — on a ban that would be
    // the worst possible guess.
    return {
      status: 'FAILED',
      message:
        'The API answered in a shape this portal does not understand, so the outcome could not be confirmed. Reload the account to see its current state before acting again.',
      ...(error.correlationId ? { reference: error.correlationId } : {}),
    };
  }

  throw error;
}
