# 19 — Mobile Test Report

**Stage 7 · Android** · §44 · §45 · last updated after group 23 (Integration validation)

> **478 unit tests across 32 classes. 0 failures, 0 errors, 0 skipped. Android
> Lint clean on `lintDebug`.**
>
> **0 of §44's eleven end-to-end flows executed. 0 of §45's thirteen device
> checks executed.** There is no emulator and no device on this machine.

---

## 1. Read this section before the rest

§45 opens with a sentence this report exists to respect:

> *"Do not mark Stage 7 complete based only on compilation."*

Nothing below marks Stage 7 complete. What follows is a **written trace** of each
mandated flow against the code and the API contract — the strongest evidence
available without hardware — and it is a weaker thing than an executed flow in a
specific way worth naming:

**A trace can show that every step has an implementation, a route and a test. It
cannot show that the steps connect when a person taps them.** Group 20 found a
revocation callback that nineteen groups of tracing had not caught, because
reading the declaration and reading the call site are two different acts and only
the second one was missing. Group 23 found three more of the same shape. Every
one of those would have been caught in about four seconds by a person holding the
phone.

So: the traces below are the deliverable, the executed flows are the debt, and
the debt is recorded in `20-mobile-open-issues.md` §2 as the largest single
verification gap in this stage.

### What runs, and what it proves

| | |
|---|---|
| **478 unit tests** | ViewModel state machines, pagination cursors, validation, grapheme limits, failure routing, deep-link parsing, cross-script search, RTL invariants, wire-shape assertions. |
| **`ApiContractTest`** | Every one of the client's 75 declared routes exists in Stage 6's generated contract, with the same method and path shape. 0 missing. Every server route the client ignores is ignored for a stated reason. |
| **`IntegrationWiringTest`** | Every function on every `*Source` interface reaches a caller, or is listed with the reason it does not. |
| **`SourceInvariantTest`** | Ten rules asserted over the whole source tree — eight on accessibility and RTL, two on blocking the main thread and logging a request body. |
| **`LocalizationParityTest`** | Every string key present in both languages. |
| **What none of it proves** | That the app runs. Not one of these tests starts an Activity, inflates a Composable, or makes a network call. |

---

## 2. The eleven §44 flows, traced

Each step is given the screen that serves it, the ViewModel or route behind it,
and the test that covers its logic. **`—` in the Test column means the step's
logic has no unit test of its own**, usually because it is navigation, which is
the part a trace is worst at proving.

### Flow A — New user

`Launch → language → signup → OTP → username → profile → suggestions → follow → home`

| Step | Screen | Behind it | Test |
|---|---|---|---|
| Launch | UX-AUTH-001 | `StartupViewModel` → `GET /me` | `StartupRoutingTest` |
| Language | UX-AUTH-002 | `LocaleManager` (LOCALE-FR-001) | `LocaleManagerTest` |
| Signup | UX-AUTH-005/006/007 | `RegisterViewModel` → `POST /register` | `RegisterFlowTest` · `AuthValidationTest` |
| OTP | UX-AUTH-009 | `OtpViewModel` → `POST /otp/verify` | `AuthUniformityTest` |
| Username | UX-SETUP-001 | `UsernameViewModel` → `GET /username/available` · `POST /me/username` | `SetupOnboardingTest` |
| Profile | UX-SETUP-002 | `ProfileSetupViewModel` → `POST /media/upload-slot` · `POST /me/profile` | `SetupOnboardingTest` |
| Suggestions | UX-SETUP-003 | `SuggestionsViewModel` → `GET /suggestions` | `SetupOnboardingTest` |
| Follow | UX-SETUP-003 | `PUT /users/{id}/follow` | `SetupOnboardingTest` |
| Home | UX-HOME-001 | `FeedViewModel` → `GET /feed/following` | `FeedStateTest` |

**Group 23 changed this flow.** Registration now carries the Individual /
Organization choice PROFILE-FR-006 always required and nothing had ever sent —
see §4 below. Before that fix this flow completed and produced the wrong kind of
account, permanently, and no trace of it would have looked wrong.

**What the trace cannot establish:** that the OTP screen receives the normalised
phone number the previous screen computed, or that `registered` actually
navigates. Both are `MohallaNavHost` wiring.

### Flow B — Returning user

`Login → feed → post detail → like → comment → notification`

| Step | Screen | Behind it | Test |
|---|---|---|---|
| Login | UX-AUTH-004 | `LoginViewModel` → `POST /login` | `AuthValidationTest` |
| Feed | UX-HOME-001 | `FeedViewModel` → `GET /feed/following` | `FeedStateTest` · `FeedPagingTest` |
| Post detail | UX-HOME-003 | `PostDetailViewModel` → `GET /posts/{id}` | `PostDetailTest` · `PostCacheTest` |
| Like | UX-HOME-003 | `PUT /posts/{id}/like` | `PostDetailTest` |
| Comment | UX-HOME-003 | `POST /posts/{id}/comments` | `PostDetailTest` |
| Notification | UX-HOME-007 | `NotificationsViewModel` → `GET /notifications` | `NotificationsTest` |

**The last step is the one that cannot be traced end to end at all.** A
notification arriving *because* another user liked or commented is server
behaviour plus a poll; the client can only be shown to render and navigate what
it is given. And a **reply** notification still has no destination (GAP-M-009),
so one variant of this flow's final step dead-ends by design.

### Flow C — Create

`Create → text → image → compression → upload → publish → post appears`

| Step | Screen | Behind it | Test |
|---|---|---|---|
| Create | UX-CREATE-001 | `ComposerViewModel` | `ComposerTest` |
| Text | UX-CREATE-001 | `BreakIterator` grapheme count, 3000 (BR-012) | `ComposerTest` |
| Image | UX-CREATE-002 | `rememberImagePickerLauncher` | — |
| Compression | UX-CREATE-002 | `ImageUploader` | `AttachmentUploadTest` |
| Upload | UX-CREATE-002 | `POST /media/upload-slot` → presigned `PUT` → `POST /media/{id}/complete` | `AttachmentUploadTest` |
| Publish | UX-CREATE-001 | `POST /posts` | `ComposerTest` |
| Post appears | UX-HOME-001 | `PostCache` + feed refresh | `PostCacheTest` |

**The image picker is the weakest link in the whole document.** It is a system
Activity result; there is no unit test and there cannot usefully be one. §45's
"Image picker" and "Camera/gallery" checks exist precisely for this step and
neither has run.

### Flow D — Social

`Search → profile → follow → message`

| Step | Screen | Behind it | Test |
|---|---|---|---|
| Search | UX-SEARCH-001/002 | `SearchViewModel` → `GET /search/people` | `SearchTest` |
| Profile | UX-PROFILE-002 | `ProfileViewModel` → `GET /users/{id}` | `ProfileTest` |
| Follow | UX-PROFILE-002 | `PUT /users/{id}/follow`, optimistic with count revert | `ProfileTest` |
| Message | UX-MSG-003 | `POST /conversations` → `ConversationViewModel` | `MessagingTest` |

Complete, and the only flow of the eleven where every step has both a route and a
test. Cross-script search (SEARCH-FR-003, Urdu and Roman Urdu) is covered by
`SearchTest`.

### Flow E — Message request

`Non-follower sends → recipient Requests → no main-nav badge from request → no
normal push → open without read receipt → accept/decline/block`

| Step | Screen | Behind it | Test |
|---|---|---|---|
| Non-follower sends | UX-MSG-003 | `POST /conversations` | `MessagingTest` |
| Recipient Requests | UX-MSG-002 | `GET /conversations?section=requests` | `MessagingTest` |
| **No main-nav badge** | shell | `ShellViewModel` takes only the accepted half of `unreadCounts()` (BR-027) | `ShellStateTest` |
| **No normal push** | — | **Cannot be verified: push does not exist** (DEP-003) | — |
| Open without read receipt | UX-MSG-004 | `markRead` not called for a pending request (BR-028) | `MessagingTest` |
| Accept / decline / block | UX-MSG-004 | `POST /conversations/{id}/accept` · `/decline` · `PUT /users/{id}/block` | `MessagingTest` · `SafetyTest` |

**Five of six steps are covered; the sixth is vacuous.** "No normal push" is
trivially true because there is no push at all, and it will need re-testing the
day DEP-003 is provisioned. That is the honest reading, and it is not a pass.

### Flow F — Events

`Events → detail → RSVP → count updates → external join availability`

| Step | Screen | Behind it | Test |
|---|---|---|---|
| Events | UX-EVENT-001 | `EventsViewModel` → `GET /events` | `EventTimesTest` |
| Detail | UX-EVENT-003 | `EventDetailViewModel` → `GET /events/{id}` | `EventRsvpAndJoinTest` |
| RSVP | UX-EVENT-003 | `PUT /events/{id}/rsvp` · `DELETE` to withdraw | `EventRsvpAndJoinTest` |
| Count updates | UX-EVENT-003 | optimistic count, reverted on refusal | `EventRsvpAndJoinTest` |
| External join availability | UX-EVENT-003 | `POST /events/{id}/join` (EVENT-FR-003, BR-045) | `EventRsvpAndJoinTest` |

Covered. **UX-EVENT-002 "Events — Mine" remains `◐`**: no endpoint returns the
events a user has RSVP'd to, so that half of EVENT-FR-004 has nothing to call.

### Flow G — RTL

`English → switch Urdu at runtime → all current screen layout mirrors → bottom
nav mirrors → Create remains center → navigate through major flows in Urdu`

| Step | Behind it | Test |
|---|---|---|
| Switch at runtime | `LocaleManager` + Activity recreation | `LocaleManagerTest` |
| Layout mirrors | logical `start`/`end` only, asserted source-wide | `SourceInvariantTest` |
| Bottom nav mirrors | tab list never `.reversed()`, asserted | `NavigationRtlTest` · `SourceInvariantTest` |
| Create remains centre | index 2 of 5, unreversed | `NavigationRtlTest` |
| Navigate in Urdu | every user-visible string from resources, both languages present | `LocalizationParityTest` |

**This is the flow where the gap between a trace and an execution is widest, and
§36 makes it release-critical.** What the tests establish is that *the mistakes
which make mirroring fail are absent* — no `Absolute.Left`, no left/right
padding, no unmirrored directional icon, no reversed tab list, no hardcoded
string. What no test here establishes is **that the pixels mirror**. That needs
an emulator and a pair of eyes, and neither is available.

Compounding it: LOCALE-FR-004 is `PARTIAL` because DEP-013 has not delivered the
licensed Noto Nastaliq face, so what would render today is not what will ship.

### Flow H — Block privacy

`A blocks B → B search → profile → feed → post → chat` — *"All produce approved
absence/neutral behavior."*

| Surface | Behind it | Test |
|---|---|---|
| Search | blocked users absent from results | `SearchTest` |
| Profile | one `ApiFailure.Unavailable` for 404 → UX-STATE-001 (BR-025) | `ProfileTest` · `FailureRoutingTest` |
| Feed | blocked authors' posts absent | `FeedStateTest` |
| Post | neutral "Content unavailable", never "you are blocked" | `PostDetailTest` · `ApiFailureShapeTest` |
| Chat | conversation preserved, sending refused (MSG-FR-006) | `MessagingTest` |

**Structurally enforced rather than remembered.** `ApiFailureShapeTest` asserts
the exact field shape of `ApiFailure.Unavailable` — it has no `code` and no
`details` — so no screen can accidentally render a distinguishing reason, because
there is no field to render. That is the strongest-covered flow in this document.

### Flow I — Suspension

`Suspended user → Home readable → Create disabled → Like blocked → Follow blocked
→ Message blocked → explanation shown`

| Step | Behind it | Test |
|---|---|---|
| Home readable | `AccountCapability.READ_ONLY` gates writes only | `ShellStateTest` |
| Create disabled | Create tab locked, tap explains rather than doing nothing | `ShellStateTest` |
| Like / Follow / Message blocked | write affordances gated on capability | `ShellStateTest` |
| Explanation shown | UX-SAFE-004 with `suspendedUntil` in the reader's calendar | `ShellStateTest` · `SafetyTest` |

Covered. Worth recording that the client gates **affordances only** and fails
*open* on an unrecognised capability string — deliberately, because the server
refuses every write from a suspended account regardless, and failing closed would
let one new server-side enum value lock working accounts out of posting.

### Flow J — Offline

`Lose connection → cached feed → banner → create attempt explanation → draft
preserved → reconnect → retry`

| Step | Behind it | Test |
|---|---|---|
| Lose connection | `ConnectivityObserver` | `FailureRoutingTest` |
| Cached feed | `PostCache` | `PostCacheTest` |
| Banner | `OfflineBanner`, above the NavHost so it covers all 40+ destinations | `FailureRoutingTest` |
| Create attempt explanation | `ApiFailure.Offline` → UX-STATE-002, not the server-error screen | `ComposerTest` · `FailureRoutingTest` |
| Draft preserved | `SavedStateHandle` in `ComposerViewModel` | `ComposerTest` |
| Reconnect | `ConnectivityObserver` flow | — |
| Retry | `ApiFailure.isRetryable()` | `FailureRoutingTest` |

Covered except the reconnect transition itself, which needs a real network
change. **A report submitted while offline is refused rather than queued**
(GAP-M-014) — a deliberate limitation, recorded, not a defect in this flow.

### Flow K — Account deletion

`Settings → Delete Account → consequence explanation → confirm → pending deletion
→ login → restore`

| Step | Screen | Behind it | Test |
|---|---|---|---|
| Settings | UX-SET-001 | `SettingsViewModel` → `GET /me/settings` | `SettingsTest` |
| Delete Account | UX-SET-009 | `DeleteAccountViewModel` | `DeleteAccountTest` |
| Consequence explanation | UX-SET-009 | `GET /me/deletion-consequences`, **which must load before Confirm enables** | `DeleteAccountTest` |
| Confirm | UX-SET-009 | `DELETE /me` with the re-entered password | `DeleteAccountTest` |
| Pending deletion | UX-AUTH-012 | 30-day window (BR-008) | `DeleteAccountTest` |
| Login | UX-AUTH-004 | `POST /login` routes to restore | `StartupRoutingTest` |
| Restore | UX-AUTH-012 | `POST /me/restore` | `DeleteAccountTest` |

Covered. The consequence list gating the Confirm button is an assertion, not a
convention: a reader cannot confirm an irreversible action before the app has
told them what it does.

### Trace summary

| Flow | Steps | Traced with a test | Cannot be traced | Verdict |
|---|---|---|---|---|
| A New user | 9 | 9 | navigation wiring | traced |
| B Returning user | 6 | 6 | the notification's cause; reply target missing | traced, one variant dead-ends |
| C Create | 7 | 6 | image picker (system Activity) | traced with a hole |
| D Social | 4 | 4 | — | fully traced |
| E Message request | 6 | 5 | push does not exist | traced; one step vacuous |
| F Events | 5 | 5 | — | traced; UX-EVENT-002 still `◐` |
| G RTL | 5 | 5 | **that pixels mirror** | traced; the real check has not run |
| H Block privacy | 5 | 5 | — | fully traced, structurally enforced |
| I Suspension | 4 | 4 | — | fully traced |
| J Offline | 7 | 6 | reconnect transition | traced |
| K Deletion | 7 | 7 | — | fully traced |

**Eleven flows traced. Zero executed.**

---

## 3. §45 — the device and emulator requirement

Every item below is **NOT RUN**. `adb devices` is empty; there is no AVD and no
system image, and downloading one is roughly a gigabyte.

| §45 check | Why it cannot run here | Nearest evidence that exists |
|---|---|---|
| Cold launch | no device | `StartupRoutingTest` covers the routing decision, not the launch |
| English | no device | `LocalizationParityTest` |
| Urdu | no device | `LocalizationParityTest`; **DEP-013 font outstanding** |
| Runtime language switch | no device | `LocaleManagerTest` covers the persistence, not the recreation |
| Keyboard | no device | `imeAction` set per field; unverified |
| Image picker | no device | none — see Flow C |
| Camera / gallery | no device | none |
| Large font | no device | `SourceInvariantTest` contrast and target rules; 130% never rendered |
| Slow network simulation | no device | `ApiFailure` routing tested; timeouts never observed |
| Offline / reconnect | no device | Flow J, minus the transition |
| Push permission UX | **push does not exist** (DEP-003) | none |
| Chat | no device | `MessagingTest`, 36 tests, no rendering |
| Scrolling performance | no device | every lazy list keyed, asserted; frame timings unmeasured |

§45 also says release *"still requires the separate physical-device matrix
defined by the SRS/QA stage."* That matrix is not begun, and DEP-006 (no Play
account, no keystore) blocks producing an installable build to run it on.

---

## 4. What group 23 found, and why unit tests could not have

Four defects, all of the same species: **code that exists, compiles, passes its
tests, and is never reached.**

| Found | Requirement | What was wrong |
|---|---|---|
| **PROFILE-FR-006 was never implemented** | **Must** | `RegisterRequest.accountType` was declared from group 03 and set by nobody. `explicitNulls = false` dropped it from every body; the server applied its `?? 'INDIVIDUAL'` default. BR-011 makes the value permanent and OD-020 forbids provisioning the administrator who could correct it — so **every organization that had ever signed up through this app was permanently mistyped.** Now a choice on UX-AUTH-005, threaded as a required parameter so no caller can omit it. |
| `PostSource.update` uncalled | POST-FR-008, Could | Six lines of correct BR-014 reasoning attached to a method with no screen. GAP-M-017. |
| `PostSource.delete` uncalled | POST-FR-007, Must | A duplicate. Deletion is wired through `PostDetailRepository.deletePost`; the requirement is fine, the second declaration is dead. |
| `NotificationSource.markAllRead` uncalled | NOTIF-FR-002 | Its own comment said a reader "taps 'Mark all read'". There is no such control — no button, no menu item, not even a string to label one. GAP-M-018. |

**None of these is a logic error, which is why 469 passing tests did not see
them.** Every assertion about registration passed: the request was well-formed
and the server accepted it. What was wrong was a field nobody populated, and a
test that exercises a ViewModel cannot tell a populated field from an absent one
it was never given.

`IntegrationWiringTest` now pins the orphan set at exactly three, each with a
stated reason, so a fourth fails the build. `RegisterFlowTest` pins the account
type at the call site. That is the enforceable half; the finding was made by
reading.

### And two in this project's own documents

| Found | What was wrong |
|---|---|
| **The §46 table existed in three shapes** | §46 prescribes thirteen columns. Groups 01–02 wrote thirteen, groups 03–04 wrote seven with no state columns at all, groups 05–19 wrote eleven with no **Accessibility** and no **Tests**. For 55 of 61 screens the accessibility column §46 asks for was simply absent — group 22's audit could not have been read off that table because it had nowhere to record it. Now one header, 61 rows, thirteen cells each. |
| **Several requirement IDs were wrong by one** | "Forgot password" and "Reset password" both cited AUTH-FR-006, which is *Logout*. "Username selection" cited PROFILE-FR-001 (*Create profile*) while "Profile setup" cited PROFILE-FR-002 (*Username Selection*) — swapped. "Suggested accounts" cited SOCIAL-FR-004 (*Following list*). "Category filter" cited FEED-FR-005 (*Pull to refresh*). Every one looks plausible on its own row. **Only inverting the table into `18-mobile-requirement-traceability.md` exposed them** — which is the argument for building a traceability matrix from the coverage table rather than writing it fresh. |

---

## 5. The contract check, and what it cannot check

`ApiContractTest` compares all 75 routes the client declares against Stage 6's
generated contract. **0 are missing.** 29 server routes go uncalled, each with a
recorded reason: 17 admin (portal, out of scope), 3 health, 2
`/notifications/devices` (DEP-003), 3 media byte routes (fetched by Coil or a
presigned OkHttp `PUT`, not Retrofit), `POST /session/refresh` (the idle window
already slides on every authenticated request — **not** a gap), and
`PUT /me/interests` (**GAP-M-016**, PROFILE-FR-011, no designed screen).

**The limitation matters as much as the result.** The generated contract has
`components.schemas` **empty** — it documents paths, methods, summaries and
nothing about request or response bodies. So this test can prove a route exists
and can never prove a field is spelled the way the client expects.

That is exactly the defect class that has cost this stage the most. Group 12's
message cursor deserialised into the *events* cursor's field name and broke
paging past thirty messages; group 14's PATCH bodies could not express a null and
made clearing a bio impossible. **A contract test with no schemas cannot catch
either.** Both were found by reading the wire types against the server's code, and
until Stage 6 emits schemas that remains the only method.

---

## 6. Where this leaves Stage 7

| | |
|---|---|
| **Unit tests** | 478 across 32 classes · 0 failures · lint clean |
| **Contract** | client ⊆ server, 0 missing, 29 exclusions each reasoned |
| **Internal wiring** | every repository function reaches a caller or is listed with why not |
| **§44 flows** | 11 traced · **0 executed** |
| **§45 device checks** | 13 listed · **0 executed** |
| **Compose UI tests** | none can run — no device |
| **Musts** | 62 of 77 `IMPLEMENTED`, 13 `PARTIAL`, 1 `BLOCKED EXTERNAL`, 1 `OUT OF SCOPE`; every outstanding one blocked outside this codebase |

**Stage 7 is not complete and this report does not say it is.** The single
cheapest change to that position is an emulator image: it would convert eleven
traced flows into executed ones, make every Compose UI test runnable, and put
§36's mirroring in front of somebody's eyes for the first time.
