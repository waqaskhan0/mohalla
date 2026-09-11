# Stage 9 — full system integration, completion record

| | |
| --- | --- |
| Branch | `feature/stage-9-system-integration` |
| Base | `a16d25bc2de4acdf24998d87225ab17a96cdcd90` (Stage 8, PR #15) |
| Last code commit | `23d9ff1` — CI green, both workflows |
| Commits | 21, the last two documentation only |
| PR | [#16](https://github.com/waqaskhan0/mohalla/pull/16) — **DRAFT, not merged** |

**SYSTEM INTEGRATION: COMPLETE** — all 20 groups and all 25 INT flows executed.

**RELEASE VALIDATION: NOT APPROVED.**

## Groups

All 20 PASS. One carries a qualification that is not a pass and is not dressed
as one:

- **Groups 13–14's author notification** is `BLOCKED_EXTERNAL` on OD-015.

Group 12's Admin rendered leg was recorded as `BLOCKED_LOCAL`; that marker is
**withdrawn** — INTEGRATION-012 was a measurement error of mine, and the
rendered portal has since been verified.

## INT flows

All 25 executed. 23 plain PASS — INT-11 included, now that its Admin rendered
leg is verified rather than blocked. INT-12 and INT-13 pass with the
author-notification leg `BLOCKED_EXTERNAL`; INT-18's external broadcast is
`BLOCKED_EXTERNAL`. The
per-flow table is in [01-system-integration-matrix.md](01-system-integration-matrix.md).

## Defects found and fixed

Nine defects were found by **running the system**, not by reading it. Every fix
carries a regression test, and every regression test was proven against the
defect it names. **All nine are now FIXED**, and a tenth entry — 012 — is
closed as a mis-diagnosis rather than a defect.

| | Defect | Layer | Status |
| --- | --- | --- | --- |
| 004 | Password reset lost the recipient between screens — an enabled Save that issued no request | Android navigation | **FIXED** |
| 005 | FEED-FR-005 had a ViewModel, a state field, a unit test and no gesture — on **six** screens | Android UI | **FIXED, all six** |
| 006 | `viewerHasLiked` absent from post detail and profile lists — an empty heart on a post you had liked, and an optimistic count that never reconciled | API contract | **FIXED** |
| 007 | Attaching any image killed the app, twice over — a relative upload URL, then blocking network on the main thread. **Media had never worked from the app at all** | Android | **FIXED** |
| 008 | A time-seeded fixture number could hit the fake provider's reserved failure suffix, producing a red that pointed at the wrong subject | Test fixtures | **FIXED** |
| 010 | The same post reported different counts on different screens with a block in place — and "1 comment" above an empty thread | API | **FIXED** |
| 011 | A block did not reach the notification centre; every notification the blocked person had caused was still listed | API | **FIXED** |
| 009 | A message sent over REST never reached a connected socket — delivery depended on how the sender happened to send | API realtime | **FIXED** |

Carried forward from the first checkpoint: 001, 002 and 003, all CLOSED with CI
evidence.

## The two that were open at the first checkpoint, and how they closed

**INTEGRATION-009 — FIXED.** The fan-out moved out of `MessagingGateway.onSend`
and into `MessagingService.send()`, which is the one place that knows a row was
actually created, so REST and socket sends accelerate identically. It runs after
the transaction commits and behind the same `created` guard, so EDGE-021's "a
duplicate renders once" is preserved with one check instead of one per
transport. The originating socket id travels with the send, so a socket client
is not echoed a message it already holds the ack for.

The service could not simply depend on the gateway — the gateway depends on the
service, and Nest answers a real cycle by never initialising and exiting with an
unsettled top-level await rather than an error naming it. `forwardRef` is what
this repository consistently refuses, so the edge was inverted instead:
`REALTIME_PUBLISHER`, whose adapter holds the Socket.IO namespace and nothing
else, in the same shape as `follow-removal.port.ts` and
`conversation-hiding.port.ts`.

Proven by mutation: restricting the fan-out back to socket sends reproduced the
exact original symptom — the HTTP suite dropping to 6 passed / 5 failed with
`0 delivery(ies)`, and two unit tests red. Reverted, and not committed.

**INTEGRATION-012 — CLOSED, and it was my error.** The Admin portal was recorded
as unrenderable in this environment on the strength of a 22,177-byte
`/moderation` response. That measurement was taken with a cookie jar that never
held a valid `mohalla_admin_session`; an unauthenticated request correctly
returns the shell, which looks identical to a render that dies halfway. With a
real session the queue returns 250,673 bytes with 20 `Review` links, the
dashboard 72,689 bytes with real figures, and a case detail 131,862 bytes with
Restore / Delete / No action, the reason field and REPORTED BY. The Admin
consuming UI is verified.

One genuine oddity survives and is separate from the portal: the default
three-worker `next build` fails prerendering Next's synthesised `/_global-error`
while `next build --debug-prerender` completes all 11 pages. A `global-error.tsx`
was tried, did not fix it, and was reverted rather than left in as a change that
does nothing.

## Still open, and honestly open

| Item | Why it is open |
| --- | --- |
| ADMIN-FR-004's author notification | `BLOCKED_EXTERNAL` on **OD-015**, an owner decision. Carried in the source as `TODO(EPIC-14)`: SAFETY-FR-008 requires the notification to cite the guideline that was breached, and no Terms or Community Guidelines are published. Writing that text would be inventing product and legal content, and it is the same open decision that keeps `TERMS_VERSION` empty in a release build |
| External push and announcement broadcast | `BLOCKED_EXTERNAL` on **DEP-002**, a provider credential only the owner can supply. The pipeline's decision is proven (`push: false`, reason named, `pushesSent: 0`); delivery to a handset is not, and is not claimed |

Neither is an engineering gap, and neither can be closed from here: one needs
content the owner has not written, the other a secret the owner holds.

## Current results

| Lane | Result |
| --- | --- |
| `npm run verify` | **16 passed · 0 failed · 3 blocked** |
| API smoke (real HTTP) | **425 passed · 0 failed** |
| API unit tests | **914 passed** |
| Admin portal E2E | **12 passed · 0 failed · 0 blocked** |
| Release gate criteria | 47 checks passed · 0 failed |
| Android lint + unit tests | PASS |
| CI on head (`23d9ff1`) | **green**, both workflows |
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
mutation-proven regressions, and the remaining gaps are two owner
decisions — OD-015 and DEP-002 — and nothing else.

Before release validation, three things need a decision or an environment that
this one could not provide: resolve **OD-015** so enforcement notifications can
cite a guideline, supply the **DEP-002** push credential so delivery to a
handset can be measured rather than inferred, and unblock the three verify lanes
(release gate, backup tooling, restore rehearsal) that have been blocked since
the Stage 9 baseline.
