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
- Status: CLOSED locally; CI pending.

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
- Status: CLOSED locally; CI pending.
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
  - Saved posts and user lists (group 19): still OPEN.

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
- Status: CLOSED locally; CI pending.

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
- Status: CLOSED locally; CI pending.

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
- Status: CLOSED locally; CI pending.

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
- Status: CLOSED locally; CI pending.

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
- Status: CLOSED locally; CI pending.

## INTEGRATION-009 — a REST send does not reach a connected socket

- Flow: any client sends over `POST /conversations/{id}/messages` while the
  recipient holds a live Socket.IO connection.
- Measured: `POST .../messages` 201, recipient socket `connected: true`, **0
  `message:new` events in 5 seconds**. A socket-originated send to the same
  recipient is delivered in under a second.
- Root cause: the fan-out lives only in `MessagingGateway.onSend`. The REST
  route calls the same `messaging.send(...)` and never emits `message:new`, so
  whether a recipient is pushed depends on how the sender happened to send. The
  same asymmetry applies to the sender's own other devices, which the gateway
  fans out to explicitly and the REST route does not.
- Owning layer: API messaging transport.
- Requirement: `12-messaging-notifications.md` — "REST is the source of truth.
  Realtime is an accelerator"; ADR-009; NFR-PERF-007.
- **No current user impact.** The only client is Android, Android holds no
  socket (it polls `messages/since` about every two seconds, which satisfies
  NFR-PERF-007), so every participant is polling and every message arrives
  inside the poll interval. Nothing a user can do today exposes this.
- Status: **OPEN — deliberately not fixed in Stage 9.** Emitting from the REST
  path changes realtime contract semantics rather than repairing a defect: it
  raises whether a REST send should also echo to the sender's other devices, and
  how that interacts with EDGE-021's "a duplicate renders once". Stage 9 is
  integration, not feature expansion.
- Recommendation for the owner: move the fan-out from the gateway handler into
  the messaging service, behind the same `result.created` guard the gateway
  already uses, so both transports accelerate identically and the guard stays in
  one place. That is a small change with one design question attached — whether
  the sender's other devices should be echoed on a REST send — and it should be
  answered before a second client type holds a socket, because after that it is
  a user-visible latency bug rather than an asymmetry.

## INTEGRATION-012 — the Admin portal cannot be rendered in this environment

- Flow: any Admin portal page that fetches through `guardedRequest` — the
  moderation queue and a case detail were the ones measured.
- Symptom: the page serves its loading skeleton and never resolves.
  `/moderation` returns 22,177 bytes with exactly **one**
  `self.__next_f.push` chunk; the resolved segment is never flushed.
  Reproducible three times running **over plain `curl`**, so it is not the
  in-app browser's blocked HMR WebSocket, which was the first suspect and is
  also present.
- The API is answering: `GET /admin/moderation/queue` and
  `GET /admin/moderation/cases/{id}` both returned 200 while the page sat on its
  skeleton. The server-side fetch completes; the render does not.
- The production path cannot be used as a comparison: `next build` fails
  locally and deterministically prerendering Next's own `/_global-error` with
  `TypeError: Cannot read properties of null (reading 'useContext')`.
- **Not attributed to the source**, on this evidence:
  - `apps/admin` is unchanged since Stage 8's merge `a16d25b`.
  - CI builds the portal green on every push, including this commit.
  - `npm run e2e:admin` passes 12/12 — HTTP and database, not a browser.
  - The `Admin parses current backend responses` verify lane passes.
  - **The portal rendered correctly earlier in this same session** (Group 3):
    sign-in, dashboard with real figures, the queue with 1,510 cases and 20 rows
    and a working pager, the audit log, sign-out, and an expired session landing
    on `/login?expired=1`.
  - A single React 19.2.8 resolves from `apps/admin`; no duplicate copy.
- Owning layer: local environment (Windows host, Next 16.3.4 dev and build
  paths). Not a repository defect on the evidence available.
- Status: **OPEN — environment blocker.** The Admin rendered-UI leg of groups
  12–18 is reported `BLOCKED_LOCAL` rather than as a pass. Those groups are
  proven at the API and database levels and through `e2e:admin`, which does
  exercise the portal's own request and parse paths.
- Recommendation: re-run the Admin browser legs on a host where `next build`
  completes, before release validation. Nothing in the repository needs to
  change for that; the earlier successful browser run in Group 3 is recorded in
  [04-admin-authentication.md](04-admin-authentication.md).

## BLOCKED_EXTERNAL — ADMIN-FR-004's author notification waits on OD-015

- Flow: an administrator restores or deletes reported content; the author should
  be told, with the reason.
- Measured: **zero notifications** to the author after both decisions.
- `13-moderation-audit.md` requires it twice: "mandatory reason -> append-only
  audit -> author notified", and "Delete | Permanent; author notified with the
  reason (ADMIN-FR-004)".
- **Not a defect found here.** `enforcement.service.ts` carries it as
  `TODO(EPIC-14)`: "notify the target with the reason ... The pipeline exists;
  the enforcement templates and the SAFETY-FR-008 guideline citation wait on
  OD-015's content."
- OD-015 is the unpublished Terms and Community Guidelines - the same open
  decision that keeps `TERMS_VERSION` empty in a release build. SAFETY-FR-008
  requires the notification to cite the guideline breached, and a citation
  cannot be written before the guideline exists.
- Status: **BLOCKED_EXTERNAL** on an owner decision, not on engineering. Every
  other leg of INT-12 and INT-13 passes. First thing to revisit once OD-015 is
  resolved.
