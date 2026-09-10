# 20 — Stage 8 Completion Report

**Admin Web Portal** · `feature/stage-8-admin-v1` · PR
[#15](https://github.com/waqaskhan0/mohalla/pull/15) (Draft, **not merged**).

---

## 1. Verdict

**STAGE 8 IMPLEMENTATION COMPLETE · RELEASE NOT APPROVED.**

All nine approved screens are built, run against the local backend, and
verified in a browser. The release verdict is unchanged from Stage 7 and is not
Stage 8's to move: the release gate remains BLOCKED on conditions outside this
stage — devices, policy URLs and a named technical owner (OD-020 / DEP-016).

## 2. What was built

| | |
|---|---|
| Screens | **9 of 9** — UX-ADM-001 to 009 |
| Routes | 12, including `/session-expired` and the redirect at `/` |
| Tests | **252** unit and source-rule, 16 files |
| E2E flows | **12**, all passing |
| `verify` | 9 passed · 0 failed · 7 blocked · 16 lanes |
| Commits | 16 on the branch |
| CI | green on every pushed commit |

## 3. The stage's central finding

**Nothing important was caught by the test suite.** Every defect worth fixing
was found by opening the portal and using it, on builds where typecheck, tests
and `next build` were all green:

- the moderation queue reporting itself empty while 1,397 cases were open
- an expired session rendering the full signed-in console, twice, by two
  different mechanisms
- a skip link that moved the scroll position and left focus behind
- a dark theme whose buttons measured 2.31:1 against a 4.5 requirement
- wire enums and raw timestamps surfacing in the interface
- a bilingual field pair whose halves did not line up
- a validation check that displayed an error and sent the request anyway

The same finding held one level up: roughly a dozen of the tests written to
protect this work **passed against the exact defect they named**, and were only
discovered by breaking the code on purpose. Both lessons are recorded in
[18](18-admin-test-report.md).

## 4. Privacy, measured rather than asserted

| | |
|---|---|
| Three loads of a conversation case | **0** audit entries |
| One press of "Open the reported conversation" | **1**, naming the administrator and the conversation |
| Three loads of an account page | `ADMIN_VIEWED_SENSITIVE_DATA` steady at **50** |
| One identifier reveal | **51**, recording `{"fields": ["phone","dateOfBirth"]}` — names, never values |
| A revealed identifier afterwards | in no URL, no storage, no attribute |
| An administrator id at both account routes | **404** |
| Suspending an administrator | **403**, stating the rule |
| An admin token at user-authenticated routes | **401** |
| Client chunks containing the credential path | **zero** |

## 5. Boundaries held

No generic CMS. No conversation search, inbox view or DM browsing — a reported
conversation is reachable only through its own case, and only by a press that
writes an audit entry first. No audit-log mutation at any layer: the audit-log
directory contains no server action, because there is nothing for one to call.
No administrator provisioning, invitation or bootstrap. No data export. No
per-user analytics. No Phase 2 work.

Restore and delete are peers: one CSS selector, no primary, no danger colour,
nothing preselected, and delete is not in the position a button row reads as the
default. The only asymmetry — a confirmation on delete — runs against deletion,
which is the direction RSK-010 points.

## 6. What is not proven

Recorded rather than papered over (§65):

- **Only Chromium was exercised.** Firefox and Safari are not claimed.
- **No assistive technology was used.** ARIA structure is asserted; how it
  sounds is not.
- **`script-src` was not tested from the browser** — Chrome exempts devtools
  evaluation from it. Verified structurally.
- **A real user token was never offered to an admin route** — OTP codes are
  hashed at rest. Verified structurally.
- **Six database `verify` lanes are BLOCKED locally** and pass in CI.
- **No performance or load testing.**

## 7. Nine API gaps remain open

Listed in [19](19-admin-open-issues.md). Two are worth the backend's attention:

- **`ADMIN-API-GAP-003`** — `COUNT(*) OVER ()` with a `?? 0` fallback makes both
  the moderation queue and the audit log report a total of zero past the end.
  This is a correctness bug in two endpoints, and it is the direct cause of
  ADMIN-RUNTIME-003.
- **`ADMIN-API-GAP-008`** — no route returns an account's enforcement history and
  the audit log cannot be filtered by the account acted on, so the screen where
  enforcement happens cannot show proportionality. BR-037 exists to support
  exactly that judgement.

Neither was worked around by adding an endpoint or by reading the public API as
an administrator.

## 8. What this stage did not do

It did not merge PR #15, and will not. It did not push to `main`, rewrite
history, force-push, weaken a gate to make CI green, convert a BLOCKED lane to a
PASS, provision a production administrator, or add a route that the approved
scope excludes.
