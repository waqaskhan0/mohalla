# 15 — Runtime End-to-End Validation

**Stage 8 · Group 15** · `npm run e2e:admin`, and a lane in `verify`.

---

## 1. Why a script and not a checklist

Every defect worth finding in Stage 8 was found by running the portal, and not
one was visible to the unit suite:

- a queue that reported itself empty with 1,397 cases open
- an expired session that rendered the signed-in console
- a skip link that moved the scroll position and not the focus
- a dark theme whose buttons measured 2.31:1
- a heading that read "POST case" and an expiry column showing a raw ISO instant
- a bilingual field pair whose two halves did not line up

A checklist somebody re-reads is not evidence. `scripts/posix/admin-e2e.mjs`
runs.

## 2. The twelve flows

| | | |
|---|---|---|
| A | the API and the portal are both answering | PASS |
| B | an administrator signs in and receives an absolute expiry (SEC-024) | PASS |
| C | a wrong password and an unknown address give the IDENTICAL refusal (SEC-006) | PASS |
| D | all six screens send an anonymous visitor to sign in | PASS |
| E | an invalid session ends the session rather than rendering the console | PASS |
| F | the dashboard returns seven integers and no identifier of any kind | PASS |
| G | the API reports total 0 past the end, and the portal does not say the queue is clear there | PASS |
| H | a decision applies, advances the version, is refused on replay with 409 naming who and how, and refuses a one-character reason | PASS |
| I | neither account view carries an identifier; they live behind their own audited route | PASS |
| J | suspending an administrator is refused 403 stating the rule; an administrator is not reachable as an account | PASS |
| K | the audit log filters exactly and case-sensitively; POST/PUT/PATCH/DELETE against it do not exist | PASS |
| L | signing out revokes server-side — the same token is refused afterwards | PASS |

**12 passed · 0 failed · 0 blocked.**

## 3. The harness was itself tested

A green harness that cannot detect the defect it describes is worth nothing.
Re-introducing ADMIN-RUNTIME-004 in the queue page made flow E fail with both of
its checks and exit 1; restoring the fix returned it to 0.

## 4. BLOCKED is never upgraded to PASS

Without credentials the nine authenticated flows report BLOCKED and the script
exits 3, which the `verify` lane surfaces as BLOCKED. A gate that quietly passes
when its subject is not running reports something proven that was never checked.

Credentials come from `ADMIN_E2E_EMAIL` / `ADMIN_E2E_PASSWORD` and are never
printed. The script refuses to run with `NODE_ENV=production`.

## 5. `guard:secrets` failed on this script and was right to

It flagged `password: 'definitely-not-the-password'` — a deliberately wrong
value, but exactly the shape the guard exists to catch. Fixed by **deriving** the
wrong password from the real one rather than by narrowing the pattern, which
removes the literal, keeps the check at full strength, and makes the test
stronger: a derived value is guaranteed to differ, where a fixed literal only
probably does.

## 6. What this script does not cover

It drives HTTP and the database, not a browser. The flows that depend on client
behaviour — a confirmation that moves focus, a form that hydrates, a CSP that
blocks an injected image, the Urdu fields' direction — were verified in a
browser and are recorded in [12](12-security-privacy.md) and
[14](14-accessibility.md), not here.
