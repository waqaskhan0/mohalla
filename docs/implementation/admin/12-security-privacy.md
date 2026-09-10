# 12 — Security and Privacy Hardening

**Stage 8 · Group 13.**

---

## 1. ADMIN-RUNTIME-004 — an expired session was shown the signed-in portal

`guardedRequest` ends a dead session by calling `redirect()`, and `redirect()`
works by **throwing**. Every page wrapped its fetch in a try/catch that rendered
its own "unavailable" state — so the catch meant for a failing API swallowed the
redirect too.

Measured with an invalid session cookie: `/moderation` answered **200** and drew
the full authenticated shell, sidebar, "Sign out", and "Something went wrong.
Nothing was changed."

That is ADMIN-RUNTIME-001 arriving through a different door. The first time, a
page checked the cookie and never asked the API. This time the page asked, the
API said no, the redirect was raised, and the page caught it. The dashboard
carried a comment stating the exact false belief — "A 401 never reaches here" —
written confidently and never tested against an invalid cookie.

Fixed with `apiFailure`, which returns the two error types a screen knows how to
render and re-throws everything else. Deliberately **not** a match on Next's
`NEXT_REDIRECT` digest: listing what IS handled needs no knowledge of how the
framework signals a redirect. Nine catch sites narrowed. Verified end to end — a
garbage cookie now lands on `/login?expired=1` with the cookie cleared.

**A measuring error worth recording.** curl reported 200 for six of the eight
routes even after the fix, and that was the instrument, not a defect: those
pages stream, so the shell has already flushed when the redirect is raised and
the status cannot change. The redirect travels in the RSC payload as
`NEXT_REDIRECT;replace;/session-expired;307` and the client performs it. What
proved the fix was that the error panel's text disappeared from the payload —
and then from the browser.

## 2. A Content-Security-Policy with a per-request nonce

Two approved facts set the threat model: the portal "renders user-generated
content and is the highest-value XSS target", and every post, bio, report note
and display name must be assumed hostile. React escaping and §34 are both
properties of code somebody could change; a CSP is the layer that holds when
they do.

| | |
|---|---|
| `script-src` | `'self'` + per-request nonce + `'strict-dynamic'`. **No `unsafe-inline` anywhere.** |
| `connect-src` | `'self'` — no rendered client component fetches anything, so script that somehow executed could not send what it read anywhere |
| `frame-ancestors` / `frame-src` | `'none'` |
| `base-uri` / `object-src` | `'none'` |
| `form-action` | `'self'` |
| Development loosens | exactly two directives: `'unsafe-eval'` and `ws:` |

Verified in production mode: all 11 script tags carry the nonce, and two
consecutive responses carried different ones. Live enforcement confirmed — a
cross-origin fetch, an external image and an iframe each fired a real
`securitypolicyviolation` event.

**One honest limit.** `script-src` could NOT be tested from the browser console,
because Chrome exempts devtools evaluation from it. A first attempt reported
"inline script ran" and "eval ran", and that was an artifact of the instrument,
not a weakness in the policy. That half is verified structurally instead: the
policy contains no `unsafe-inline`, and every script tag carries the nonce.

## 3. The two audited reads

| | |
|---|---|
| Three loads of a conversation case | **0** `ADMIN_READ_REPORTED_CONVERSATION` entries |
| One press of "Open the reported conversation" | **1** entry, naming the administrator and the conversation, metadata carrying only the case id |
| Three loads of an account page | `ADMIN_VIEWED_SENSITIVE_DATA` unchanged at 50 |
| One reveal | 51, recording field NAMES and none of the values |

§21 is the rule the first serves: "Administrators must NOT have general access
to private conversations", with exactly one exception — a participant reported
the conversation. There is no conversation search in this portal, no inbox view,
no message browser, and no route that accepts a conversation id. The panel
exists on a CASE, which means a report exists, which is the single condition
under which the API will answer at all.

## 4. Constant headers

`X-Frame-Options: DENY` · `Referrer-Policy: no-referrer` ·
`X-Content-Type-Options: nosniff` · a `Permissions-Policy` denying camera,
microphone, geolocation and payment · COOP and CORP `same-origin` · HSTS.

`no-referrer` is a privacy decision rather than a habit: admin URLs carry case
ids and account ids, and any weaker policy hands those to the next origin
visited. HSTS matters here specifically because the `__Host-` cookie prefix
REQUIRES Secure, so a downgrade breaks the session rather than merely weakening
it.

## 5. §12 — the two credential stores do not cross

Verified against the live API:

- the admin credential cannot even be **shaped** for the user login route, which
  takes a phone;
- a user identifier at `/admin/login` returns the same message as a wrong
  password;
- an admin session token is refused **401** by user-authenticated routes.

**Not executed:** a real user token against admin routes. OTP codes are hashed
at rest and the plaintext is only reachable from the app's in-process fake SMS
provider, which a separate API process cannot expose. Verified structurally
instead: the admin guard resolves only through `admin_sessions`, and the admin
identity repository never reads `users`.

## 6. SEC-025, measured on the shipped bundle

Zero client chunks contain `mohalla_admin_session`, `__Host-`, `Authorization`,
`Bearer`, `readAdminToken`, `adminRequest`, or any `/admin/...` path. They
appear only in server chunks.
