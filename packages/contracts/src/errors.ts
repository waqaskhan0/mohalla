/**
 * The single error envelope every API failure uses.
 *
 * Stage 4 defines the error catalogue in
 * `docs/architecture/contracts/error-catalogue.md`. This is its wire shape.
 *
 * WHY ONE SHAPE, ENFORCED GLOBALLY
 *
 * The Android client and the admin console both need to distinguish "retry
 * this", "fix the input", and "you are not allowed" without string-matching
 * prose. A stable `code` gives them that. It also keeps localisation on the
 * client: the server sends a code, the client renders Urdu or English — which
 * is what LOCALE-FR-001 requires, since the server cannot know the reader's
 * language for every delivery path.
 */
export interface ApiErrorBody {
  /** Stable machine-readable code from the Stage 4 error catalogue. */
  code: string;
  /**
   * Developer-facing English message. NOT for display to users — clients render
   * their own localized copy from `code`.
   */
  message: string;
  /** Field-level detail for validation failures. Never contains secret values. */
  details?: ReadonlyArray<{ path: string; message: string }>;
  /** Echoed so a user-reported failure can be found in the logs. */
  correlationId: string;
  /** ISO-8601, server clock, UTC. */
  timestamp: string;
}

export interface ApiErrorResponse {
  error: ApiErrorBody;
}

/**
 * Foundation error codes.
 *
 * Deliberately minimal: these are the only failures the foundation can actually
 * produce. Product codes are added by the epic that can raise them, so this
 * enum never lists a code no code path emits.
 */
export const FoundationErrorCode = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  NOT_FOUND: 'NOT_FOUND',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  DEPENDENCY_UNAVAILABLE: 'DEPENDENCY_UNAVAILABLE',
} as const;

export type FoundationErrorCode = (typeof FoundationErrorCode)[keyof typeof FoundationErrorCode];

/**
 * Identity error codes (EPIC-02).
 *
 * Taken verbatim from `docs/architecture/contracts/error-catalogue.md`. Added
 * by the epic that can raise them, so this enum never lists a code no path
 * emits.
 *
 * NOTE WHAT IS ABSENT. There is no `ACCOUNT_NOT_FOUND`, no `ALREADY_REGISTERED`
 * and no `ACCOUNT_BANNED`. The catalogue is explicit that a wrong password, an
 * unknown number and a banned account all return the SAME
 * `INVALID_CREDENTIALS` (SEC-006). Adding a more specific code here would be
 * enough to undo that on its own - the code IS the disclosure.
 */
export const IdentityErrorCode = {
  /** 401 - missing, invalid, expired or revoked session. */
  AUTHENTICATION_REQUIRED: 'AUTHENTICATION_REQUIRED',
  /** 401 - wrong password, unknown number, or banned. All three. */
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  /** 403 - authenticated, but not permitted to do this. */
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  /** 403 - a suspended account attempted a write (BR-034). */
  ACCOUNT_SUSPENDED: 'ACCOUNT_SUSPENDED',
  /** 422 - below the minimum age (BR-002). */
  AGE_BELOW_MINIMUM: 'AGE_BELOW_MINIMUM',
  /** 429 - a rate limit or lockout is in force (SEC-007). */
  RATE_LIMITED: 'RATE_LIMITED',
} as const;

export type IdentityErrorCode = (typeof IdentityErrorCode)[keyof typeof IdentityErrorCode];
