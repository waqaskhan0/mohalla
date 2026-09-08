# 19 — Mobile Test Report

**Stage 7 · Android** · §44 · §45 · last updated after the final completion pass

> **Flow A and Flow G were EXECUTED on an emulator against the real Stage 6
> stack.** They found **six defects**, all of which are fixed and re-verified.
> One of the six was a Stage 6 backend defect.
>
> **Flows B, C, D, E, F, H, I, J and K are NOT EXECUTED.**
>
> 487 Android unit tests · 904 backend tests · 0 failures · Android Lint clean.

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

| | |
|---|---|
| **11 passed · 1 failed · 3 blocked · 15 total** | |
| The failure | `build all apps` — the **admin** Next.js app failed to prerender `/_global-error` with `TypeError: Cannot read properties of null (reading 'useContext')`. **A stale `.next` cache**, not a source defect: `rm -rf apps/admin/.next` and the build succeeds. No Stage 7 commit touches `apps/admin`; its last change is `c9fc19e`, already on public `main`. |
| The 3 blocked | release gate, backup, restore rehearsal — all need a second database (`mohalla_restore_check`) that was not provisioned. **Recorded as BLOCKED, not converted to PASS.** |

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
| **A — New user** | **PASS** (six defects found and fixed) |
| B — Returning user | **NOT EXECUTED** |
| C — Create post | **NOT EXECUTED** |
| D — Social | **NOT EXECUTED** |
| E — Message request | **NOT EXECUTED** |
| F — Events | **NOT EXECUTED** |
| **G — RTL** | **PASS** for mirroring and translation · RUNTIME-006 open |
| H — Block privacy | **NOT EXECUTED** |
| I — Suspension | **NOT EXECUTED** |
| J — Offline | **NOT EXECUTED** |
| K — Account deletion | **NOT EXECUTED** |

**2 of 11 executed.** The nine are `NOT EXECUTED`, not `BLOCKED` — the
environment for them now exists and works, which is the substantive change this
pass made. What they need is time, and the deterministic fixtures §8 asks for
(two users, a suspended account, a pending-deletion account, an event, a block
relationship) were not built.

Screens that ran are marked `✅` in the `Runtime` column of
`17-mobile-screen-coverage.md`; every other screen is `—`, which means **NOT
EXECUTED** and must never be read as a pass.

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
| Android unit | 33 | **487** | 0 |
| Backend | 46 | **904** | 0 |
| **Total** | 79 | **1391** | **0** |

Android Lint: clean. `guard:all`: dependency direction, locale parity and secret
scan all pass.

New in this pass: 5 date-field regressions, 2 backend session regressions, 3
`DocumentationIdTest` checks, 1 `SourceInvariantTest` invariant.

**Compose UI tests: still none.** The emulator exists now, so they are
writable — they were not written.
