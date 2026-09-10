import { NextResponse, type NextRequest } from 'next/server';

/**
 * The portal's Content-Security-Policy.
 *
 * WHY THIS IS THE ONE PIECE OF HARDENING THAT MATTERS MOST HERE. Two approved
 * facts set the threat model: the portal "renders user-generated content and is
 * the highest-value XSS target" in the product, and every post, bio, report
 * note, display name and conversation excerpt must be assumed hostile. React
 * escapes by default and §34 forbids `dangerouslySetInnerHTML`, but those are
 * both properties of code somebody could change. A CSP is the layer that holds
 * when they do.
 *
 * A NONCE, NOT `unsafe-inline`. A policy with `'unsafe-inline'` in `script-src`
 * would permit exactly the attack it is supposed to stop, so the nonce is
 * generated per request here and Next attaches it to its own inline bootstrap
 * scripts — which is why this has to be middleware rather than a static header:
 * a nonce that is not per-request is not a nonce.
 *
 * THE FILE IS `proxy.ts`, NOT `middleware.ts`. Next 16 renamed the convention
 * and the build warns on the old name — "The 'middleware' file convention is
 * deprecated." A deprecation warning in a build is the kind of thing that
 * becomes a break at the next upgrade, and this file is load-bearing for the
 * portal's XSS posture, so it is not somewhere to discover that later.
 *
 * `connect-src 'self'` IS TIGHT ON PURPOSE, and the architecture is what makes
 * it possible. Every admin API call runs server-side with the credential
 * attached from an httpOnly cookie; no rendered client component fetches
 * anything at all. So the browser has no legitimate reason to open a connection
 * to any other origin — which means that if script did somehow execute, it could
 * not send what it read anywhere.
 *
 * (`components/health-panel.tsx` is a Stage 5 leftover that would call the API
 * from the browser, and it is rendered on no page. If it is ever mounted this
 * policy will break it, and that is the correct outcome: an admin screen calling
 * the API from the browser is a decision to make deliberately, not by import.)
 *
 * `frame-ancestors 'none'` because an administration console must never be
 * framed. `form-action 'self'` because every form here is a server action
 * posting to its own origin. `base-uri 'none'` so injected markup cannot
 * relocate every relative URL on the page.
 *
 * `no-referrer` IS A PRIVACY DECISION, NOT A HABIT. Admin URLs carry case ids
 * and account ids — `/moderation/<caseId>`, `/users/<userId>` — and a referrer
 * header would hand those to any origin the browser was sent to next.
 *
 * WHAT DEVELOPMENT LOOSENS, AND ONLY THAT. `next dev` evaluates code for hot
 * reload and opens a websocket for it, so development adds `'unsafe-eval'` to
 * `script-src` and `ws:` to `connect-src`. Every other directive is identical
 * in both modes, which is deliberate: it keeps the difference between what is
 * tested locally and what ships to one line each.
 */
function policy(nonce: string, isDev: boolean): string {
  const scriptSrc = [
    "'self'",
    `'nonce-${nonce}'`,
    // Lets Next's own bootstrap load the chunks it needs without naming each
    // one, while still refusing anything an attacker injects.
    "'strict-dynamic'",
    ...(isDev ? ["'unsafe-eval'"] : []),
  ].join(' ');

  const connectSrc = ["'self'", ...(isDev ? ['ws:', 'wss:'] : [])].join(' ');

  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    // Next injects the stylesheet inline in development and as a link in
    // production; `unsafe-inline` for STYLE does not enable script execution,
    // and the alternative is a nonce on every style Next emits.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src ${connectSrc}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "frame-src 'none'",
    "worker-src 'self'",
    "manifest-src 'self'",
    // Harmless over plain HTTP and correct everywhere the portal is actually
    // served, which is HTTPS.
    ...(isDev ? [] : ['upgrade-insecure-requests']),
  ].join('; ');
}

export function proxy(request: NextRequest): NextResponse {
  const isDev = process.env.NODE_ENV !== 'production';

  // `crypto.randomUUID` rather than `Math.random`: a guessable nonce is not a
  // nonce, and the Edge runtime has the Web Crypto API.
  const nonce = btoa(crypto.randomUUID());
  const csp = policy(nonce, isDev);

  // SET ON THE REQUEST TOO, not only the response. Next reads the policy from
  // the incoming headers to decide which nonce to stamp on its own scripts; a
  // policy set only on the way out would produce a page whose scripts the page
  // itself forbids.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('content-security-policy', csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });

  response.headers.set('content-security-policy', csp);

  return response;
}

export const config = {
  /**
   * Documents only.
   *
   * Static assets and images are excluded because they carry no markup for a
   * policy to govern, and running middleware for each of them would add a
   * nonce computation per file for nothing. `_next/static` is also
   * content-hashed, so it is not a place where injected script could hide.
   */
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
