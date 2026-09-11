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
| **Status** | **CLOSED — MEDIUM, SECURITY HARDENING** |

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

---

## QA-005 — resolution

**Owner decision:** use a dedicated secret-key HMAC-SHA256. Do not keep the
design, do not make SHA-256 slower, and do not stretch a six-digit code with
Argon2id or bcrypt.

### Implemented

`OtpDigest` replaces `hashOtpCode` / `otpMatches`:

```
HMAC-SHA256(OTP_HASH_KEY, encode([
  "mohalla:otp:v2", challengeId, purpose, code
]))
```

`encode` writes each part as a 4-byte big-endian length followed by its UTF-8
bytes, so the fields cannot be slid past one another — plain concatenation
would make `("ab","c")` and `("a","bc")` collide.

| Decision | Why |
| --- | --- |
| Dedicated `OTP_HASH_KEY` | key separation is mandatory. Not the identifier pepper, session, password, admin or push secret. The pepper additionally can **never** be rotated (it would unban everyone); this key can be. |
| `challengeId` in the input | two live challenges holding the same six digits store different digests, so the table reveals nothing by collision |
| `purpose` in the input | a digest lifted from a `REGISTRATION` row cannot be replayed against a `PASSWORD_RESET` one |
| Production fails closed | `loadEnv` refuses to start when the key is absent or still the development default, and the refusal never prints the key |

### Migration

`0024_otp_hmac_transition.js` **deletes every row in `otp_challenges`**.

They cannot be migrated — the new digest needs the plaintext, and the whole
point of the stored value is that the plaintext is not kept. Recomputing it
would mean performing the attack in order to fix it.

**No hash-version column and no legacy window**, deliberately: any row still
verifiable under `sha256(code)` is a row an attacker with a database read can
still solve, so a "bounded" fallback is a bounded window in which nothing is
fixed. The bound that matters already exists — OTPs live ten minutes. Somebody
holding an unused code at deploy time requests a new one, which is the same
experience as a code that expired while they were reading it.

### Acceptance tests

| | Requirement | Where |
| --- | --- | --- |
| A | correct OTP verifies | `otp.service.spec.ts` — "verifies a correct code and activates the account" |
| B | wrong OTP fails | "rejects a wrong code and spends an attempt" |
| C | single-use | "REFUSES TO REUSE A CODE that already succeeded" |
| D | expired fails | "REFUSES A CODE THAT HAS EXPIRED, even though it is correct" |
| E | resend invalidates the previous code | "RESENDING INVALIDATES THE PREVIOUS CODE" + "the newly sent code is the one that works" |
| F | attempt limit enforced | "LOCKS OUT after the attempt cap, and the lockout outlives the challenge" |
| G | password reset uses the same construction | `password.service.spec.ts`, built through `OtpDigest` |
| H | digest is not `sha256(otp)` | `otp.spec.ts` — H/I |
| I | enumeration with only the row no longer recovers it | `otp.spec.ts` — H/I, and the runtime evidence below |
| J | same code, different challenges, different digests | `otp.spec.ts` — J |
| K | production without the key fails closed | `env.spec.ts` — four K tests |
| L | the dev fixture cannot become a production key | `env.spec.ts` — two L tests |

A–G already existed and now run against the new construction; they were not
rewritten, which is the point — the security property changed and the
behavioural contract did not.

### Mutation proof

Restoring `storedDigest = SHA256(otp)`:

```
× J. two challenges with the SAME code do not share a stored digest
× binds the purpose, so a registration digest cannot be replayed as a reset
× H/I. the stored digest is NOT sha256(code), and the space is not enumerable without the key
× a different key does not verify the same code
Tests  4 failed | 14 passed (18)
```

Reverted; not committed.

### Runtime evidence, both ways

The same script, against the real endpoint and the real database, holding only
the stored row:

| Build | Result |
| --- | --- |
| Legacy `sha256(code)` | `enumerated 10^6 six-digit codes in 554 ms` → **RECOVERED the live code**, matching the code the provider delivered |
| Keyed HMAC | full 10^6 sweep → **NOT RECOVERABLE from the database row** |

### The QA harness had to stop working, and did

Reading codes out of the database was the defect, so the driver can no longer
do it — that is an acceptance criterion, not a regression. `qa10.otp_for` now
reads the in-process `FakeSmsProvider` outbox through
`.emulator-evidence/stage10-api-harness.mjs`, which composes the same
`AppModule` and mounts one route beside it.

It cannot exist in production: it is not part of `apps/api` (`grep -rn
"__qa_harness__" apps/` returns **0 matches**), it lives in a git-ignored
directory, and it refuses to start unless `NODE_ENV` is development, the
database is local, and the SMS provider self-identifies as `fake`. Verified
live — the route returns a six-digit code for a synthetic number while the same
database row yields nothing to a full sweep.

Explicitly not used: a debug endpoint in the app, an admin route, a plaintext
column, a log line containing a code, or a committed secret.

### Severity

**MEDIUM**, unchanged. Exploitation needs database read access, so this is not
a standalone authentication bypass and is not recorded as one. It is in scope
because this project's own threat model already treats a stolen database dump
as in scope — that is the entire justification for peppering identifier hashes.
No more direct attack path was demonstrated, so the severity was not raised.

Architecture supersession: [otp-digest-supersession.md](../../security/otp-digest-supersession.md).

---

## QA-006 — the API recorded acceptance of Terms versions that do not exist

| | |
| --- | --- |
| **Severity** | MEDIUM |
| **Area** | API — `POST /register` |
| **Requirement** | BR-004, AUTH-FR-009, PRIV-018; OD-015 |
| **Environment** | Local API, Postgres 18.6 |
| **Status** | **CLOSED** |

### How it was found

Stage 10 §12 asks whether a release-like configuration can silently record
legally meaningful Terms acceptance against unavailable documents. Measured
directly against the running API:

| `termsVersion` sent | Response |
| --- | --- |
| `""` | 400 |
| `"   "` | 400 |
| `"not-a-real-version"` | **202 — accepted and stored** |
| `"terms-9999-99"` | **202 — accepted and stored** |

The schema was `z.string().min(1).max(64)` and the service checked only that
the field was non-empty. Any string was recorded as the record of what the
person agreed to.

### Why it matters, stated without inflation

The **shipped release client cannot do this**: the release Android build ships
`TERMS_VERSION=""` while OD-015 is unresolved, so it refuses to submit and
registration is blocked. There is no user-facing path to the defect today, and
no security compromise — nothing is disclosed and no account is taken over.

What is wrong is that the guarantee lived **only in the client**. PRIV-018
makes these documents the stated basis for every enforcement action, so an
acceptance row naming a document that was never published cannot support the
thing it exists to support. It is the same lesson QA-002 recorded about the
Admin cookie: a rule enforced only by the client is not enforced.

### Fix

`PUBLISHED_TERMS_VERSIONS` — the versions a deployment will accept an
acceptance of. `RegisterService` refuses anything outside it, with the
**identical** refusal it gives an empty version, so a caller cannot enumerate
which versions exist.

- **Development** defaults to `terms-2026-01,unpublished-od-015` — exactly what
  local tooling, CI and the debug Android build really submit, so nothing about
  development changes.
- **Production** must set it explicitly and startup fails if it does not, so a
  production deployment cannot silently inherit a list containing a version
  whose own name says it is unpublished.
- **Empty is valid in production** and means every registration is refused.
  That is the correct posture while OD-015 is unresolved, and it now matches
  what the release client already does.

No legal text was invented, and none was needed: the fix is a refusal to accept
acceptance of a document nobody has published.

### Mutation proof

Removing the check:

```
× REFUSES a version nobody published, instead of recording it
× refuses a plausible-looking but unpublished version
× and nothing is written for a refused version
× gives the same refusal shape as an empty version, disclosing nothing extra
Tests  4 failed | 20 passed (24)
```

Reverted; not committed.

### Runtime retest

| `termsVersion` | Before | After |
| --- | --- | --- |
| `"terms-2026-01"` | 202 | 202 |
| `"not-a-real-version"` | 202 | **400 `TERMS_NOT_ACCEPTED`** |
| `"terms-9999-99"` | 202 | **400 `TERMS_NOT_ACCEPTED`** |
| `""` | 400 | 400 |

Nine new tests: five on the service, four on the environment.

---

## QA-007 — a NUL byte in a search query returned 503

| | |
| --- | --- |
| **Severity** | MEDIUM |
| **Area** | API — `apps/api/src/modules/product/search/domain/search-query.ts` |
| **Requirement** | SEARCH-FR-003 E2 and E3 |
| **Environment** | Local API, PostgreSQL 18.6 |
| **Status** | **CLOSED** |

### Reproduction

```
GET /search/people?q=%00a   ->  503  {"error":{"code":"SEARCH_UNAVAILABLE"}}
GET /search/people?q=a%00b  ->  503
```

Server log:

```
error: invalid byte sequence for encoding "UTF8": 0x00
  at pg/lib/client.js:694
  at pg-search.repository.js:97
```

### Root cause

`checkSearchQuery` counted code points on the raw string, so `a` was two
characters and passed the two-character minimum. The value went to PostgreSQL,
which refuses a NUL byte in a UTF-8 string, and the repository's failure was
translated into `503 SEARCH_UNAVAILABLE`.

### Why it is a defect and not merely odd input

Two separate things were wrong.

A **503 tells the client the service is down and to retry** — but the request
was malformed and will fail identically forever. And SEARCH-FR-003 E3 reserves
that answer deliberately: a search outage *"must not present as a zero-results
state, which would mislead the user into thinking the content does not exist"*.
The "we could not look" answer exists to distinguish an outage from an empty
result, and spending it on bad input devalues the one signal that carries that
meaning.

No data was exposed — the error body is neutral and carried no stack trace.

### Fix

`stripControlCharacters` removes the C0 and C1 ranges plus ` `/` `,
and both `checkSearchQuery` and `normalizeSearchQuery` apply it. Stripping
rather than rejecting, because that is what the surrounding code already does
with whitespace and because the rest of the query is usually a perfectly good
search. If nothing usable remains, the existing length rule refuses it with the
minimum stated — which is E2's answer.

Ordinary spacing, every script's letters and emoji are untouched; the tests
assert that explicitly.

### Mutation proof

Removing the stripping fails two of the eight new tests:

```
× THE DEFECT: a NUL plus one letter is now too short, not a database error
× and a real query containing one still works, with the byte removed
```

Reverted; not committed.

### Runtime retest

| Query | Before | After |
| --- | --- | --- |
| `?q=%00a` | 503 | **400** |
| `?q=a%00b` | 503 | **200** (byte stripped, `ab` searched) |
| `?q=ali%00ya` | 503 | **200** (searches `aliya`) |
| `?q=%00%1f` | 503 | **400** |
| `?q=%1f%1f` | 200 | 400 |

---

## QA-008 — every failed request was written to the access log as `status: 200`

| | |
| --- | --- |
| **Severity** | HIGH |
| **Area** | API — `apps/api/src/common/logging/request-logging.interceptor.ts` |
| **Requirement** | EPIC-15 observability; Stage 10 §46 |
| **Environment** | Local API |
| **Status** | **CLOSED** |

### How it was found

Chasing QA-007. The 503 was plainly visible in the response, and the access-log
line for the same correlation id read:

```
{"event":"http_request","path":"/search/people","status":200}
```

Probing further showed it was **not** specific to that route. Every request
that ends in a thrown exception was logged as 200:

```
logged: POST /login             -> status 200   (really 401)
logged: GET  /posts/not-a-uuid  -> status 200   (really 400)
logged: GET  /search/people     -> status 200   (really 503)
```

### Root cause

The interceptor logged from an rxjs `tap`, reading `res.statusCode` in both the
next and the error path:

```ts
return next.handle().pipe(tap({ next: finish, error: finish }));
```

On the error path that runs **before** the exception filter, so the status is
still Express's default 200.

### Why HIGH

No data is exposed and nothing is corrupted, so this is not a security or
integrity defect. It is rated HIGH because of what it disables.

The access log is the primary operational signal, and it reported **every
failure as a success, systematically and silently**. Error-rate alerting built
on these lines could never fire. A brute-force run against `/login` appears as
a wall of 200s. An outage of the kind QA-007 produced would be invisible.

A log that is merely missing is a gap you can see. A log that confidently
reports the opposite of what happened is worse, because it is trusted.

Bounded, deliberately: the `/health/metrics` figures are computed from the
database and are unaffected — checked, not assumed.

### Fix

The line is now written on the response's own `finish` event, after the status
and headers are on the wire, so it records what the client actually received.
`close` covers a client that disconnected first, which would otherwise log
nothing at all, and a `logged` flag keeps the pair from producing two lines for
one request.

The existing privacy rule is retained and pinned by a test: the query string is
never logged, because that is where identifiers end up.

### Mutation proof

Restoring the `tap` — as a **compiling** program, checked with `tsc` before
running, because a mutation that merely fails to build proves nothing:

```
× logs the real status when the handler THROWS
× logs the real status for a guard rejection
× logs exactly one line even when finish and close both fire
× logs a client disconnect rather than dropping the request entirely
Tests  4 failed | 2 passed (6)
```

The two that still pass are the successful-response case and the query-string
privacy case — neither depends on the timing, which is the right shape for this
proof. Reverted; not committed.

**A first attempt at this mutation did not compile** (the import edit missed a
multi-line statement) and every test failed for that reason instead. That run
was discarded rather than reported.

### Runtime retest

```
logged GET /search/people   -> 400
logged GET /posts/not-a-uuid -> 400
logged GET /search/people   -> 200
logged GET /health          -> 200
```

---

## QA-009 — the Android push-notification client does not exist

| | |
| --- | --- |
| **Severity** | **HIGH** |
| **Area** | Android — `apps/android` |
| **Requirement** | **NOTIF-FR-001 (Must)**, PRIV-015, MSG-FR-004, LOCALE-FR-006 |
| **Environment** | Emulator API 36; backend and worker running |
| **Status** | **CLOSED — 2026-09-12. Client implemented and verified on device. See the resolution below.** |

### How this was found, and a correction to my own earlier reporting

The Stage 10 device checkpoint recorded:

> No `POST_NOTIFICATIONS` because the app posts no OS notification at all;
> therefore the notification permission lifecycle is N/A.

**That conclusion was wrong**, and it was wrong in the specific way the brief
warns against: I let a missing external provider hide a missing client
implementation. The observation (no permission, no channel, no posting code)
was accurate. The inference — that this is therefore *not applicable* — was
not. Nothing in the approved requirements says the client may be absent because
a provider credential is unavailable.

Re-reading the authority chain settles it. `04-mobile-architecture.md` §137–139
is **mobile** architecture and is explicit:

> 🟦 NOTIF-FR-001 · PRIV-015 — permission requested contextually; declining
> degrades **only** notifications.
>
> 🟩 Token registered after login and on permission grant; removed on logout;
> refreshed on FCM rotation. Deep links route to the causing item… **Message
> Requests never produce a push** (BR-027).

And `08-api-architecture.md` defines the contract the client is supposed to
call:

| | | | |
| --- | --- | --- | --- |
| NOTF-API-004 | NOTIF-FR-001 | POST | `/devices` |
| NOTF-API-005 | NOTIF-FR-001 | DELETE | `/devices/{token}` |

### What exists

| Layer | State |
| --- | --- |
| Backend outbox → worker → notification row | **implemented and working** — 17/17 checks this stage |
| `PUSH_SENDER` port and `FakePushSender` adapter | implemented |
| `POST` / `DELETE /notifications/devices` | **implemented and routed** |
| Notification preferences API | implemented |
| Android in-app notification **centre** | implemented and working |
| Android notification **preferences screen** | implemented, calls the preferences API |

### What is missing

Searched across `apps/android`:

| Expected | Found |
| --- | --- |
| Push SDK dependency (Firebase/FCM) | **none** in `build.gradle.kts` or `libs.versions.toml` |
| Device token acquisition | **none** |
| Call to `POST /notifications/devices` | **none** — the endpoint exists and the app never calls it |
| Token removal on logout (`DELETE`) | **none** |
| Token refresh handling | **none** |
| `POST_NOTIFICATIONS` permission | **not declared** |
| Notification channel | **none** — no `NotificationChannel`, `NotificationManager` or `NotificationCompat` anywhere |
| Incoming payload handling | **none** |
| Deep link *from a notification* | **none** (in-app deep links exist) |

Corroborated at runtime: `device_tokens` holds 8 rows, **every one created
2026-09-05** by backend tests calling the endpoint directly. Nothing has been
registered by the app in this stage, or by any app — because no code path can.

The sharpest way to put it: **the app ships a screen for choosing which push
notifications you want, and no ability to receive any of them.**

### Severity — HIGH, and why not higher or lower

NOTIF-FR-001 is a retained **Must**, and its entire client half is absent, so
this is a core Must flow that does not exist rather than one that misbehaves.
That is HIGH in this project's model.

It is **not CRITICAL**: nothing is insecure, nothing leaks, no data is
corrupted, and every other feature works — which is itself the requirement
("declining degrades **only** notifications"). Today the app behaves exactly as
a user who declined push would, without ever having asked.

### Why it is not fixed in this stage

Implementation needs the owner's Firebase project. The Android FCM SDK cannot
initialise without `google-services.json` (or the equivalent `FirebaseOptions`
— project id, application id, API key), and that configuration **is** DEP-003.

Three things were considered and deliberately **not** done:

1. **Requesting `POST_NOTIFICATIONS` anyway.** The requirement says the
   permission is requested *contextually*. Asking for permission to post
   notifications the app cannot receive is not context, it is a prompt with
   nothing behind it — worse than absent.
2. **A non-FCM token source behind a port.** The architecture names FCM
   specifically; inventing a second mechanism to make a test go green would be
   inventing architecture, which is out of scope for QA.
3. **Calling it N/A.** That is the error being corrected here.

### What the owner needs to supply

A Firebase project and its `google-services.json` (**DEP-003**). With that, the
client path is ordinary work: SDK, channel, contextual permission, token
register/refresh/remove against endpoints that already exist, payload handling
and deep links.

### Verdicts as at the time this was raised, kept separate

| | |
| --- | --- |
| **PUSH BACKEND PIPELINE** | **PASS** |
| **IN-APP NOTIFICATION CENTRE** | **PASS** — 17/17 |
| **PUSH CLIENT IMPLEMENTATION** | **FAIL — absent** |
| **OS NOTIFICATION PERMISSION FLOW** | **NOT IMPLEMENTED** (consequence of the above) |
| **REAL EXTERNAL PROVIDER DELIVERY** | **BLOCKED_EXTERNAL — DEP-003** |

## QA-009 — resolution, 2026-09-12

The owner supplied the DEP-003 client configuration
(`apps/android/app/google-services.json`, git-ignored by `.gitignore:11` and
confirmed untracked and invisible to `git status`). The client was then
implemented and tested on the device.

### What the app now does

| Expected, from the table above | State |
| --- | --- |
| Push SDK dependency | Firebase BOM 33.7.0 + `firebase-messaging`, `google-services` 4.4.2 |
| Device token acquisition | `FirebasePushTokenSource` behind a `PushTokenSource` port |
| Call to `POST /notifications/devices` | `PushTokenRegistrar.onAuthenticated()`, after sign-in |
| Token removal on logout | `onLoggedOut()` → `DELETE /notifications/devices`, before the session ends |
| Token refresh handling | `MohallaMessagingService.onNewToken` → `onTokenRotated()` |
| `POST_NOTIFICATIONS` | declared, and requested contextually on the signed-in shell |
| Notification channel | one channel, `mohalla.notifications`, `IMPORTANCE_DEFAULT` |
| Incoming payload handling | `onMessageReceived`, reading `title` / `body` / `deepLink` and nothing else |
| Deep link from a notification | `DeepLinks.resolvePath`, the same allowlist every other link uses |

### What was executed, and what it proved

| Lane | Result |
| --- | --- |
| Android unit tests — `PushTokenRegistrarTest`, `PushDeepLinkTest` | 17/17 |
| Device lifecycle — `.emulator-evidence/qa10_push.py` | **36/36** |
| On-device delivery, permission granted — `PushMessageDeliveryTest` | 6/6 |
| On-device delivery, permission refused — `PushDeniedDeliveryTest` | 2/2 |
| Rotation wiring on device — `PushTokenRotationTest` | 1/1 |
| Backend→client payload seam — `qa10_push_payload.mjs` | 6/6 |
| Notification suite, re-run | 17/17 |

A **real Firebase registration token** was obtained on the emulator (142
characters, separator at 22 — shape only; the value is never printed, logged or
committed) and registered against the account with `platform=ANDROID` and the
device's own language, satisfying BR-040.

### One defect found while testing this, and fixed

The first implementation kept "have we already asked?" in `rememberSaveable`,
which does not survive process death. On the device that meant the OS prompt
reappeared on **every cold start** after a refusal, and reappeared immediately
after somebody deliberately turned notifications off in Android Settings. That
is not a contextual request. Fixed by [`PushPromptStore`], which remembers that
the app has had its turn to ask — never the grant state, which belongs to the
operating system — and by a notice on the notification-preferences screen that
appears only while the OS is refusing, explaining the situation and opening the
Android settings page that can actually change it. Both halves are covered by
the device suite, and the fix is mutation-proven: forcing `hasAsked()` to
`false` fails "a refusal is not re-asked on the next cold start".

[`PushPromptStore`]: ../../../apps/android/app/src/main/java/org/shehersaaz/mohalla/core/push/PushPromptStore.kt

### What is still not proven, stated plainly

Nothing here demonstrates that Google's servers deliver anything. Sending to FCM
requires a **service-account credential** that this public repository must not
hold, so real server→FCM→handset delivery is recorded as its own external
blocker (**DEP-003-B**, below) rather than folded into the passes above. What is
proven is every step the codebase owns: the token is obtained, registered,
rotated, retired and reassigned; the backend addresses that exact token; the
payload it composes carries only the contracted fields and a deep link the
client can resolve; and the client renders, ignores or refuses each payload
correctly on a real device.

### Verdicts now, kept separate

| | |
| --- | --- |
| **ANDROID PUSH CLIENT** | **PASS** |
| **DEVICE TOKEN REGISTRATION** | **PASS** |
| **OS PERMISSION FLOW** | **PASS** |
| **BACKEND PUSH PIPELINE** | **PASS** |
| **REAL FCM DELIVERY** | **BLOCKED_EXTERNAL — DEP-003-B** |

---

## DEP-003-B — server→FCM delivery cannot be exercised without a service-account credential

| | |
| --- | --- |
| **Severity** | n/a — external blocker, not a defect |
| **Area** | Backend delivery · deployment |
| **Requirement** | NOTIF-FR-001 |
| **Status** | **OPEN — BLOCKED_EXTERNAL, owner action required** |

DEP-003 had two halves and only one of them is now supplied.

| Half | What it is | State |
| --- | --- | --- |
| Client configuration | `google-services.json` — project id, application id, API key | **supplied**, and QA-009 is closed on it |
| Server credential | a Firebase **service-account key** (or ADC) for the FCM v1 API | **not supplied** |

Without the second, `PUSH_SENDER` can only be `FakePushSender`: the backend
composes the message and records what it *would* have sent, which is what
`qa10_push_payload.mjs` inspects. No real `FirebasePushSender` adapter exists
yet, and one cannot be tested against anything without the key.

**This is not a workaround anybody should take.** The service-account key is a
production secret and must never be committed to this repository — it is on the
explicit never-commit list for this stage. It belongs in the deployment's secret
store, injected as an environment value.

What the owner needs to do, once, when a real environment exists:

1. In the Firebase console, **Project settings → Service accounts → Generate new
   private key**. This downloads a JSON key.
2. Store it in the deployment's secret manager. Do **not** place it in the repo,
   in `.env`, in CI logs, or in any QA document.
3. Provide it to the API process as a credential path or an environment value,
   and switch `PUSH_SENDER` from `fake` to the real adapter.

Until then this lane stays **BLOCKED_EXTERNAL** and must not be reported as a
pass.

---

## QA-010 — Stage 9 and Stage 10 documentation attributed push to the wrong dependency

| | |
| --- | --- |
| **Severity** | LOW |
| **Area** | Documentation — Stage 9 integration records, Stage 10 QA baseline |
| **Requirement** | traceability |
| **Status** | **CLOSED** |

### The drift

`14-infrastructure-environments.md` is the authoritative dependency register:

| ID | Dependency | Owner |
| --- | --- | --- |
| **DEP-002** | **SMS / OTP provider** | Shehersaaz + technical owner |
| **DEP-003** | **FCM** | Technical owner |

Stage 9's integration records and the Stage 10 baseline both describe
**DEP-002** as "the push provider credential". It is not; it is the SMS
provider, and it is separately still open — it is what `FakeSmsProvider` stands
in for, and OD-021 made it *"the single most important external dependency in
the project"* by removing email registration as a fallback.

### Which case this is

Checked against §4's two options. **B — documentation drift.** No approved
architecture renumbers these: `00-source-baseline.md`, `02-technology-stack.md`,
`03-system-architecture.md`, `17-open-decisions.md`, `10-environment-variables.md`
and `14-staging-deployment.md` all use DEP-002 for SMS consistently, and only
`14-infrastructure-environments.md` mentions DEP-003, correctly as FCM.

### Correction

Stage 10 documents now cite **DEP-003** for push and **DEP-002** for SMS.

Stage 9's records are **not rewritten** — they are frozen history, and silently
editing them would hide the drift rather than record it. The Stage 9 completion
record's push blocker should be read as DEP-003; that is noted here rather than
patched into the file.

Consequence worth stating: DEP-002 has been reported as "the one push blocker"
since Stage 9, which obscured the fact that **two** separate external
dependencies are open — SMS (DEP-002, blocking registration in any real
environment) and FCM (DEP-003, blocking push).

---

## QA-011 — the notification permission was re-asked on every cold start after a refusal

| | |
| --- | --- |
| **Severity** | LOW |
| **Area** | Android — `apps/android`, push permission |
| **Requirement** | NOTIF-FR-001, PRIV-015, `04-mobile-architecture.md` ("requested contextually") |
| **Environment** | Emulator API 36, real backend |
| **Status** | **CLOSED — fixed in the same change that closed QA-009** |

### What happened

Found while executing QA-009's own permission lifecycle, not by reading the
code. The device suite refused the prompt, relaunched the app, and the OS dialog
was there again — sitting over the feed. Worse: after deliberately turning
notifications off in Android Settings, the very next launch asked again.

The cause was small. The first implementation held "have we already asked?" in
`rememberSaveable`, which survives a configuration change but not process death,
so every cold start believed it had never asked.

### Why it counts as a defect and not a preference

`04-mobile-architecture.md` says the permission is *requested contextually*. A
dialog that returns every morning is not context; and somebody who went into
Settings on purpose to turn notifications off has given an unambiguous answer
that the app then talked over. Android caps the practical damage — it stops
showing the dialog after two refusals in a row — but the cap is the platform's
good behaviour covering for the app's, and a revoke resets the counter.

**LOW**, not higher: nothing is insecure, nothing is lost, and the reader can
always refuse again. It is a respect-for-the-answer defect, not a functional one.

### The fix

`PushPromptStore` remembers that the app has had its turn to ask — and only
that. It never mirrors the grant state, which belongs to the operating system
and goes stale the moment somebody changes it in Settings.

Not re-asking creates an obvious hole: how does somebody who refused change
their mind? Android will not show the dialog again, so an in-app button that
"asks" would do nothing and look broken. So the notification-preferences screen
now shows a notice **only while the OS is refusing**, explaining the situation
and offering a control that opens the Android settings page which can actually
change it. Granting there clears the notice on resume and re-registers the
device.

### Evidence

| Check | Result |
| --- | --- |
| A refusal is not re-asked on the next cold start | PASS |
| A deliberate revocation is not re-asked on the next launch | PASS |
| Preferences explain that the phone is refusing notifications | PASS |
| …and offer a control that can actually change it | PASS — opens `Settings$AppNotificationSettingsActivity` |
| The per-category switches remain usable | PASS |
| Granting from Android Settings clears the notice and re-registers | PASS |

Mutation-proven: forcing `PushPromptStore.hasAsked()` to return `false` fails
"a refusal is not re-asked on the next cold start", and takes four downstream
checks with it — which is precisely the cascade the original defect caused.

---

## QA-012 — the smoke test's event-listing check had a page budget it outgrew

| | |
| --- | --- |
| **Severity** | LOW |
| **Area** | QA harness — `scripts/posix/api-smoke-test.mjs` |
| **Requirement** | EVENT-FR-005, EVENT-FR-007; the harness is the executable evidence |
| **Status** | **CLOSED** |

### What happened

`npm run verify` went from `16 passed · 0 failed` to `14 passed · 1 failed`
between two runs an hour apart, with no change to any API code. The failing
check was *"and it is still in the upcoming list until its original date
passes"* — a cancelled event that should remain visible so its attendees find
out.

It was not a product failure. The check paged the upcoming list looking for the
event, up to **twenty pages of fifty**. The smoke fixture database is never
reset, so upcoming events accumulate on every run; there are now **1,110**, and
the event under test sits on page **22**.

### Why this is worth a register entry rather than a quiet edit

This is the same defect twice. The code carried a comment explaining that an
earlier version had asserted against a single `?limit=50` page and *"passed
until there were more than fifty upcoming events"* — and the fix for that was to
pick a bigger arbitrary number. A third arbitrary number would only move the
date of the next false failure.

A harness that reports a product failure for correct behaviour is the more
expensive direction of the two failure modes named at the top of this register:
it costs a real investigation every time, and it teaches whoever sees it to
distrust the suite.

### The fix

Stop on the ordering instead of on a budget. The list is soonest-first, so once
a page begins later than the event under test starts, the event is genuinely
absent and the search can stop. Work is now bounded by where the event sits in
time rather than by how much fixture data has piled up.

Mutation-proven: searching for an id that does not exist makes the check **FAIL**
at page 22 and terminate, so the loop is bounded and the assertion is not
vacuous. Reverted.

`422 passed · 0 failed · 422` after the fix, found on page 22.
