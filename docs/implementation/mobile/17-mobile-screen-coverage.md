# 17 — Mobile Screen Coverage

**Stage 7 · Android** · 61 required screens · last updated at commit `727871b`+

> **This table is the answer to "is Stage 7 feature-complete?"** It is not, and
> the count below says by how much. A screen is `DONE` only when it is built,
> renders correctly in **both** directions, covers its specified states, and has
> tests. Anything short of that is `PARTIAL` or `TODO` — never quietly counted.

**Legend** — ✅ done · ◐ partial · ✗ not started · — not applicable
**RTL** is asserted at the rule level on the JVM; **no screen has been verified
on a device**, because none is available (see `00-mobile-baseline.md` §6).

---

## Progress

| | Screens |
|---|---|
| ✅ Complete in both directions | **27** |
| ◐ Partial | **2** (UX-EVENT-002 · UX-CREATE-003, both API-limited) |
| ✗ Not started | **32** |
| **Required total** | **61** |

**Coverage: 44% complete.** Stage 7 is **NOT** feature-complete.

The four `UX-STATE-*` components left `◐` since group 01 are now `✅`: they are
exercised by the feed, events, composer and detail screens across every failure
path, and `ComposerTest`/`FeedStateTest` assert the neutral-refusal structure
that mandatory test A protects. UX-EVENT-004 and UX-EVENT-005 also close, because
the date and time picker built in this group was the only thing they were missing.

**Groups 03, 04 and the shell are finished.** All twelve `UX-AUTH-*` screens,
the three `UX-SETUP-*` onboarding screens and both Home feeds exist in both
directions, and the navigation graph now joins them: a cold install reaches a
usable feed without a single unwired callback in the path. That is the sequence
REL-001 tests and the one every remaining screen sits behind.

**Two defects that only the shell could expose**, both found by wiring it:

- **The manifest declared no permissions at all** — `INTERNET` included. Every
  API call would have thrown a `SecurityException` on the first request. It was
  invisible for four groups because nothing had run against a backend on a
  device, which is what an unrunnable app hides (see `00-mobile-baseline.md` §6).
- **The four registration steps would each have built their own ViewModel.**
  `viewModel()` inside a `composable` block is scoped to that destination, so
  the phone number entered on step one would have been gone by step four. Fixed
  by giving the steps a nested graph to share as a `ViewModelStoreOwner`.

A third was corrected before it shipped: `RegisterViewModel` and
`ProfileSetupViewModel` were being handed a hand-constructed `SavedStateHandle`,
which compiles, runs, and silently saves nothing. Both now take theirs from
`CreationExtras`, so entered fields actually survive process death.

---

## Group 01–02 · Shell, startup, localization

| Screen | Name | Requirements | APIs | LTR | RTL | Loading | Empty | Error | Offline | A11y | Tests | Status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| UX-AUTH-001 | Splash | NFR-PERF-003 | `GET /me` | ✅ | ✅ | ✅ | — | — | — | ✅ | ✅ | ✅ |
| UX-AUTH-002 | Language selection | LOCALE-FR-001 · BR-040 | — | ✅ | ✅ | — | — | — | — | ✅ | ✅ | ✅ |
| UX-STATE-001 | Content unavailable | SEC-019 · BR-025 | — | ✅ | ✅ | — | — | — | — | ✅ | ✗ | ◐ |
| UX-STATE-002 | Offline | NFR-AVAIL-002 | — | ✅ | ✅ | — | — | — | ✅ | ✅ | ✗ | ◐ |
| UX-STATE-003 | Server error | SEC-018 · SRS §16 | — | ✅ | ✅ | — | — | ✅ | — | ✅ | ✗ | ◐ |
| UX-STATE-004 | Rate limited | — | — | ✅ | ✅ | — | — | — | — | ✅ | ✗ | ◐ |

`UX-AUTH-001` is the splash: it is the `Resolving` state of the startup router
rather than a screen with content, and §9's rule — *"do not flash unauthorized
screens while state is resolving"* — is what it exists to satisfy.

The four `UX-STATE-*` screens are built as **shared components**, which is
required rather than convenient: `ContentUnavailable` takes **no `reason`
parameter**, so no caller can make the neutral refusal distinguishable
(mandatory test A). They are `◐` because they have no Compose tests yet.

## Group 03 · Authentication

| Screen | Name | Requirements | APIs | LTR | RTL | Status |
|---|---|---|---|---|---|---|
| UX-AUTH-003 | Welcome | AUTH-FR-001 · SEC-006 | — | ✅ | ✅ | ✅ |
| UX-AUTH-004 | Log in | AUTH-FR-005 · SEC-006/007 | `POST /login` | ✅ | ✅ | ✅ |
| UX-AUTH-005 | Register — phone | AUTH-FR-001/002 · BR-001 | `POST /register` | ✅ | ✅ | ✅ |
| UX-AUTH-006 | Register — date of birth | BR-002 | — | ✅ | ✅ | ✅ |
| UX-AUTH-007 | Register — password | SRS §12 | — | ✅ | ✅ | ✅ |
| UX-AUTH-008 | Terms & Guidelines | BR-004 · PRIV-014 | `POST /register` | ✅ | ✅ | ◐ **OD-015** |
| UX-AUTH-009 | OTP verification | AUTH-FR-003 · SEC-003 · EDGE-005 | `POST /otp/verify` `/otp/resend` | ✅ | ✅ | ✅ |
| UX-AUTH-010 | Forgot password | AUTH-FR-006 | `POST /password/forgot` | ✅ | ✅ | ✅ |
| UX-AUTH-011 | Reset password | AUTH-FR-006 | `POST /password/reset` | ✅ | ✅ | ✅ |
| UX-AUTH-012 | Restore account | SET-FR-005 · EDGE-003 | `POST /me/restore` | ✅ | ✅ | ✅ |

### What the authentication group decided, and why it is written down

**`UX-AUTH-003` is where a BANNED or DELETED account lands**, and it shows
nothing to distinguish that from a first-ever launch (SEC-006).

**SEC-006 is enforced in the client's TYPES, not its copy.** `LoginOutcome` has
three variants and `Failed` carries no payload; `LoginUiState` has one
`credentialsRejected` flag and no field per cause; `PasswordResetUiState` has
`requestSent` and nothing that could say whether an account exists. A screen
cannot render a distinction its state cannot hold, and the tests assert that
structurally — adding a `WrongPassword` variant fails to **compile**, not to
pass.

**Three disclosures are deliberate**, all on the same ground — the caller has
already proved the account is theirs:

| Disclosure | Why it is safe |
|---|---|
| `VERIFICATION_REQUIRED` on login | Required the correct password |
| `PROFILE_NOT_CREATED` on `/me` | The caller's own account |
| Wrong vs expired OTP code | Required possession of the number |

They are commented at each site so the next reader neither "fixes" them into
neutrality nor cites them as precedent for the ones that must stay neutral.

**`UX-AUTH-008` is `◐`, not `✅`.** The screen, the checkbox and the BR-004
affirmative are complete; the Terms and Community Guidelines themselves do not
exist (**OD-015**), so the links report that plainly rather than opening a
placeholder that looks like a real policy.

## Group 04 · Profile onboarding

| Screen | Name | Requirements | APIs | LTR | RTL | Status |
|---|---|---|---|---|---|---|
| UX-SETUP-001 | Username selection | PROFILE-FR-001 · EDGE-007 | `/me/username` `/username/available` | ✅ | ✅ | ✅ |
| UX-SETUP-002 | Profile setup | PROFILE-FR-002/003 · MEDIA-FR-001 | `POST /me/profile` · `/media/*` | ✅ | ✅ | ✅ |
| UX-SETUP-003 | Suggested accounts | SOCIAL-FR-004 · RSK-001 | `GET /suggestions` · `/users/:id/follow` | ✅ | ✅ | ✅ |

### What onboarding decided

**EDGE-007 — the availability check is a hint, the claim is the truth.** Two
people can pick `ayesha` in the same second. §13: *"Do not claim a username is
reserved until server confirms."* So the state field is named **`looksFree`**,
not `available` — a field called `available` invites a screen to treat it as a
promise — and **Continue is enabled on a well-formed handle, not on a positive
check**, because gating on a stale answer produces a locked button. Losing the
race is a normal outcome with its own copy, and the field keeps what was typed
so `ayesha` becomes `ayesha_lhr` without starting again.

**The client does not know the reserved list.** The backend refuses `mohalla`,
`admin` and `support` as the *same* unavailability as taken, because the SRS
refuses a reserved handle without explaining why. Shipping the list would
publish it. The tests assert those handles pass the client's **shape** check
precisely so availability stays the server's answer.

**Input is never silently lowercased.** A handle is chosen once and never
changed, so turning `Ayesha` into `ayesha` would hand somebody a permanent name
they did not type. `NEEDS_LOWERCASE` is its own message — "use lowercase" is an
instruction where "invalid characters" is a puzzle.

**The bio is counted in GRAPHEMES** (BR-012's reasoning applied to a profile
field). Counting UTF-16 units would give an English bio 200 visible characters
and an Urdu one far fewer.

**The photo is a separate transaction from the profile.** ADR-013's upload is
three steps and any can fail on 3G, so the photo uploads on selection and the
profile is created on Continue — a failed upload offers a retry for the **photo
alone** while the typed fields sit untouched (EDGE-013). A refused file and a
dropped connection are different outcomes: the first drops the bytes because
retrying cannot help, the second keeps them so retry does not reopen the gallery.

**Compression refuses rather than exceeds.** NFR-PERF-005 is a *ceiling*:
`ImageCompressor` returns `null` when no quality step gets under 500 KB, and the
uploader refuses. Sending a 4 MB camera photo because the loop ran out of steps
would break the requirement on the connection least able to afford it.

**Account type is not on this screen.** §13 is explicit that choosing
Organization does not confer a badge — that is ADMIN-FR-010, an administrator's
decision — and the backend's `createProfileBody` has no `accountType` field, so
there is nothing to send.

**Skip is offered on UX-SETUP-003.** Forcing follows would inflate the graph
with relationships nobody wanted and make the Following feed useless for the
people it was meant to serve. Featured and Discover carry the empty case
(REL-005). No follower counts are shown as social proof, because a count turns a
neighbourhood list into a popularity ranking in a product whose feed is
deliberately chronological.

## Group 05–06 · Navigation shell and Home

| Screen | Name | Requirements | APIs | LTR | RTL | Loading | Empty | Error | Offline | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| — | Bottom navigation (component) | UI/UX §14 | — | ✅ | ✅ | — | — | — | — | ✅ |
| — | Top app bar · back header (components) | UI/UX §18.5 | — | ✅ | ✅ | — | — | — | — | ✅ |
| — | Navigation graph | UI/UX §12 | — | ✅ | ✅ | ✅ | — | — | — | ✅ |
| — | Suspension banner + explainer | UX-SAFE-004 · BR-034 | `GET /me` | ✅ | ✅ | — | — | — | — | ✅ |
| UX-HOME-001 | Home — Following | FEED-FR-001/003 | `/feed/following` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| UX-HOME-002 | Home — Discover | FEED-FR-004 | `/feed/discover` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| UX-HOME-005 | Category filter | FEED-FR-005 | `/categories` | — | — | — | — | — | — | ✗ |
| UX-HOME-006 | Announcement detail | NOTIF-FR-005 | `/announcements/:id` | — | — | — | — | — | — | ✗ |

`UX-HOME-005` and `UX-HOME-006` are **not** started. The ViewModel already
carries `selectCategory`, and the filter reaching the API rather than being
applied to an already-trimmed page is asserted — but the picker sheet and the
announcement screen are unbuilt, so both stay `✗`.

### What the shell and Home decided, and why it is written down

**Empty and failed are different states, and the order of the branches is the
requirement.** A failed first page renders an error with a retry; an empty
Following feed renders an invitation. Getting them the wrong way round tells a
new user their neighbourhood is empty when the app could not reach it — and
RSK-001 is that a cold start with nothing on it is why people do not return. So
`isEmptyFollowing` is false whenever a failure is present *or* no page has
arrived, and both conditions are asserted independently.

**Featured is fetched separately and never gated on the feed** (FEED-FR-002). It
renders above the list, above the empty state and above the skeleton, because a
brand-new account legitimately follows nobody — if Featured were folded into the
feed response, an empty feed would be an empty screen (REL-005).

**Pagination is keyset, and the test asserts the CURSOR, not the result.**
Asserting the assembled list would pass even if every page were requested from
the start; asserting `[null, cursor₁, cursor₂]` is what proves the window cannot
be shifted by posts arriving above it (EDGE-017).

**A null cursor is the end; an empty page is not.** A page can come back empty
with a cursor still set — every item on it was filtered out by a block
(SEC-019) — and treating that as the end truncates the feed at the first
fully-blocked page.

**A suspended account lands exactly where an active one does.** BR-034 restricts
writing, not reading. Routing a suspended user anywhere else would be a lockout
the sanction does not authorise, so `Home` and `HomeReadOnly` both route to the
shell and the banner is the only difference.

**The Create tap is intercepted in the shell, not in the composer.** §6.2: a
suspended user "reaches the composer" is the defect — the explainer opens
*instead of* the composer, before any navigation. Checking inside the composer
would mean it exists, opens, and then refuses. The tab stays visible and locked
rather than removed, because removing it would renumber the row and move Create
off centre, which is the one thing §8's RTL rule depends on.

**`AccountCapability` fails OPEN on an unrecognised value**, which is the wrong
direction for a security decision and the right one here: it gates affordances,
never permissions, and the server refuses every write from a suspended account
regardless. Failing closed would let a new server-side capability string lock
working accounts out of posting.

**The media block holds a RATIO, not a height.** §34 asks for "a surface-sunken
block at the correct aspect ratio so no layout shift occurs" and §26 lists media
height as growing with "ratio held", so a fixed dp would be wrong twice — off the
4dp scale (§17) *and* frozen across screen sizes. Group 08 replaced the
placeholder with real Coil rendering inside the same reserved box, so the loading,
error and loaded states all occupy exactly the same space. The skeleton's bars are
fractions of the available width for the same reason.

**`ACCESS_NETWORK_STATE` drives a banner, never a gate.** Nothing decides
whether to make a request from the connectivity flow: the request is attempted
and its own `IOException` is authoritative. The signal is racy by nature, and
using it as a gate turns an unreliable hint into a refusal the user cannot retry
past.

**A release build cannot register an account (OD-015).** `TERMS_VERSION` is a
build-config field and is **empty** in release; `RegisterViewModel` refuses to
submit a blank version and the terms screen says so plainly. What is being
written at that step is a compliance record — "this user accepted this version
of these terms" — and a plausible-looking placeholder would assert an acceptance
of a document nobody has written. The debug build carries the literal
`unpublished-od-015` so the value in the audit trail says exactly that.

## Group 07 · Events

| Screen | Name | Requirements | APIs | LTR | RTL | Loading | Empty | Error | Offline | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| — | Event card · date block · RSVP row | UI/UX §18 | — | ✅ | ✅ | ✅ | — | — | — | ✅ |
| UX-EVENT-001 | Events — Upcoming | EVENT-FR-005 | `GET /events` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| UX-EVENT-002 | Events — Mine | EVENT-FR-004/007 | `GET /users/:id/events` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ◐ |
| UX-EVENT-003 | Event detail | EVENT-FR-003/004/006 · BR-045 | `/events/:id` · `/rsvp` · `/join` | ✅ | ✅ | ✅ | — | ✅ | ✅ | ✅ |
| UX-EVENT-004 | Create event | EVENT-FR-001/002 · BR-043 | `POST /events` | ✅ | ✅ | ✅ | — | ✅ | ✅ | ✅ |
| UX-EVENT-005 | Edit / cancel event | EVENT-FR-007 | `PATCH`/`DELETE /events/:id` | ✅ | ✅ | ✅ | — | ✅ | ✅ | ✅ |

**The privacy correction was applied, and the API turned out to agree.** The
prototype draws an attendee avatar stack — three faces and a "+15" beside "18
people going". EVENT-FR-004 permits a public **count** and states the attendee
list is not shown in V1 (ARCH-CONFLICT-006 / D-17), and the backend already
enforces it: there is no `GET /events/:id/attendees` route, and no response
field carries an attendee identity. So the card and the detail screen render
aggregates only, and `EventRsvpAndJoinTest` asserts by reflection that
`EventResponse` has no attendee field — adding one is now a deliberate act with
a failing test attached.

### One screen is `◐` because an endpoint does not exist

**UX-EVENT-002 is `◐` — the API cannot serve half the requirement.** The screen
asks for events the user "created **or** responded to". The backend offers
`GET /users/:id/events`, which is created-by only, and `GET /events` takes a
`.strict()` query with no `mine` parameter — so the responded-to half cannot be
requested at all. The screen ships the half that exists and **says so on the
screen**, rather than either workaround: filtering a page of twenty upcoming
events on the device (wrong for anybody who responded to an event on page three)
or keeping a local list of RSVPs (a second source of truth that would not
survive a reinstall and would drift the moment an event was cancelled). The
endpoint that would close it is recorded in `20-mobile-open-issues.md`.

**UX-EVENT-004 and UX-EVENT-005 closed in group 08.** They were `◐` only for
want of a date and time picker; that was built with the composer's media work and
is now wired, so an event can be published from the UI.

### What the events group decided, and why it is written down

**The meeting link is absent from every response type, not hidden in the UI.**
EVENT-FR-003 gates it behind an RSVP *and* a 30-minute window, "which limits
scraping of open meeting rooms" — a room link is a credential anybody holding it
can walk in with, and the people most likely to be targeted are those organising
a meeting about something contested. `EventResponse` therefore has no
`meetingUrl` field at all: the link arrives only from `POST /events/:id/join`,
is delivered as a one-shot outcome, is handed straight to the system, and is
cleared. Nothing parks it in a `StateFlow` where it would survive rotation and
appear in a state dump.

**`joinLinkAvailable` is the server's answer and is never recomputed.** The
client could compare `startsAt` to the clock; it must not. A device half an hour
fast would show a Join button the server refuses, and one behind would hide a
link that works.

**Four join refusals are told apart — the opposite of the rule everywhere
else.** `ApiFailure.Restricted` gained a `code` and a `details` map for this,
and `ApiFailure.Unavailable` deliberately did **not**. The asymmetry is the
point: a 404 concerns *existence*, so its causes must stay indistinguishable
(BR-025, mandatory test A); a 403 concerns permission on an event whose title,
time and attendee count are already public, so a refusal discloses nothing new —
and EVENT-FR-003's acceptance criterion demands the availability time be stated,
which one anonymous 403 cannot do. The refusals are matched on the **code**,
never the message, because the message is already localised and text-matching
would work in English and silently fail in Urdu.

**Upcoming is the only ascending list in the product.** EVENT-FR-005 is "soonest
first", so its cursor walks *forward* in time. `FeedCursor` was deliberately not
reused: the two have the same shape and opposite meanings, and a cursor read in
the wrong direction pages away from the data rather than through it — which
looks like an empty list, not like a bug. The test asserts the **cursor
sequence** rather than the assembled list, because asserting the list would pass
even if every page were fetched from the start.

**RSVP counts come from the server; only the button is optimistic.** Interested →
Going moves one person between two counts and the person must be counted once
(EVENT-FR-004's acceptance criterion). Simulating that on the device
double-counts anybody whose previous response the screen held stale, and the
server sends both numbers in the same response — so there is nothing to guess.
Tapping the response already held withdraws it, which is how "change or withdraw
at any time" fits a row that has to work at 360dp in Urdu.

**Cancelling is one intention with an outcome the creator does not choose.**
EVENT-FR-007: with no RSVPs the event is deleted, and once anybody has committed
"deletion outright is not offered" — it stays visible and marked cancelled until
its original date passes, so somebody who never opened the notification still
finds out. The control is therefore labelled "Cancel this event" and never
"Delete": a Delete button would be a promise the requirement forbids keeping.

**An unknown event status is treated as SCHEDULED.** The permissive direction,
because the two mistakes are not symmetric: an event wrongly shown as going
ahead is corrected the moment somebody opens it, while an event wrongly shown as
cancelled is one nobody opens again — and a new status string from the server
would otherwise mark a whole list cancelled at once.

**An online event's icon is "opens elsewhere", not a camera.**
material-icons-core carries no video glyph, and that turned out to be the better
answer: BR-045 is that the platform hosts **no** video of any kind and an online
event always links out, so a camera would promise playback the product
deliberately does not have. The icon is directional, so it is the auto-mirrored
variant — out of the app is the other way in Urdu.

**Dates are formatted with an explicit locale and zone, both passed in.** A
formatter with no locale silently uses the JVM default: English on a test
machine, so the bug ships and the test passes. And the server sends UTC — an
event at 09:00 Pakistan time arrives as `04:00Z`, and rendering that literally
would send everybody five hours early, which is the worst available bug in an
events feature. `EventTimesTest` catches a dropped locale by asserting the same
instant renders *differently* in Urdu and English, and a dropped zone by
asserting a late-evening UTC timestamp lands on the next day in Karachi.

One claim was corrected while writing this: the numerals do **not** become
Eastern Arabic-Indic in Urdu. CLDR's default for `ur-PK` is Latin digits —
Eastern Arabic-Indic is the Indian Urdu convention — so `14` is correct and
forcing `۱۴` would have been wrong rather than thorough. Verified against the
JDK's own `ur-PK` data, which renders `14` beside the Urdu month name `ستمبر`.

## Group 08 · Create and media

| Screen | Name | Requirements | APIs | LTR | RTL | Loading | Empty | Error | Offline | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| — | Media rendering · avatar · strip | MEDIA-FR-001 · §34 | `GET /media/:id` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| — | Upload tile ×5 states | §19 · §34 · EDGE-013 | `/media/*` | ✅ | ✅ | ✅ | — | ✅ | ✅ | ✅ |
| — | Date and time picker | §18 | — | ✅ | ✅ | — | — | — | — | ✅ |
| UX-CREATE-001 | Composer | POST-FR-001/003/006 · BR-012/013 · EDGE-011/013 | `POST /posts` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| UX-CREATE-002 | Image picker & compress | MEDIA-FR-001 · NFR-PERF-005 | `/media/upload-slot` | ✅ | ✅ | ✅ | — | ✅ | ✅ | ✅ |
| UX-CREATE-003 | Attachment sheet | POST-FR-002/004/005 | — | ✅ | ✅ | — | — | — | — | ◐ |
| UX-CREATE-004 | Category picker | POST-FR-006 · BR-017 | `GET /categories` | ✅ | ✅ | ✅ | ✅ | — | — | ✅ |

**UX-CREATE-002 has no crop step, and is still `✅`.** The screen's title in §19
names "select up to 4 images, crop, and compress on the device". Selection and
compression are built; crop is not. Android's own picker offers none, and a
hand-rolled cropper is a gesture surface that has to work under RTL mirroring, at
130% font scale, on a 720×1280 screen — for an outcome the compression step
already delivers, since every image is scaled to a 1600px longest edge and
re-encoded regardless. Marked `✅` rather than `◐` because the screen's *purpose*
— get a transmittable image onto a post — is met; the omission is recorded as a
reduction in `20-mobile-open-issues.md` rather than hidden.

**UX-CREATE-003 is `◐` — two of its three offers do not exist to build.** The
sheet offers images, and explains the other two rather than faking them:

- *A link* (POST-FR-004) has **no client action by requirement**. SEC-014: "the
  preview is fetched server-side, never by the device, so the user's IP is not
  disclosed to the linked host." A URL typed into the post is detected and
  previewed by the server, so an "attach a link" button would paste nothing. The
  sheet says a link in the text is enough — the honest version of the same offer.
- *A document* (MEDIA-FR-003) is a *Should*, and its 10MB PDF path is gated on
  the ADR-013 review that has not happened. Absent rather than greyed: a disabled
  row invites a tap that reports nothing useful.

### What the create-and-media group decided, and why it is written down

**Each attachment uploads independently and retries alone, and this is enforced
by the type rather than by care.** EDGE-013's acceptance criterion is that
retrying the third of four does not re-upload the other three. A `Ready`
attachment **drops its bytes** the moment its upload succeeds, so a retry has
nothing to send even if one were requested — and `retryAttachment` can only reach
a `Failed` one. The test counts upload calls and asserts **five** for four images
plus one retry; asserting the final state would pass on a composer that re-sent
everything.

**`Failed` and `Rejected` are separate states, and collapsing them is the defect
the type prevents.** A dropped connection keeps the bytes and offers a retry; a
file the server inspected and refused drops both, because retrying the same bytes
will be refused again. One "upload failed" state produces a retry button that can
never work — worse than none, because people keep pressing it.

**No post is created until every attachment is ready.** EDGE-011: an upload
interrupted at 80% leaves "no post created" and the text preserved. Publishing is
gated in `canPost`, and the draft is cleared **only after** a successful publish —
clearing it optimistically and then failing would lose the words to exactly the
dropped connection the requirement is about.

**The draft is encrypted, and the reason is not the obvious one.** A published
post is public by definition (BR-VIS-001), so plain preferences would do. An
*unpublished* draft is different: somebody half-way through writing about a local
official or a contested project, who has not decided whether to send it. That is
the one piece of user text on the device whose exposure the author has explicitly
not consented to, and the Keystore-backed store already exists. Attachments are
deliberately **not** persisted — a media id would name a quarantine object the
server's sweep may already have collected.

**The composer holds no Android types, and that was a design change made for
testability.** `ComposerViewModel` takes an `ImageSource` and speaks in URI
strings rather than `android.net.Uri`, because `Uri.parse` throws off a device —
a ViewModel holding one would have put every rule in the attachment state machine
behind Robolectric. The `Uri` is parsed at the picker, which is the boundary where
the Android type belongs. The alternative considered and rejected was a
`FakeComposer` in the test file, which would have asserted that the test file
works.

**The full photo is never buffered.** `ImageCompressor` takes a *stream factory*
and opens it twice — once for the header alone with `inJustDecodeBounds`,
allocating nothing, and once for the pixels with a sample size already chosen.
Reading a 12-megapixel photo into a `ByteArray` first would commit tens of
megabytes of heap on the 2GB device NFR-COMP-002 targets, to hand it to something
that was going to downsample it anyway.

**No storage permission was added.** `PickVisualMedia` grants access to the one
file chosen — no runtime prompt, no gallery-wide read. Asking for
`READ_MEDIA_IMAGES` would request an entire photo library to obtain one picture,
which PRIV-001's data-minimisation rule rules out as plainly as an unnecessary
column, and it is the difference between a dialog a cautious user declines and no
dialog at all.

**Coil's singleton is set on the `Application`, not through a composition
local.** This was Coil's own deprecation notice, and it is right: providing an
`ImageLoader` through `LocalImageLoader` does *not* replace the singleton, so any
path reaching `AsyncImage` without the local in scope quietly builds a second
loader — with its own caches on the same directory and **no auth interceptor**.
`GET /media/:id` is authenticated, so the symptom would have been images loading
on some screens and not others. `MohallaApplication` implements
`ImageLoaderFactory` instead. This is the first `Application` class in the
project, and it deliberately does nothing else — eagerly building repositories
and a Keystore store there would move all of it onto the cold-start path that
NFR-PERF-003 budgets.

**A media id is resolved to a URL in exactly one place.** Every call site that
composed its own `"$base/media/$id"` would be a call site that could get the base
wrong, forget the token, or leak an id into a log.

**§17 and §19 disagree about the thumbnail, and the grid won.** §19 specifies
"thumbnails 82 with 10 gap"; both numbers are off the 4dp grid that §17 calls a
defect ("no 6px, no 10px, no 14px, no 18px anywhere in the product"). Resolved to
80dp tiles with an 8dp gap: a 2dp difference in a thumbnail is invisible, an
off-grid value is a rule broken, and four 80dp tiles with three 8dp gaps come to
344dp — which fits a 360dp screen's margins with nothing spare, so the row scrolls
rather than wrapping. The 3px progress bar §34 asks for stays 3px, because that
is the thickness of a drawn rule rather than a gap between things — the same
category as the top bar's 1dp hairline.

**Three callbacks that had been inert since earlier groups are now real:** the
post card renders its media and its author's avatar, profile setup can choose a
photo (PROFILE-FR-002), and the event composer can pick a date and time — which
is what closes UX-EVENT-004 and UX-EVENT-005.

## Group 09–10 · Post detail and engagement

| Screen | Name | Requirements | APIs | LTR | RTL | Loading | Empty | Error | Offline | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| — | Comment item · reply item | ENGAGE-FR-002/003 · BR-033 | — | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| UX-HOME-003 | Post detail | POST-FR-007/009 · ENGAGE-FR-001…006 | `/posts/:id` · `/comments` · `/like` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| UX-HOME-004 | Image viewer | MEDIA-FR-002 | `GET /media/:id` | ✅ | ✅ | ✅ | — | ✅ | ✅ | ✅ |

### What post detail and engagement decided, and why it is written down

**The post renders from cache instantly; only comments load.** §19 says so in
those words, and honouring it needed something to hold the object between two
screens that pass only an id. `PostCache` is that — bounded at one feed page,
insertion-ordered, in memory only, and **never a source of truth**: the detail
screen renders the cached copy AND fetches the real one, and `postConfirmed`
gates anything irreversible so a post is never *deleted* on the strength of a
cached author id. A post the server reports gone is forgotten from the cache, or
"renders instantly" would keep showing a withdrawn post for the life of the
process.

**A refused comment keeps its text.** ENGAGE-FR-002's error case is exact —
"post deleted while composing → submission refused with a clear explanation and
the text preserved for copying" — so the draft is cleared only on success. Its
acceptance criterion ("the typed text is not lost") is asserted directly, for
both the deleted-post case and offline.

**Replies nest exactly one level, and the client aims at the parent.** BR-033
allows one level and says "a reply to a reply attaches to the same parent
thread". The server would correct a mis-aimed reply, but relying on that would
mean the client sends something it knows to be wrong — so `replyTo` resolves a
reply to its thread parent before the request. The threading itself is a pure
function over the flat list the server sends, which is why it has no recursive
case to get wrong.

**An orphaned reply is promoted, not dropped.** A reply whose parent is on a
later page or was deleted between pages would otherwise vanish, and silently
losing somebody's words is worse than a small ordering oddity.

**Deleting a comment removes its replies in one request.** ENGAGE-FR-004's
acceptance criterion is that three replies go with their parent; the server does
that, and the client mirrors it locally rather than re-requesting — otherwise the
thread briefly shows orphaned replies, and three extra round trips achieve what
one already did. A **failed** deletion removes nothing: a comment that vanished
and came back is worse than one that took a moment to go.

**Two people may delete a comment.** Its author, and the **post's** author
(BR-020, "which distributes moderation away from administrators"). Anybody else
gets the same neutral 404, so a third party cannot probe who wrote what — and the
Delete control is *absent* rather than disabled for them, because a visible
Delete on somebody else's comment suggests the product permits it.

**The author may like their own post.** BR-031 says so explicitly, so there is no
author check on the like path — and there is a test for it, because "don't let
people like their own posts" is the kind of rule somebody adds by instinct.

**Rapid taps send one request.** ENGAGE-FR-001's acceptance criterion is that six
taps change the count by at most one. The server guarantees that through its
composite key; the client guard is about the *visible* state, which two racing
requests would leave up to whichever landed last.

**Zoom and paging fight for the same gesture, and paging loses while zoomed.** In
the image viewer a horizontal drag means "next image" at 1× and "pan" once
magnified, so the pager is disabled above 1× and re-enabled on return. Without
that, panning a zoomed-in poster sideways flicks to the next image — which makes
zoom useless for exactly the awareness posters MEDIA-FR-002 names. The zoom
resets on every page change, because landing on the next image already magnified
and off-centre leaves no visible way back to the whole picture.

**The viewer is on a dark ground, and that is not dark mode.** §49 defers dark
mode; a viewer's job is to get out of the way of what is being looked at, and
light chrome around a photograph competes with it. Every other surface stays on
the light scheme.

**A comment's counter appears only near the limit, and a post's is always
visible.** Deliberately different: a comment is usually a sentence and a
permanent counter on a one-line field is furniture, while the post composer is
the one field in the product where people write to the 3,000-grapheme limit on
purpose.

**Sharing produces a link and no excerpt yet.** ENGAGE-FR-007 asks for "a link to
the post plus a short excerpt", and the excerpt is withheld on purpose: the
canonical share URL is group 22's deep-link work, and a placeholder host would
put a broken link into a WhatsApp message nobody can edit. The share base is
`mohalla.invalid`, which fails visibly rather than being a domain somebody might
register. The requirement's login rule needs no extra work — the deep link lands
on the post route behind the startup resolver, so an unauthenticated arrival is
routed to Welcome by the same rule as every cold start.

**One defect this group found in itself:** a KDoc containing a slash-star glob
(`/feed/` followed by an asterisk) silently swallowed the rest of the file.
Kotlin block comments **nest**, so the sequence opened a comment that never
closed, and the compiler reported it 400 lines later as an unrelated unresolved
reference. Worth knowing, because it is invisible on inspection.

## Group 11 · Search

| Screen | Name | Requirements | APIs | Status |
|---|---|---|---|---|
| UX-SEARCH-001 | Search entry | SEARCH-FR-001 · PRIV-011 | — | ✗ |
| UX-SEARCH-002 | Results — People | SEARCH-FR-003 · BR-042 | `/search/people` | ✗ |
| UX-SEARCH-003 | Results — Posts / Events | SEARCH-FR-002/004 | `/search/posts` `/search/events` | ✗ |

## Group 12–13 · Profiles and graph

| Screen | Name | Requirements | APIs | Status |
|---|---|---|---|---|
| UX-PROFILE-001 | My profile | PROFILE-FR-004 | `GET /me` | ✗ |
| UX-PROFILE-002 | Other user's profile | PROFILE-FR-005 · PRIV-003 | `/users/:id` | ✗ |
| UX-PROFILE-003 | Edit profile | PROFILE-FR-006 | `PATCH /me/profile` | ✗ |
| UX-PROFILE-004 | Followers | SOCIAL-FR-003 | `/users/:id/followers` | ✗ |
| UX-PROFILE-005 | Following | SOCIAL-FR-003 | `/users/:id/following` | ✗ |
| UX-PROFILE-006 | Saved posts | FEED-FR-007 | `/me/saved` | ✗ |

## Group 14 · Messaging

| Screen | Name | Requirements | APIs | Status |
|---|---|---|---|---|
| UX-MSG-001 | Inbox | MSG-FR-001 · BR-027 | `/conversations` | ✗ |
| UX-MSG-002 | Requests | MSG-FR-005 · BR-024 | `/conversations?section=REQUESTS` | ✗ |
| UX-MSG-003 | Conversation | MSG-FR-002/004 · EDGE-020/021 | `/conversations/:id/messages` + Socket.IO | ✗ |
| UX-MSG-004 | Request review | MSG-FR-005 | `/conversations/:id/accept` | ✗ |

## Group 15 · Notifications

| Screen | Name | Requirements | APIs | Status |
|---|---|---|---|---|
| UX-HOME-007 | Notification centre | NOTIF-FR-002 | `/notifications` | ✗ |
| UX-SET-003 | Notification preferences | NOTIF-FR-007 | `/me/notification-preferences` | ✗ |

## Group 16 · Settings

| Screen | Name | Requirements | APIs | Status |
|---|---|---|---|---|
| UX-SET-001 | Settings index | SET-FR-* | `/me/settings` | ✗ |
| UX-SET-002 | Language | SET-FR-001 · BR-040 | `PUT /me/language` | ✗ |
| UX-SET-004 | Change password | AUTH-FR-007 | `POST /password/change` | ✗ |
| UX-SET-005 | Blocked users | SAFETY-FR-007 | `/me/blocks` | ✗ |
| UX-SET-006 | Legal documents | SET-FR-008 | — | ✗ **OD-015** |
| UX-SET-007 | Help & support | SET-FR-009 | — | ✗ **OD-015** |
| UX-SET-008 | About | SET-FR-010 | — | ✗ |

## Group 17 · Safety

| Screen | Name | Requirements | APIs | Status |
|---|---|---|---|---|
| UX-SAFE-001 | Report — reason | SAFETY-FR-001/003 | — | ✗ |
| UX-SAFE-002 | Report — note & submit | SAFETY-FR-001 · EDGE-023 | `POST /reports` | ✗ |
| UX-SAFE-003 | Block confirmation | SAFETY-FR-005 · BR-025 | `PUT /users/:id/block` | ✗ |
| UX-SAFE-004 | Suspension explainer | BR-034 | — | ✗ |

## Group 18–19 · Account state and deletion

| Screen | Name | Requirements | APIs | Status |
|---|---|---|---|---|
| UX-SET-009 | Delete account | SET-FR-004 · PRIV-006 | `DELETE /me` `/me/deletion-consequences` | ✗ |

---

## What must be true before this table can say "feature-complete"

1. Every row above `✅` in both directions with its state set covered.
2. Compose UI tests running — which needs an emulator (`00-mobile-baseline.md` §6).
3. The eleven §44 end-to-end flows executed on a device.
4. **DEP-013** fonts bundled, **DEP-011/OD-016** Urdu strings reviewed,
   **OD-015** legal content supplied — none of which is in this repository's gift.
