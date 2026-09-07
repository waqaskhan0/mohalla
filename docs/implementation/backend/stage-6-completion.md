# Stage 6 — Backend Implementation · Completion Report

**Shehersaaz Community Platform (Mohalla — محلہ)**
Branch `feature/stage-6-backend-v1` · 27 commits · `54fb3c0` … `d603dd7`
Report date: **7 September 2026**

---

# Verdict

## 🟢 The backend is complete. 🔴 The release is not approved.

Every **backend** epic in Stage 6's scope — **EPIC-02 and EPIC-04 … EPIC-16, fourteen in
all** — is implemented, tested against a real PostgreSQL instance, and exercised over real
HTTP. All seven mandatory integration tests exist and pass.

**Nothing that was checked is broken. Seven release criteria were never checked**, because
they need a physical device, a published legal document, a paid provider, or a person with
authority this repository does not have. They are listed in §7 with their owners.

`npm run verify` → **12 lanes pass · 0 fail · 3 BLOCKED**
`npm run smoke:api` → **413/413**
`npm run release:gate` → **47 checks pass · 6 criteria verified here · 7 BLOCKED**

---

## 1 · What was built

| | |
|---|---|
| Epics delivered | **14** (EPIC-02 · EPIC-04 … EPIC-16) |
| Modules | **18** — 6 platform · 10 product · 2 admin |
| Migrations | **22**, forward-only (ADR-008) |
| HTTP endpoints | **105** |
| TypeScript source | **254 files · ~42,000 lines** |
| Test files | **61** |

### Epics

| Epic | Scope | Agent-safety rating |
|---|---|---|
| 02 | Authentication & sessions | ❌ security-critical |
| 04 | Profiles & verification | ✅ |
| 05 | Social graph & blocking | ❌ privacy-critical |
| 06 | Posts & media | ⚠️ (upload path ❌) |
| 07 | Feed & engagement | ✅ |
| 08 | Search — cross-script Urdu / Roman Urdu | ✅ |
| 09 | Messaging & message requests | ❌ privacy-critical |
| 10 | Events & RSVPs | ✅ |
| 11 | Notifications — outbox and push | ⚠️ |
| 12 | Safety & moderation | ❌ integrity-critical |
| 13 | Admin Portal (API) | ⚠️ (enforcement ❌) |
| 14 | Settings & account deletion | ❌ irreversible |
| 15 | Observability, security & recovery | ⚠️ |
| 16 | Release validation | ❌ |

**EPIC-01 and EPIC-03 are not in this list**, and should not be read as delivered. Their
Stage 5 foundation outputs exist — `packages/contracts` (correlation, errors, health),
`packages/design-tokens`, the `en`/`ur` catalogues with the parity guard, and Android's
`AppLocale` / `LocaleManager` — but EPIC-03's substance is RTL across the interface, which is
Android work and is exactly what REL-002 and mandatory test G remain blocked on (§7).

**Nine of the fourteen carry ❌ or ⚠️ agent-safety ratings, and six of those say human review
is mandatory.** This report is not that review. It records what was built and what was
verified; the sign-off on security-critical, privacy-critical, integrity-critical and
irreversible work is a separate act by a person.

---

## 2 · Verification

### Automated tests — 1,059 passing

| Workspace | Tests |
|---|---|
| `apps/api` | 902 |
| `packages/db` (real PostgreSQL) | 90 passing · **3 skipped** |
| `packages/observability` | 32 |
| `apps/worker` | 18 |
| `packages/validation` | 11 |
| `apps/admin` | 6 |
| **Total** | **1,059 passing · 3 skipped** |

The 3 skips are `read_only_support` privilege tests, which need
`READ_ONLY_SUPPORT_DATABASE_URL`. That role's privileges are therefore **unverified in this
run** — an environment gap, not a defect, and worth closing before release.

### End-to-end over real HTTP

| Suite | Result |
|---|---|
| `npm run smoke:api` — every epic's flow against the real app and database | **413/413** |
| `npm run release:gate` — mandatory tests A/B/E + REL-003/004/005 | **47/47** |

### `npm run verify` — 15 lanes

```
PASS     build shared packages
PASS     guard: module dependency direction
PASS     guard: localization parity
PASS     guard: secret scan
PASS     format check
PASS     lint (includes the RTL gate)
PASS     build all apps
PASS     unit tests (api, worker, validation, admin)
PASS     migration status
PASS     audit append-only test
PASS     api smoke test (real HTTP)
BLOCKED  release gate (REL-001…008, tests A/B/E)
BLOCKED  backup for the rehearsal (SEC-026)
BLOCKED  restore rehearsal (REL-007)
PASS     android lint + unit tests
```

**BLOCKED is a third answer, not a soft pass.** Verify refuses to call a run complete while
any lane holds one. The release-gate lane runs fully and reports blocked *release criteria*;
the two rehearsal lanes are blocked because the PostgreSQL client tools are absent on the
development host.

---

## 3 · The seven mandatory integration tests

§15.2 names these as release gates: each targets a rule where a silent failure would be
severe and would not surface in ordinary use. **All seven now exist.**

| | Test | Where | Status |
|---|---|---|---|
| **A** | Block privacy — ten surfaces, one identical refusal, within a timing band | `release-gate.mjs` | ✅ |
| **B** | Session revocation on the next request, on every device | `release-gate.mjs` | ✅ |
| **C** | Report-threshold race — atomic auto-hide under concurrency | `packages/db` | ✅ |
| **D** | Moderator collision — optimistic version lock | `packages/db` | ✅ |
| **E** | Message idempotency — six concurrent identical `clientMessageId` | `release-gate.mjs` | ✅ |
| **F** | Deletion lifecycle — restore vs erasure cannot interleave | `packages/db` | ✅ |
| **G** | RTL end-to-end through every module | Android | 🔴 **BLOCKED** |

C, D and F run against real PostgreSQL rather than in-memory fakes, because they are claims
about **transaction interleaving** — an in-memory fake decides those in a single-threaded
loop, which is a different claim from the one being made.

**Test F pinned an asymmetry worth recording.** The erasure sweep can only contend for a
deletion request *after* the grace boundary, and a restore can only succeed *before* it. So
a restore still holding the row lock when day 30 arrives re-reads the deadline and declines.
Losing is the correct direction: a user refused in the last second can log in again; a user
restored onto erased content cannot.

---

## 4 · Architectural conformance

- **Three-tier module dependency** (Admin → Product → Platform) enforced by
  `check-module-dependencies.mjs` on **imports**, on every verify. Clean across 18 modules.
- **Inverted edges are ports**, bound at the composition root — the only wiring in
  `app.module.ts`, and it says why.
- **Forward-only migrations** (ADR-008). 22 applied; corrections are new migrations.
- **Transactional outbox** (ADR-014) — domain events written in the producing transaction;
  the worker drains on a schedule and enqueues nothing.
- **Neutral-refusal discipline** — missing, blocked and deleted collapse to one
  `RESOURCE_UNAVAILABLE`, with documented exceptions.
- **ADRs realised in code:** 007, 008, 009, 010, 011, 012, 013, 014, 016, 018, 019, 021.
- **ADR-013 (PDF):** gated **off by default**. The ADR says that if no safe sanitisation
  mechanism fits V1, PDF is cut rather than SEC-013 weakened. The safe default is in place;
  the decision itself remains open.

---

## 5 · Defects found and fixed during the stage

The ones worth a reviewer's attention, because each was invisible to the tests that existed
at the time.

### Content of deleted accounts was disappearing (BR-009 · PRIV-006) — cross-epic
Every content read path asked *"is the author publicly visible?"* and dropped the content
when the answer was no. Correct for a ban; **wrong for a deletion**, where the product
promises out loud — before the user confirms — that posts and comments remain, attributed
to "Deleted User", *"because it differs from the erasure many will assume."*

The schema had been built for it (the anonymous actor is state `DELETED` and has a profile
row); the read paths never were. Fixed in posts, comments and the feed by separating two
questions that had been conflated. **This changed modules from EPIC-06 and EPIC-07 and
deserves attention beyond EPIC-14's own review.**

### An alert that contradicted its own rationale
`dead_letter_growth` was `threshold: 1, comparison: 'above'` — which fires on the *second*
permanently-lost job, while its rationale said the first. Now `threshold: 0`.

### A migration without grants
Migration 0022 created `backup_runs` but granted nothing, and the metrics endpoint returned
500 on `permission denied`. `runtime_app` now has `SELECT` and nothing more — an application
that could write that table could report a backup that never happened.

### Two tests that passed while proving nothing
Both found by reading the evidence strings rather than the PASS marks:
- A block-privacy check pointed at `/search/users`, received a **routing 404**, and passed —
  a typo returning nothing.
- An idempotency check searched the outbox for the message id, which the payload does not
  carry, found zero, and passed on a `<= 1` comparison that could not distinguish *one*
  notification from *none*.

### A rehearsal that stranded its own ledger row
The restore rehearsal called `process.exit` on a missing binary, leaving the `RUNNING` row it
had just written open forever — precisely the ambiguity the ledger exists to remove.

### Earlier in the stage
An empty conversation raising a message-request badge on someone's phone · socket
authentication running *after* connect · like-batching double-counting its own summary row ·
`MAX()` on a `uuid` column (parses, fails at execution) · a conversation "owner" derived from
UUID ordering, silently refusing whichever participant sorted lower.

---

## 6 · What Stage 6 deliberately did not build

Stated so the scope is not mistaken for a gap:

- **The Android application.** 13 Kotlin files; the app is the design-system and
  localization foundation from EPIC-03, not the product.
- **The Admin Portal front end.** `apps/admin` is a Next.js shell — three files. The admin
  **API** is complete (EPIC-13).
- **Any deployment.** No staging, no production, no paid provisioning.
- **Real SMS or push delivery.** Deterministic fakes only; no message reached a real
  recipient at any point.

---

## 7 · What is blocked, and who owns it

**None of these can be cleared from inside this repository.**

| Item | Blocked by | Owner |
|---|---|---|
| REL-001 · REL-008 · NFR-COMP-002 — the journey on **three physical low-to-mid-range devices** | Needs the Android build and real hardware. The SRS is explicit that emulators do not reproduce low-end performance. | Shehersaaz |
| REL-002 · Test G — **RTL across every screen** | Android UI, plus **DEP-011 / OD-016** — ~400 Urdu strings | Shehersaaz |
| REL-006 — Privacy Policy, Terms, Community Guidelines at reachable URLs | **OD-015** — the content does not exist | Shehersaaz |
| REL-007 — a **proven** restore | Mechanism built in EPIC-15; never run against a production backup. Needs a host with PostgreSQL client tools. | Technical |
| **An administrator existing at all** | **OD-020 / DEP-016** — no named technical owner, so none may be provisioned and no bootstrap endpoint exists in any environment | Shehersaaz |
| BR-046 / PRIV-006 / PRIV-007 retention wording | **OD-019** — legal confirmation | Legal |
| SEC-027 — backups encrypted at rest | The destination must provide it; `pg_dump` does not | Technical |
| Repository licence | Licence decision outstanding | Shehersaaz |
| Publication of this work to the public remote | Publication-authorization record **not approved** | Shehersaaz |

### The administrator gap is larger than it looks

It does not only block the admin portal. **A3 — that somebody reviews the moderation queue
daily — is rated *Severe***, and EPIC-15 built an alert that pages when the oldest open case
passes 24 hours. Right now that alert would page nobody, because nobody holds the role.

The safety loop is implemented and tested end to end. It has no operator.

---

## 8 · Publication status

**No Stage 6 work has been pushed.** All 27 commits are local, per the standing instruction
that new backend implementation must not reach the public remote until an approved
publication-authorization record exists.

The governance record
(`docs/governance/PUBLIC-REPOSITORY-AUTHORIZATION-REQUIRED.md`) remains **NOT APPROVED**. The
exposure audit found no confidential material, and the addendum's own reading is that this is
an open governance item rather than a hard blocker — but the authorization has not been
given, so the push has not been made.

---

## 9 · Recommended next steps

**Before any release conversation**

1. **Name a technical owner (OD-020).** It unblocks administrator provisioning, gives the
   moderation-queue alert a recipient, and is the prerequisite for A3 being a real process
   rather than an assumption.
2. **Run the restore rehearsal (REL-007)** on a Linux host or in CI:
   `npm run db:backup && npm run db:restore:rehearsal`. Then point staging at the restored
   copy and run the smoke suite, per §15.5.
3. **Set `READ_ONLY_SUPPORT_DATABASE_URL`** so the three skipped role-privilege tests run.

**Human review, before merge**

4. Review the six epics marked *human review mandatory* — 02, 05, 09, 12, 13, 14.
5. Review the **cross-epic BR-009 fix** (§5) on its own terms: it changed content visibility
   in modules delivered by earlier epics.

**Organisational, in parallel**

6. Resolve **OD-015** (legal documents), **OD-016 / DEP-011** (Urdu strings), **OD-019**
   (retention wording), the licence decision, and the publication authorization.
7. Decide **ADR-013**: approve a PDF sanitisation capability, or record PDF as cut from V1.
   The safe default is already in force either way.

---

## Appendix · Reproducing this report

```bash
# 12 lanes, plus the blocked ones named explicitly
npm run verify

# every epic's flow against the real app and database
npm run smoke:api

# REL-001…008 and mandatory tests A, B, E
npm run release:gate

# mandatory tests C, D, F against real PostgreSQL
npm run test --workspace @mohalla/db
```

Requires `DATABASE_URL`, `MIGRATION_DATABASE_URL`, `RUNTIME_APP_DATABASE_URL` and
`METRICS_TOKEN`; `RESTORE_TARGET_URL` additionally for the rehearsal lanes. There is no
`.env` in the repository — see `.env.example`.
