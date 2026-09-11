# Stage 10 — functional Android QA

Executed on the emulator (API 36, headless, 3072 MB / 4 cores) against the real
local API, worker, Socket.IO and PostgreSQL. Nothing is stubbed and no result
below comes from reading source.

**Result: 36 checks, 36 PASS, 0 FAIL**, stable across three consecutive runs.
One defect found and fixed — **QA-004**.

## Clean install and the authentication chain

Driven end to end on a wiped install (`pm clear`, verified empty data
directory), against a phone number that had never been registered.

| Step | Evidence |
| --- | --- |
| Splash → language | `Choose your language` with **English** and **اردو** |
| Welcome | `Mohalla — Your neighbourhood, online.` |
| Number entry | typed `0300…`, **normalised on screen to `+92 300 …`** |
| Account type | Individual / Organization, with *"This cannot be changed later"* |
| Date of birth | accepted `YYYY-MM-DD`, gate stated as 13+ |
| Password | rule shown: 8–64 characters, one letter and one number |
| Terms step | **QA-004 found here** |
| OTP | `We sent a 6-digit code to +92 3** *** **44` — **masked**, with a 60-second resend cooldown counting down |
| Verification | the app **auto-submits on the sixth digit** and advances |
| Username | *"cannot be changed later"*, claimed successfully |
| Profile setup | name, city, bio, with a live 200-character counter |
| Suggested follows | real accounts from the backend, skippable |
| Home | feed, Featured rail, bottom navigation |

The number masking and the auto-submit are both worth naming: the OTP screen
never redisplays the full number the user typed, and the code field does not
make a person hunt for a Verify button.

### One false defect I nearly filed, and how it was disproved

The first OTP run looked serious: the API logged `otp_verified` **200**, the
database showed the challenge consumed, the user row `ACTIVE` and a session
created — and the app **stayed on the OTP screen**. That reads as "registration
succeeds server-side and strands the user".

It was my harness. `type_into` pressed `KEYCODE_BACK` to dismiss the keyboard;
because the app auto-submits on the sixth digit, it had *already* navigated to
the username screen, and the back-press popped it straight off again. Re-run
with the keypress suppressed, the app advances correctly every time.

Recorded because the evidence for the false version was strong — a 200, a
consumed challenge, a real session row — and none of it was evidence about the
app.

## QA-004 — the consent step's legal links did nothing

Found here, fixed, and verified on the device. Full write-up in the defect
register; the short version is that **Read the Terms** and **Read the Community
Guidelines** were wired to empty lambdas, so both were pressable and inert at
the moment the reader is asked to tick *"I have read and accept"*. The app
already had the right answer — `LegalDocumentScreen`, which Settings has always
used — and registration was the one place that did not route to it.

| | Before | After |
| --- | --- | --- |
| Read the Terms | screen unchanged | *"This document is not available yet."* |
| Read the Community Guidelines | screen unchanged | same, under the Guidelines title |
| Back | — | returns with the checkbox state intact |

No legal content was invented; OD-015 remains the owner's to resolve.

## Home and feed

| Check | Evidence |
| --- | --- |
| Both feed tabs render | Following / Discover |
| Featured rail present | `Announcements` on every tab — checked on all three |
| Category filter offered | `Filter by category` |
| Discover returns posts | `/feed/discover` 200, 10 items |
| **And the screen shows what the API returned** | matched by body text, not by a fixture title |
| Scrolling reveals new content | new labels appear rather than repeats |
| Pull-to-refresh leaves a populated feed | 41 labels, no error state (FEED-FR-005) |

The feed check is cross-referenced against the endpoint rather than a hardcoded
title, because each run of this suite publishes another post and the fixtures
sink — a title-based check would pass or fail on its own history.

## Posts — three levels of evidence

A post is created on the device and then chased through every layer:

| Level | Evidence |
| --- | --- |
| **Initiating UI** | composer opens, text entered, submit control tapped |
| **Database** | `SELECT id FROM posts WHERE body LIKE …` returns the row |
| **API** | `GET /posts/{id}` as a *different* signed-in user → 200 |
| **Consuming UI** | the post renders in the feed the author reads |

Post detail opens from the feed, and **the controls it offers match
ownership**: the account's own post shows *Delete this post* and no *Report*;
another author's shows *Report* and no delete. That asymmetry was found by an
assertion of mine that wrongly demanded both.

## Search

| Check | Evidence |
| --- | --- |
| Input present | `Search people, posts and events` |
| People search finds a real account | `userb…` / `QA user-b` |
| Urdu-script people query accepted | `/search/people?q=اردو` → 200 |
| Urdu-script post query accepted | `/search/posts?q=پانی` → 200 |
| No-result state is explicit | **`No people found`**, per tab |
| And it suggests the likely cause | *"Try the other spelling — Urdu script instead of Roman Urdu, or the other way round."* |

**Urdu is queried at the API, not typed on the device, and that is a harness
limit rather than a choice.** `adb shell input text` cannot send non-ASCII at
all — it exits 255 — so there is no way to type Urdu on this emulator without
installing a helper IME. Urdu *rendering* is proven separately.

The empty state is better than the assertion written for it: the first version
of that check looked for "not found" and missed "No people found".

## Events

| Check | Evidence |
| --- | --- |
| List renders | 36 labels |
| Event search finds the fixture event | title, time and place |
| Detail opens from a search result | `Organiser`, `Going`, `Interested` |
| RSVP changes the stored response by exactly one | measured for **that** event |
| The count on screen matches the database | `db 1, screen "1 person going"` |
| Tapping again reverses it | `1 → 0` |

Two corrections here are worth recording. The event is reached by **search**,
not by scrolling: there are 1,022 upcoming events on this database from earlier
stages and the fixture sorts at position **993**, because the list is correctly
ordered by start time. And the RSVP check counts rows *for that event* — an
earlier version counted every RSVP row in the database and would have passed on
369 rows left behind by earlier stages without this tap doing anything.

The toggle is asserted in both directions so the suite is re-runnable; asserting
"+1" failed on the second run with `1 → 0`, which was the product correctly
un-RSVPing, not a defect.

## Notifications, profile and settings

| Check | Evidence |
| --- | --- |
| Notification centre opens | renders without error |
| Own profile renders | 31 labels |
| Settings reachable from profile | yes |
| Settings offers Language / Blocked / Log out / Delete account | all four present |

## Stability

Clean crash buffer across every run — no `FATAL`, no `AndroidRuntime` entry for
the package.

## Not claimed

- **Physical devices**: none available. Every hardware-specific lane stays
  `BLOCKED_EXTERNAL`.
- **Urdu typed on device**: not executed, for the `adb` limitation above.
- **Human Urdu language quality**: not executed — no fluent reviewer. Layout and
  RTL are assessed separately from translation quality.
- Logout, password reset and restore-account on the device are covered in the
  authentication regression rather than here; the OTP-driven paths were proven
  during signup.

## An environment result that is not a product result

Three of the earliest launch measurements were **discarded, not filed**. A cold
launch reported `Status: timeout` with first draw at +29.4 s, +21.4 s and
+26.9 s — which reads as a serious startup defect. A screenshot taken at that
moment shows the app's own language screen rendered correctly *behind* a system
dialog reading **"System UI isn't responding"**, with ANRs in the keyboard and
telephony processes and 6 % idle CPU inside the guest. The AVD had 2 GB and 2
cores on an 8 GB host. It was raised to 3 GB / 4 cores and moved headless, and
no performance figure from before that change is used anywhere.
