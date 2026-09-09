'use server';

import { revalidatePath } from 'next/cache';
import { AdminApiError, AdminApiShapeError } from '../../../lib/admin-api/client';
import { guardedRequest } from '../../../lib/admin-api/guarded';
import { messageForCode } from '../../../lib/admin-api/messages';
import { noContentSchema } from '../../../lib/admin-api/schemas';
import { REASON_LIMITS, type VerificationState } from './verification-state';

/**
 * Grant or revoke the organization badge — ADMIN-FR-010.
 *
 * THE DECISION IS READ FROM A FIXED PAIR, never inferred. `grant` and `revoke`
 * are the only accepted values; anything else is refused rather than defaulted,
 * because a mangled submission that fell through to `granted: true` would put a
 * verification badge on an account nobody approved — and the badge is a
 * statement to every reader that the platform vouches for this organization.
 *
 * THE ELIGIBILITY RULE IS THE SERVER'S. `canHoldVerifiedBadge` runs in the API
 * and only on the GRANT path — revoking is allowed whatever the account type,
 * which is correct: if a badge exists on an account that should not hold one,
 * the way to fix that must not itself be blocked by the eligibility check.
 *
 * A 204 MEANS THERE IS NOTHING TO READ BACK, so success is confirmed by
 * re-reading the account rather than by the absence of an error. See the note
 * on `noContentSchema`.
 */
export async function setVerification(
  _previous: VerificationState,
  form: FormData,
): Promise<VerificationState> {
  const userId = String(form.get('userId') ?? '');
  const decision = String(form.get('decision') ?? '');
  const reason = String(form.get('reason') ?? '').trim();

  if (decision !== 'grant' && decision !== 'revoke') {
    return {
      status: 'INVALID',
      field: 'decision',
      message: 'Choose grant or revoke. Nothing has been changed.',
    };
  }

  if (reason.length < REASON_LIMITS.min) {
    return {
      status: 'INVALID',
      field: 'reason',
      message: `A reason of at least ${REASON_LIMITS.min} characters is required. It is recorded in the audit log with this decision.`,
    };
  }
  if (reason.length > REASON_LIMITS.max) {
    return {
      status: 'INVALID',
      field: 'reason',
      message: `A reason can be at most ${REASON_LIMITS.max} characters. This one is ${reason.length}.`,
    };
  }

  const granted = decision === 'grant';

  try {
    await guardedRequest({
      path: `/admin/users/${encodeURIComponent(userId)}/verification`,
      method: 'PUT',
      body: { granted, reason },
      schema: noContentSchema,
    });
  } catch (error) {
    return verificationFailure(error);
  }

  // The panel re-reads the account, so what it shows afterwards is the badge
  // the server holds rather than the one this form asked for.
  revalidatePath('/verification');
  revalidatePath(`/users/${userId}`);

  return { status: 'APPLIED', granted };
}

function verificationFailure(error: unknown): VerificationState {
  if (error instanceof AdminApiError) {
    // ADMIN-FR-010: the refusal STATES the rule. An administrator verifying an
    // individual has made a category error, not probed a boundary, and a
    // neutral "that did not work" would leave them retrying.
    if (error.code === 'NOT_ELIGIBLE_FOR_VERIFICATION') {
      return { status: 'NOT_ELIGIBLE', message: messageForCode(error.code) };
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
    // A 204 has no body to mis-shape, so reaching here means something
    // unexpected answered. The badge state is not claimed either way.
    return {
      status: 'FAILED',
      message:
        'The API answered unexpectedly, so it is not certain whether the badge changed. Reload the account before deciding again.',
      ...(error.correlationId ? { reference: error.correlationId } : {}),
    };
  }

  throw error;
}
