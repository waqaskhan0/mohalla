import 'server-only';

import { CORRELATION_HEADER, type ApiErrorResponse } from '@mohalla/contracts';
import type { z } from 'zod';
import { adminEnv } from '../env';
import { readAdminToken } from '../admin-session';

/**
 * The portal's only route to the admin API, and it runs SERVER-SIDE ONLY.
 *
 * `lib/api-client.ts` is the Stage 5 foundation client: browser-bundled, and
 * able to call the health endpoints and nothing else. This is deliberately a
 * separate module rather than an extension of it, because the two have opposite
 * constraints — that one must be safe to ship to a browser, and this one must
 * never be, since it attaches an administrator credential.
 *
 * `import 'server-only'` enforces that at build time. A client component that
 * imports this fails the build; it does not quietly ship the credential path
 * into the bundle. SEC-025 says no admin credential in the client bundle, and
 * this is the mechanism rather than the promise.
 */

export class AdminApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly correlationId: string,
    /** `details[]` keyed by `path`, as the API's error envelope carries it. */
    readonly details: Record<string, string> = {},
  ) {
    super(message);
    this.name = 'AdminApiError';
  }
}

/**
 * A response that did not match the schema the portal was written against.
 *
 * SEPARATE FROM `AdminApiError` because it is a different kind of problem with
 * a different audience: the API answered successfully and the portal could not
 * read it. That is a contract drift for a developer to fix, not a condition an
 * administrator can act on — so it must not be rendered as though the moderation
 * tool were merely busy.
 *
 * It names the failing fields. Stage 7 spent hours on a blank screen that was
 * one missing field; a message that says which field is the difference.
 */
export class AdminApiShapeError extends Error {
  constructor(
    readonly path: string,
    readonly issues: string[],
    readonly correlationId: string,
  ) {
    super(
      `The API's response for ${path} did not match the shape this portal expects. ` +
        `The generated contract carries no schemas, so this is checked here instead ` +
        `(ADMIN-API-GAP-001). Fields: ${issues.join('; ')}`,
    );
    this.name = 'AdminApiShapeError';
  }
}

function newCorrelationId(): string {
  return globalThis.crypto.randomUUID();
}

interface AdminRequest<T> {
  path: string;
  schema: z.ZodType<T>;
  method?: 'GET' | 'POST' | 'PUT';
  body?: unknown;
  /** Send without the admin credential — login only. */
  anonymous?: boolean;
  timeoutMs?: number;
}

/**
 * Call the admin API and validate what comes back.
 *
 * NO RETRIES, ON PURPOSE. Every mutating admin route is a moderation or
 * enforcement action — restore, delete, suspend, ban, reinstate, verify,
 * publish. A transparent retry on a request whose response was lost would risk
 * applying a decision twice. §39 puts duplicate protection in the UI and
 * idempotency on the server; a client that quietly re-sent would defeat both.
 */
export async function adminRequest<T>({
  path,
  schema,
  method = 'GET',
  body,
  anonymous = false,
  timeoutMs = 10_000,
}: AdminRequest<T>): Promise<T> {
  const correlationId = newCorrelationId();

  const headers: Record<string, string> = {
    Accept: 'application/json',
    [CORRELATION_HEADER]: correlationId,
  };

  if (!anonymous) {
    const token = await readAdminToken();
    // A missing token is reported as the API's own unauthenticated code, so
    // callers have one condition to handle whether the cookie was absent or
    // the server rejected it.
    if (token === null) {
      throw new AdminApiError(401, 'AUTHENTICATION_REQUIRED', 'Sign in again.', correlationId);
    }
    headers.Authorization = `Bearer ${token}`;
  }

  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const url = `${adminEnv.NEXT_PUBLIC_API_BASE_URL}/${path.replace(/^\/+/, '')}`;

  // BUILT WITHOUT THE KEY rather than with `body: undefined`. The admin
  // tsconfig sets `exactOptionalPropertyTypes`, under which an explicit
  // `undefined` is not the same as an absent property — and it is right to:
  // `fetch` treats a present-but-undefined body differently from no body on
  // some runtimes, so the stricter type is describing a real distinction.
  const init: RequestInit = {
    method,
    headers,
    signal: AbortSignal.timeout(timeoutMs),
    // Never cached. A moderation queue served from a cache would show a case
    // another administrator has already resolved.
    cache: 'no-store',
  };
  if (body !== undefined) init.body = JSON.stringify(body);

  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    // A timeout and a refused connection are the same thing to a reader: the
    // tool cannot reach the service. Distinguishing them here would only
    // produce two messages for one situation.
    throw new AdminApiError(
      0,
      'NETWORK_UNAVAILABLE',
      'Could not reach the API.',
      correlationId,
      {},
    );
  }

  const text = await res.text();
  const serverCorrelation = res.headers.get(CORRELATION_HEADER) ?? correlationId;

  if (!res.ok) {
    let code = 'UNKNOWN';
    let message = `Request failed with status ${res.status}`;
    let details: Record<string, string> = {};

    try {
      const envelope = JSON.parse(text) as ApiErrorResponse;
      if (envelope.error) {
        code = envelope.error.code;
        message = envelope.error.message;
        for (const d of envelope.error.details ?? []) {
          if (d.path) details[d.path] = d.message;
        }
      }
    } catch {
      // Not the error envelope — a proxy answered instead. Keep the
      // status-based message rather than surfacing raw HTML into the portal.
      details = {};
    }

    throw new AdminApiError(res.status, code, message, serverCorrelation, details);
  }

  // A 204 carries no body, and `schema` for those callers is `z.void()`.
  const parsed = schema.safeParse(text === '' ? undefined : JSON.parse(text));

  if (!parsed.success) {
    throw new AdminApiShapeError(
      path,
      parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
      serverCorrelation,
    );
  }

  return parsed.data;
}
