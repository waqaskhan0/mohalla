/**
 * The audit actions the API emits, grouped for a filter.
 *
 * WHY THE PORTAL CARRIES A LIST AT ALL. The API's `action` filter is an EXACT,
 * case-sensitive match — `action = $n` in the SQL. Measured against the running
 * log: `action=ADMIN_SUSPEND` returns 105 entries, `action=suspend` returns 0,
 * `action=SUSPEND` returns 0. So a free-text box on its own would turn every
 * typo and every guess at the naming convention into "there is no record of
 * this", which on an audit log is the worst available false statement.
 *
 * READ FROM THE API SOURCE, NOT INVENTED. Every literal below appears in
 * `apps/api/src` as an `action:` value, or is formed there by a template:
 * `ADMIN_${kind}` over `EnforcementKind` and `MODERATION_${state}` over the
 * resolution states. Cross-checked against the distinct values in the local
 * `audit_log` table.
 *
 * IT IS A SUGGESTION LIST, NOT A CONSTRAINT. The filter accepts any value, so
 * an action this portal has not heard of is still searchable — including the
 * infrastructure markers the local log carries (`foundation.test`,
 * `role.test`, `rehearsal.marker`), which are deliberately not listed because
 * they are not product actions. The screen says the list is the portal's.
 */

export interface AuditActionGroup {
  label: string;
  actions: readonly string[];
}

export const AUDIT_ACTION_GROUPS: readonly AuditActionGroup[] = [
  {
    // §6 of the admin design lists these as the recorded enforcement actions.
    label: 'Enforcement',
    actions: ['ADMIN_SUSPEND', 'ADMIN_BAN', 'ADMIN_REINSTATE', 'ADMIN_CONTENT_DELETED'],
  },
  {
    label: 'Moderation decisions',
    actions: [
      'MODERATION_RESOLVED_RESTORED',
      'MODERATION_RESOLVED_DELETED',
      'MODERATION_RESOLVED_NO_ACTION',
    ],
  },
  {
    /**
     * THE TWO ENTRIES THAT MAKE PRIV-008 AND PRIV-009 VERIFIABLE. "Viewing is
     * auditable, not only acting" is the sentence that turns those two rules
     * from aspirations into something an investigator can check, so they are
     * grouped together and named for what they are.
     */
    label: 'Administrator access to private data',
    actions: ['ADMIN_VIEWED_SENSITIVE_DATA', 'ADMIN_READ_REPORTED_CONVERSATION'],
  },
  {
    label: 'Verification',
    actions: ['ADMIN_GRANTED_VERIFICATION', 'ADMIN_REVOKED_VERIFICATION'],
  },
  {
    label: 'Announcements',
    actions: ['ADMIN_PUBLISHED_ANNOUNCEMENT', 'ADMIN_BROADCAST_ANNOUNCEMENT'],
  },
  {
    label: 'Administrator sessions',
    actions: [
      'ADMIN_LOGIN_SUCCEEDED',
      'ADMIN_LOGIN_FAILED',
      'ADMIN_LOGIN_BLOCKED_LOCKOUT',
      'ADMIN_LOGOUT',
    ],
  },
  {
    label: 'Refusals and automatic actions',
    actions: ['ADMIN_ON_ADMIN_ACTION_REFUSED', 'CONTENT_AUTO_HIDDEN'],
  },
  {
    label: 'Account lifecycle',
    actions: ['ACCOUNT_DELETION_REQUESTED', 'ACCOUNT_ERASED', 'ACCOUNT_RESTORED'],
  },
];

/** Every listed action, flattened. */
export const KNOWN_AUDIT_ACTIONS: readonly string[] = AUDIT_ACTION_GROUPS.flatMap(
  (group) => group.actions,
);

/**
 * An action in words.
 *
 * THE WIRE VALUE IS ALSO SHOWN, always. An audit log is read to answer a
 * question about what happened, and the answer is often quoted somewhere else —
 * a ticket, an email, a filter on this same screen. A friendly label alone
 * would make the entry harder to act on, so the label explains and the raw
 * value stays visible.
 *
 * AN UNRECOGNISED ACTION RETURNS NULL rather than a guess, and the caller shows
 * the wire value on its own. Inventing a description for an action the portal
 * does not know would be putting words into the record.
 */
const DESCRIPTIONS: Record<string, string> = {
  ADMIN_SUSPEND: 'Suspended an account',
  ADMIN_BAN: 'Banned an account',
  ADMIN_REINSTATE: 'Reinstated an account',
  ADMIN_CONTENT_DELETED: 'Deleted content',
  MODERATION_RESOLVED_RESTORED: 'Restored reported content',
  MODERATION_RESOLVED_DELETED: 'Deleted reported content permanently',
  MODERATION_RESOLVED_NO_ACTION: 'Closed a case with no action',
  ADMIN_VIEWED_SENSITIVE_DATA: 'Viewed an account’s phone number or date of birth',
  ADMIN_READ_REPORTED_CONVERSATION: 'Read a reported private conversation',
  ADMIN_GRANTED_VERIFICATION: 'Granted the verified badge',
  ADMIN_REVOKED_VERIFICATION: 'Revoked the verified badge',
  ADMIN_PUBLISHED_ANNOUNCEMENT: 'Published an announcement',
  ADMIN_BROADCAST_ANNOUNCEMENT: 'Published an announcement and sent it as a push',
  ADMIN_LOGIN_SUCCEEDED: 'Signed in',
  ADMIN_LOGIN_FAILED: 'Failed a sign-in attempt',
  ADMIN_LOGIN_BLOCKED_LOCKOUT: 'Sign-in blocked by lockout',
  ADMIN_LOGOUT: 'Signed out',
  ADMIN_ON_ADMIN_ACTION_REFUSED: 'Attempted an action against another administrator, refused',
  CONTENT_AUTO_HIDDEN: 'Content hidden automatically when reports crossed the threshold',
  ACCOUNT_DELETION_REQUESTED: 'A user asked for their account to be deleted',
  ACCOUNT_ERASED: 'An account was erased',
  ACCOUNT_RESTORED: 'An account was restored within the grace period',
};

export function auditActionDescription(action: string): string | null {
  return DESCRIPTIONS[action] ?? null;
}
