import { AdminApiError, AdminApiShapeError } from './client';

/**
 * Narrow a caught value to an API failure, or let it keep going.
 *
 * ADMIN-RUNTIME-004 — A DEAD SESSION RENDERED THE SIGNED-IN CONSOLE, AGAIN.
 *
 * `guardedRequest` ends an expired session by calling `redirect()`, and
 * `redirect()` works by THROWING a `NEXT_REDIRECT` error for the framework to
 * catch. Every page wrapped its fetch in
 *
 *     try { page = await guardedRequest(...) }
 *     catch (error) { return <SomethingUnavailable error={error} /> }
 *
 * so the catch that was meant for a failing API swallowed the redirect as
 * well. Measured with an invalid session cookie: `/moderation` answered **200**
 * and drew the full authenticated shell — sidebar, "Sign out", and "Something
 * went wrong. Nothing was changed." Somebody whose session had ended was shown
 * a signed-in portal and a generic error, instead of being returned to the
 * sign-in screen.
 *
 * That is ADMIN-RUNTIME-001 arriving through a different door. The first time,
 * a page checked the cookie and never asked the API. This time the page asked,
 * the API said no, the redirect was raised — and the page caught it.
 *
 * SO THE RULE IS: A CATCH HANDLES WHAT IT RECOGNISES AND NOTHING ELSE. The two
 * error types below are the only ones a screen knows how to render. Anything
 * else — a redirect, a bug in this portal, a failure nobody has thought about
 * yet — is re-thrown, which is also the honest behaviour in general: an
 * unrecognised error rendered as "something went wrong" is a defect converted
 * into a screen.
 *
 * Deliberately not `error instanceof Error && error.digest?.startsWith(...)`.
 * Matching on the framework's redirect marker would work today and would put
 * this portal's session handling at the mercy of an internal string. Listing
 * what IS handled needs no such knowledge, and stays correct if Next changes
 * how a redirect travels.
 */
export function apiFailure(error: unknown): AdminApiError | AdminApiShapeError {
  if (error instanceof AdminApiError || error instanceof AdminApiShapeError) {
    return error;
  }

  throw error;
}
