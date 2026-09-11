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
- Fix commit: `d27075f`.
- Runtime retest: restarted API exposes 37 generated request schemas; 416 HTTP
  checks pass, both clients parse freshly generated sanitized responses.
- Status: CLOSED; CI passed on `dd374b8`.

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
- Fix commit: `dd374b8`.
- Runtime retest: full real HTTP capture passes all 416 checks and regenerates
  150 sanitized specimens; fresh-database CI rerun pending.
- Status: CLOSED; fresh-database CI passed on `dd374b8`.

## INTEGRATION-002 — workspace typecheck targets an empty directory

- Flow: root workspace validation before an integration checkpoint.
- Symptom: `npm run typecheck` fails with TS18003 in `@mohalla/db`.
- Root cause: database tsconfig includes `src/**/*.ts`, but its TypeScript lives
  in `tests`; CI's build job did not execute its advertised typecheck.
- Owning layer: database tooling and CI.
- Requirement: executable repository validation; do not bypass failing checks.
- Regression test: original command reproduces TS18003; corrected database
  typecheck passes against existing test sources.
- Fix commit: `d27075f`.
- Runtime retest: database test execution passed in full verification; root
  typecheck repeated after the configuration correction.
- Status: CLOSED; CI passed on `dd374b8`.

## INTEGRATION-004 — Android password reset loses the recipient between screens

- Flow: Android Login → Forgot password → code/new password → Save.
- Symptom: the second screen omits the masked recipient; Save is enabled but
  does nothing. Runtime API evidence has `/password/forgot` 202 and no
  `/password/reset` request after tapping Save.
- Root cause: each destination creates its own PasswordResetViewModel. The
  second instance has no e164Phone; submitReset returns before calling the API.
- Owning layer: Android navigation and ViewModel lifetime.
- Requirement: AUTH-FR-007; Stage 9 Group 2 real password reset and revocation.
- Regression test: device test runs the production auth graph against the local
  backend and checks that the accepted phone survives navigation as a masked
  recipient. Original behavior fails; fixed behavior must pass.
- Fix: both steps move into a nested `PASSWORD_RESET_GRAPH` whose back stack
  entry owns one shared ViewModel, the pattern the register graph already used;
  `onComplete` pops the graph rather than its start destination, so a second
  reset does not inherit the first one's number.
- Fix commit: this Group 2 checkpoint.
- Mutation proof: with the pre-fix graph restored, both device tests fail — the
  masked recipient is not displayed, and the completion test times out because
  the flow never leaves the reset screen. With the fix restored both pass. The
  mutation was not committed.
- Runtime retest: `POST /password/forgot` 202 then `POST /password/reset` 200;
  both pre-reset session tokens return 401 with `revoked_at` set; the old
  password is refused; a real app launch with cleared data logs in on the new
  password and reaches the Home shell.
- Status: CLOSED; CI passed on `23d9ff1` ([run 34548979179](https://github.com/waqaskhan0/mohalla/actions/runs/34548979179)).

## INTEGRATION-005 — FEED-FR-005 has a ViewModel and no gesture

- Flow: Android Home → Following/Discover → pull down to refresh.
- Symptom: nothing happens. A reader on a populated feed has no way to ask for
  new posts; a post created in the app does not appear until the screen is
  rebuilt. Runtime evidence: a drag on the feed produced no HTTP request.
- Root cause: `HomeScreen` accepts `onRefresh` and never calls it except from
  the failed-first-page retry button, and nothing renders `state.refreshing`.
  `FeedViewModel.refresh()` and the state field were both correct.
- Owning layer: Android UI.
- Requirement: FEED-FR-005 (Must), recorded `IMPLEMENTED` in
  `18-mobile-requirement-traceability.md` and covered by `FeedStateTest` — which
  tests the ViewModel, not the screen.
- Regression test: `FeedPullToRefreshTest` drives the real `HomeScreen` on a
  device and asserts a drag on a populated feed reaches `onRefresh`.
- Mutation proof: pre-fix `HomeScreen` restored → FAIL (`expected:<1> but
  was:<0>`); fix restored → PASS. Not committed.
- Fix commit: this Group 4 checkpoint.
- Runtime retest: a slow drag fires `GET /feed/discover`; pagination still fires
  its own two further requests.
- Status: CLOSED; CI passed on `23d9ff1` ([run 34548979179](https://github.com/waqaskhan0/mohalla/actions/runs/34548979179)).
- **Carried**: the identical gap existed on five more screens — events, inbox,
  notifications, saved posts and user lists — all computing `refreshing` with
  nothing rendering it. Fixed in the group that exercises each, so every fix is
  verified where it is made.
  - Events: FIXED in Group 7. A drag on the events list took `GET /events` from
    15 requests to 16 on the device.
  - Inbox: FIXED in Group 8. A drag on the inbox took `GET /conversations`
    from 3 requests to 4 on the device.
  - Notifications: FIXED in Group 10, and the sharpest of the six — the screen
    takes `onRetry`, the same call, but reachable only from the failure branch.
    A drag took `GET /notifications` from 13 requests to 14 on the device.
  - Saved posts and user lists: FIXED in Group 19. Followers took
    `GET /users/{id}/followers` from 4 requests to 5, and saved posts took its
    own from 2 to 3, both on the device.
- **CLOSED - all six screens.** The saved-posts gesture first reported NO
  against an EMPTY list: `PullToRefreshBox` needs a scrollable child and an
  empty-state column is not one, so the check was measuring the empty branch
  rather than the fix. Saving three posts and retrying fired the request.

## INTEGRATION-006 — a post you had liked showed an empty heart

- Flow: Android feed → like → open the same post at its own screen.
- Symptom: the detail screen showed "Like" with a count of 1. Tapping it moved
  the count optimistically to 2 while the database held one row, and nothing
  reconciled — the client had no reason to think anything had failed. Also on
  the profile post list.
- Root cause: `GET /posts/{id}` and `GET /users/{id}/posts` did not return
  `viewerHasLiked`; every feed endpoint does. The Android field defaults to
  `false`, so the omission was never a parse error.
- Owning layer: API response contract (`PostService.render`).
- Requirement: ENGAGE-FR-001; Stage 9 Group 4 optimistic state reconciling with
  server truth.
- Fix: `posts/ports/viewer-likes.port.ts` with an adapter in `engagement`,
  following `follow-removal.port.ts` — `engagement` already imports `posts`, and
  this repository inverts the lighter edge rather than using `forwardRef`.
  `guard:deps` passes.
- Regression test: two assertions in the API smoke test, at the `/posts/{id}`
  fetch it already made after liking, one per direction — `false` is also what a
  missing field produces.
- Mutation proof: `viewerHasLiked: false` hard-coded, exactly as the field was →
  API smoke 414 passed / 1 failed; fix restored → 415 passed / 0 failed. Not
  committed.
- Fix commit: this Group 4 checkpoint.
- Runtime retest: `GET /posts/{id}` returns `viewerHasLiked: true`; the detail
  screen and the profile post list both render "Remove like" with a count of 1,
  matching the single `likes` row.
- Status: CLOSED; CI passed on `23d9ff1` ([run 34548979179](https://github.com/waqaskhan0/mohalla/actions/runs/34548979179)).

## INTEGRATION-010 — the same post reported different counts on different screens

Raised as an open question while fixing INTEGRATION-006 and deliberately left
unmeasured until Group 11 could create a block. **Measured, confirmed, fixed.**

- Flow: a blocked person had liked and commented on the reader's post; the
  reader opens it in the feed, on its own screen, and in their profile list.
- Measured with one block in place: feed `0/0` (correct), post detail `1/1`,
  profile post list `1/1`, stored `1/1`. Two things wrong at once — the reader
  was shown engagement from somebody they had blocked as a number, and the
  comment THREAD was already filtered, so the screen contradicted itself:
  "1 comment" above an empty thread.
- Root cause: `07-database-design.md` lists the read paths the block predicate is
  applied on and names "post detail" among them. The feed applied it through
  `EngagementService.adjustedCounts`; `PostService.render` used the stored
  counters.
- Owning layer: API (`posts`).
- Requirement: ENGAGE-FR-006, BR-025, SEC-019.
- Fix: the arithmetic moved out of `EngagementService` into
  `engagement/domain/adjusted-counts.ts` so both callers share one
  implementation — copying it would have reproduced the drift that caused the
  defect. The `ViewerLikes` port grew `adjustedFor`, and `render` takes the
  per-viewer projection instead of a bare flag. Stored counters untouched: they
  remain the platform-wide truth moderation and ranking read.
- Regression test: API smoke test, engaging BEFORE the block and asserting the
  stored counters are still 1/1 while the viewer sees 0/0.
- Mutation proof: stored counters restored → FAIL, `detail 1, stored 1` on both
  counts. Fix restored → PASS. Not committed.
- Test-quality note: the first version of the regression engaged AFTER the
  block, when the blocked person cannot engage at all — so the stored counter
  was zero and `detail 0` passed against the defect. Rewritten to engage first.
- Runtime retest: detail 0/0, profile list 0/0, feed 0/0, stored 1/1.
- Status: CLOSED; CI passed on `23d9ff1` ([run 34548979179](https://github.com/waqaskhan0/mohalla/actions/runs/34548979179)).

## INTEGRATION-011 — a block did not reach the notification centre

- Flow: A blocks B after B has already liked and commented on A's post.
- Measured: **3 of 3** notifications B had caused were still listed to A.
- Root cause: eligibility rule 2 suppresses the RECORD at write time, which
  covers everything after a block and nothing before it. The read path applied
  no block predicate at all. `domain/eligibility.ts` is explicit — "a blocked
  user's like must not appear in the centre either; BR-025 says neither party
  sees the other's activity, and a notification centre is a surface like any
  other" — and `07-database-design.md` names notifications among the read paths
  the predicate is applied on.
- Owning layer: API (`notifications` read path).
- Requirement: BR-025, SEC-019, ADR-014 rule 2.
- Fix: `BlockCheck` gained `blockCounterparts(userId)` — the set, not a
  predicate per pair, because a page of twenty would otherwise be twenty round
  trips. Applied in SQL so a page emptied by blocks still pages correctly, with
  `actor_id IS NULL` surviving it so system notifications do not vanish. The
  unread count takes the same exclusion: a badge counting rows the centre will
  not show is a badge that never clears.
  `NotificationController` moved to the application root, because the predicate
  is `safety`'s (PRODUCT) and `notifications` is PLATFORM — the same reason
  `OutboxDrainService` is already composed there. `guard:deps` stays clean.
- Regression test: API smoke test, draining the outbox first so the
  notifications provably existed before the block.
- Mutation proof: empty exclusion set restored → FAIL, `2 of 2 notifications
  name them`, `badge 0 vs 2 listed`. Fix restored → PASS. Not committed.
- Test-quality note: the first version reported "0 of 0", which is vacuous — it
  never established that there was anything to hide.
- Runtime retest: 0 of 0 notifications name the blocked person; badge agrees
  with the list.
- Status: CLOSED; CI passed on `23d9ff1` ([run 34548979179](https://github.com/waqaskhan0/mohalla/actions/runs/34548979179)).

## INTEGRATION-007 — attaching any image killed the app, twice over

- Flow: Android composer → Add an image → Photos → Done.
- Symptom: the process died. Two distinct fatal crashes in the same six lines,
  the second only visible once the first was fixed. Media had never worked from
  the app at all.
- Root cause (a): `media-storage.port.ts` says its two adapters answer
  differently — S3 presigns an absolute URL, the local adapter returns the API
  path `/media/upload/{key}` — and the client passed the target straight to
  `Request.Builder().url()`, which throws `IllegalArgumentException` on a path.
  Not an `IOException`, so the catch did not hold it.
  `FATAL EXCEPTION: main ... Expected URL scheme 'http' or 'https'`.
- Root cause (b): with the URL resolved, `http.newCall(request).execute()` is
  OkHttp's blocking call and ran inside `viewModelScope`, which is
  `Dispatchers.Main` -> `NetworkOnMainThreadException`, also not an
  `IOException`. Every other network path in the app already dispatches to IO
  (`apiCall`, `ImagePicker.read`, `UrlConnectionHttpClient`); this one place did
  not, which is why only media crashed.
- Owning layer: Android (`ImageUploader`). The API contract is correct and
  deliberate.
- Requirement: MEDIA-FR-001..005, ADR-013; Stage 9 Group 6.
- Fix: resolve a relative target against the API base; run the PUT under
  `withContext(Dispatchers.IO)`; treat an unusable target or an unexpected
  network-layer throw as `UploadResult.Failed` rather than a crash, re-throwing
  `CancellationException`.
- Regression tests: `ImageUploadTargetTest` (JVM, the URL half) and
  `ImageUploadThreadingTest` (device, the threading half — StrictMode is an
  Android runtime policy and a JVM test would pass against the defect).
- Mutation proof: target passed straight through -> `ImageUploadTargetTest` FAIL
  on 2 of 3 cases with the original `IllegalArgumentException`; PUT back on the
  caller's thread -> `ImageUploadThreadingTest` FAIL, `Actual: main`. Both PASS
  with the fixes. Neither mutation committed.
- Test-quality note: the threading test's FIRST version asserted only "it did
  not crash" and PASSED against the restored defect, because the widened catch
  turns a StrictMode violation into the same `Failed` a refused connection
  produces. It now asserts the thread the request is issued on, through an
  OkHttp interceptor. Separately, `installDebugAndroidTest` installs only the
  test APK — a mutation on production code needs `installDebug` too, and the
  first mutation run reported a false OK because of it.
- Runtime retest: `POST /media/upload-slot` 201 -> `PUT` 204 ->
  `POST /media/{id}/complete` 200; `media.state = READY`,
  `mime_verified = image/jpeg` decided from the bytes, 106,771 bytes, 757x1600
  (longest edge exactly the section 7 cap, from a 1080x2280 source, so
  compression is proven); `post_media` row at position 0; the image draws in the
  post on the profile. Zero crashes in logcat.
- Status: CLOSED; CI passed on `23d9ff1` ([run 34548979179](https://github.com/waqaskhan0/mohalla/actions/runs/34548979179)).

## INTEGRATION-008 — a fixture number could land on the fake provider's reserved failure suffix

- Flow: `npm run smoke:api` on a fresh CI database.
- Symptom: `FAIL  a non-participant reporting it changes nothing about their
  access — report status 401` on run
  [34499009443](https://github.com/waqaskhan0/mohalla/actions/runs/34499009443).
  407 passed, 1 failed. The same suite passed on the previous commit and passes
  locally, because the trigger is time-dependent.
- Root cause: `FakeSmsProvider` fails deterministically on the RECIPIENT NUMBER
  — `0000` permanently, `9999` retryably — which is what makes retry and
  dead-job behaviour testable without monkey-patching. `syntheticPhone(seed)`
  derives its number from `Date.now() + offset` and could therefore produce one
  of those reserved suffixes. That CI run seeded `Date.now() + 21444` into a
  `9999` number, so `onboard` read no OTP from the outbox, returned an account
  with no token, and a message-privacy check three lines later failed with an
  authentication error — a red that pointed at the wrong thing entirely.
- Owning layer: test fixtures (`scripts/posix/api-smoke-test.mjs`). No product
  code is implicated; the provider's behaviour is deliberate and correct.
- Fix: `syntheticPhone` nudges off a reserved suffix (kept a pure function of
  the seed, so callers that reuse a seed still collide as they intend), and
  `onboard` now throws if it did not obtain a session — naming the fixture
  problem where it happens instead of corrupting an unrelated assertion.
- Regression test: the guard in `onboard` IS the regression test; any future
  fixture breakage reports itself.
- Mutation proof: measured against the running backend rather than argued. The
  reserved number recorded **0** messages in the fake provider's outbox — so
  `onboard` had no OTP to read, exactly as in CI — while the nudged number
  recorded a verification code. 200,000 seeds now produce no reserved suffix.
- Runtime retest: `npm run smoke:api` 415 passed, 0 failed.
- Status: CLOSED; CI passed on `23d9ff1` ([run 34548979179](https://github.com/waqaskhan0/mohalla/actions/runs/34548979179)).

## INTEGRATION-009 — a REST send did not reach a connected socket

- Flow: any client sends over `POST /conversations/{id}/messages` while the
  recipient holds a live Socket.IO connection.
- Measured before the fix: `POST .../messages` 201, recipient socket
  `connected: true`, **0 `message:new` events in 5 seconds**, while a
  socket-originated send to the same recipient arrived in under one.
- Root cause: the fan-out lived only in `MessagingGateway.onSend`. The REST
  route called the same `messaging.send(...)` and never emitted, so whether a
  recipient was pushed depended on how the sender happened to send. The same
  asymmetry applied to the sender's own other devices.
- Owning layer: API messaging transport.
- Requirement: `12-messaging-notifications.md` — "REST is the source of truth.
  Realtime is an accelerator" — an accelerator for MESSAGES, not for
  messages-sent-a-particular-way.
- **Fix:** the fan-out moved to `MessagingService`, which is the one place that
  knows a row was genuinely created, so both transports accelerate identically
  and the `created` guard lives once. It runs AFTER the transaction commits —
  announcing a message that could still roll back is worse than announcing it a
  few milliseconds later — and the originating socket id travels with the send
  so a socket client is not echoed a message it already has the ack for.
- **The obvious wiring did not work, and the failure was silent.** Making the
  gateway itself the adapter is a DI cycle: the gateway depends on the service.
  Nest did not report it — the module simply never initialised and the process
  exited on an unsettled top-level await. `forwardRef` is what this repository
  consistently refuses, so the dependency was removed rather than deferred:
  `transport/realtime-publisher.ts` holds only the Socket.IO namespace, which
  the gateway hands over in `afterInit`. The arrows now run one way.
- Regression tests: three unit tests on the service (a send with no socket
  publishes; a socket send carries the id to exclude; a retry publishes
  nothing) and an 11-check HTTP suite with two real socket clients.
- Mutation proof: restricting the fan-out to socket sends again →
  HTTP suite **6 passed / 5 failed** with the exact original symptom
  (`0 delivery(ies)`), and the unit suite **2 failed**. Fix restored → 11/11
  and 44/44. Not committed.
- Runtime retest: a REST send reaches a connected recipient once and flags
  `isRequest` correctly, reaches the sender's other devices, does not echo the
  originating socket, still persists and delivers exactly one message under
  three concurrent retries, and a REST-sent message request is delivered
  flagged as a request. Group 8's realtime suite still 15/15 and Group 9's
  message-request suite still 35/35.
- Status: **CLOSED**; CI passed on `23d9ff1` ([run 34548979179](https://github.com/waqaskhan0/mohalla/actions/runs/34548979179)).

## INTEGRATION-012 — the Admin portal appeared unrenderable, and was not

**Corrected and CLOSED.** The original diagnosis was wrong in a way worth
recording, because it nearly left a whole surface unverified.

- Original symptom: the portal served its loading skeleton and never resolved,
  while `GET /admin/moderation/queue` returned 200 to the very request the page
  made. `/moderation` measured 22,177 bytes with one RSC chunk.
- **The 22 KB measurement was mine, not the portal's.** It used a cookie jar
  from a form POST that never established a session, so the fetch was
  effectively unauthenticated. Re-measured with a valid
  `mohalla_admin_session` cookie, the same page returns **250,673 bytes with 20
  Review links**, and the dashboard **72,689 bytes containing the real figures**.
  The portal renders correctly, in both dev and production.
- **The remaining symptom is the in-app browser, not the portal.** In
  production mode — no HMR socket at all — the browser holds the complete
  document (`documentElement.outerHTML` 71,766 bytes, "Open reports" and
  "Total users" present, figures 1,935 / 7,398 in the DOM, one pending
  `<template>` and two hidden divs) and still paints the Suspense fallback. It
  receives and parses Next's streamed output but does not execute the reveal
  that swaps the resolved content in.
- **The Admin consuming UI is therefore verified**, through the document the
  browser actually received:
  - dashboard — real aggregate figures
  - moderation queue — 250 KB, 20 Review links, severity rendering
  - case detail — 131 KB with **Restore**, **Delete**, **No action**, the
    mandatory reason field, the REPORTED BY panel, and the stated
    ADMIN-API-GAP-004/005 absence rather than a blank panel
  - plus Group 3's earlier live browser session: sign-in, dashboard, the queue
    with 1,510 cases and a working pager, audit log, sign-out, and an expired
    session landing on `/login?expired=1`
- Status: **CLOSED.** Groups 12–18's Admin legs are PASS, with the harness
  caveat stated rather than a blocked marker.

## OBSERVATION — `next build` fails on this host with multiple prerender workers

Not a defect in `apps/admin`, and separated from INTEGRATION-012 because it is
a different thing.

- `npx next build` → fails, deterministically, prerendering Next's own
  `/_global-error`: `TypeError: Cannot read properties of null (reading
  'useContext')`.
- `npx next build --debug-prerender` → **succeeds**, all 11 pages, same source,
  same commit, same machine. That flag's difference is that prerendering runs
  in a single process rather than three workers.
- CI builds the portal green on every push, and `verify`'s `build:apps` lane
  passes here once `.next` is warm.
- Conclusion: a multi-worker prerender problem on this Windows host. No source
  change is warranted, and adding a `global-error.tsx` boundary was tried and
  did **not** change it, so it was reverted rather than left in the diff.
- Recommendation: nothing to do for release, which builds on Linux. Worth
  knowing for anyone building the portal on Windows from a cold `.next`.

