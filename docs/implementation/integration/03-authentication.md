# Group 2 — Android authentication

Baseline: `a16d25bc2de4acdf24998d87225ab17a96cdcd90`.

Every flow below was driven on the existing `mohalla_test` AVD (emulator-5554)
against the local API on port 3000, the Compose PostgreSQL 18.6 instance and the
existing fake SMS adapter. No mock backend, no in-memory repository, no
recorded response. Synthetic fixtures only; credentials, codes and captures stay
in ignored local scratch space (§38).

## What was executed

| Flow | Evidence | Result |
| --- | --- | --- |
| Signup → account type → mobile → DOB → password → OTP → username → profile → authenticated request | Device UI, `POST /register` 202 · `POST /otp/verify` 200 · `POST /me/username` 201 · `POST /me/profile` 201 · `GET /me` 200 · `GET /feed/discover` 200; `users.state = ACTIVE`, identifier verified, live `sessions` row unrevoked | PASS |
| Logout → old session rejected | `GET /me` 401 on the signup token; `sessions.revoked_reason = LOGOUT`; an independent session still returns 200 | PASS |
| Password reset → prior sessions invalidated | Device UI through the production auth graph; `POST /password/forgot` 202 · `POST /password/reset` 200; both pre-reset tokens 401 with `revoked_at` set; old password `POST /login` 401; new password logs in and reaches the Home shell | PASS |

The reset flow carries all three evidence levels: the initiating Android UI, the
API and database state, and the consuming UI — a real (not instrumented) app
launch, cleared data, logging in with the new password and landing on Home with
the bottom navigation and a populated Featured rail.

## INTEGRATION-004 was found by running the app, not by the suite

The reset flow was the one that failed. `MohallaNavHost` created a separate
`PasswordResetViewModel` for each of the two destinations, so the number
accepted on UX-AUTH-010 was gone by UX-AUTH-011: no masked recipient, and
`submitReset` returning at its first line behind a Save button that looked
enabled. The runtime capture is unambiguous — `POST /password/forgot` 202 and
then no `/password/reset` request at all.

The ViewModel's own KDoc already said what should have happened: *"ONE VIEWMODEL
FOR BOTH, because the phone number has to survive the step boundary."* The
register flow had solved the same problem correctly, with a nested graph and a
shared `ViewModelStoreOwner`. The fix applies that pattern rather than inventing
a second one, and `onComplete` now pops the graph rather than its start
destination, so a second reset cannot inherit the first one's number.

Existing unit tests did not and could not catch this. Every one of them
constructs the ViewModel directly or asserts on `PasswordResetUiState`, and both
were correct throughout. The defect lived only in how the graph scoped them.

## The regression test was mutation-proven

`PasswordResetNavigationTest` runs the **production** `authGraph` on a device
against the real backend. It was proven against the defect before being trusted:

| Step | `theAcceptedNumberSurvives…` | `theResetCompletesThroughTheRealGraph` |
| --- | --- | --- |
| Defect restored (pre-fix graph, `internal` visibility only) | FAIL — masked recipient not displayed | FAIL — `ComposeTimeoutException`, the flow never leaves the reset screen |
| Fix restored | PASS | PASS |

The mutation was never committed. It was the graph exactly as `HEAD` had it,
with only the `authGraph` visibility change the test needs.

The second test needs the code the fake provider "sent". Nothing in `apps/api`
exposes one and nothing was added to it: the local evidence harness serves the
outbox at `/__local-harness__/last-code`, behind the development, localhost and
fake-provider checks it already enforces before starting. The test takes
`syntheticPhone`, `syntheticNewPassword` and `codeChannel` as instrumentation
arguments with no defaults, so a public checkout carries no fixture.

`connectedAndroidTest` is not part of CI — CI has no emulator, and `./gradlew
test` does not compile the `androidTest` source set. `assembleDebugAndroidTest`
was run locally to keep the file compiling.

## What this group does not prove

Session expiry (INT-21), suspension and ban state transitions, and account
deletion and restore are later groups and are not claimed here. External SMS
delivery is not proven: the fake adapter is what ran, and a real provider
remains `BLOCKED_EXTERNAL`.
