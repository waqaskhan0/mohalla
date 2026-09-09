/**
 * The state of the enforcement panel.
 *
 * IN ITS OWN MODULE because `actions.ts` is a `'use server'` file, which may
 * export async functions and nothing else.
 */

/** ADMIN-FR-006: "24 hours, 7 days or 30 days". Not a free-form duration. */
export const DURATIONS = ['HOURS_24', 'DAYS_7', 'DAYS_30'] as const;
export type Duration = (typeof DURATIONS)[number];

export const DURATION_LABELS: Record<Duration, string> = {
  HOURS_24: '24 hours',
  DAYS_7: '7 days',
  DAYS_30: '30 days',
};

/** BR-038 - the API's own bounds, restated so the field can say them first. */
export const REASON_LIMITS = { min: 5, max: 500 } as const;

/** The three actions, and nothing else is accepted. */
export const ENFORCEMENTS = ['suspend', 'ban', 'reinstate'] as const;
export type Enforcement = (typeof ENFORCEMENTS)[number];

export type EnforcementState =
  | { status: 'IDLE' }
  /**
   * What the API says it did, rather than what the form believes it asked for.
   *
   * `sessionsRevoked` is here because BR-035 is otherwise invisible: "all
   * sessions are invalidated" is a claim, and the count is the evidence. An
   * administrator who suspends somebody and is told two sessions were signed
   * out knows the suspension took effect on a device somebody was holding.
   */
  | {
      status: 'APPLIED';
      action: Enforcement;
      kind: string;
      expiresAt: string | null;
      sessionsRevoked: number;
    }
  | { status: 'INVALID'; field: 'reason' | 'action' | 'duration'; message: string }
  | { status: 'REFUSED'; message: string; reference?: string }
  | { status: 'FAILED'; message: string; reference?: string };

export const IDLE_ENFORCEMENT: EnforcementState = { status: 'IDLE' };
