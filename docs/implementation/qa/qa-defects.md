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

---

## QA-004 — the registration consent step's legal links did nothing

| | |
| --- | --- |
| **Severity** | MEDIUM |
| **Area** | Android — registration (`MohallaNavHost`, `RegisterTermsScreen`) |
| **Requirement** | SET-FR-008, PRIV-018; OD-015 context |
| **Environment** | Emulator API 36, debug build, real local backend |
| **Status** | CLOSED |

### Reproduction

Fresh install → language → Create account → number → date of birth → password →
the *Terms and Community Guidelines* step. Tap **Read the Terms**, or **Read the
Community Guidelines**.

### Expected

Something. The reader is being asked to tick *"I have read and accept the Terms
and the Community Guidelines"*, so a control offering to show them must either
show them or say why it cannot.

### Actual

Nothing at all. No navigation, no message, no error, no crash — the screen did
not change. Measured on the device: identical accessibility tree before and
after the tap, and a clean crash buffer.

### Root cause

Both callbacks were literally empty:

```kotlin
onOpenTerms = {},
onOpenGuidelines = {},
```

with a comment explaining the reasoning — OD-015 means the documents do not
exist, so nothing should open a browser at a URL that would 404 and nothing
should ship placeholder legal text.

**Both of those points are right.** What the reasoning missed is that the app
had already solved this exact problem elsewhere. `LegalDocumentScreen` exists,
renders *"This document is not available yet."* with the explanation *"It hasn't
been published yet. Nothing is shown here rather than something that only looks
official."*, and **Settings had been routing to it all along**. The choice was
never "a 404, invented text, or nothing" — there was a fourth option already
built and reachable, and registration was the one place that did not use it.

### Why the existing wiring test did not catch it

`IntegrationWiringTest` exists for precisely this class of defect; its own
header says *"a callback nothing passes looks exactly like a callback that
works."* It missed this one because here the callback **was** passed. It was
passed as a no-op, which from one layer up is indistinguishable from a working
one.

### Fix

`MohallaNavHost.kt` — route both controls to the screen Settings already uses:

```kotlin
onOpenTerms = { navController.navigate(Routes.legal(Routes.LEGAL_TERMS)) },
onOpenGuidelines = { navController.navigate(Routes.legal(Routes.LEGAL_GUIDELINES)) },
```

No legal content is invented. The destination's entire job is to say that no
document has been published.

### Regression test

`apps/android/app/src/test/.../LegalLinkWiringTest.kt` — five checks: each link
navigates to its legal route, neither is an empty lambda again, the destination
route is actually declared, and the legal screen still refuses to invent text.

A source check, for the reason `PasswordResetNavigationTest` records: the
destination lives in the top-level `NavHost` while the register screens live in
`authGraph`, so a behavioural test would have to hand-assemble a graph — and a
hand-assembled graph is exactly what passes while the real one is broken.

### Runtime evidence, before and after

| | Tap "Read the Terms" | Tap "Read the Community Guidelines" |
| --- | --- | --- |
| Before | screen unchanged, no crash | screen unchanged |
| After | `Terms and Privacy Policy` → *"This document is not available yet."* | `Community Guidelines` → same honest screen |

Back-navigation returns to the consent step with the checkbox state intact, and
the crash buffer stayed clean throughout.

### Retest

Full Android functional suite: **36 passed · 0 failed**. Android unit tests
including the new regression: green.

---

## QA-005 — OTP codes are stored as an unsalted SHA-256 of six digits

| | |
| --- | --- |
| **Severity** | MEDIUM |
| **Area** | API — `apps/api/src/modules/platform/identity/domain/otp.ts` |
| **Requirement** | SEC-003; compare the project's own reasoning in `identifier-hash.ts` |
| **Environment** | Local Postgres 18.6 |
| **Status** | OPEN — recommendation recorded, no code change made |

### What was found

`hashOtpCode` is a bare digest of the code:

```ts
export function hashOtpCode(code: string): Buffer {
  return createHash('sha256').update(code, 'utf8').digest();
}
```

A six-digit code has 10^6 possibilities, so the entire space can be precomputed
and reversed in well under a second. This was not inferred — the Stage 10 QA
driver **does exactly that** to read live verification codes out of
`otp_challenges` for its own device-driven signup tests. It works every time.

### Why this is worth raising, given the code argues the opposite

The module states its reasoning:

> A plain SHA-256 is correct here, unlike for passwords: the code lives for ten
> minutes, is single-use, and is capped at five attempts, so the slow-hash
> property Argon2id provides buys nothing while costing latency on every
> verification.

Every clause of that is true, and the conclusion still does not follow. The
argument answers *"should this be a slow hash?"* — and no, slowness buys
nothing. It does not answer *"should this be a **keyed** hash?"*, which is a
different question, and the codebase already answers it, in the opposite
direction, three files away:

> a phone number has only ~10^9 possibilities, so an unkeyed SHA-256 of the
> whole space is enumerable in seconds. **The pepper is what makes a stolen
> database dump useless** for recovering identifiers.
> — `identifier-hash.ts`

A phone number's space is 10^9. An OTP's is 10^6 — **a thousand times smaller**.
The same argument that justified peppering identifiers applies to OTP codes with
far greater force, and the project has already accepted "a stolen database dump"
as an in-scope threat by engineering against it.

### Impact, stated precisely

The TTL, the five-attempt cap and the lockout are all real, and none of them
helps here: an attacker who can read the table does not guess. They compute the
code offline and use it once, on the first attempt.

- Requires **read access to `otp_challenges`** — a leaked backup, a replica, a
  read-only support role, or an injection with read. It is not a standalone
  remote bypass, which is why this is MEDIUM and not HIGH.
- What it yields is not small: `PASSWORD_RESET` challenges are in the same
  table, so recovering one is account takeover for that identifier.

### Recommended fix

Key the hash, exactly as identifiers already are — HMAC-SHA256 under a pepper
held outside the database, with a distinct context string so the two uses cannot
be interchanged. The verification path is unchanged in shape and the cost stays
negligible.

Two things the owner should weigh, which is why Stage 10 did not simply do it:

1. It changes an **explicitly documented, approved** security decision. The
   comment is not an oversight; somebody thought about it and wrote down a
   conclusion. Overriding that is the owner's call, not QA's.
2. Deploying it invalidates every in-flight challenge — a ten-minute window in
   which pending users must request a new code. Harmless, but it is a
   deployment note, not a silent change.

### Not claimed

No exploit against a deployed system was attempted or demonstrated. The
enumeration was performed against the local QA database, on synthetic
challenges created by this stage's own fixtures.
