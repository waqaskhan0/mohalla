/**
 * Login failure lockout (SEC-007).
 *
 * `08-api-architecture.md` §281: 10 failures per 15 minutes, then a 30-minute
 * lockout — and §274: applied per account AND per source address.
 *
 * BOTH KEYS, because each alone is a hole:
 *
 *   account only — anyone who knows a number can fail ten logins against it
 *                  and lock its owner out for half an hour, on repeat. The
 *                  lockout becomes the attack.
 *   source only  — one machine sprays a single guess across ten thousand
 *                  accounts and never trips a counter.
 *
 * So a subject is locked if EITHER key is over its threshold. The source
 * threshold is higher because a shared mobile carrier NAT, a university, or an
 * office can legitimately put many people behind one address — and in Pakistan
 * carrier-grade NAT is the normal case, not the exception, so a tight
 * per-address limit would lock out real neighbourhoods.
 */

export const LOGIN_FAILURE_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
export const LOGIN_LOCKOUT_MS = 30 * 60 * 1000; // 30 minutes

/** Failures against ONE account before that account is locked. */
export const LOGIN_MAX_FAILURES_PER_ACCOUNT = 10;

/**
 * Failures from one source address before that address is locked.
 *
 * Deliberately generous: behind carrier-grade NAT this address is shared by
 * many unrelated people, and locking it out punishes all of them for one
 * attacker. It is a backstop against spraying, not the primary control.
 */
export const LOGIN_MAX_FAILURES_PER_SOURCE = 50;

export interface LoginFailureCounts {
  /** Failures for this account since its last SUCCESSFUL login, in-window. */
  account: number;
  /** Failures from this source address in-window. */
  source: number;
  /** When the most recent counted failure happened, for either key. */
  lastFailureAt: Date | null;
}

export type LoginLockReason = 'ACCOUNT' | 'SOURCE';

export interface LoginLockout {
  reason: LoginLockReason;
  until: Date;
}

/**
 * Is this attempt locked out right now?
 *
 * Returns the lockout rather than a boolean so the caller can audit WHICH
 * limit fired — the two mean very different things operationally. It is never
 * disclosed to the caller: the response stays the uniform failure, or the
 * lockout would confirm that an account exists.
 */
export function checkLoginLockout(
  counts: LoginFailureCounts,
  now: Date = new Date(),
): LoginLockout | null {
  if (counts.lastFailureAt === null) return null;

  const until = new Date(counts.lastFailureAt.getTime() + LOGIN_LOCKOUT_MS);
  if (until.getTime() <= now.getTime()) return null;

  // Account first: it is the specific signal, and the one an operator wants to
  // see named when a real person reports being locked out.
  if (counts.account >= LOGIN_MAX_FAILURES_PER_ACCOUNT) return { reason: 'ACCOUNT', until };
  if (counts.source >= LOGIN_MAX_FAILURES_PER_SOURCE) return { reason: 'SOURCE', until };
  return null;
}
