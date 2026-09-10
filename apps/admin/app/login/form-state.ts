/**
 * The shape the sign-in form renders from.
 *
 * IN ITS OWN MODULE, and the reason is a build rule rather than taste: a
 * `'use server'` file may export **async functions only**. Keeping the type and
 * the initial value in `actions.ts` failed the build with "A 'use server' file
 * can only export async functions, found object" — the constant was the object.
 *
 * Splitting them is also the right shape independently: the client component
 * needs the type and the initial state, and it has no business importing the
 * module that talks to the API.
 */
export interface LoginFormState {
  /** Administrator-facing message, or `null` before the first attempt. */
  error: string | null;
  /** Shown beside the error so an unexplained failure is findable in the logs. */
  correlationId: string | null;
  /** Field-level messages, keyed by field name, for accessible validation. */
  fields: Record<string, string>;
}

export const EMPTY_LOGIN_STATE: LoginFormState = {
  error: null,
  correlationId: null,
  fields: {},
};
