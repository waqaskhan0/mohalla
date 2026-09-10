/**
 * The state of the verification control.
 *
 * IN ITS OWN MODULE because `actions.ts` is a `'use server'` file.
 */

/** BR-038 - the API's own bounds, restated so the field can say them first. */
export const REASON_LIMITS = { min: 5, max: 500 } as const;

export type VerificationState =
  | { status: 'IDLE' }
  /** `granted` is what was asked for; the page re-reads the account to confirm. */
  | { status: 'APPLIED'; granted: boolean }
  /**
   * ADMIN-FR-010's refusal, and it STATES THE RULE rather than being neutral.
   * The requirement is explicit that an administrator verifying an individual
   * "has made a category error, not a security probe" - so the answer names
   * the eligibility rule instead of a generic failure.
   */
  | { status: 'NOT_ELIGIBLE'; message: string }
  | { status: 'INVALID'; field: 'reason' | 'decision'; message: string }
  | { status: 'FAILED'; message: string; reference?: string };

export const IDLE_VERIFICATION: VerificationState = { status: 'IDLE' };
