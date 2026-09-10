import type { SensitiveUserView } from '../../../../lib/admin-api/schemas';

/**
 * The state of the identifier panel.
 *
 * IN ITS OWN MODULE because `actions.ts` is a `'use server'` file, and such a
 * file can only export async functions.
 */
export type SensitiveState =
  /**
   * THE STARTING STATE, AND IT IS NOT "LOADING".
   *
   * Requesting the identifiers WRITES an audit entry naming this
   * administrator and the fields read (PRIV-008, SEC-022). So they are not
   * fetched until somebody asks: a page that loaded them on render would
   * record a look at somebody's phone number every time the account was
   * opened for any reason at all, and §24 says it plainly — "do not prefetch
   * sensitive fields unnecessarily".
   */
  | { status: 'NOT_REQUESTED' }
  | { status: 'REVEALED'; view: SensitiveUserView }
  | { status: 'FAILED'; message: string; reference?: string };

export const HIDDEN_IDENTIFIERS: SensitiveState = { status: 'NOT_REQUESTED' };
