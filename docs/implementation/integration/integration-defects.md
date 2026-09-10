# Stage 9 integration defect register

Retain resolved defects. Close only after regression and runtime retest evidence.

## INTEGRATION-001 — the contract guard cannot see response fields

- Flow: Android/Admin consume backend JSON.
- Symptom: live OpenAPI exposes 88 paths but no component schemas. Existing
  Android contract tests check routes only; Admin maintains runtime parsers.
- Root cause: backend Swagger generation emits route metadata without the
  transport schemas needed to validate response bodies.
- Owning layer: cross-client contract validation.
- Requirement: Stage 9 Group 1 and contract drift guard; actual serialization
  must be tested rather than inferring correctness from route existence.
- Regression test: actual backend responses pass production Android serializers
  (39 types) and all 13 Admin parsers. Removing category `slug` or dashboard
  `totalUsers` in isolated specimens fails the corresponding client test.
- Fix commit: first Stage 9 contract checkpoint (record exact SHA after commit).
- Runtime retest: restarted API exposes 37 generated request schemas; 416 HTTP
  checks pass, both clients parse freshly generated sanitized responses.
- Status: CLOSED locally; CI pending.

## INTEGRATION-003 — erasure smoke fixture is not due on a fresh database

- Flow: CI generates client contract examples through the full HTTP smoke suite.
- Symptom: first Stage 9 CI run fails two day-30 dry-run assertions (404 passed,
  2 failed, 406 total without the locally configured metrics checks).
- Root cause: fixture subtracts one day from the earliest deletion schedule.
  If all schedules are future dates, the shifted account is still not due.
  Accumulated old local fixtures concealed this pre-existing test defect.
- Owning layer: synthetic smoke fixture scheduling.
- Requirement: repeatable integration fixtures on fresh and reused databases.
- Regression test: a read-only PostgreSQL VALUES query with only future
  schedules returns false for the original due-date expression and true for
  the corrected expression. Existing sweep assertions remain unchanged.
- Fix commit: CI follow-up to the first contract checkpoint.
- Runtime retest: full real HTTP capture passes all 416 checks and regenerates
  150 sanitized specimens; fresh-database CI rerun pending.
- Status: CLOSED locally; CI pending.

## INTEGRATION-002 — workspace typecheck targets an empty directory

- Flow: root workspace validation before an integration checkpoint.
- Symptom: `npm run typecheck` fails with TS18003 in `@mohalla/db`.
- Root cause: database tsconfig includes `src/**/*.ts`, but its TypeScript lives
  in `tests`; CI's build job did not execute its advertised typecheck.
- Owning layer: database tooling and CI.
- Requirement: executable repository validation; do not bypass failing checks.
- Regression test: original command reproduces TS18003; corrected database
  typecheck passes against existing test sources.
- Fix commit: first Stage 9 contract checkpoint (record exact SHA after commit).
- Runtime retest: database test execution passed in full verification; root
  typecheck repeated after the configuration correction.
- Status: CLOSED locally; CI pending.
