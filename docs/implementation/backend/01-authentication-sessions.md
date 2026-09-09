# EPIC-02 — Authentication and sessions

**Status:** implemented · **Stage:** 6 (backend API) · **Module:** `platform/identity`

Requirements: AUTH-FR-001…011 · BR-002/004/005/007/034/035/036 · SEC-001/002/003/005/006/007/020/021/024 · PRIV-002/003/010 · EDGE-001/003/004/005/009/010 · ADR-008

This records **what was built and why the non-obvious decisions were made**. The
frozen architecture in `docs/architecture/` remains authoritative for *what* is
required; this documents the implementation that satisfies it, and the places
where building it revealed something the design documents did not say.

---

## 1. The one idea that shapes everything

**A stranger must not be able to learn who holds an account.**

For a civic platform in Pakistan that is not a preference. Membership of a
neighbourhood platform, tied to a mobile number, is exactly the information that
puts people at risk — so every endpoint that touches an identifier answers the
same way whether or not the identifier is known.

| Endpoint | Free / unknown | Already registered | Banned | Wrong password |
|---|---|---|---|---|
| `POST /register` | `202` | `202` | `202` | — |
| `POST /login` | `401 INVALID_CREDENTIALS` | — | `401 INVALID_CREDENTIALS` | `401 INVALID_CREDENTIALS` |
| `POST /otp/verify` | `401` | — | `401` | `401` (wrong/expired/used) |
| `POST /otp/resend` | `202` | `202` | `202` | — |
| `POST /password/forgot` | `202` | `202` | `202` | — |
| `POST /password/reset` | `401` | — | `401` | `401` |

Two consequences worth stating plainly, because both are easy to undo later:

**There is no error code for "no such account".** `IdentityErrorCode` contains
no `ACCOUNT_NOT_FOUND`, no `ALREADY_REGISTERED` and no `ACCOUNT_BANNED`. Adding
one would re-open the oracle without touching a single service — the code *is*
the disclosure.

**Timing is part of the response.** `LoginService` verifies a password hash even
when no account exists, against a decoy built from a random secret nobody holds.
The obvious implementation returns early for an unknown number, skipping ~236 ms
of Argon2 and turning latency into a membership oracle: fast means "nobody
here". `AdminAuthService` does the same, where the set to enumerate is far
smaller and more valuable.

The distinction users need is delivered by the **OTP**, which only ever reaches
the number's actual holder.

---

## 2. What was built

| Layer | Files |
|---|---|
| Domain (pure) | `phone-number`, `identifier-hash`, `otp`, `session-token`, `user-state`, `password-policy`, `login-lockout` |
| Ports | `password-hasher`, `sms-provider`, `clock` |
| Adapters | `argon2-password-hasher`, `fake-sms-provider` |
| Repositories | `identity.repository.port` + `pg-identity.repository`; `admin-identity.repository.port` + `pg-admin-identity.repository` |
| Application | `register`, `otp`, `login`, `session`, `password`, `admin-auth` |
| Transport | `auth.controller`, `auth.dto`, `session.guard`, `admin-session.guard` |
| Migrations | `0003` identity schema · `0004` terms + age · `0005` OTP throttle · `0006` login attempts · `0007` credential-store privileges |

Endpoints, against the frozen list in `08-api-architecture.md`:

| ID | Route | Auth | Implemented |
|---|---|---|---|
| AUTH-API-001 | `POST /register` | — | yes |
| AUTH-API-002 | `POST /otp/verify` | — | yes |
| AUTH-API-003 | `POST /otp/resend` | — | yes |
| AUTH-API-004 | `POST /login` | — | yes |
| AUTH-API-005 | `POST /logout` | U | yes |
| AUTH-API-006 | `POST /password/forgot` | — | yes |
| AUTH-API-007 | `POST /password/reset` | — | yes |
| AUTH-API-008 | `POST /session/refresh` | U | yes |
| AUTH-API-009 | `POST /account/restore` | U | **deferred to EPIC-14** (account deletion and restore is settings' own flow, SET-FR-005) |
| AUTH-API-010 | `POST /admin/login` | — | yes |
| AUTH-API-011 | `POST /admin/logout` | A | yes |

`POST /password/change` is additionally implemented for SET-FR-002.

---

## 3. Decisions that are not obvious from the requirements

### 3.1 Guarding is the default; opting out is explicit

`SessionGuard` is registered as a global `APP_GUARD`. Every route in every
module requires a session unless it declares `@Public()`.

The alternative — guard per controller — was rejected because of what happens
when someone *forgets*. Opt-in leaves an endpoint **open**; opt-out leaves it
**dead**, and a dead endpoint fails loudly in the first test that calls it. With
fifteen modules still to be written, mostly by agents working one epic at a
time, that asymmetry matters more than the small cost of writing `@Public()`
seven times in this epic.

`@RequiresAdmin()` is the reverse — opt-**in** — for the same reason applied to
a different mistake. A route that forgot to require an admin would fall through
to the user guard and be reachable **by any signed-in user**: silent privilege
escalation. So admin routes must say so, and `SessionGuard` steps aside for
them rather than rejecting the administrator's token as an invalid user session.

### 3.2 Sessions are opaque rows, and that is the whole point (ADR-008)

Authority lives in a row, not in a signed token, so a ban, suspension, logout or
password reset takes effect **on the very next request** (EDGE-010) with no
deny-list. Account state is re-read on every request rather than trusted from
login: a moderator's suspension has to bite immediately, not at the user's next
sign-in — which is precisely when a suspended person would avoid signing in.

**Idle expiry, 60 days, slid on use** (AUTH-FR-010). An earlier draft used a
30-day *absolute* lifetime, which is wrong twice: an absolute limit signs out
the **active** user, punishing the wrong person and training people to re-enter
passwords often, which is how credentials get phished.

`slidExpiry` refuses to extend a revoked or expired session. Sliding must never
resurrect one, or revocation means nothing. It also declines to write when the
gain is under a minute — otherwise every scroll of a feed issues an `UPDATE`.

**Admin sessions are the deliberate opposite: 8 hours absolute** (SEC-024). An
admin console left open on an unattended machine *is* the risk, so it ends on
schedule however busy the moderator is.

### 3.3 The OTP lockout is what makes the attempt cap real

`0003` implemented three of the five OTP rules. The other two needed
`0005`, and the reason is worth keeping:

> Without a lockout, the 5-attempt cap is decorative. Exhaust five guesses, call
> resend, and the counter is back at zero. That is unlimited guessing with extra
> steps — and every round costs the victim an SMS.

`attempts_exhausted_at` is stamped in the **same statement** that increments the
counter, so the two cannot disagree, and `COALESCE` keeps the first stamp so a
later attempt cannot push the window further out. The lockout is checked on
**verify as well as resend**: checking only the current challenge's counter
would let an attacker resend past it the moment the 60-second cooldown lapsed.

Attempts are spent **before** the code is compared and in the same transaction,
so parallel guesses cannot all read `attempts = 0`. Expiry is checked **before**
the counter, so a stale code cannot burn a legitimate user's remaining attempts.
A malformed code is input, not a guess — otherwise five junk requests lock
someone out of their own registration.

### 3.4 The login lockout needs two keys, not one

`08-api-architecture.md` §274 says limits apply *per account **and** per source
address*, and each alone is a hole:

- **Account only** — anyone who knows a number can fail ten logins against it
  and lock its owner out for half an hour, repeatedly. The lockout becomes the
  attack.
- **Source only** — one machine sprays a single guess across thousands of
  accounts and never trips a counter.

The per-source threshold is deliberately much higher (50 vs 10). Behind
carrier-grade NAT — the normal case in Pakistan, not the exception — one address
is shared by many unrelated people, so a tight limit there would lock out whole
neighbourhoods for one attacker's behaviour. It is a backstop against spraying,
not the primary control.

Failures are counted **since the last success**, so someone who mistypes nine
times, gets in, then mistypes twice is not locked out by failures they already
recovered from.

`login_attempts` stores **hashes only** and has **no foreign key to `users`**.
Rows are written for identifiers with no account, so the table would otherwise
become a list of phone numbers belonging to non-members — exactly the data the
platform has no business holding (PRIV-010) — and its *shape* would answer the
question the responses refuse to.

### 3.5 A password reset and its revocations are one transaction

BR-035, and the reason it must be atomic rather than merely prompt: someone
resetting their password is very often doing it *because* they believe another
person has access. If the new hash commits and revocation is a separate step
that then fails, **the attacker keeps a live session while the victim believes
they have just locked them out** — the worst available outcome, and a silent
one. The session list is read *inside* that transaction, so a session created
between an earlier read and the write cannot survive.

`/password/reset` is public, so it carries its own proof — phone, code and new
password in one call. An intermediate "reset token" after OTP verification would
create another bearer credential to leak, log or replay for no gain.

Policy is checked **before** the code is spent: burning a one-time code on a
policy failure forces another SMS, and at three per hour that can lock someone
out of their own recovery.

`/password/change` requires the **current** password even though the caller
already holds a session — a borrowed or stolen phone must not be enough to lock
the owner out. It signs out other devices but keeps this one: the person is
present and has just proved it, while everyone else, who may be the reason for
the change, goes.

### 3.6 The two credential stores are separate types, not separate names

SEC-020 asks for a separate administrator store. `AdminIdentityRepository` is
its own port, so authenticating against the wrong store is a **compile error**
rather than a code-review question. The port has no create/update/delete:
provisioning is the technical owner's CLI (S2-CR-005) and there is no bootstrap
endpoint in any environment, so a create method here would be the first step
towards one existing by accident.

Administrators get **five** failures rather than ten. The population is tiny and
known, and every one of them can act on other people's accounts; ten failures
against an administrator is not fumbling, it is an attack.

### 3.7 The principal carries no identifier

`AuthenticatedPrincipal` is `{ userId, sessionId, state, capability,
suspendedUntil }` — no phone number, no date of birth, no email. It reaches
every product module, and `06-backend-modules.md` forbids a raw identifier
leaving identity (PRIV-002/003). A feature that needs the number must ask for it
rather than find it already in hand. It is stored on the request under a
`Symbol`, so a handler that carelessly serialises the request cannot spill it.

### 3.8 The audit log outlives erasure, so it must never hold an identifier

The log is retained **pseudonymously after account erasure** (OD-019). That
makes it the one place where writing a phone number silently defeats a deletion
request forever. `assertNoIdentifiers` refuses phone numbers, email addresses,
dates of birth and suspicious key names before the row is written, and the error
never contains the offending value — that would move the identifier into the
application log one hop later.

Getting this right took two attempts, and the second failure is instructive. A
digit-run heuristic matched inside UUIDs. Tightening to whole tokens fixed the
obvious cases, but a random-UUID loop then failed: a UUID's hyphen-separated
digit groups can concatenate into a valid number — `92312345-6789-…` strips to
`923123456789`, which is `92` + a real `03xx` mobile. UUIDs are now removed
before scanning, and the adversarial shapes are pinned deterministically instead
of left to chance.

Worth being explicit about the trade-off: **a privacy guard that refuses
legitimate audit writes makes the trail less trustworthy, not more.** Both
directions had to be correct.

---

## 4. Things building this revealed

These are corrections to the implementation, not changes to approved
requirements. None of them alters a frozen decision.

| Found | Was | Now |
|---|---|---|
| `0003` was built from the mermaid ERD, which omits columns the authoritative catalogue in `07-database-design.md` §2.1 lists | no `terms_version` / `terms_accepted_at` | added in `0004`, `NOT NULL`, plus BR-002 minimum age as a server-clock `CHECK` and a plausibility bound (a future date of birth is trivially "over 13") |
| Session expiry | 30 days absolute | 60 days idle, slid on use (AUTH-FR-010, ADR-008 §42) |
| `checkOtpUsable` read the ambient clock while tests ran on a fake one, so every "expired" assertion was accidentally true | `new Date()` inside the domain call | a `Clock` port; "fifteen minutes later" is an assertion, not a sleep |
| The global guard covered `/health`. A probe carries no bearer token, so `/health/ready` would have returned `401`, the orchestrator would have judged the process unhealthy, and **no traffic would ever reach a working service** | guarded | `@Public()` on `HealthController` |
| The error filter, request logging, helmet, CORS and `trust proxy` were applied imperatively inside `bootstrap()`, so anything booting `AppModule` got the same routes with **none of the security posture** | wiring in `main.ts` | extracted to `configure-app.ts`; `main.ts` and the smoke test call the same function |
| `req.ip` is the socket address unless Express `trust proxy` is set — and it was not, though a comment claimed otherwise | unset | `TRUST_PROXY_HOPS`, explicit, default `0`, with a startup warning outside development |
| `runtime_app` could `INSERT` into `admins` — inherited from the `ALTER DEFAULT PRIVILEGES` in `roles.sql`. Nothing in the application does this, so the privilege existed purely as capability: an injection or code-execution flaw in the API could mint itself an administrator | full DML | `0007`: `SELECT` only on `admins`; the worker loses access entirely. Asserted by the smoke test |
| `provision-admin.mjs` reported `adminsTableExists: false` long after the table existed, because it shelled out to `psql` and a missing **tool** was indistinguishable from a missing **table** | `spawnSync('psql')` | the `pg` client, with a three-way answer (`true` / `false` / `unknown`) |

`TRUST_PROXY_HOPS` deserves one more line, because both mistakes are real and
opposite. Too low: every request behind a load balancer reports the balancer's
address, the per-source lockout counts the whole internet as one client, and 50
failures lock out everybody. Too high: the address becomes a header the client
sets, and the limit stops existing. A hop **count**, not `true` — `true` trusts
the whole chain, so the client-supplied left-most entry can win.

---

## 5. How this is tested

**277 unit tests** in `apps/api`, and **31 checks over real HTTP** in
`scripts/posix/auth-smoke-test.mjs`.

The split matters. Unit tests prove the *rules*; they cannot fail when a
controller never mounts, the guard is not applied, the DI graph does not
resolve, or the error envelope says something different from what a client
parses. The foundation already learned this: the Socket.IO gateway compiled,
passed its tests, and silently never mounted. So the single most valuable
assertion in the smoke test is that `POST /register` is not a `404` — and it is
the smoke test, not a unit test, that found both the `/health` regression and
the `configure-app` divergence.

The §14 critical matrix, and where each is proved:

| Case | Where |
|---|---|
| Concurrent duplicate registration (EDGE-001) | `register.service.spec` — the race returns the identical `ACCEPTED`; uniqueness is decided by the `UNIQUE` index inside the transaction, never by a prior `SELECT` |
| Number uniqueness | migration `0003` `UNIQUE (value_hash)`; `pg-identity.repository` returns `null` on `23505` |
| OTP expiration · reuse · resend-invalidation · attempt lockout | `otp.service.spec`, on a controlled clock |
| Auth enumeration resistance | `register`, `login`, `otp`, `password` specs each assert that every failure branch serialises to one value; the smoke test asserts it over HTTP |
| Timing uniformity | `login.service.spec` — both the no-account and the wrong-password paths perform the same number of hash verifications |
| Sixth-device eviction (BR-007, EDGE-009) | `login.service.spec` — six logins, then the **first** device's token is dead and the second-oldest still works |
| Password-reset session revocation (BR-035) | `password.service.spec` and `session.service.spec` |
| A user credential rejected by admin auth, and the reverse (SEC-020) | `admin-auth.service.spec`, and over HTTP in the smoke test with a real seeded administrator |
| Revocation within one request cycle (EDGE-010) | `session.service.spec` (ban mid-session) and the smoke test (revoked token refused on the next request) |
| The runtime role cannot create an administrator | smoke test, asserted directly against the database |

No test sends SMS, email or push to a real recipient: the only SMS adapter is
the deterministic fake, which records instead of sending. Test data is
synthetic, and the smoke test generates a distinct number per run so repeats do
not collide on the unique index.

---

## 6. Open and deferred

| Item | Status |
|---|---|
| **OD-020 — technical owner not named** | `provision-admin.mjs` still refuses to create an administrator. The schema is ready and the remaining blocker is purely governance: an administrator must belong to a named accountable human, and creating one that belongs to nobody is worse than having none. Not a block an engineer may clear. |
| **DEP-002 — no SMS provider selected** | Only `FakeSmsProvider` exists. A real adapter is chosen and wired in EPIC-11, behind the same port. |
| **Argon2 parameters** | Benchmarked on the development host to ~236 ms (`m=98304, t=3, p=1`). Host-specific; **must be re-benchmarked** on the production host when one is selected. Read from configuration, so that needs no code change. |
| **`TRUST_PROXY_HOPS`** | Defaults to `0`. Must be set per deployment once the topology is known. |
| **OTP dispatch is direct, not outboxed** | `TODO(EPIC-11)`: move to the transactional outbox so delivery survives a process restart. Acceptable while the only adapter is a deterministic fake. |
| **`login_attempts` growth** | `TODO(EPIC-15)`: scheduled pruning. Nothing older than the longest lockout window affects a decision. |
| **AUTH-API-009 `/account/restore`** | EPIC-14, with the rest of deletion and restore (SET-FR-005). |
