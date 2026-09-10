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
- **Carried**: the identical gap exists on the events, inbox, notifications,
  saved-posts and user-list screens — all five compute `refreshing` and no
  screen renders it. Fixed in the group that exercises each, so every fix is
  verified where it is made. Groups 7, 8, 10 and 19.

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

## OPEN QUESTION — detail counts are not block-adjusted

- `/posts/{id}` renders stored counts directly; the feed passes them through
  `EngagementService.adjustedCounts`, which subtracts engagement from blocked
  people (ENGAGE-FR-006). The same post may therefore report different counts in
  a feed and on its own screen.
- Noticed while fixing INTEGRATION-006. **Not measured**, because no block has
  been exercised yet. Group 11 creates one and is the honest place to settle it.
- Status: OPEN — unmeasured, not yet a defect.

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
