# Stage 9 — full system integration, completion record

| | |
| --- | --- |
| Branch | `feature/stage-9-system-integration` |
| Base | `a16d25bc2de4acdf24998d87225ab17a96cdcd90` (Stage 8, PR #15) |
| Head | `2a5cc91a8975507481b4a9233e7f8fc9dab54e69` |
| Commits | 17 |
| PR | [#16](https://github.com/waqaskhan0/mohalla/pull/16) — **DRAFT, not merged** |

**SYSTEM INTEGRATION: COMPLETE** — all 20 groups and all 25 INT flows executed.

**RELEASE VALIDATION: NOT APPROVED.**

## Groups

All 20 PASS. Two carry a qualification that is not a pass and is not dressed as
one:

- **Group 12's Admin rendered leg** is `BLOCKED_LOCAL` (INTEGRATION-012).
- **Groups 13–14's author notification** is `BLOCKED_EXTERNAL` on OD-015.

## INT flows

All 25 executed. 22 plain PASS; INT-11 passes at API/DB with its Admin rendered
leg `BLOCKED_LOCAL`; INT-12 and INT-13 pass with the author-notification leg
`BLOCKED_EXTERNAL`; INT-18's external broadcast is `BLOCKED_EXTERNAL`. The
per-flow table is in [01-system-integration-matrix.md](01-system-integration-matrix.md).

## Defects found and fixed

Nine defects were found by **running the system**, not by reading it. Every fix
carries a regression test, and every regression test was proven against the
defect it names.

| | Defect | Layer | Status |
| --- | --- | --- | --- |
| 004 | Password reset lost the recipient between screens — an enabled Save that issued no request | Android navigation | **FIXED** |
| 005 | FEED-FR-005 had a ViewModel, a state field, a unit test and no gesture — on **six** screens | Android UI | **FIXED, all six** |
| 006 | `viewerHasLiked` absent from post detail and profile lists — an empty heart on a post you had liked, and an optimistic count that never reconciled | API contract | **FIXED** |
| 007 | Attaching any image killed the app, twice over — a relative upload URL, then blocking network on the main thread. **Media had never worked from the app at all** | Android | **FIXED** |
| 008 | A time-seeded fixture number could hit the fake provider's reserved failure suffix, producing a red that pointed at the wrong subject | Test fixtures | **FIXED** |
| 010 | The same post reported different counts on different screens with a block in place — and "1 comment" above an empty thread | API | **FIXED** |
| 011 | A block did not reach the notification centre; every notification the blocked person had caused was still listed | API | **FIXED** |

Carried forward from the first checkpoint: 001, 002 and 003, all CLOSED with CI
evidence.

## Open, and honestly open

| | Item | Why it is open |
| --- | --- | --- |
| 009 | A REST send does not reach a connected socket | **No user impact today** — the only client polls. Emitting from the REST path is a realtime-contract decision, not a defect fix, and Stage 9 is integration rather than feature expansion. Recommendation is in the register |
| 012 | The Admin portal cannot be **rendered** in this environment | Environment blocker, not a source defect: `apps/admin` is unchanged since Stage 8, CI builds it green, `e2e:admin` passes 12/12, the parser lane passes, a single React copy resolves, and the portal rendered correctly earlier in this same session |
| — | ADMIN-FR-004's author notification | `BLOCKED_EXTERNAL` on **OD-015**, an owner decision. Carried in the source as `TODO(EPIC-14)`: SAFETY-FR-008 requires citing the guideline breached, and none is published |
| — | External push and announcement broadcast | `BLOCKED_EXTERNAL` on DEP-002. The pipeline's decision is proven (`push: false`, reason named, `pushesSent: 0`); delivery to a handset is not |

## Current results

| Lane | Result |
| --- | --- |
| `npm run verify` | **16 passed · 0 failed · 3 blocked** |
| API smoke (real HTTP) | **425 passed · 0 failed** |
| API unit tests | **911 passed** |
| Admin portal E2E | **12 passed · 0 failed · 0 blocked** |
| Release gate criteria | 47 checks passed · 0 failed |
| Android lint + unit tests | PASS |
| CI on head | **green**, both workflows |
| `npm audit --audit-level=high` | **0 vulnerabilities** |
| Secret / public-data scans | clean on every commit |

The three blocked verify lanes are unchanged from the Stage 9 baseline: release
gate, backup tooling and the dependent restore rehearsal. **BLOCKED is not
PASS**, and none of them is counted as one.

## Security posture

**One open CodeQL alert: #6, `js/xss-through-dom`, high, in
`docs/prototype.html`** — the unchanged frozen Stage 3 prototype. It is
pre-existing, disclosed in the Stage 9 baseline, and untouched by this stage.
This stage does **not** claim zero repository alerts.

## What this stage kept learning

Twelve checks in this stage failed against **correct** behaviour before they
were right, and each one is recorded where it happened rather than quietly
fixed. The pattern is always the same: a check written from what the tester
expected rather than from what the requirement says reports the requirement as
broken.

The clearest examples:

- Asserting reports are **retained** on restore, when ADMIN-FR-003 requires the
  count to **reset** so a coordinated group cannot immediately re-hide.
- Asserting a suspension is **not** a sign-out, when the revocation cascade
  explicitly revokes sessions — seven cascading failures.
- Asserting erasure **frees** the number, when EDGE-029 keeps the hash reserved
  precisely so it cannot be reused.
- Asserting BR-027 means **no notification**, when it means no **push**.
- Asserting 403 for a user token on an admin endpoint, when 401 discloses less.

And three checks passed against the defect they named before being rewritten:
the media threading test (a broad catch made "did not crash" meaningless), the
block count check (engagement created *after* the block, when a blocked person
cannot engage at all), and the notification-centre check ("0 of 0" is vacuous).
A green test is not automatically a meaningful one.

## Push state and merge

Everything is committed and pushed. CI is green on the head commit.

**NOT MERGED — AWAITING OWNER REVIEW.** No Stage 9 merge authorization exists
and PR #16 remains a draft.

## Recommendation

**READY FOR QA / BUG FIXING.**

The system works together: every cross-surface flow has been driven end to end
with three levels of evidence, the defects found have been fixed with
mutation-proven regressions, and the remaining gaps are two owner decisions
(OD-015, DEP-002), one environment blocker that does not implicate the source,
and one contract question with no user impact today.

Before release validation, three things need a decision or an environment that
this one could not provide: re-run the Admin browser legs where `next build`
completes (INTEGRATION-012), resolve OD-015 so enforcement notifications can
cite a guideline, and settle INTEGRATION-009 before a second client type holds
a socket — after that it becomes a user-visible latency bug rather than an
asymmetry.
