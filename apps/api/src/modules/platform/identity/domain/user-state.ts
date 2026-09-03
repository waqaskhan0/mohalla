/**
 * Account state machine and what each state permits.
 *
 * Centralised because the same question - "may this account act?" - is asked by
 * every module, and a per-module answer is how a suspended user ends up able to
 * comment. The guard reads THIS.
 */
export type UserState =
  'UNVERIFIED' | 'ACTIVE' | 'SUSPENDED' | 'BANNED' | 'PENDING_DELETION' | 'DELETED';

/** Outcome of authenticating: distinct from "may write". */
export type AuthOutcome =
  | { kind: 'ALLOW' }
  /** BR-034: a suspended user signs in and can READ, but not write. */
  | { kind: 'READ_ONLY'; until: Date | null }
  /** A pending-deletion user signs in ONLY to restore the account. */
  | { kind: 'RESTORE_ONLY' }
  /** Must be reported with the SAME neutral response as a wrong password. */
  | { kind: 'DENY_NEUTRAL' }
  /** Registration incomplete - the client resumes OTP verification. */
  | { kind: 'VERIFY_REQUIRED' };

export function authOutcomeFor(state: UserState, suspendedUntil: Date | null): AuthOutcome {
  switch (state) {
    case 'ACTIVE':
      return { kind: 'ALLOW' };
    case 'UNVERIFIED':
      return { kind: 'VERIFY_REQUIRED' };
    case 'SUSPENDED':
      return { kind: 'READ_ONLY', until: suspendedUntil };
    case 'PENDING_DELETION':
      return { kind: 'RESTORE_ONLY' };
    case 'BANNED':
    case 'DELETED':
      // SEC-006: a banned or deleted account must be indistinguishable from a
      // wrong password, or the endpoint becomes an account-status oracle.
      return { kind: 'DENY_NEUTRAL' };
  }
}

/** May this account create or modify content? */
export function canWrite(state: UserState): boolean {
  return state === 'ACTIVE';
}

/** May this account's content be shown to others? */
export function isPubliclyVisible(state: UserState): boolean {
  // A suspended profile stays visible (SRS); banned/deleted do not.
  return state === 'ACTIVE' || state === 'SUSPENDED';
}

/** Legal state transitions. Anything absent here is rejected. */
const TRANSITIONS: Record<UserState, readonly UserState[]> = {
  UNVERIFIED: ['ACTIVE', 'DELETED'],
  ACTIVE: ['SUSPENDED', 'BANNED', 'PENDING_DELETION'],
  SUSPENDED: ['ACTIVE', 'BANNED', 'PENDING_DELETION'],
  PENDING_DELETION: ['ACTIVE', 'DELETED', 'BANNED'],
  BANNED: ['ACTIVE'],
  DELETED: [],
};

export function canTransition(from: UserState, to: UserState): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Revoking sessions is mandatory on these transitions (SEC-005). */
export function transitionRevokesSessions(to: UserState): boolean {
  return to === 'SUSPENDED' || to === 'BANNED' || to === 'PENDING_DELETION' || to === 'DELETED';
}
