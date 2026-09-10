'use client';

import { useActionState } from 'react';
import { signIn } from './actions';
import { EMPTY_LOGIN_STATE, type LoginFormState } from './form-state';

/**
 * The sign-in form (UX-ADM-001).
 *
 * A CLIENT COMPONENT ONLY FOR THE PENDING AND ERROR STATES. It never receives
 * the session token: `signIn` runs on the server, stores the credential in an
 * httpOnly cookie and returns nothing but a message. There is no code path
 * here that could put a credential in the browser's reach, which is what
 * SEC-025 asks for.
 *
 * ACCESSIBILITY, because §44 is not a checklist item on a login screen — it is
 * the screen an administrator using a screen reader has to get through before
 * anything else works:
 *
 *   - each input has a real `<label>`, associated by `htmlFor`/`id`
 *   - a field error is bound to its input by `aria-describedby` and marked
 *     `aria-invalid`, so the message is read out on focus rather than sitting
 *     visually nearby and silently
 *   - the form-level error is a `role="alert"`, so it is announced when it
 *     appears without moving focus away from what the reader was doing
 *   - the submit button reports its own busy state in text, not by colour
 */
export function LoginForm() {
  const [state, formAction, pending] = useActionState<LoginFormState, FormData>(
    signIn,
    EMPTY_LOGIN_STATE,
  );

  return (
    <form action={formAction} className="login-form" noValidate>
      {state.error !== null && (
        <div role="alert" className="notice notice-error">
          <p>{state.error}</p>
          {state.correlationId !== null && (
            <p className="mono muted small">Reference: {state.correlationId}</p>
          )}
        </div>
      )}

      <div className="field">
        <label htmlFor="admin-email">Email</label>
        <input
          id="admin-email"
          name="email"
          type="email"
          autoComplete="username"
          // `autoFocus` on the first field of the only control on the page is
          // the one place it does not steal focus from something a reader was
          // already doing.
          autoFocus
          aria-invalid={state.fields.email !== undefined}
          aria-describedby={state.fields.email !== undefined ? 'admin-email-error' : undefined}
          disabled={pending}
        />
        {state.fields.email !== undefined && (
          <p id="admin-email-error" className="field-error">
            {state.fields.email}
          </p>
        )}
      </div>

      <div className="field">
        <label htmlFor="admin-password">Password</label>
        <input
          id="admin-password"
          name="password"
          type="password"
          autoComplete="current-password"
          aria-invalid={state.fields.password !== undefined}
          aria-describedby={
            state.fields.password !== undefined ? 'admin-password-error' : undefined
          }
          disabled={pending}
        />
        {state.fields.password !== undefined && (
          <p id="admin-password-error" className="field-error">
            {state.fields.password}
          </p>
        )}
      </div>

      <button type="submit" disabled={pending} className="primary">
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
