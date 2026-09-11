# Group 1 — contract audit

Baseline: `a16d25bc2de4acdf24998d87225ab17a96cdcd90`.
Local checkpoint validation and CI passed on `dd374b8`. This
contract checkpoint does not complete any Android-to-Admin end-to-end flow.

## What was compared

- Live backend `/docs-json`: 88 paths and 104 operations.
- Android Retrofit: 74 ordinary method annotations plus DELETE-with-body `@HTTP`.
  All routes match; every API method has a production repository caller.
- The existing `IntegrationWiringTest` checks the next layer. Its three documented
  orphans remain: duplicate `PostSource.delete`, the Could/no-screen
  `PostSource.update` (GAP-M-017), and unrequested bulk
  `NotificationSource.markAllRead` (GAP-M-018). No new UI scope was added.
- Actual JSON from the existing API smoke flows, through the production
  `MohallaJson` serializers and all 13 Admin response parsers. Two Admin routes
  absent from the original smoke suite were also called: user search and the
  audited reported-conversation endpoint.

Initial runtime capture passed 413 API checks and supplied 837 response samples.
Android decoded 762 samples across 38 response types. Two supplemental Admin
responses completed coverage of its 13 parsers. The final guard also handles
Retrofit's DELETE-with-body annotation. Sanitized, deduplicated runtime examples
are generated into `packages/contracts/fixtures/http-responses.json`; they are
examples rather than a second hand-maintained transport specification.

## Defect and change

INTEGRATION-001: Swagger exposed zero schemas, so route presence could pass
while clients failed to serialize a field. `createApiDocument` now derives 37
request schemas from the actual Zod pipes attached to controller methods.
Required fields, enums, nullable fields, and strict object shape have a regression
test. Cross-field refinements remain server-enforced and are not claimed to be
fully expressible by OpenAPI.

`npm run contract:generate` updates the existing generated Stage 6 contract.
The approved historical Stage 4 `openapi-v1.yaml` is unchanged. The API and
offline generator use the same generation function. CI rejects an uncommitted
change to the generated contract.

Android checks its typed request field names against those generated validators.
The deliberate JsonObject PATCH builders retain their existing three-state
tests. Both clients decode current backend response specimens in the database
CI job, which regenerates them through real HTTP actions. Ordinary unit tests
also exercise the committed sanitized specimens. `verify` regenerates specimens
when a local database is configured, runs the Admin parser, and supplies the
current specimens to Android. Failed capture cannot fall back to a stale file.

## Runtime and mutation evidence

- Restarted the existing API on port 3000; readiness PASS and live `/docs-json`
  returns 88 paths with 37 request schemas.
- Production Android response decoding and typed request-field checks PASS.
- All 13 production Admin parsers PASS on normal specimens.
- In an isolated fixture copy, remove category `slug`: Android contract test
  FAILS with `MissingFieldException` and exit 1.
- In an isolated fixture copy, remove dashboard `totalUsers`: Admin contract
  test FAILS at `totalUsers` and exit 1.
- Normal fixtures and source were not mutated by those negative runs.
- Specimen privacy tests verify removal of free text, credentials, personal
  values, dynamic object keys and route identifiers before any example is
  eligible for publication. Raw capture remains ignored and local.

## Limits and follow-up

The final full `verify` run passed 16 lanes with zero failures and three blocked
release/backup/restore lanes. Its real HTTP capture passed 416 checks, generated
150 sanitized examples across 69 operations, and Android decoded 124 responses
across 39 production types. Both Android contract tests passed; all 13 Admin
response parsers passed. API tests, Admin tests/build/E2E, worker tests, Android
tests/lint, formatting, lint, secret scan and OpenAPI drift verification passed.

A separate root typecheck reproduced a stale database tsconfig pointing at an
empty `src` directory. It now checks the actual database test TypeScript files;
CI explicitly runs the root typecheck after builds (INTEGRATION-002).

First push: `d27075f`, [Draft PR #16](https://github.com/waqaskhan0/mohalla/pull/16).
The fresh database CI run exposed INTEGRATION-003 in the existing erasure smoke
fixture. All other CI jobs passed. Its date calculation is corrected without
changing the deletion implementation or weakening the two failed assertions.

The correction passed all 416 local HTTP checks. Fresh-database CI and both
client contract checks passed in [34452831956](https://github.com/waqaskhan0/mohalla/actions/runs/34452831956).
Android build/tests passed in [34452831965](https://github.com/waqaskhan0/mohalla/actions/runs/34452831965)
and CodeQL passed in [34452829009](https://github.com/waqaskhan0/mohalla/actions/runs/34452829009).
Group 1 is PASS; the next group is Android authentication.

Success-body parsing is not proof of correct UI behavior or of every omitted
optional field. Android intentionally supplies defaults for several optional
fields; both clients ignore additive response fields. Response schemas are not
invented from TypeScript interfaces; actual response serialization is the guard.
Pagination includes the distinct feed, event, message and notification cursor
shapes present in the executed smoke flows. Error handling and semantic state
changes still require the later integration groups.

The initial capture with a scheduled worker running reported two notification
summary assertions before all competing drain work was reflected. The existing
smoke suite deliberately controls the drainer (including assertions before
drain), so scheduled consumption was paused for its isolated fixture run. The
repeat passed all 413 checks. This is not a Stage 9 notification delivery PASS;
the live worker path and concurrency remain part of Group 10.

The reported-conversation response captured here contains an empty message
array. Parsing that wrapper does not establish that report evidence is actually
returned. That behavior must be exercised with known conversation content in
the moderation/privacy groups.
