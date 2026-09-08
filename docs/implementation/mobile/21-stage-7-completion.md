# 21 — Stage 7 Completion Report

**Stage 7 · Android mobile application** · `feature/stage-7-android-v1`

---

## The two verdicts

### MOBILE FEATURE IMPLEMENTATION: **NOT COMPLETE**

### RELEASE VALIDATION: **NOT APPROVED**

§28 lists what "feature-complete" requires. Three of its conditions are unmet,
and none of the three is an external dependency:

| §28 condition | State |
|---|---|
| Mandatory emulator flows are executed | **2 of 11.** A and G ran; B, C, D, E, F, H, I, J, K did not |
| Accessibility implementation/audit is performed | **Source-level only.** Ten invariants hold across the tree; no device audit, no TalkBack, no font-scale run |
| No known code defect prevents a Must flow | **Two open defects.** RUNTIME-005 and RUNTIME-006 |
| All 61 screens represented | ✅ one canonical schema, 61 rows, 0 duplicates |
| Required screens implemented | **59 of 61.** `UX-HOME-005` and `UX-HOME-006` not started |
| Local API integration gaps fixed | ✅ one found, one fixed (MOBILE-BACKEND-FIX-001) |
| Runtime RTL executed | ✅ Flow G, measured |
| Build · lint · tests pass | ✅ |

§32 says not to write this file prematurely and bend the evidence to match it.
The evidence says not complete, so that is what it says. **This is much closer
than it was** — the runtime environment now exists and works, and the two flows
that ran found and fixed six real defects — but two of eleven flows is not
eleven.

---

## 1. Branch and commits

| | |
|---|---|
| Branch | `feature/stage-7-android-v1` |
| Base | `0981b1a` (`origin/main`, untouched) |
| HEAD | `5c3b171` |
| Commits ahead of `main` | **60** — 30 Stage 6 backend, 30 Stage 7 |
| This pass | 8 commits, `02c3c03..5c3b171` |
| Remote | `origin/feature/stage-7-android-v1` at `5c3b171`, in sync |
| `main` touched | **NO** |
| Merge status | **NOT MERGED — AWAITING OWNER REVIEW** |

## 2. Screen coverage — 61 of 61 represented

One canonical fourteen-column schema (§3), 61 rows, 0 duplicates, 0 missing.

| Build status | |
|---|---|
| ✅ Complete both directions | 55 |
| ◐ Partial | 4 — `UX-AUTH-008` `UX-CREATE-003` `UX-EVENT-002` `UX-SET-005` |
| ✗ Not started | 2 — `UX-HOME-005` `UX-HOME-006` |

| Runtime status | |
|---|---|
| ✅ Exercised in an executed flow | **15** |
| ✗ Exercised and failed, fixed, re-render not executed | 1 — `UX-SETUP-003` |
| — **NOT EXECUTED** | **45** |

## 3. Requirement coverage — 77 Musts

| Status | Count | Of which Must |
|---|---|---|
| `IMPLEMENTED` | 79 | **62** |
| `PARTIAL` | 21 | 13 |
| `BLOCKED EXTERNAL` | 6 | 1 |
| `DEFERRED SHOULD` | 4 | 0 |
| `REMOVED APPROVED` | 1 | 0 |
| `OUT OF SCOPE` | 1 | 1 |
| **Total** | **112** | **77** |

**The numbers did not move this pass, but their truth did.** Three Musts were
recorded `IMPLEMENTED` and were not actually working on a device:

| Requirement | Was recorded | Actually |
|---|---|---|
| `AUTH-FR-002` OTP verification | IMPLEMENTED | issued no session — registration could not complete |
| `AUTH-FR-008` Age gate | IMPLEMENTED | the date field could not be typed into at all |
| `LOCALE-FR-002` Switch language | IMPLEMENTED | mirrored the layout and left every string in English |

All three are now genuinely implemented and runtime-verified. That is the
strongest argument in this document for finishing the remaining nine flows:
**every flow that ran turned a documented `IMPLEMENTED` into a defect.**

`PROFILE-FR-006` (account type) was implemented in group 23 and is now proved
end to end, with `ORGANIZATION` persisted in Postgres.

## 4. Build, lint, tests

| | |
|---|---|
| Android clean build | **PASS** |
| Android Lint (`lintDebug`) | **PASS**, clean |
| Android unit tests | **487** across 33 classes · **0 failures** |
| Backend tests | **904** across 46 files · **0 failures** |
| **Total** | **1391 · 0 failures** |
| `npm run verify` | **12 passed · 0 failed · 3 blocked** |
| `npm run smoke` | **8 passed · 0 failed · 0 blocked** |
| `guard:all` | dependency direction · locale parity · secret scan — all **PASS** |
| Compose UI tests | **none exist** — now writable, not written |
| Navigation tests | JVM only (`NavigationRtlTest`, `StartupRoutingTest`) |

The 3 blocked verify lanes (release gate, backup, restore rehearsal) need a
second database that was not provisioned. **BLOCKED, not PASS.**

## 5. Emulator flows

| Flow | Result |
|---|---|
| **A — New user** | **PASS** — six defects found and fixed |
| B — Returning user | NOT EXECUTED |
| C — Create post | NOT EXECUTED |
| D — Social | NOT EXECUTED |
| E — Message request | NOT EXECUTED |
| F — Events | NOT EXECUTED |
| **G — RTL** | **PASS** for mirroring and translation · RUNTIME-006 open |
| H — Block privacy | NOT EXECUTED |
| I — Suspension | NOT EXECUTED |
| J — Offline | NOT EXECUTED |
| K — Account deletion | NOT EXECUTED |

Full step-by-step evidence in [`19-mobile-test-report.md`](19-mobile-test-report.md).

## 6. Runtime results by area

| Area | Result |
|---|---|
| **LTR** | **PASS** — 15 screens rendered and driven in English |
| **Runtime RTL** | **PASS** — switched without reinstall; nav mirrored, Create centred to within 2px; Urdu strings render |
| **Accessibility** | **PARTIAL** — ten source invariants hold; no device audit, no TalkBack, no focus-order check |
| **Large font** | **NOT EXECUTED** |
| **Offline / reconnect** | **NOT EXECUTED** |
| **Messaging realtime** | **NOT EXECUTED** on device. Socket.IO verified up by smoke; the client polls by design (GAP-M-008) |
| **Media / upload** | **NOT EXECUTED** — the image picker is a system Activity and has no unit coverage either |
| **Performance** | **NOT MEASURED.** First composition logged `Davey! duration=12034ms` and SystemUI ANR'd twice — those numbers describe `swiftshader_indirect` on a contended 8 GB Windows host, not the app on a phone. **No NFR is claimed from them in either direction.** |

## 7. Backend fixes made during Stage 7

### MOBILE-BACKEND-FIX-001 — OTP verification established no session

AUTH-FR-002 step 5: *"A session is established and the visitor proceeds to
username selection."* `POST /otp/verify` returned `{status, userId}` and no
token, so a new account was ACTIVE and signed out and every authenticated call
answered 401.

Reproduced by `curl` twice before any change. Fixed with `issueSessionFor`
extracted so BR-007's five-device cap and EDGE-009's atomicity have one
implementation, called inside the same transaction that consumes the challenge.
`PASSWORD_RESET` deliberately issues nothing. Two regression tests, proven by
reverting the fix.

### MOBILE-BACKEND-GAP-002 — the blocked list cannot name anyone (open)

`GET /me/blocks` returns no `displayName` and no `username`, so an approved
**Must** screen (SET-FR-003, SAFETY-FR-007) cannot render a row that names the
person. Reclassified from "external dependency" to a backend gap per §22D.

**Not fixed**, and the reason is a standard rather than a shrug: Flow H has not
run. MOBILE-BACKEND-FIX-001 was made because an executed flow proved the defect
and the SRS named the expected behaviour in one sentence. Changing a
privacy-sensitive projection on a screen nobody has executed would be the
guesswork that fix avoided. The shape is stated in
[`20-mobile-open-issues.md`](20-mobile-open-issues.md) §0.1.

## 8. Known defects

| | Severity |
|---|---|
| **RUNTIME-005** — auth and setup screens render only `Offline` and `Server` failures; every other `ApiFailure` shows nothing at all | Real. It is why a 401 looked like an inert button for two attempts |
| **RUNTIME-006** — Home's Urdu empty-state button compressed to 74px (≈28dp) with its label clipped, against 126px (48dp) elsewhere | Real, RTL-only, measured |
| **OBS-001** — a live OTP is recoverable from its unsalted SHA-256 in under a second given database read access | A Stage 6 security decision, recorded not acted on |

Six further defects were found and fixed this pass; see
[`19-mobile-test-report.md`](19-mobile-test-report.md) §4.

## 9. External blockers — none of which Stage 7 can clear

| | |
|---|---|
| **OD-015** | The three legal documents and a support address |
| **OD-016** | ~400 Urdu strings unreviewed — and now, for the first time, actually **renderable**, so the review has something to review against |
| **DEP-003** | Push provider — NOTIF-FR-001 and every reminder |
| **DEP-013** | The licensed Noto Nastaliq face. Urdu currently renders in the system face, which is **not** what will ship |
| **ADR-013 / OD-023** | The PDF safety gate — POST-FR-005, MEDIA-FR-003/004 |
| **DEP-006 · DEP-007** | Play account, release keystore, domain — and therefore App Links verification |
| **OD-017** | Interests (PROFILE-FR-011) |
| **OD-020 / DEP-016** | No named technical owner, so no administrator may be provisioned — which makes BR-011's *"an administrator may correct it"* currently untrue |
| Publication authorization · licence | Open governance items; the audit records that neither blocks pushes |
| Physical-device matrix · UAT · production environment | Later QA and release stages |

## 10. Documentation status — **5 of 21**

| Present | Missing |
|---|---|
| `00-mobile-baseline.md` | `01`–`16` (16 module documents) |
| `17-mobile-screen-coverage.md` | |
| `18-mobile-requirement-traceability.md` | |
| `19-mobile-test-report.md` | |
| `20-mobile-open-issues.md` | |
| `21-stage-7-completion.md` (this file) | |

**Not written, and not padded to look written.** §2 of the final-pass addendum
asked for the sixteen module documents to be produced by redistributing evidence
that already exists — chiefly the per-group sections inside
`17-mobile-screen-coverage.md`, which run to some 1,700 lines and already carry
the screen IDs, requirement IDs, decisions and defects each module document
needs. That redistribution is real work and it was not done: the runtime pass
took the time, and §34 was explicit that runtime execution outranked
documentation formatting.

Stating it as a gap is the honest option. Sixteen generated summaries would have
made this row look green and taught a reader nothing.

## 11. What to do next, in order

1. **Build the §8 fixtures** — two users, an organization, a suspended account, a
   pending-deletion account, an event, posts and comments, a block relationship.
   Every remaining flow needs them and none exists.
2. **Execute flows B, C, D, E, F, H, I, J, K.** On this pass's evidence, expect
   them to find defects: two flows found six, three of them in requirements
   already documented as implemented.
3. **Fix RUNTIME-005 and RUNTIME-006**, then re-execute the affected screens.
4. **Re-execute `UX-SETUP-003`** to confirm the crash fix renders.
5. **MOBILE-BACKEND-GAP-002**, once Flow H has shown what the screen needs.
6. **§25 device accessibility audit, §26 large-font run, §27 measurements** — all
   now possible.
7. **Write Compose UI tests.** The emulator exists; there are none.
8. **The sixteen module documents**, by redistribution.
9. **Build `UX-HOME-005` and `UX-HOME-006`.**

Everything in that list is doable with what is now on this machine. Nothing in it
waits on an external dependency.

---

**Do not read this document as a refusal to finish.** It records that the hard
part — a working runtime environment, and the discipline of believing it over the
documentation — is now in place, and that the work it exposed is larger than one
pass. The nine unexecuted flows are the remaining risk, and they are now cheap
to run.
