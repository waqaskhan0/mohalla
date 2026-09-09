/**
 * Administrator-facing copy for the API's error codes.
 *
 * WHY THE SERVER'S MESSAGE IS NOT RENDERED. `@mohalla/contracts` says it
 * plainly: the envelope's `message` is a "developer-facing English message. NOT
 * for display to users — clients render their own localized copy from `code`."
 * Stage 8 §40 says the same from the other direction: no raw JSON, no framework
 * internals, no storage paths in front of an administrator.
 *
 * The portal is English-only in V1 (ADR-002), so this is one map rather than a
 * resource bundle — but it is still a map, so the day a second language is
 * added there is one place to translate instead of a search for interpolated
 * server strings.
 *
 * EVERY MESSAGE HERE TELLS THE READER WHAT TO DO. "Request failed" is not a
 * state anybody can act on; "the case was already resolved" is.
 */
const COPY: Record<string, string> = {
  // Deliberately one message for wrong credentials AND for a locked account.
  // The API returns `FAILED` for both — `admin-auth.service.ts` logs
  // `ADMIN_LOGIN_BLOCKED_LOCKOUT` and then returns exactly the same status as a
  // wrong password. Telling the two apart here would leak whether an address
  // belongs to a real administrator, which is the enumeration the uniformity
  // exists to prevent.
  INVALID_CREDENTIALS: 'That email or password is not right.',

  AUTHENTICATION_REQUIRED: 'Your session has ended. Sign in again to continue.',

  // EDGE-024. Rendered as information, not a fault — see the queue detail
  // screen, where it becomes a panel naming who resolved the case and how.
  CASE_ALREADY_RESOLVED: 'Another administrator has already resolved this case.',

  // SEC-021 / BR-ADM-001. Reaching this means a request was made that the UI
  // does not offer, so the copy states the rule rather than apologising.
  ADMIN_CANNOT_ACT_ON_ADMIN:
    'Administrator accounts cannot be actioned through the portal. This is enforced by the server.',

  RESOURCE_UNAVAILABLE: 'This is no longer available.',

  VALIDATION_FAILED: 'Some of what was entered cannot be accepted. Check the fields marked below.',

  RATE_LIMITED: 'Too many requests. Wait a moment and try again.',

  NETWORK_UNAVAILABLE: 'Could not reach the API. Check that it is running, then try again.',

  PERMISSION_DENIED: 'This action is not available to your account.',
};

/**
 * Copy for a code, or a safe generic.
 *
 * THE FALLBACK NEVER INCLUDES THE SERVER'S TEXT. An unmapped code is a portal
 * gap, and pasting a developer message into the interface to cover it is how
 * SQL fragments and stack traces end up in front of moderators (§40). The
 * correlation id is what makes an unmapped case findable in the logs, and the
 * caller renders that separately.
 */
export function messageForCode(code: string): string {
  return COPY[code] ?? 'Something went wrong. Nothing was changed.';
}

/** Is this code one the portal has deliberate copy for? */
export function hasCopyFor(code: string): boolean {
  return code in COPY;
}

export const ADMIN_ERROR_COPY = COPY;
