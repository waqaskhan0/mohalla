'use server';

import { AdminApiError, AdminApiShapeError } from '../../../../lib/admin-api/client';
import { guardedRequest } from '../../../../lib/admin-api/guarded';
import { messageForCode } from '../../../../lib/admin-api/messages';
import { sensitiveUserViewSchema } from '../../../../lib/admin-api/schemas';
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
