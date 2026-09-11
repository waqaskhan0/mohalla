# Stage 9 — system integration baseline

Started 10 September 2026 after the owner's explicit PR #15 merge authorization.
Repository instructions, history, CI, and Stage 6/7/8 completion reports were
read before integration work. No previous Stage 9 branch or completed integration
group existed in the local or fetched repository.

| Baseline | Evidence |
| --- | --- |
| PR #15 | MERGED at 2026-09-10T06:37:57Z; protected squash, no bypass |
| STAGE_8_MERGE_SHA | `a16d25bc2de4acdf24998d87225ab17a96cdcd90` |
| Latest main | Same SHA; local HEAD equaled origin/main; clean before branching |
| Branch | `feature/stage-9-system-integration` |
| STAGE_9_BASE_SHA | `a16d25bc2de4acdf24998d87225ab17a96cdcd90` |
| Main CI | [34446078876](https://github.com/waqaskhan0/mohalla/actions/runs/34446078876), PASS |
| Main CodeQL | Both analysis jobs passed in [34446078683](https://github.com/waqaskhan0/mohalla/actions/runs/34446078683) |
| API | Existing local API on port 3000; live and ready endpoints PASS |
| PostgreSQL | Existing Compose PostgreSQL 18.6; migrations current, four roles present |
| Worker | Existing implementation started as runtime_worker; health job completed, notification outbox drained |
| Android | Existing mohalla_test AVD, emulator-5554, booted; tests/lint/debug build PASS |
| Admin | Existing local portal on port 3001; 12 HTTP/database E2E flows PASS |
| Socket.IO | Foundation ping plus real transport delivery/revocation tests in API smoke PASS |
| Media | Existing local adapter and presigned-slot backend checks PASS; Stage 9 client flow pending |
| Notifications | Existing fake provider/outbox worker; external push not proven |
| Contracts | Live OpenAPI has 88 paths and zero component schemas; route guards cannot validate fields |
| First group | Group 1: runtime contract audit against actual client serializers/parsers |
| Draft PR | Not yet created; create after first meaningful green group |

Stage 8 finalization evidence is in
[21-final-merge-validation.md](../admin/21-final-merge-validation.md).
Its results are a baseline, not proof that Stage 9's three-level flows passed.
Stage 8 feature implementation is COMPLETE; RELEASE VALIDATION is NOT APPROVED.

## Commands and constraints

Use the existing pinned Node 24.20.0/npm 11.19.0 installation, JDK 21, Android
SDK and Gradle wrapper. Existing commands are `npm run verify`, `npm run smoke`,
`npm run smoke:api`, `npm run e2e:admin`, `npm run typecheck`, `npm run guard:all`,
`npm audit --audit-level=high`, and Android `test lint assembleDebug`.

Use only synthetic local fixtures and the existing Compose infrastructure.
Credentials, live response specimens, emulator images, and raw runtime logs
stay in ignored local scratch space. Do not publish them. Existing worker
account-erasure dry-run mode is enabled during baseline validation.

Known carried limitations include documented Admin API gaps, missing response
schemas, external providers, physical-device/human release reviews, and the
unchanged frozen prototype's existing CodeQL alert #6. No advisory exception is
active: DEP-ADVISORY-001 was patched, and the fresh dependency audit is clean.

Work one integration group at a time: reproduce, fix, test, runtime verify,
scan, commit, push, check CI, then continue. No Stage 9 merge authorization exists.
