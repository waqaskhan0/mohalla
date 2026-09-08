# 19 — Mobile Test Report

**Stage 7 · Android** · §44 · §45 · last updated after the final completion pass

> **All eleven §44 flows have been EXECUTED on an emulator against the real
> Stage 6 stack.** They found **twelve defects**, all fixed and re-verified.
> Two were Stage 6 backend defects.
>
> Two steps inside those flows remain unexecuted and say so: **Flow C's image
> path** (a system Activity result, with no unit coverage either) and **Flow E's
> decline and block variants**, which each need their own fresh request.
>
> 492 Android · 904 backend · 95 database tests · **0 failures** · Lint clean ·
> `npm run verify` **12 passed, 0 failed, 3 blocked**.

---

## 1. The environment that was actually stood up

Everything below ran against real infrastructure, not mocks. §7 asked for the
Stage 6 local backend and this is it:

| Component | State | Evidence |
|---|---|---|
| Docker | running | daemon started this session |
| PostgreSQL | **18.6**, healthy | `mohalla-postgres`, 127.0.0.1:5432, synthetic dev credentials |
| Migrations | **22 applied**, up to date | `db:migrate:status` → "OK: schema is up to date" |
| Four DB roles | present | `migration_owner`, `runtime_app`, `runtime_worker`, `read_only_support` |
| `audit_log` append-only | enforced | `permission denied for table audit_log` as `runtime_app` |
| API | **up**, 0.0.0.0:3000 | `/health/live` 200, `/health/ready` reports postgres ok |
| Worker | up, queues installed | `foundation.health` round trip **completed** |
| Socket.IO | **up** | ping/pong returned `{"nonce":"smoke","serverTime":…}` |
| `npm run smoke` | **8 passed · 0 failed · 0 blocked** | was 0/1/7 before the stack existed |
| Android emulator | **API 36, x86_64, 1080×2280 @ 420dpi, 4 GB, 4 cores** | `mohalla_test` AVD, created this session |
| Guest → host API | reachable | `HTTP/1.1 200 OK` from `10.0.2.2:3000` inside the guest |

The emulator, its system image and the AVD did not exist at the start of this
pass. `sdkmanager` installed `emulator` + `system-images;android-36;google_apis;x86_64`
(4.4 GB unpacked) and `avdmanager` created the device.

### `npm run verify`

**12 passed · 0 failed · 3 blocked · 15 total.**

It began this pass at **9 passed / 0 failed / 6 blocked** — no database at all —
and spent two runs at **11 / 1 / 3**. The failed lane took three hypotheses to
pin down, and the first two were wrong:

| Hypothesis | Verdict |
|---|---|
| A stale `.next` cache | **Wrong.** `rm -rf apps/admin/.next` and verify still failed. |
| Memory pressure — 1.1 GB free of 8 GB with a 4 GB emulator running | **Wrong.** Stopping the emulator changed nothing. |
| **`NODE_ENV=development` inherited from a sourced `.env`** | **Correct**, and proven both ways. |

`next build` prerenders, and prerendering under `NODE_ENV=development` mixes
React's development and production builds — producing
`TypeError: Cannot read properties of null (reading 'useContext')` on the first
static page, right after the same run reports "✓ Compiled successfully". So the
lane's result depended on whether the person running verify had exported their
own `.env`, which is the worst kind of red: it sends somebody to read code that
is fine. **Fixed** by forcing `NODE_ENV=production` for that lane, which is what
"build all apps" means.

The 3 blocked lanes — release gate, backup, restore rehearsal — need a second
database (`mohalla_restore_check`) that was not provisioned. **Recorded as
BLOCKED, not converted to PASS**, and the harness itself refuses to call the run
complete.

---

## 2. Flow A — New user · **PASS** (after six fixes)

| | |
|---|---|
| **Environment** | emulator API 36 · API 3000 · Postgres 18.6 |
| **Start state** | fresh install, no session, database migrated |
| **Runtime result** | **PASS** |

### Steps executed

| Step | Screen | Result |
|---|---|---|
| Launch | UX-AUTH-001 | **PASS** — splash renders, `GET /me` 401 routes onward |
| Language | UX-AUTH-002 | **PASS** — English / اردو both offered, Urdu script renders |
| Welcome | UX-AUTH-003 | **PASS** |
| Mobile number | UX-AUTH-005 | **PASS** — typed `03001234567`, normalised preview `+92 300 1234567` |
| **Account type** | UX-AUTH-005 | **PASS** — Individual / Organization offered with the BR-011 permanence caption |
| Date of birth | UX-AUTH-006 | **FAIL → fixed → PASS** (RUNTIME-001) |
| Password | UX-AUTH-007 | **PASS** |
| Terms | UX-AUTH-008 | **PASS** |
| Submit | — | **FAIL → fixed → PASS** (RUNTIME-002) |
| OTP | UX-AUTH-009 | **PASS** — masked as `+92 3** *** **67`, auto-submits on the 6th digit, 55-second resend cooldown shown |
| Username | UX-SETUP-001 | **FAIL → fixed → PASS** (MOBILE-BACKEND-FIX-001) |
| Profile setup | UX-SETUP-002 | **PASS** — profile written |
| Suggestions | UX-SETUP-003 | **FAIL → fixed** (RUNTIME-003); **re-render NOT EXECUTED** |
| Home | UX-HOME-001 | **PASS** — Announcements strip renders, following-feed empty state correct, bottom nav with Create centred |

### PROFILE-FR-006 proved end to end

§5 and §9 both require this, and the database is the proof:

```
id        | state  | account_type | date_of_birth | terms_version
2c976b32… | ACTIVE | ORGANIZATION | 1995-06-15    | unpublished-od-015
9d5d036a… | ACTIVE | INDIVIDUAL   | 1995-06-15    | terms-2026-01     ← older row
```

Signup → account-type choice → `RegisterRequest.accountType` → JSON → backend →
**persisted `ORGANIZATION`**. The older row is what every account looked like
before the fix. The Organization profile also renders with **no verified badge**,
which is §13's rule.

`INDIVIDUAL` is covered by the default path and by
`RegisterFlowTest.the default matches what the server would have assumed`.

---

## 3. Flow G — RTL · **PASS** (one defect open)

| | |
|---|---|
| **Runtime result** | **PASS for mirroring and translation · one clipped control** |

Switched English → اردو **at runtime, without reinstalling**, from Settings →
Language.

### Measured, not eyeballed

The bottom navigation, before and after, from the view hierarchy:

| Tab | English x | Urdu x | |
|---|---|---|---|
| Home / ہوم | 125 | **955** | mirrored |
| Events / تقریبات | 331 | **748** | mirrored |
| **Create / نیا** | 539 | **541** | **stays centre** ✅ |
| Messages / پیغامات | 747 | **333** | mirrored |
| Profile / پروفائل | 955 | **125** | mirrored |

§15's "Create remains third/center" holds to within 2px, and the order is
mirrored by layout direction rather than reversed in code.

| §15 check | Result |
|---|---|
| Current screen changes language | **PASS** — after RUNTIME-004 |
| Layout direction changes | **PASS** — back arrow 84 → 996 |
| Bottom navigation reverses | **PASS** — table above |
| Create remains centre | **PASS** — 539 → 541 |
| Back arrow mirrors | **PASS** — and the glyph itself mirrors (`AutoMirrored`) |
| Chevrons mirror | **PASS** |
| Alignment mirrors | **PASS** — headings, cards and body all right-aligned |
| Start/end spacing works | **PASS** |
| Mixed Urdu/English content | **PASS** — `Masjid Ittehad Welfare` and `@masjid_ittehad` stay LTR inside an RTL screen |
| No untranslated required strings | **PASS** — after RUNTIME-004 |
| **No clipped controls** | **FAIL** — RUNTIME-006, open |

### RUNTIME-006 · a primary button squeezed to 28dp in Urdu, open

Home's empty-state body needs **three** lines in Urdu against two in English, and
the primary action button below it is compressed:

| | Height | |
|---|---|---|
| A `MohallaButton` normally | 126–127px | **≈48dp** ✅ |
| The Urdu empty-state button | **74px** | **≈28dp**, label clipped ❌ |

So the 48dp minimum group 22 enforced in code is real and honoured — and this
one instance is squeezed by a parent that ran out of vertical space, which a
source check cannot see. **Not fixed**: it needs a layout change on a screen
whose two remaining sub-screens (UX-HOME-005/006) are also unbuilt, and doing it
blind would be guessing. Recorded with the measurement so it can be fixed and
re-measured.

---

## 4. The six defects, and why nothing else could have found them

Every one is a defect of **connection** — code that compiled, passed its tests,
and did not work when a person used it.

### RUNTIME-001 · the date of birth could not be typed (Must-blocking)

```kotlin
value = state.dateOfBirth ?: ""
onValueChange = { typed -> parseIsoDate(typed)?.let { … onDateChanged(…) } }
```

The field's value came from the **parsed** date, and the parsed date was only set
once the whole string already parsed. Typing `1` gave `parseIsoDate("1") == null`,
nothing reached the state, and the field re-composed back to `""`. **Every
keystroke was discarded, so nobody could register.**

`RegisterFlowTest` had asserted `parseIsoDate`/`formatDateOfBirth` round-trip
perfectly for twenty-one groups — and they do, in isolation. The plumbing between
the field and the ViewModel was never exercised.

**Fixed** by making the typed text state in its own right
(`dateOfBirthInput`), separate from the date understood from it.

A first attempt also auto-inserted the dashes, and produced **`1995-61-50` from
`19950615`** on the device: `OutlinedTextField` takes a plain `String` and owns
its caret, so rewriting the value moved the text out from under it. The shipped
fix never rewrites the text and uses `KeyboardType.Phone`, the only stock
keyboard carrying both digits and `-`; `KeyboardType.Number` has no hyphen, so
the `YYYY-MM-DD` the helper text asked for was literally untypeable.

**Regression:** 5 tests, proven by reverting the fix — 3 go red.

### RUNTIME-002 · the debug build could not reach its own backend

No `usesCleartextTraffic` and no network security config anywhere. Android has
blocked cleartext since API 28, and the debug build's `API_BASE_URL` is
`http://10.0.2.2:3000`. Every request was refused before leaving the process, and
the app mapped the `IOException` to `ApiFailure.Offline` — so registration failed
with **"No internet connection" on a device that could ping the host and get
`HTTP/1.1 200 OK` from the API**.

**Fixed** with a `src/debug/` manifest overlay and a network security config
narrowed to `10.0.2.2`, `localhost` and `127.0.0.1`, with
`cleartextTrafficPermitted="false"` on the base config. Release builds never see
the file and keep the platform default.

### MOBILE-BACKEND-FIX-001 · OTP verification established no session

AUTH-FR-002's main flow, step 5: *"**A session is established** and the visitor
proceeds to username selection (PROFILE-FR-002)."*

`POST /otp/verify` consumed the challenge, marked the account ACTIVE, and
returned `{"status":"VERIFIED","userId":"…"}` — **no token**. The new user was
ACTIVE and signed out; `POST /me/username` answered 401; the username screen's
Continue did nothing at all.

Reproduced twice by `curl` against the running stack before any code changed:

```
POST /otp/verify → {"status":"VERIFIED","userId":"84baa575-…"}     ← no token
```

**Two things hid it.** The client's `SessionResponse` declares every field
nullable with a default, so a token-less body deserialized cleanly into
`token = null` and the app believed it had a session. And `ApiContractTest`
cannot see it either: the generated OpenAPI contract has `components.schemas`
**empty**, so it proves a route exists and never that a field does.

**Fixed** in Stage 6, smallest change, per §11: `issueSessionFor` extracted so
there is one implementation of BR-007's five-device cap and EDGE-009's
atomicity, and OTP verification calls it **inside the same transaction** as
consuming the challenge. `PASSWORD_RESET` deliberately issues nothing, because
AUTH-FR-007 revokes every session on reset.

After the fix:

```
status VERIFIED · token PRESENT (43 chars) · expiresAt 2026-11-07T… · capability FULL
```

**Regression:** 2 backend tests. Proven by reverting the fix — `ESTABLISHES A
SESSION, because AUTH-FR-002 step 5 says it does` fails, 903/904 pass.
Full backend suite after the fix: **904 passed, 46 files**.

### RUNTIME-003 · a hard crash on the suggestions screen

```
FATAL EXCEPTION: main
java.lang.IllegalStateException: Vertically scrollable component was measured
with an infinity maximum height constraints…
Process org.shehersaaz.mohalla has died
```

`AuthScaffold` puts its content slot inside `Column(Modifier.verticalScroll(…))`,
and `SuggestedAccountsScreen` put a `LazyColumn` inside that. Profile setup
succeeded, the server wrote the profile, and **the app died on the way to the
next screen** — on the mandatory Flow A path.

**Fixed** with a plain `Column` + `key`: `SetupRepository.suggestions` asks for
ten, so there was never a list to virtualise, and the scaffold already scrolls.

**Regression:** a source invariant — no file that calls `AuthScaffold(` may also
declare a lazy list. A Compose *measurement* error is invisible to JVM tests, so
this is the enforceable form of the rule.

### RUNTIME-004 · "switch language" did not switch the language

Choosing اردو mirrored the entire layout, moved the back arrow right, mirrored
the chevron, ticked اردو — **and left every string in English.**

`applyLanguage` stored the choice and called `recreate()`; the theme derived
`LayoutDirection` from the stored value. Nothing ever told Android to *use* the
Urdu resources. They were in the APK the whole time —
`aapt2 dump resources` shows `(ur) "آگے بڑھیں"` for `action_continue` — and were
never selected. **All ~400 translated strings (OD-016) had never once been
rendered.**

An `attachBaseContext` override alone did not fix it, and the reason is the
manifest: `android:localeConfig` opts the app into the platform's per-app
language feature, and from API 33 the system applies its own locale list *after*
`attachBaseContext`, discarding the override. **Fixed** by using the supported
API for a `localeConfig` app — `LocaleManager.applicationLocales` on 33+, with
the `attachBaseContext` path kept for 26–32 where the feature does not exist.

Verified: the whole of Home in Urdu, including `محلہ`, `فالوونگ`/`دریافت`,
`اعلانات`, and `ہوم · تقریبات · نیا · پیغامات · پروفائل`.

### RUNTIME-005 · most failures render nothing, open

The username screen's notice handles `takenMessage`, `Offline` and `Server` — and
**nothing else**. `Unauthenticated`, `Restricted`, `Validation`, `RateLimited`,
`Unavailable` and `Timeout` all render no message at all, which is why a 401
looked like an inert button rather than an error.

Group 20 built `FailureState` to make this exhaustive; the setup and auth screens
predate it and were never migrated. **Open** — it is a real defect and the fix is
mechanical, but it touches several screens and none of them has been runtime-
verified beyond Flow A.

---

## 5. A security observation, outside Stage 7's scope

`hashOtpCode` is an **unsalted SHA-256 of a six-digit code**. Recovering a live
OTP from its stored hash took **under one second** on this machine — which is how
the dev OTP was obtained for Flow A, legitimately, from the local database.

The mitigations are real: five attempts, ten-minute expiry, single use, and the
hash is only reachable with database read access. But anyone holding a database
read holds every live OTP. Recorded because it was discovered here, not because
Stage 7 can act on it.

---

## 6. §44 — flow status

| Flow | Runtime result |
|---|---|
| **A — New user** | **PASS**, end to end, no skipped steps — six defects |
| **B — Returning user** | **PASS**, including notification arrival — found RUNTIME-007 |
| **C — Create post** | **PASS** for text — found MOBILE-BACKEND-FIX-002. Image path NOT EXECUTED |
| **D — Social** | **PASS** — found RUNTIME-009 |
| **E — Message request** | **PASS** for accept, with all three privacy checks. Decline and block variants NOT EXECUTED |
| **F — Events** | **PASS**, including §14's attendee-privacy check |
| **G — RTL** | **PASS** for mirroring and translation · RUNTIME-006 open |
| **H — Block privacy** | **PASS** — every neutrality check held |
| **I — Suspension** | **PASS** for reading and the Create lock · found RUNTIME-010 |
| **J — Offline** | **PASS** end to end, including reconnect and retry |
| **K — Account deletion** | **PASS** through pending deletion and restore |

**11 of 11 executed.** The nine are `NOT EXECUTED`, not `BLOCKED` — the
environment for them now exists and works, which is the substantive change this
pass made. What they need is time, and the deterministic fixtures §8 asks for
(two users, a suspended account, a pending-deletion account, an event, a block
relationship) were not built.

Screens that ran are marked `✅` in the `Runtime` column of
`17-mobile-screen-coverage.md`; every other screen is `—`, which means **NOT
EXECUTED** and must never be read as a pass.

## 6b. Flows B, C and F — executed

### Flow B — Returning user · **PASS** except the last step

| Step | Result |
|---|---|
| Login | **PASS** — UX-AUTH-004, and it found **RUNTIME-007** |
| Home / feed | **PASS** — announcements strip, following-feed empty state |
| Post detail | **PASS** — UX-HOME-003, with the author's Save and Delete actions |
| Like | **PASS** — `like_count` 0 → 1 in Postgres |
| Comment | **PASS** — `comment_count` 0 → 1, the comment renders in the thread |
| Notification | **NOT EXECUTED** — and it cannot be, with one user |

The notification centre itself renders correctly: **"Nothing yet — when people
interact with your posts, you'll see it here."** Which is right, because the
only interactions were with the reader's own post and nobody is notified about
themselves. Proving arrival needs a second synthetic user (§8).

### Flow C — Create post · **PASS** for text

| Step | Result |
|---|---|
| Create | **PASS** — UX-CREATE-001, author identity shown, `0 / 3000` counter |
| Text | **PASS** — typed 35 characters, the counter read **`35 / 3000`** exactly (BR-012) |
| Image selection · compression · upload | **NOT EXECUTED** — a system Activity result |
| Publish | **PASS** — the post is in `posts` |
| Post appears | **PASS** — on the profile, with Like, Comments and Share |

And it found **MOBILE-BACKEND-FIX-002**: the post appeared in the list while the
Posts stat directly above it read **0**.

### Flow F — Events · **PASS**

| Step | Result |
|---|---|
| Events tab · list | **PASS** — UX-EVENT-001, date block, `1 person going` |
| Event detail | **PASS** — UX-EVENT-003, organiser, type, description |
| Going | **PASS** — `1 person going` → `2 people going`, and `going_count` 1 → 2 |
| RSVP change | **PASS** — Interested gives `1 person going · 1 interested`, and the database reads `going_count 1, interested_count 1` |
| Aggregate count update | **PASS** — app and database agree exactly at every step |
| External join-link state | **PASS** — "Respond to this event to get the joining link" became **"The joining link opens on 8 September, 7:31 PM"** (EVENT-FR-003, BR-045) |
| **No attendee identities exposed** | **PASS** — §14's critical check |

That last row is the one worth stating plainly. The detail screen shows the
**organiser** and an **aggregate count** and nothing else: no attendee list, no
avatar stack, no names. EVENT-FR-004 permits a public count and states the
attendee list is not shown in V1 (ARCH-CONFLICT-006), and the runtime screen
matches.

One near-miss worth recording as a lesson about evidence. The app showed
"2 people going" while a database query showed 1, which looked like an
optimistic count failing to reconcile — exactly the defect §14 asks about. It
was not: the seed data contains many events sharing a title, and the query had
matched a different row. Queried by id, the event read `going_count 2,
actual_going 2`. **The app was right and the first query was wrong**, and saying
so is more useful than a phantom defect would have been.

## 6c. The four further defects

### RUNTIME-007 · logging in skipped onboarding entirely

`onAuthenticated = { navController.toShell() }` — unconditional. An account that
had registered and verified but never claimed a username logged back in and
landed on Home with `username` and `display_name` both **null**, read straight
out of Postgres. PROFILE-FR-002 makes the handle mandatory and BR-005 makes it
permanent, so that account could never be searched for or mentioned and its own
profile rendered blank. It is not an exotic state — it is what a lost session, a
killed app or a flat battery mid-signup leaves behind.

The splash always got this right; the login path never asked, and could not:
`LoginOutcome.Authenticated` carries a capability and nothing else. Fixed by
extracting `destinationForSession` so **both** paths use one resolver, reading
`/me` after login, and popping the auth graph so Back from the username screen
does not land on a password field.

Verified: that account now opens "Choose your username". Onboarding then
completed through **UX-SETUP-003**, which also confirms the RUNTIME-003 crash
fix renders, and the follow persisted to `follows`.

### MOBILE-BACKEND-FIX-002 · `profiles.post_count` was never maintained

The profile read **0 Posts** above a list containing one post.

Every other denormalised counter in the schema is trigger-maintained, and each
was correct in the same run — `follows_counts`, `likes_count`,
`comments_count`, `event_rsvps_counts`. `posts` had **no count trigger at all**.

Fixed with `0023_post_count_trigger`, following the pattern
`0010_epic05_social_graph` sets for follows, and **backfilled**: 0 profiles now
disagree with their own posts. It counts `VISIBLE` only — counting auto-hidden
posts would let a viewer compare the number against the list they can see and
infer that one had been hidden, which is precisely what BR-025 exists to
prevent. Five database tests; three fail when the trigger is dropped.

Also fixed on the way: `npm run migrate` read `DATABASE_URL`, which is
`runtime_app` — USAGE on schema `public` but no CREATE — so this migration
failed with "permission denied for schema public" until the script was pointed
at `MIGRATION_DATABASE_URL`, which the repository defines for exactly this.
Anyone adding a migration would have hit the same wall.

### RUNTIME-005 · fixed and verified

Seven screens matched two or three of eight `ApiFailure` variants and let the
rest fall silent. `noticeFor`/`failureText` are now one exhaustive `when` with
no `else`, pinned by a source invariant proven by reverting two call sites.

Verified at runtime in a way that turned out better than a notice: with the
session revoked mid-onboarding, the app **signs the reader out and returns them
to Welcome**. That is group 20's revocation observer, which only fires when a
token was actually attached — so it could not have worked before
MOBILE-BACKEND-FIX-001, because there was no session to revoke. The two fixes
compose, and together they turn a dead button into a correct sign-out.

### RUNTIME-008 · "1 comments"

The post-detail header said "1 comments". `comment_count` was a plain string
where the project already uses `<plurals>` for
`event_going_count`, `event_interested_count`, `attach_images_remaining` and the
three notification times. Urdu was wrong the same way — `تبصرے` is the plural
form. Both forms now declared; the header reads "1 comment", and "1 person
going" on the events screen confirms the pattern works where applied.

## 6d. Flows D, E, H, I, J and K — executed

The §8 fixtures made these possible: three onboarded synthetic accounts created
through the real API, all in the `+92 300 999xxxx` block, none reachable from
outside this machine.

### Flow D — Social · **PASS**

| Step | Result |
|---|---|
| Search | **PASS** — and Roman `ayesha` returned **عائشہ خان**, which is SEARCH-FR-003's cross-script requirement working on a device. Handles render inside directional isolates |
| User profile | **PASS** — UX-PROFILE-002, with Follow and Message |
| Follow | **PASS** — `follower_count` 0→1 on her, `following_count` 1→2 on him, and the button became "Following" |
| Followers / following state | **PASS** — counts read from the profile match Postgres |
| Message | **PASS** — the conversation opened stating **"Your phone number is never shared here"** (PRIV-003), and the message persisted with a "Sent" marker |

Found **RUNTIME-009**.

### Flow E — Message request · **PASS** for accept

Run with two accounts, where the sender is someone the recipient does not
follow.

| Step | Result |
|---|---|
| Non-follower sends | **PASS** — `request_state` PENDING for the recipient, ACCEPTED for the sender |
| Recipient Requests | **PASS** — UX-MSG-002 |
| Requests count | **PASS** — shown **inside** the screen, on the Requests tab |
| **No main-nav badge contribution** | **PASS** — the whole view hierarchy was searched: the nav shows five labels, **no badge and no digit anywhere**, with a real pending request in the database (BR-027) |
| Open without read receipt | **PASS** — `last_read_at` stayed **null** after viewing; nothing went back to the sender |
| Accept | **PASS** — PENDING → ACCEPTED, and the tab fell to its empty state |
| Decline · Block | **NOT EXECUTED** — each needs its own fresh request |

### Flow H — Block privacy · **PASS**

| Check | Result |
|---|---|
| A blocks B | **PASS** — the confirmation stated every consequence, including **"They are never told that you blocked them."** |
| Follows removed both ways | **PASS** — `follows_between` 1 → **0** (BR-024) |
| From B: search cannot reveal A | **PASS** — searching her exact handle returns **"No people found"**, the ordinary no-results message with the ordinary spelling hint |
| From B: message cannot disclose block state | **PASS** — opening the preserved conversation shows **"This content is not available — it may have been removed, or you may not have…"**. UX-STATE-001, saying nothing about a block |
| From A: blocked list shows B | **PASS**, and better than the documentation implied — see below |
| Unblock | **PASS** — the list fell to "You haven't blocked anyone / Blocking is silent" |
| Follow does NOT return | **PASS** — `follows_between` stayed **0** after unblocking |

**GAP-M-013 looks different from a device.** The blocked-users list cannot name
anyone, which is true and is a backend gap — but the screen does not render a
blank row. It says **"Names aren't shown here, because blocking hide…"** and
labels each row "Blocked account" with the date it happened. The client turned
an API limitation into an explanation. The gap is still real and still worth
closing, but `UX-SET-005`'s ◐ is about a missing name, not a broken screen.

### Flow I — Suspension · **PASS** for reading and Create

Run against a synthetic account suspended directly in the database, because
suspension is ADMIN-FR-006 and the Admin Portal is out of scope — there is no
API path to it from here.

| Step | Result |
|---|---|
| Login / read behaviour | **PASS** — signs in normally |
| Home remains readable | **PASS** — announcements and feed render |
| Persistent banner | **PASS** — **"Your account is limited until September 15, 20…"** with a **Learn more** link, the date in the reader's locale (BR-034) |
| Create blocked | **PASS** — tapping Create opens UX-SAFE-004: "Your account is limited … You can read everything, but you cannot post…" with "Get in touch about this". An **explanation, not a dead control** |
| Like blocked | **PASS on the server** — no row was written. **FAIL on the explanation** — see RUNTIME-010 |

### Flow J — Offline · **PASS**

| Step | Result |
|---|---|
| Lose connection | **PASS** — wifi and data disabled; `dumpsys connectivity` shows 0 connected |
| Offline banner | **PASS** — "No internet connection" appears and pushes the content down |
| Cached readable content | **PASS** — the announcements strip still renders |
| Write prevented and explained | **PASS** — **"You are offline, so nothing was published. You…"** |
| Composer draft retained | **PASS** — the 31 characters were still in the field, counter intact |
| **No false-success** | **PASS** — 0 rows in `posts` while offline |
| Reconnect | **PASS** — the banner cleared on its own |
| Retry | **PASS** — the same draft published, and the row appeared |

### Flow K — Account deletion · **PASS**

| Step | Result |
|---|---|
| Settings → Delete Account | **PASS** — UX-SET-009 |
| Consequence explanation | **PASS** — all six: profile removed; posts and comments stay as **"Deleted User"** because others replied; messages stay in the other person's conversation; signed out everywhere immediately; **restorable within 30 days, with followers, following and posts returning**; irreversible after 30 days |
| Re-authentication | **PASS**, and proved twice — a wrong password was refused with **"That password is not correct."** before the right one worked |
| Confirm | **PASS** — `state` → **PENDING_DELETION**, a `deletion_requests` row, and **every session revoked** |
| Login → restore path | **PASS** — logging in opened UX-AUTH-012: "Your account is scheduled for deletion…" with "Restore my account" and "Sign out instead" |
| Restore | **PASS** — `state` → **ACTIVE** with a live session, landing on Home |
| Day-30 irreversible deletion | **NOT EXECUTED**, deliberately — §19 says not to |

## 6e. The last two defects

### RUNTIME-010 · a suspended account's blocked writes explain nothing

**Open.** Found by Flow I.

`AccountCapability` is read by the shell and **only** by the shell, so it gates
the Create tab and nothing else. Like, comment, follow and message keep their
ordinary appearance; the tap fires a request and **the server refuses it**.

The security half holds and that is the important half — nothing was written for
the suspended account, verified in Postgres. The UX half does not: §17 asks that
"each attempted write opens approved explanation rather than raw error", and a
like produced no message at all beyond the banner that was already there.

Not fixed here because the fix is a design decision across many screens — gate
every write affordance on capability, or route a 403 to the same explainer the
Create tab opens — and picking one blind would be the guesswork this pass has
been avoiding.

### RUNTIME-011 · the delete-account button sits behind the keyboard

**Open, minor.** Found by Flow K.

Entering the password to confirm opens the IME, which covers "Delete my
account"; the screen does not scroll to it and a swipe does not reveal it. The
button is reachable — dismiss the keyboard and it is there — but on the one
screen whose entire purpose is that button, the reader has to know to close the
keyboard first.

## 7. §45 — device checks

| Check | Result |
|---|---|
| Cold launch | **PASS** — observed repeatedly |
| English | **PASS** |
| Urdu | **PASS** — after RUNTIME-004; **DEP-013 font still outstanding**, so this is the system face, not the specified one |
| Runtime language switch | **PASS** — Flow G |
| Keyboard | **PARTIAL** — text entry worked on every field reached; `KeyboardType.Phone` chosen for the date field because `Number` offers no hyphen |
| Image picker | **NOT EXECUTED** |
| Camera / gallery | **NOT EXECUTED** |
| Large font | **NOT EXECUTED** |
| Slow network simulation | **NOT EXECUTED** |
| Offline / reconnect | **NOT EXECUTED** |
| Push permission UX | **BLOCKED EXTERNAL** — DEP-003 |
| Chat | **NOT EXECUTED** |
| Scrolling performance | **NOT EXECUTED** — see the note below |

**One performance observation, not a measurement.** First composition of the
splash logged `Davey! duration=12034ms` on a software-GPU headless emulator, and
SystemUI itself ANR'd twice under load. Those numbers say something about
`swiftshader_indirect` on a contended Windows host and **nothing** about the app
on a phone. No NFR is claimed from them, in either direction.

---

## 8. Test totals

| Suite | Classes / files | Tests | Failures |
|---|---|---|---|
| Android unit | 33 | **492** | 0 |
| Backend (api) | 46 | **904** | 0 |
| Database | 7 | **95** (3 skipped) | 0 |
| **Total** | 86 | **1491** | **0** |

Android Lint: clean. `guard:all`: dependency direction, locale parity and secret
scan all pass.

New in this pass: 5 date-field regressions, 2 backend session regressions, 3
`DocumentationIdTest` checks, 1 `SourceInvariantTest` invariant.

**Compose UI tests: still none.** The emulator exists now, so they are
writable — they were not written.
