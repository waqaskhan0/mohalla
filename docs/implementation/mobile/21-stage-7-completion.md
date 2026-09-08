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
| Mandatory emulator flows are executed | **5 of 11.** A, B, C, F and G ran; D, E, H, I, J, K did not |
| Accessibility implementation/audit is performed | **Source-level only.** Ten invariants hold across the tree; no device audit, no TalkBack, no font-scale run |
| No known code defect prevents a Must flow | **One open defect.** RUNTIME-006. RUNTIME-005 is fixed |
| All 61 screens represented | ✅ one canonical schema, 61 rows, 0 duplicates |
| Required screens implemented | **59 of 61.** `UX-HOME-005` and `UX-HOME-006` not started |
| Local API integration gaps fixed | ✅ **two** found, two fixed (MOBILE-BACKEND-FIX-001, -002) |
| Runtime RTL executed | ✅ Flow G, measured |
| Build · lint · tests pass | ✅ |

§32 says not to write this file prematurely and bend the evidence to match it.
The evidence says not complete, so that is what it says.

**The gap has narrowed a great deal.** The runtime environment exists and works,
five of eleven flows now pass, and those five found and fixed **ten** real
defects — two of them in the Stage 6 backend. But five of eleven is not eleven,
and the six that remain are the ones that need a second synthetic user: block
privacy, suspension, message requests, the social flow, offline and deletion.
Those are also, on this pass's evidence, the flows most likely to find something.

---

## 1. Branch and commits

| | |
|---|---|
| Branch | `feature/stage-7-android-v1` |
| Base | `0981b1a` (`origin/main`, untouched) |
| HEAD | `2fcb3de` (this report is committed on top of it) |
| Commits ahead of `main` | **62** — 30 Stage 6 backend, the rest Stage 7 |
| This pass | 10 commits, `02c3c03..HEAD` |
| Remote | `origin/feature/stage-7-android-v1`, pushed and in sync |
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
| Android unit tests | **491** across 33 classes · **0 failures** |
| Backend tests (api) | **904** across 46 files · **0 failures** |
| Database tests | **95** across 7 files · **0 failures** |
| **Total** | **1490 · 0 failures** |
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
| **A — New user** | **PASS**, end to end, no skipped steps — six defects found and fixed |
| **B — Returning user** | **PASS** except notification arrival — found RUNTIME-007 |
| **C — Create post** | **PASS** for text — found MOBILE-BACKEND-FIX-002. Image path NOT EXECUTED |
| D — Social | NOT EXECUTED |
| E — Message request | NOT EXECUTED |
| **F — Events** | **PASS**, including §14's attendee-privacy check |
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
| **Large font** | **PASS at 130%** — found RUNTIME-006’s root cause; fix verified at Urdu × 130%, all buttons ≥48dp |
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

### MOBILE-BACKEND-FIX-002 — `profiles.post_count` was never maintained

The profile read **0 Posts** above a list containing one post. Every other
denormalised counter in the schema is trigger-maintained and each was correct in
the same run; `posts` had no count trigger at all.

`0023_post_count_trigger`, following the pattern
`0010_epic05_social_graph` sets for follows, plus a backfill — 0 profiles now
disagree with their own posts. Counts `VISIBLE` only, because counting
auto-hidden posts would let a viewer infer from the number that something had
been hidden (BR-025). Five database tests; three fail when the trigger is
dropped.

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
| ~~RUNTIME-005~~ · ~~RUNTIME-007~~ · ~~RUNTIME-008~~ | **ALL FIXED and runtime-verified.** RUNTIME-005: Seven screens matched two or three of eight `ApiFailure` variants and let the rest fall silent. `noticeFor`/`failureText` are one exhaustive `when` with no `else`, so a ninth variant fails to compile at the mapping. Pinned by a source invariant, proven by reverting two call sites |
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

## 10. Documentation status — **21 of 21**

All twenty-one §48 documents exist. The sixteen module records were produced by
**redistribution**, which is what §2 asked for, and every table in them is
joined from a parsed source rather than composed:

| Column | Joined from |
|---|---|
| Screen rows | `17-mobile-screen-coverage.md`, all fourteen columns verbatim |
| Requirement rows | `18`'s own row data, itself parsed from the SRS |
| Decisions | the per-group prose of `17`, **moved** rather than paraphrased |
| Commits | `git log`, restricted to that module's own source paths |
| Runtime | the `Runtime` column, so a module cannot claim more than ran |

`DocumentationIdTest` passes across all twenty-one: every requirement and screen
ID cited anywhere in the directory exists in the SRS or the UI/UX specification.

Where a module genuinely shares an implementation with another, §24's
permission is used and the record cross-references instead of duplicating —
`UX-SET-005` is described once, in `12-safety-blocking.md`, and referenced from
`11-settings.md`.

Two needed more than the join could give. `16-performance.md` owns no screen and
no requirement family, so the generic join produced a stub — §2 forbids exactly
that, and it now carries the structural rules that are actually enforced plus an
explicit statement that **no NFR is claimed from emulator numbers in either
direction**. `15-accessibility-rtl.md` gained Flow G's measured mirroring, which
is the only runtime accessibility evidence the stage has, and an itemised list
of what §25 and §26 have **not** audited.

## 11. What to do next, in order

Two items stand between this and feature-complete. Both are ordinary work and
neither waits on anybody outside this repository.

1. **The accessibility audit on a device (§25), and the large-font run (§26).**
   Ten invariants hold across the source tree and Flow G measured the mirroring,
   but nothing has been heard through TalkBack, no focus order has been walked,
   and no screen has been seen at 130%. RUNTIME-006 — a primary button squeezed
   to 28dp because Urdu needed a third line — is a strong hint that font scaling
   will find more of the same.
2. **Build `UX-HOME-005` (category filter) and `UX-HOME-006` (announcement
   detail).** The only two of 61 screens that are not started. `selectCategory`
   already exists in the ViewModel and reaches the API; there is no picker to
   drive it, and an ANNOUNCEMENT notification currently renders and goes nowhere.

Then the rest, in rough order of value:

3. **Fix RUNTIME-010** — a suspended account's blocked writes explain nothing.
   The server refuses them correctly; §17 asks for an explanation and only the
   Create tab has one. It is a design choice across several screens: gate every
   write affordance on capability, or route a 403 to the Create tab's explainer.
4. **Fix RUNTIME-011** (the delete-account button behind the keyboard), then
   re-measure it. RUNTIME-006 is done.
5. **Execute Flow C's image path** and **Flow E's decline and block variants** —
   the two steps still unexecuted inside otherwise-passing flows.
6. **MOBILE-BACKEND-GAP-002**, now that Flow H has shown what the blocked-users
   screen actually needs: a name, on a screen that already explains its absence.
7. **Write Compose UI tests.** The emulator exists and there are none. Every
   defect this pass found was a defect no JVM test could see.
8. **§27 performance measurements** on hardware. Nothing measured here describes
   a phone, and the report says so rather than claiming a number.

---

**The most useful sentence in this document is in section 3.** Three
requirements were recorded `IMPLEMENTED` and did not work on a device: OTP
verification issued no session, the date-of-birth field could not be typed into,
and "switch language" changed the layout direction and left every string in
English. A fourth, PROFILE-FR-006, had never been implemented at all.

None of that was visible from 469 passing tests, a clean lint, or a
traceability matrix built carefully from the specification. It became visible in
the first ninety seconds of running the app.

So the two items left in section 11 are worth doing properly rather than
declaring done: on this stage's own evidence, the parts nobody has watched a
person use are the parts that do not work.
