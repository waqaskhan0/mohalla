# Group 3 — Admin authentication

Baseline: `a16d25bc2de4acdf24998d87225ab17a96cdcd90`.

Driven against the local API on port 3000, the Compose PostgreSQL 18.6 instance
and the Admin portal on port 3001, in a real browser. The administrator is a
synthetic local fixture provisioned through the approved path: the row is
inserted by the **owner** role — migration 0007 forbids the runtime role from
creating an administrator, and `api-smoke-test.mjs` asserts that boundary — and
the password is hashed by the API's own `PASSWORD_HASHER`, never by anything
the harness invents. The address is under `mohalla.invalid`, which RFC 2606
reserves and which can never reach anybody. The generated password is written
to ignored local scratch space and printed nowhere.

## Browser console

| Step | Evidence | Result |
| --- | --- | --- |
| Unauthenticated protected route | `/dashboard` → `/login`, no console content rendered | PASS |
| Sign in → dashboard | Real aggregate figures: 1,510 open reports, 5,883 total users, 174 actions this week | PASS |
| Protected route | `/moderation` renders 1,510 open cases, 20 rows, `Showing 1–20 of 1,510` | PASS |
| Sign out | → `/login`, session cookie cleared | PASS |
| Protected route after sign out | `/dashboard` → `/login`; the console is not rendered from a stale cookie | PASS |
| **Expired session with a live cookie** | Session row expired directly in the database, then `/moderation` requested: → `/login?expired=1`, "Your session has ended", cookie cleared, console never rendered | PASS |

The expired-session case is the one worth stating separately, because it is the
one a portal gets wrong. The cookie was present and valid-looking; only the
server-side session was dead. ADMIN-RUNTIME-001 records that an earlier version
rendered the full dashboard in exactly this situation, because it checked the
cookie and never asked the API. `guardedRequest` asks on every protected page,
and the browser confirms the result rather than the code comment claiming it.

## Both stores, and neither crossing into the other

Nine checks at real HTTP, all PASS:

| Check | Result |
| --- | --- |
| An administrator signs in to the admin store | 200 |
| A user signs in to the user store | 200 |
| A USER credential is refused by admin login | 400 |
| An ADMIN password is refused by user login | 401 |
| A USER token is refused by an admin endpoint | 401 |
| An ADMIN token is refused by a user endpoint | 401 |
| An anonymous request is refused by an admin endpoint | 401 |
| An EXPIRED admin session is refused | 401 |
| A forged admin token is refused | 401 |

Stated precisely: the USER-credential-into-admin-login case is refused at
**validation** with 400, because a Pakistani mobile number is not an email
address and never reaches a credential lookup. That is a refusal, but it is not
by itself proof that a user's password cannot authenticate an administrator.
The token checks are what prove the separation, and admin E2E flow C proves a
wrong password is refused without saying anything extra.

Session expiry is asserted by expiring the row rather than by presenting a token
the server never issued. A store that ignored `expires_at` entirely would still
reject an invented token, so a forged-token check alone proves nothing about
SEC-024's absolute 8-hour lifetime.

## Admin E2E, previously blocked, now executed

`npm run e2e:admin` reported 3 passed · 0 failed · 9 blocked at the start of
this session, because `ADMIN_E2E_EMAIL` / `ADMIN_E2E_PASSWORD` were unset in the
shell. With the synthetic fixture supplied it reports **12 passed · 0 failed ·
0 blocked**. That lane was an environment gap, not a code regression — the
script correctly refuses to upgrade BLOCKED to PASS on its own.

## An observation that is not a defect

The moderation queue first rendered nothing but its loading skeleton
indefinitely — `aria-busy="true"`, no rows, and no request reaching the API at
all — while the same endpoint answered in 17 ms to `curl` and the E2E flows
passed. It was traced to a wedged long-running `next dev` process, not to the
portal: restarting the dev server made the page render 1,510 cases immediately,
with no source change. Recorded here because a green HTTP suite would never have
shown it, and because the next person to see a permanently loading portal page
should suspect the dev server before the code. Not filed as an integration
defect: nothing in the shipped application is implicated, and it does not
reproduce against a freshly started server.

## What this group does not prove

Moderation decisions reaching Android (groups 12–14), suspension and ban state
(groups 15–16), and admin collision handling (group 19) are later groups. The
portal was driven in `next dev`; a production `next start` build is a release
concern and is not claimed here.
