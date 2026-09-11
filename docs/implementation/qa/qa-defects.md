# Stage 10 — QA defect register

Base: `a00597586b3877fdf2fc2c49f565c3154edab838` (Stage 9, PR #16).

Severities are **CRITICAL / HIGH / MEDIUM / LOW**, applied as defined in the
Stage 10 brief. Statuses are **OPEN / FIXED_PENDING_RETEST / CLOSED /
BLOCKED_EXTERNAL / ACCEPTED_RISK**. Nothing is deleted once resolved.

A defect in the **test harness** is recorded here alongside product defects,
because a harness that reports the wrong answer is the thing this project has
been bitten by most: a false FAIL wastes a fix, and a false PASS ships a bug.

---

## QA-001 — `e2e:admin` cannot authenticate against a production portal build

| | |
| --- | --- |
| **Severity** | MEDIUM |
| **Area** | QA harness — `scripts/posix/admin-e2e.mjs` |
| **Requirement** | ADMIN-RUNTIME-003; the harness is the executable evidence for UX-ADM-003 |
| **Environment** | Windows host, portal started with `next start` (production build), API on `:3000`, portal on `:3001` |
| **Status** | CLOSED |

### Reproduction

1. `npm run build` (portal built by `next build`).
2. Start the portal with `next start -p 3001`.
3. `npm run e2e:admin` with valid `ADMIN_E2E_EMAIL` / `ADMIN_E2E_PASSWORD`.

### Expected

12 of 12 flows pass, as they do against a `next dev` portal.

### Actual

`11 passed · 1 failed`. Flow **G** — *"The moderation queue never reports an
empty queue from a deep page"* — failed on `the portal says the page is past
the end`.

### Root cause

Not the portal. `lib/admin-session.ts` names the cookie by deployment mode:

```
const SECURE_COOKIE_NAME = '__Host-mohalla_admin_session';
const DEV_COOKIE_NAME = 'mohalla_admin_session';
```

The harness hardcoded the **development** name. Against a production build the
portal looks up `__Host-mohalla_admin_session`, finds nothing, and correctly
sends the request to `/login` — so every authenticated portal fetch in the
harness was a 307 to the sign-in page, and the assertions ran against the
redirect body rather than the moderation page.

Measured, with the same token, against the same running portal:

| Cookie name sent | `/moderation` | `/moderation?offset=5000` |
| --- | --- | --- |
| `mohalla_admin_session` | **307 → /login** | 307 → /login |
| `__Host-mohalla_admin_session` | **200, 55,672 bytes, 40 Review links** | **200, 23,114 bytes, "past the end of the queue" present** |

The product behaviour flow G asserts is **correct**. The harness was measuring
a redirect.

### The part that matters more than the false FAIL

Flow G failed loudly, which is the lucky case. Its sibling check on the same
page —

```
check('the portal does NOT say the queue is clear at that offset',
      !r.text.includes('Nothing is waiting for review'));
```

— **passed**, because a `/login` redirect body contains no such string either.
A check phrased as "this text is absent" cannot tell an empty queue from an
empty page. Against a production portal the harness would have reported that
assertion as evidence while never having loaded the screen.

### Fix

`scripts/posix/admin-e2e.mjs`:

- resolves the portal's cookie name at runtime by probing `/dashboard` with each
  candidate and keeping whichever the portal actually accepts, so the harness
  follows the build it was pointed at instead of assuming one;
- reports the resolved name in flow B, so the mode under test is on the record;
- adds a **positive control** before every content assertion: an authenticated
  portal fetch must be `200`. An absence-assertion is no longer allowed to stand
  on a page that never rendered.

### Regression test and mutation proof

The positive control is the regression test. Mutation, run against the fixed
harness with the portal in production mode:

| Mutation | Result |
| --- | --- |
| Force the dev cookie name (restore the defect) | flow G FAILS on `the moderation page rendered for an administrator — status 307`, before it reaches any content assertion |
| Fixed harness | `12 passed · 0 failed · 0 blocked` |

The mutation was reverted and not committed. Note what changed: the defect now
fails on the *cause* (the page did not render) rather than on a downstream
symptom.

### Retest

`npm run e2e:admin` against **both** portal modes:

| Portal mode | Result |
| --- | --- |
| `next start` (production build) | 12 passed · 0 failed |
| `next dev` | 12 passed · 0 failed |

Re-confirmed after QA-002 added flow M: **13 passed · 0 failed** in both modes.
The positive control still fires first, so a page that fails to render is still
reported as a failure to render rather than as a content assertion.

---

## QA-002 — the portal advertised a plain-HTTP escape hatch that never worked

| | |
| --- | --- |
| **Severity** | MEDIUM |
| **Area** | Admin portal — `apps/admin/lib/admin-session.ts`, admin authentication doc |
| **Requirement** | SEC-017 (plain HTTP refused, not redirected), SEC-024, SEC-025 |
| **Environment** | `next build` output run over plain HTTP |
| **Status** | **CLOSED — DOCUMENTED SECURITY POLICY CORRECTION** |

### What was observed

`admin-session.ts` documented a two-name scheme and explained it as:

> The prefix requires Secure, which requires HTTPS. Local development over
> plain HTTP therefore uses the unprefixed name — see `sessionCookieName`.

which reads as a supported plain-HTTP path for any deployment. The admin
authentication doc said the same thing in a table row: *"unprefixed over plain
HTTP locally"*.

**That escape hatch does not exist.** Next inlines `process.env.NODE_ENV` at
build time, so a production bundle has the secure name constant-folded in — the
compiled route literally reads:

```
(await cookies()).delete("__Host-mohalla_admin_session")
```

`.env` sets `NODE_ENV=development`, `next start` even warns *"You are using a
non-standard NODE_ENV value"*, and the cookie name does not change, because the
decision was already compiled in. Independently, a browser refuses a `__Host-`
cookie on an insecure origin, so the promise could not have been kept anyway.

**The observation stands and is not withdrawn:** the previously documented
plain-HTTP production escape hatch did not work.

### Owner disposition

> **PRODUCTION ADMIN PORTAL REQUIRES HTTPS.**

The approved resolution is to **remove the promise, not weaken the credential**.
Explicitly rejected: dropping `Secure`, dropping the `__Host-` prefix,
conditionally downgrading at runtime, trusting a forwarded-proto header without
an approved proxy model, or adding any insecure environment switch to
production behaviour.

This matters because the portal is, by the architecture's own words, *"the
highest-value XSS target"* in the product, and the cookie in question is an
8-hour administrator session.

### Resolution

No behaviour changed. The **documentation** was corrected to state the policy,
and tests were added so the policy is enforced rather than merely written down:

- `apps/admin/lib/admin-session.ts` — the comment now states that production
  requires HTTPS, explains that the two names are a property of the *build*
  rather than a runtime option, and records that there is deliberately no
  downgrade switch. `isSecureDeployment` documents that it reads `NODE_ENV` and
  nothing else, on purpose.
- `docs/implementation/admin/02-admin-authentication.md` — the "unprefixed over
  plain HTTP locally" row is replaced with an explicit build/transport table.

| Build | Transport | Cookie |
| --- | --- | --- |
| `next dev` | plain `http://localhost` supported | `mohalla_admin_session` |
| `next build` + `next start` | **HTTPS required** | `__Host-mohalla_admin_session` |

### Regression coverage

`apps/admin/lib/admin-cookie-policy.spec.ts` — six tests, behavioural where
behaviour can reach (`sessionCookieName` does not touch request-scoped
`cookies()`, so it is directly callable):

| | Requirement | Test |
| --- | --- | --- |
| **A** | production build uses the secure cookie | `NODE_ENV=production` → `__Host-mohalla_admin_session` |
| **B** | development build uses the intended dev behaviour | `NODE_ENV=development` → `mohalla_admin_session` |
| **C** | production cannot silently downgrade | eight plausible downgrade variables set at once — including `ADMIN_INSECURE_COOKIE` and a forwarded-proto claim — must not change the name; plus a source check that the decision reads `NODE_ENV` **and nothing else**; plus `secure:` must stay bound to `isSecureDeployment()` rather than a literal |
| **D** | an authenticated production-mode portal works | `e2e:admin` **flow M**, against the running portal |

Flow M reads the build mode from the portal's own CSP header rather than from
an environment this script controls — `proxy.ts` adds `'unsafe-eval'` only in
development, and that decision is inlined from the same constant as the cookie
name. Requiring the two to agree is what catches a build that shipped
production CSP with a development cookie. It then **attempts** the downgrade
rather than assuming it impossible: a production portal must refuse the
unprefixed cookie outright.

### Mutation proof

Adding exactly the switch the owner forbade —

```
if (process.env.ADMIN_INSECURE_COOKIE === '1') return false;
```

— failed **both** C tests: the behavioural one on the specific variable, and the
source check generically (`expected [ 'ADMIN_INSECURE_COOKIE', 'NODE_ENV' ] to
equal [ 'NODE_ENV' ]`). Reverted; not committed.

One test of mine was wrong before the code was: the documentation assertion used
`readCode`, which strips block comments, and so failed against a file that
already said the right thing. Fixed to use `readFile`, and the reason is
recorded in the test.

### Retest

| Lane | Result |
| --- | --- |
| `admin-cookie-policy.spec.ts` | 6 passed |
| `e2e:admin` against production build (`next start`) | **13 passed · 0 failed** |
| `e2e:admin` against development build (`next dev`) | **13 passed · 0 failed** |

### What is NOT claimed

| | |
| --- | --- |
| **SECURITY CONFIGURATION** | **PASS** |
| **LIVE HTTPS DEPLOYMENT** | **NOT EXECUTED — release environment** |

No TLS terminator was placed in front of the portal, so no browser was observed
storing a real `__Host-` cookie over HTTPS. The configuration that governs it is
proven; the deployment is not, and is not claimed.

## QA-003 — first cold `next build` after a dev session fails on `/_global-error`

| | |
| --- | --- |
| **Severity** | LOW |
| **Area** | Admin portal build, this Windows host |
| **Requirement** | none — build hygiene |
| **Environment** | Windows 10, Node 24, Next 16.3.4 |
| **Status** | CLOSED — not reproducible; superseded by evidence |

Stage 9 carried an OBSERVATION that `next build` failed deterministically on
Next's synthesised `/_global-error` with three prerender workers, and succeeded
under `--debug-prerender`.

Re-tested at the start of Stage 10. The **first** `npm run build` of the session
failed; every subsequent `next build` and `npm run build` succeeded, all 11
pages, exit 0, with no flag and no source change:

```
✓ Generating static pages using 3 workers (11/11) in 368ms
EXIT=0
```

So the failure is tied to a cold or dev-dirtied `.next`, not to the source or
to worker count. Stage 9's `--debug-prerender` finding is consistent with that
— the flag also changes how the directory is populated. No fix is warranted;
the Stage 9 observation is narrowed rather than carried forward as-is.
