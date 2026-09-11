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

---

## QA-002 — the portal's admin cookie name is fixed at build time, not runtime

| | |
| --- | --- |
| **Severity** | MEDIUM |
| **Area** | Admin portal — `apps/admin/lib/admin-session.ts` |
| **Requirement** | SEC-024 session handling; the module's own stated intent |
| **Environment** | `next build` output run over plain HTTP |
| **Status** | OPEN — recommendation recorded, no code change made |

### What the code intends

`admin-session.ts` documents a deliberate two-name scheme:

> The prefix requires Secure, which requires HTTPS. Local development over
> plain HTTP therefore uses the unprefixed name — see `sessionCookieName`.

and implements the switch as `process.env.NODE_ENV === 'production'`.

### What actually happens

Next inlines `process.env.NODE_ENV` at **build** time. In the production bundle
the ternary is constant-folded — the compiled route reads:

```
(await cookies()).delete("__Host-mohalla_admin_session")
```

So a production build always uses the `__Host-` name **regardless of the
runtime environment**. `.env` sets `NODE_ENV=development`, `next start` even
warns *"You are using a non-standard NODE_ENV value"*, and the cookie name does
not change, because the decision was already compiled in.

### Impact, stated precisely

- **Real deployments: none.** The portal is served over HTTPS, where `__Host-`
  is the correct and more secure choice. Nothing about production is wrong.
- **Local and staging verification over plain HTTP: broken.** A browser refuses
  to store a `__Host-` cookie on an insecure origin, so signing in to a
  production build over `http://` silently fails — the POST succeeds, the
  cookie is discarded by the browser, and the reader lands back on `/login`.
  The documented escape hatch for exactly this case does not work.

This is not a security hole; it is a hole in the ability to verify the release
artifact before shipping it. It is also the most plausible explanation for how
Stage 9's INTEGRATION-012 came to be diagnosed as "the portal cannot render".

### Why no code change was made here

The obvious fix is a runtime switch (an explicit env flag consulted at request
time rather than `NODE_ENV`). That adds a supported way to downgrade the
session cookie from `__Host-` to an unprefixed name, which is a **security
policy decision about the highest-value credential in the product**, not an
ordinary reversible defect fix. Stage 10 does not make that call unprompted.

### Recommended owner disposition

One of:

1. **Accept as-is** and record that the production build must be verified over
   HTTPS (a local TLS-terminating proxy in front of `next start` is enough).
2. **Add an explicit, loudly-named runtime flag** — e.g. `ADMIN_INSECURE_COOKIE`
   — read per request, refused when `NODE_ENV=production` at runtime, and
   logged at startup whenever it is on.

Option 1 changes nothing and costs a proxy. Option 2 restores the documented
intent at the cost of a deliberate downgrade switch existing in the codebase.

---

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
