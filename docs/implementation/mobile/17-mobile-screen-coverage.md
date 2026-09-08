# 17 — Mobile Screen Coverage

**Stage 7 · Android** · 61 required screens · last updated after group 20 (Offline and error states)

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
| ✅ Complete in both directions | **55** |
| ◐ Partial | **4** (UX-AUTH-008 · UX-CREATE-003 · UX-EVENT-002 · UX-SET-005) |
| ✗ Not started | **2** (UX-HOME-005 · UX-HOME-006) |
| **Required total** | **61** |

**Coverage: 90% complete.** Stage 7 is **NOT** feature-complete.

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
| UX-STATE-001 | Content unavailable | SEC-019 · BR-025 | — | ✅ | ✅ | — | — | — | — | ✅ | ✅ | ✅ |
| UX-STATE-002 | Offline | NFR-AVAIL-002 | — | ✅ | ✅ | — | — | — | ✅ | ✅ | ✅ | ✅ |
| UX-STATE-003 | Server error | SEC-018 · SRS §16 | — | ✅ | ✅ | — | — | ✅ | — | ✅ | ✅ | ✅ |
| UX-STATE-004 | Rate limited | — | — | ✅ | ✅ | — | — | — | — | ✅ | ✅ | ✅ |

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

| Screen | Name | Requirements | APIs | LTR | RTL | Loading | Empty | Error | Offline | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| — | User row (component) | §18 · SEARCH-FR-001 | — | ✅ | ✅ | — | — | — | — | ✅ |
| — | Home top app bar | §14 · §19 | — | ✅ | ✅ | — | — | — | — | ✅ |
| UX-SEARCH-001 | Search entry · recent searches | SEARCH-FR-005 · PRIV-011 | — | ✅ | ✅ | — | ✅ | — | — | ✅ |
| UX-SEARCH-002 | Results — People | SEARCH-FR-001 | `GET /search/people` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| UX-SEARCH-003 | Results — Posts / Events | SEARCH-FR-002/003/004 | `/search/posts` · `/search/events` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

**Home gained its top app bar in this group**, which §19 had required since
group 05–06 and which had been missed: `homeActions()` existed in
`MohallaTopBar.kt` and nothing called it. §14 places Search and Notifications
there as *actions* rather than tabs — "search is an action performed against feed
content, not a place", and notifications are "an interrupt, not a place… users go
there because something happened, not because they chose to" — so putting either
in the bottom bar would spend one of five slots on a screen visited reactively.
The bell is wired to nothing yet; UX-HOME-007 is group 12.

### What search decided, and why it is written down

**A failed search is never an empty-results state.** SEARCH-FR-003's acceptance
criterion says so outright, and this is the screen people use to ask "did anyone
raise this before?" — so a zero-results page after an outage answers *no* to a
question nobody asked it, and can convince somebody that nobody reported a
problem they in fact reported. `SearchTabState.isEmpty` is therefore false
whenever a failure is present **and** false when no request has come back, and
both conditions are asserted separately because either one alone would let the
defect through. The API is unusually candid for the same reason: 200 with an
empty list means "we looked and there is nothing", 503 means "we could not look",
and 400 with the minimum means "the query was too short to run".

**Three states, not two: never asked, asked and empty, failed.** A tab the reader
has not opened must not claim to be empty either — otherwise switching to Posts
would flash "no posts found" before the request had left.

**The empty state's advice is only sound because it is unreachable after a
failure.** §21 asks it to suggest alternative spellings, which is genuinely the
next thing to do on a platform where the same word is written in two scripts —
and exactly the wrong advice when the search never ran.

**The client sends what was typed and never transliterates.** SEARCH-FR-003 puts
normalisation on the server, against an index holding both the original text and
its transliterated form. A client-side romanisation would disagree with the index
it is querying, so "pani" would match different things depending on which side
did the folding. Asserted with an Urdu-script query reaching the source
unchanged.

**Offset pagination, and that is correct here.** Every other list in the product
pages by cursor, because a cursor names a position in a stable ordering. Search
results are ranked by relevance then recency, and relevance is not a column —
there is no `(score, id)` pair a later page could resume from, and page one's
ranking can legitimately change between requests. An offset is honest about being
approximate where a cursor would imply a stability the ordering does not have.
Results are de-duplicated on append for the same reason.

**Each tab is searched only when it is opened, and never twice for one query.**
Three simultaneous requests would triple the cost of one search on the 3G
connection NFR-PERF-001 budgets for, to fetch two sets of results the reader has
not asked to see. Changing the query clears all three and re-runs only the one on
screen.

**Typing sends one request, not one per keystroke.** 350ms — long enough that
"pani" is one query rather than four, short enough that somebody who has stopped
typing does not notice. Slightly shorter than the username check's 400ms because
a search is a read the reader is actively waiting on. A submit bypasses it.

**A query below the minimum is not sent at all.** The server would refuse it with
the minimum stated; spending a round trip to be told that is a round trip wasted.
Backspacing to one character returns the screen to the recent searches, which is
where a one-character query belongs.

**The recent-search history is encrypted, and the screen says it never leaves the
phone.** PRIV-011 is absolute — "never transmitted to or retained on the server"
— so there is no endpoint, no sync, and no request field that carries one. It is
Keystore-backed for the same reason the composer's draft is: a search history is a
list of what somebody is worried about and who they are checking on, and on a
civic platform a server that held it could be compelled to produce it. Entries are
newline-separated so that "water, drains" stays one query rather than becoming
two rows, de-duplicated case-insensitively with the newest casing winning, and
removable one at a time — somebody who looked up a name they would rather not
leave on the screen of a shared phone should not have to clear everything. Signing
out takes the history with it, because a shared phone is a common arrangement in
this market.

**The history records submissions, never keystrokes.** A history of every prefix
would fill with "p", "pa", "pan" — and would record a query somebody typed and
then thought better of.

**A search result offers no engagement controls.** Tapping a post card in results
opens the post rather than liking it: liking from a list of hits would need the
optimistic-and-revert machinery of a feed for an action nobody performs there.
Event results carry no RSVP row either, because SEARCH-FR-004 ranks past events
*down* rather than excluding them ("the upcoming list is a schedule, but search is
a memory"), so half the rows cannot be responded to — and a control that works on
some rows and not others is worse than one that lives on the detail screen.

**One test was wrong and the code was right.** An early assertion claimed that
re-submitting a query leaves the Posts tab unsearched; in fact `submit` searches
the tab **in view**, which is correct — the other two are cleared and fetched when
opened. The test was corrected to assert that behaviour rather than the code
being changed to match a mistaken expectation.

## Group 12 · Messaging

| Screen | Name | Requirements | APIs | LTR | RTL | Loading | Empty | Error | Offline | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| — | Message bubble (component) | §18 · MSG-FR-002/008 | — | ✅ | ✅ | ✅ | — | ✅ | — | ✅ |
| UX-MSG-001 | Inbox | MSG-FR-003 · BR-024 | `GET /conversations` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| UX-MSG-002 | Requests | MSG-FR-005 · BR-027 | `/conversations?section=REQUESTS` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| UX-MSG-003 | Conversation | MSG-FR-002/004/006/008/009 · EDGE-020/021/022 | `/conversations/:id/messages` · `/messages/since` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| UX-MSG-004 | Request review | MSG-FR-005 · BR-028 | `/conversations/:id/accept` · `/decline` | ✅ | ✅ | — | — | ✅ | ✅ | ✅ |

UX-MSG-004 is a decision offered inside the conversation and the request row
rather than a screen of its own: replying **is** accepting, so a reader who must
first visit a separate screen to accept has already been asked to read the
message before deciding whether to receive it.

### What messaging decided, and why it is written down

**Delivery is by polling, not by a socket, and that is a recorded choice.**
MSG-FR-004 asks for delivery "within 3 seconds without manual refresh". The API
is explicit that "REST is the source of truth; realtime is an accelerator… every
route has to work with the socket switched off", and names
`GET /conversations/:id/messages/since` as the polling fallback ADR-009
sanctions; the SRS's own risk note says "polling is an acceptable fallback at
this scale". So the conversation polls that route every **two** seconds — inside
the requirement, with headroom for the request itself on 3G. A socket would add
a dependency, an auth handshake, a reconnection and backoff policy and a
lifecycle to get wrong, for a latency improvement below the threshold the
requirement sets. It is listed as **GAP-M-008** rather than presented as
finished.

**The poll is bounded to the open, foregrounded conversation.** Tied to
`ON_RESUME`/`ON_PAUSE` through a `DisposableEffect`, because composition survives
the app going to the background and a poll that kept running there would spend
data on a screen nobody is looking at. NFR-PERF-001 budgets for Pakistani mobile
data; one small request every two seconds is not free, and a phone in a pocket
now makes none.

**The client message id is the identity of a message, and the server id is a
field that arrives later.** A message the reader has just sent exists on the
device before the server knows about it and needs a stable identity from that
instant — for a list key, for a retry to find it, and for the server's eventual
copy to be recognised as the *same* message. That inversion is what makes
MSG-FR-002's criterion hold: minted once at compose time and reused on every
attempt, so "a message that fails and is retried twice… exactly one message is
delivered". The test asserts the ids **sent**, not the list rendered — asserting
the list would pass on a client that sent three distinct messages and displayed
only the last.

**A failed message is marked, never removed.** Somebody who typed three
sentences on a bus must not lose them to a tunnel, and the retry carries the body
so they do not retype it.

**Ownership is decided by the sender, and that was a defect first.** `isMine`
was derived from the presence of a client id, which answers "did *this install*
compose it" — a different question. The server echoes a client id to **both**
participants, and a message the reader sent from another device carries none at
all, so the derived answer was wrong in both directions: the reader's own message
rendered on the wrong side of the screen, and a received message carrying a
`readAt` rendered as theirs with a read receipt against it. It is now one
comparison of sender to viewer, stored on the message, and a `readAt` arriving on
a message the reader *received* is dropped rather than displayed — this device
has no business reporting on the reader to the reader.

**Requests are a separate query, never one list filtered.** BR-027 and
MSG-FR-003 make them a separate section with its own count; filtering locally
would show a request in the main inbox for as long as a page took to load, which
on a slow connection is exactly long enough for the thing the requirement exists
to prevent. The SRS calls this "the platform's principal defence against
unsolicited contact" and notes it "matters most for women users".

**The request count never reaches the bottom bar.** §14: requests "are counted
separately inside the screen and never contribute to this badge — a stranger must
not be able to make the user's navigation demand attention." Two counts, two
fields, and the shell reads only the first.

**Declining tells the sender nothing, and there is nothing in the decline path
that could.** BR-028: "informing them invites retaliation." One 204 and no
confirmation dialog — a dialog would imply a consequence that does not exist. The
thread is suppressed rather than deleted, so later messages from that sender land
in it instead of raising a new request, and stay available if the reader reports
or changes their mind.

**A block is refused with the same neutral 404 as everything else, and the client
does not try to tell them apart.** MSG-FR-006 requires a send after a block to be
"refused without disclosing the block"; the only reliable way not to disclose it
is for the refusal to be indistinguishable. EDGE-022's read-only conversation is
the one refusal that *does* explain itself, because it is about the conversation
rather than the other person's account — the compose box closes and the thread is
marked, where a neutral refusal would make a thread the reader can still scroll
look like one that vanished.

**Message images are fetched from `conversations/media/{id}` and never
`media/{id}`.** MSG-FR-008: the general media route refuses `RESTRICTED` objects
outright, so a message image would 404 on the person it was sent to.

**Three pagination shapes appear in this one module** — the inbox pages by a
`before` **timestamp**, the history by a `(createdAt, id)` **keyset**, and the
reconcile takes a **timestamp** and returns oldest-first. Using the wrong one
pages away from the data rather than through it.

**A wire-shape defect the compiler could not see.** `MessagesResponse.nextCursor`
was typed as the events list's cursor. Three keyset routes spell the same idea
three different ways: the feed and comment thread return `{createdAt, id}`, the
events list `{cursorStartsAt, cursorId}`, and message history
`{cursorCreatedAt, cursorId}`. The borrowed type has no default for its field, so
the first read *past* the newest thirty messages of a thread would have thrown
`MissingFieldException` — on long conversations only, which is precisely where
the reader needs it. It now has its own type, and a shape test says why.

**PRIV-003 is enforced by the shape of the types, not by a screen.** "Mobile
numbers, email addresses and dates of birth are never visible to another user, in
any surface, at any time. This is the platform's single most important privacy
improvement over the WhatsApp-group status quo it replaces." Two neighbours
organise about a blocked drain without either handing over a number — so
`ConversationResponse`, `ConversationPreview`, `MessageResponse` and
`UnreadCountsResponse` are asserted against their **complete** allowed field
sets, and a field added under any name fails with the requirement quoted.

## Group 13 · Notifications

| Screen | Name | Requirements | APIs | LTR | RTL | Loading | Empty | Error | Offline | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| — | Notification row (component) | §18 · NOTIF-FR-002/003 | — | ✅ | ✅ | ✅ | — | — | — | ✅ |
| UX-HOME-007 | Notification centre | NOTIF-FR-002/003/004/005 | `/notifications` · `/notifications/read` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| UX-SET-003 | Notification preferences | NOTIF-FR-007 · SET-FR-007 | `/notifications/preferences` | ✅ | ✅ | ✅ | — | ✅ | ✅ | ✅ |

**The Home bell is no longer inert**, and neither is the Messages tab's badge.
Both were declared in group 05–06 and group 12 respectively and neither was fed
by anything — `ShellUiState.unreadConversations` and `unreadNotifications`
existed and were permanently `0`. The shell now reads both counts, and re-reads
them on `ON_RESUME` along with the account capability, which `ShellViewModel`'s
own comment had claimed happened since group 05–06 and which nothing had ever
called. A suspension applied by a moderator while the app was open would not have
taken effect until the process restarted.

### What notifications decided, and why it is written down

**The centre always has everything, and that is enforced by the shape of the
response rather than by a code path.** NOTIF-FR-001's acceptance criterion is
that a user who *denied* the push permission still finds the notification here;
NOTIF-FR-007's is that disabling a category stops the push and leaves the entry.
They are the same claim from opposite ends — a preference and a permission cost
the *buzz*, never the *record* — so `NotificationResponse` carries no `pushed`
flag and no `deliveredAt`, and the test asserts its complete field set with both
requirements quoted. A field saying whether a push happened would invite a client
to draw the distinction both requirements exist to erase.

**Not one notification sentence exists in `strings.xml`.** The server renders
each one at *read* time in the language the request names, which is what makes
LOCALE-FR-002 — "the entire interface updates without reinstall" — true on this
screen: a centre of pre-rendered Urdu would still be Urdu after somebody switched
to English. So the locale rides every request rather than being read from the
stored preference, because the client is the only party that knows what it is
displaying *now* and the server's copy can be a sync behind. What the client owns
is the chrome: the day headings, the relative times, and the empty state.

**Relative times go through plural tables, and the formatter returns a number.**
Urdu and English do not share pluralisation rules, so `"$n hours ago"` is wrong
in both — "1 hours ago" is the visible English failure and the Urdu one is
subtler, heard as wrong by a native reader who cannot point at the word.
`RelativeTime` returns a sealed `Ago` carrying a unit and a count, and
`plurals.xml` turns it into words. This also closes the shape of a defect
`PostCard` still has: its `relativeTime` renders the ISO date's day part with a
`TODO` waiting for exactly this formatter.

**Day grouping is by calendar date in the reader's zone, and the boundary is the
only interesting thing about it.** A notification stamped 23:58 and read at 00:02
belongs under *Yesterday*, not "4 minutes ago and Today" — that is how a person
reads their own day. Grouping by UTC would put an evening notification in Karachi
under *Today* for five hours after midnight had passed for the reader. Both are
asserted; the clock is injected rather than read, because a function that reads
`System.currentTimeMillis()` cannot be tested at a boundary.

**When a notification becomes read was settled by what the wireframe does not
contain.** Every row carries an unread dot and the screen's secondary action is
"None" — no *Mark all read* control. That rules out both obvious
implementations: marking everything on open would blank every dot before the
reader had looked at one, making the dot decoration; marking only on tap would
leave the badge lit for somebody who read the list and opened nothing, making the
badge a nag. So the dots survive the visit and *leaving* marks what was actually
shown — never `read-all`, which would also clear notifications further down a
list the reader never scrolled to. Somebody who opens the centre, sees three new
things and leaves has read three things, not ninety.

**A row with nowhere to go is not clickable.** `onClick` is nullable, and a null
one leaves the row with no ripple and no button role. Three cases reach it today
— a reply (GAP-M-009), an announcement (UX-HOME-006 is not built) and an
unrecognised target — and in each the row is still information worth rendering.
Inviting a tap that does nothing is worse than a row that plainly does not offer
one.

**The destination is derived from the target, never from the category.** A like
and a batched like both point at a post; an event notification points at an event
whether it was an RSVP, a change, a cancellation or a reminder. Branching on the
category would be four cases doing the same thing and a fifth that would be
missed. It is returned as a sealed type rather than a route string, so the
navigation graph's `when` is exhaustive and the feature does not import the
graph.

**An unrecognised category is still a row.** The text is rendered server-side, so
a category this client has never heard of still displays a correct sentence — it
gets the neutral mark instead of a specific one. Refusing to render it would hide
a notification the reader was meant to see, which is the one outcome NOTIF-FR-001
and NOTIF-FR-007 both exist to prevent.

**Message requests are absent because the server never creates one.** BR-027 and
NOTIF-FR-004: "no notification is ever sent for a Message Request." There is no
client-side filter, which is the right place for it not to be — a filter here
would silently stop working the day the category was renamed.

**The preferences screen states what a switch does, in a sentence, above the
switches.** NOTIF-FR-007's rule is that preferences "apply to push only; the
in-app centre always records everything, so disabling push never loses
information" — and a reader cannot deduce that from a switch labelled *Likes*.
Without the sentence, somebody who turns everything off to stop the buzzing
either believes they have stopped being notified at all, or opens the centre
later and thinks it is broken.

**A failed read of the preferences shows no switches at all.** Seven switches in
their default position after a failed request state something about the account
that was never learned, and the reader acts on it. A toggle is optimistic and
moves *back* if the server refused, with the refusal stated in place rather than
in a toast — this is a setting nobody checks twice.

**The actor's photo is fetched per distinct actor and never blocks the list.**
The sentence already names the actor, so a row whose avatar has not arrived is
fully readable. There is no batch profile route, so a page of twenty
notifications from twelve people costs twelve requests — which is why they are
fetched *after* the list renders and why a failure is silent per person.

## Group 14–15 · Profiles and the social graph

| Screen | Name | Requirements | APIs | LTR | RTL | Loading | Empty | Error | Offline | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| — | Verified badge (component) | PROFILE-FR-007 · ADMIN-FR-010 | — | ✅ | ✅ | — | — | — | — | ✅ |
| UX-PROFILE-001 | My profile | PROFILE-FR-004/008/009 · BR-032 | `GET /me` · `/users/:id/posts` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| UX-PROFILE-002 | Other user's profile | PROFILE-FR-005/007 · SOCIAL-FR-001 · BR-025 | `/users/:id` · `/users/:id/follow` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| UX-PROFILE-003 | Edit profile | PROFILE-FR-003/010 · BR-005 | `PATCH /me/profile` | ✅ | ✅ | ✅ | — | ✅ | ✅ | ✅ |
| UX-PROFILE-004 | Followers | SOCIAL-FR-003 | `/users/:id/followers` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| UX-PROFILE-005 | Following | SOCIAL-FR-004 | `/users/:id/following` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| UX-PROFILE-006 | Saved posts | FEED-FR-007 | `/me/saved` · `/posts/:id/save` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

**The Profile tab is no longer a placeholder**, and neither is the Message
button that group 12 built a route for and nothing called: `conversationWith`
exists to resolve BR-024's one-conversation-per-pair, and UX-PROFILE-002 is the
screen it was written for.

### The defect this group found, which was not in this group

**The client could not send a JSON `null`, and two features were silently broken
by it.** `MohallaJson` sets `explicitNulls = false` — right for *reading*, since
a server that stops sending an optional field must not crash a screen — and it
also **omits** a null property when *writing*. The API's rule for both PATCH
routes is the exact opposite: *"send `null` to clear an optional field; omit it
to leave it alone."*

So `UpdateProfileRequest(bio = null)` serialised to `{}`. Nobody could clear a
bio, a city or a profile photo: the request said "leave it alone" every time.

**And on `PATCH /events/{id}` it broke a whole flow that shipped in group 07.**
The backend's own comment predicts it exactly: *"a caller switching a PHYSICAL
event to ONLINE — who must send a link AND null the location — would have the
old location merged back in and be told they supplied both. The type change
would be impossible, and the error message would blame a field they had just
cleared."* That is what the app did. Changing an event's type was impossible,
and the refusal named the field the creator had just emptied.

The fix is `PatchBody.kt`: PATCH bodies are built as JSON rather than as data
classes, because JSON already has three states and a Kotlin nullable field has
two. `EventChanges` and `ProfileChanges` carry a `Patch` — *unchanged*, *clear*,
*set* — so the distinction survives the trip from a ViewModel to the wire. The
test asserts the ENCODED STRING, and demonstrates the old behaviour alongside
it, so anyone tempted to replace the JsonObject with a tidier data class fails
with the encoded body in the message.

### What profiles decided, and why it is written down

**Nothing in the API says whether the viewer already follows somebody.** A post
carries `viewerHasLiked`; no response anywhere carries `viewerFollows`, and the
server has `isFollowing` internally and exposes it on no route. So the Follow
control's resting state on a cold open is a guess (**GAP-M-011**). It is
resolved as a TRI-STATE rather than a boolean — `Unknown` is a real answer and
the honest one — and `Unknown` offers **Follow**, because a repeat follow is
idempotent and moves no count, where a wrongly-shown "Following" would stop
somebody following at all. `ViewerRelations` remembers what the session has
observed, so following from a profile still reads as Following when the same
person is opened from search two taps later.

**The one place the API does answer it is the viewer's own Following list**,
twenty people at a time, incidentally — so opening it records the whole page.
Somebody *else's* following list and *anyone's* follower list prove nothing
about the viewer, and recording either would put a confident wrong answer where
an honest `Unknown` was.

**One ViewModel serves both profile screens**, because UX-PROFILE-001 and
UX-PROFILE-002 are one screen with a different action row: identity, three stat
pills and a post list are identical, and what differs is Edit and Saved versus
Follow and Message. The route composable is keyed by user id — without a key,
opening one profile from another reuses the first one's ViewModel, since
`viewModel()` scopes to the destination and both are the same route pattern.

**The header and the post list are two requests and two independent states.**
The wireframe says so by hand: "No posts → 'No posts yet'. Statistics still
render." A post list that failed must not take the identity down with it, and an
empty one is a different thing from one that could not be read.

**BR-032's under-review posts are not filtered out.** "GIVEN a post of mine is
auto-hidden, WHEN I view my own profile, THEN I see it labelled under review,
and no other user sees it at all." Both halves are the server's — it returns
those rows only to their author, marked — and the client's job is not to drop
them.

**The follower count moves optimistically and reverts.** PROFILE-FR-009 says
counts "update on follow or unfollow", and this is the one screen where the
number *is* the feedback.

**Likes work on every post list, not just the feed.** A heart that does nothing
outside Home is the kind of inert control a reader taps three times before
deciding the app is broken — so the profile and the saved list carry the same
optimistic-and-reverting toggle.

**The verified badge became one component.** PROFILE-FR-007 is a requirement
about consistency across surfaces — profile, every post and comment, search
results, the message inbox — and it was three copies of six lines drifting
independently.

**The handle is now actually forced left-to-right.** `UserRow` carried a comment
saying it was, and the code did nothing: the `@` is a NEUTRAL character, so the
bidi algorithm gives it the paragraph's direction and an unmarked
"@sana_bashir" renders in an Urdu line as "sana_bashir@" — a correct handle that
looks mistyped to the one person who knows it is not. `ltr()` wraps the run in a
directional isolate, which is the only thing that fixes it; neither alignment
nor layout direction touches it.

**Saving a post has a home, because the UX spec gives it none.** FEED-FR-007
says "user saves a post" and no surface in the design offers the action — the
card carries like, comment and share, and the overflow carries report and block.
A Saved screen nothing can fill would be a feature in name only, so the control
is a star in the post detail's top bar. Its resting state is a guess for the
same reason the Follow control's is: there is no `viewerHasSaved` (**GAP-M-012**).

**The band's tint is the brand's, not the account's.** The wireframe wants it
"from the account's most-used category"; no response carries a most-used
category, and deriving one from the first page of posts would change the band's
colour a second after the screen opened.

**Two inert safety controls were removed rather than left in place.** The
conversation header and the post detail both carried a Report button wired to
nothing, pending UX-SAFE-001 in group 17. An inert control is a small lie on
most screens and a dangerous one here: somebody being harassed who taps Report
and sees nothing happen may reasonably believe they have reported it and stop.
Both come back when the sheet is behind them.

## Group 16 · Settings

| Screen | Name | Requirements | APIs | LTR | RTL | Loading | Empty | Error | Offline | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| UX-SET-001 | Settings index | SET-FR-001…010 | `GET /me/settings` | ✅ | ✅ | ✅ | — | ✅ | ✅ | ✅ |
| UX-SET-002 | Language | SET-FR-001 · LOCALE-FR-002 | `PUT /me/language` | ✅ | ✅ | — | — | ✅ | ✅ | ✅ |
| UX-SET-004 | Change password | SET-FR-002 · SEC-005 | `POST /password/change` | ✅ | ✅ | ✅ | — | ✅ | ✅ | ✅ |
| UX-SET-005 | Blocked accounts | SET-FR-003 · SAFETY-FR-006/007 | `/me/blocks` · `DELETE /users/:id/block` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ◐ **GAP-M-013** |
| UX-SET-006 | Legal documents | SET-FR-008 | — | ✅ | ✅ | — | — | — | — | ✅ **OD-015** |
| UX-SET-007 | Help & support | SET-FR-009 | — | ✅ | ✅ | — | — | — | — | ✅ **OD-015** |
| UX-SET-008 | About | SET-FR-010 | — | ✅ | ✅ | — | — | — | — | ✅ |

UX-SET-005 is `◐` because the rows carry no names — see below. UX-SET-006 and
UX-SET-007 are `✅` because the screens are complete and correct: what they show
is that the documents and the support address do not exist, which is true.

**Three things stopped being unreachable in this group.** The language switch had
existed only at first launch; `MohallaNavHost` took an `onRequestLanguageChange`
that was wired to `{}`; and the notification preferences built in group 13 had no
in-app path to them at all. All three now hang off the Settings row on My
profile, which is where §14's navigation tree puts them.

### What settings decided, and why it is written down

**The index renders without its request.** Every row is a destination that exists
whether or not `GET /me/settings` came back; what the request adds is two
SUBTITLES — which language the account has stored, and how many accounts are
blocked. A settings screen replaced by an error page strands the person who came
to use it, and people come here when something is already wrong. A failed request
therefore greys out two subtitles and leaves eight working rows.

**Signing out clears this device whatever the server says.** SET-FR-006's
criterion is about what this device shows afterwards — "the welcome screen is
shown and no cached personal content is visible" — and the local clear is what
satisfies it. The revocation call is still made, and made FIRST because it needs
the token, but its answer does not gate the clear: a sign-out that failed because
a train went into a tunnel, on a shared phone, is the worst possible moment to
leave somebody signed in.

**The language is written to the device synchronously and to the account
afterwards, and a failed request does not undo the switch.** The device's copy is
what decides the layout direction of the very first frame of the next cold start,
before any request could have answered — and the caller recreates the activity
the moment the choice returns, so an asynchronous write would lose that race and
compose the whole app in the old direction. The ACCOUNT's copy is what makes
SET-FR-001's criterion true — "GIVEN Urdu is selected on one device, WHEN the
user logs in on another device, THEN Urdu is applied there too" — and when that
request fails, LOCALE-FR-002's promise has already been kept: the interface
changed. Reverting would flip the whole app back under somebody who is reading
it. Choosing again is the retry.

**Each language names itself, in itself.** "English" and "اردو", whichever
language the interface is currently in, so somebody who cannot read the current
one can still find theirs. That is the first-launch screen's reasoning applied
to the same decision made later.

**Change password is not a preferences screen.** It is what somebody reaches for
when they think another person is inside their account: "GIVEN a password change
on device A, WHEN device B makes its next request, THEN device B is signed out."
The screen says that above the fields, because leaving it unsaid means the change
either surprises the person who only wanted a new password or is missed by the
person who needed it. The confirmation field is not ceremony either — a typo here
locks the owner out with every other session already dead. And the new password
must differ from the current one, checked on the device as well as the server:
re-entering the same one would still kill the other sessions and still look like
it worked, leaving somebody believing they had removed an intruder who knows the
password they just re-entered.

**Blocked accounts cannot be named, and the screen says so.** `GET /me/blocks`
returns an id and a date per row, and `GET /users/{id}` answers the neutral 404
for anybody blocked in either direction — which is every row on this list. There
is no request the client can make that would name these people. **GAP-M-013.**
The rows show WHEN each block was made, newest first, with a line explaining the
absence: a list of identical unlabelled rows with no explanation reads as a bug,
and the same list with the explanation reads as a limitation.

**The one thing deliberately not done there** is unblocking to read a name and
re-blocking. It would work, and it would mean the app silently unblocking people
to render a list — a blocked person becoming able to message somebody for the
length of a network round trip is not a trade this screen gets to make on the
user's behalf. No user id is rendered either: a raw UUID identifies nobody a
reader could recognise, and on a shared phone it puts a stranger's account
identifier on display for no benefit.

**A pagination trap in `/me/blocks`, handled at the repository.** The server sets
`nextBefore` to the last row's timestamp whenever the page has rows — so it is
non-null on the FINAL page too, and a client that paged until it went null would
re-fetch that page forever. The end is derived from a page shorter than the limit
instead.

**The legal screens show nothing rather than something official-looking.** OD-015
leaves the Terms, the Privacy Policy and the Community Guidelines unwritten;
PRIV-017 makes a publicly reachable Privacy Policy a Google Play submission
requirement, so this is a release blocker rather than an app gap. There is no
placeholder text and no link to an unpublished URL — these documents are the
stated basis for every enforcement action on the platform (PRIV-018), and a user
who read an invented version would have been told the rules wrongly.

**And no support address has been published either.** `SUPPORT_EMAIL` is a build
field, empty in both build types exactly as `TERMS_VERSION` is, and the Help
screen states that rather than opening a mail composer addressed to somewhere
invented. This is also the appeals channel for a suspension (OD-020) — the one
place where sending into a void has a real cost. When an address exists the
screen offers `ACTION_SENDTO` with a `mailto:` URI, which reaches mail clients
only: `ACTION_SEND` would also offer every messaging app on the device, and
somebody appealing a suspension does not need that going to WhatsApp.

**Delete account is absent, not inert.** UX-SET-009 is group 18–19, and an
account-deletion row that does nothing is the worst possible control to leave
wired to `{}`.

## Group 17 · Safety

| Screen | Name | Requirements | APIs | LTR | RTL | Loading | Empty | Error | Offline | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| UX-SAFE-001 | Report — reason | SAFETY-FR-001/002/003 | — | ✅ | ✅ | — | — | ✅ | ✅ | ✅ |
| UX-SAFE-002 | Report — note & submit | SAFETY-FR-001 · EDGE-023 | `POST /reports` | ✅ | ✅ | ✅ | — | ✅ | ✅ | ✅ |
| UX-SAFE-003 | Block confirmation | SAFETY-FR-005 · BR-025 | `PUT /users/:id/block` | ✅ | ✅ | ✅ | — | ✅ | ✅ | ✅ |
| UX-SAFE-004 | Suspension explainer | BR-034 · ADMIN-FR-006 | — | ✅ | ✅ | — | — | — | — | ✅ |

UX-SAFE-004 was built in group 05–06 with the shell that shows it; it is counted
here because this is the group its siblings arrive in.

**Every inert Report control is now real.** Three were removed rather than left
wired to `{}` — the conversation header and the post detail in group 14–15, and
the event detail was the last one left. All three are back with the sheet behind
them, and two more entry points exist that never had one: a comment, and an
account.

### Where reporting and blocking can start

| Surface | Reports | Blocks | Why |
|---|---|---|---|
| Post detail | `POST` | via the sheet | The bar's second slot; Save has the first. Exclusive with Delete. |
| Comment row | `COMMENT` | via the sheet | The only surface a comment has. Exclusive with Delete. |
| Event detail | `EVENT` | — | An event is not a person. No block is offered, because there is nobody behind it. |
| Other profile | `PROFILE` | ⋯ menu | SAFETY-FR-002 — the account, when the pattern rather than one item is the problem. |
| Conversation | `CONVERSATION` | ⋯ menu | MSG-FR-007. Always has a person behind it, so both are real. |

### What safety decided, and why it is written down

**The acknowledgement is identical every time, and the client has no way to make
it otherwise.** A first report, a fourth from the same account and the one that
crossed the auto-hide threshold all return the same empty 202 — so there is one
success branch, one sentence, and nothing in the state it renders from that
could vary. SAFETY-FR-001 requires exactly that: a repeat shows "the
acknowledgement again without incrementing the count, SO THE REPORTER CANNOT
INFER THE CURRENT TALLY".

**Why the tally matters this much.** It is what a coordinated group needs — it
tells them how many more accounts to bring — and RSK-010 rates coordinated
reporting used to silence civic criticism as this platform's characteristic
abuse, on a platform whose entire purpose is civic criticism. The test asserts
the request's complete field set with that reasoning quoted, so a count added
under any name fails.

**Severity is the server's and there is no field for it.** Each of the eight
reasons carries a severity that orders the moderation queue; a reporter who could
set it would make CRITICAL the rational choice every time, and the ordering would
stop carrying information for the one reviewer who depends on it.

**Two taps to send, one tap to change your mind.** Choosing a reason moves to the
note step rather than submitting — a sheet that sent on the first tap would never
show the optional note SAFETY-FR-001 offers — and the reason can be changed
without losing what has already been typed. Both sheets dismiss by tapping
outside: "reporting is never a trap", and that includes having opened the menu by
accident.

**The note is optional, and requiring one would have been the wrong default.**
It would make the fastest path through this sheet — the one somebody uses while
distressed — the one that asks them to write about it. It is counted in graphemes
(BR-012), so an Urdu note gets its full 500 rather than 250.

**A failed report keeps every word.** The reason and the note stay exactly where
they were and the sheet stays open, so a retry is one tap. Somebody who has just
typed three sentences about being harassed must not have to type them again
because a train went into a tunnel.

**What it does NOT do is claim the report was queued.** The wireframe asks for
"Offline → queued, submitted on reconnect, user told", and the app has no durable
queue — so a claim of queueing that an app kill silently discarded would be worse
than the refusal, on the one flow where the user most needs to know whether it
went. **GAP-M-014.**

**The block is offered from the acknowledgement, because "in practice the two go
together".** It is an offer and never a side effect: blocking removes follows in
both directions and SAFETY-FR-006 restores visibility and never the follows, so
it stays a deliberate second tap.

**The block sheet states what changes for BOTH parties, in four lines** — and the
two that decide it are the ones people do not expect. The follows are removed and
unblocking does not bring them back; and the blocked person is never told
(BR-025). Somebody deciding whether to block a neighbour they will see at the
shops tomorrow is deciding on exactly that second question, and leaving it unsaid
would make the safest option look like the most confrontational one.

**The safe choice is the primary button and it sits ABOVE the destructive one.**
§6.7 for a Tier-2 action: a thumb reaching for the bottom of a sheet finds
Cancel, and Block is the outlined control beside it rather than a filled red
button.

**Delete and Report are mutually exclusive on both content surfaces.** §18.5 caps
the top bar at two actions and Save has one of them — but the exclusivity is
right anyway, because SAFETY-FR-001 refuses a report of your own content. An
author has nothing to report and everybody else has nothing to delete.

**A departed author's comment offers neither.** PRIV-007 keeps what remains of a
deleted account carrying no link back, and there is nobody left to action.

## Group 18–19 · Account state and deletion

| Screen | Name | Requirements | APIs | LTR | RTL | Loading | Empty | Error | Offline | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| UX-SET-009 | Delete account | SET-FR-004 · PRIV-006 · BR-008/009 | `/me/deletion-consequences` · `DELETE /me` | ✅ | ✅ | ✅ | — | ✅ | ✅ | ✅ |

**The other account states were already built and are listed where they were
made**: UX-AUTH-012's restore offer in group 03, the suspension banner and the
read-only capability in group 05–06, and UX-SAFE-004's explainer in group 17.
What this group adds to them is the one thing the restore screen was missing.

### The counts in this file had drifted, and are now derived from the table

The progress figures above were being carried forward by hand from group to
group and had fallen out of step with the rows they summarise. Counted from the
table itself, the position before this group was **50 done · 8 partial · 3 not
started**, not the 52 · 3 · 6 previously reported. Two things caused it: the four
`UX-STATE-*` rows were still `◐` in the table although group 08's prose recorded
them as complete, and the running totals were adjusted by the number of screens
each group added rather than recounted.

Both are fixed. The `UX-STATE-*` rows now say what the prose has said since group
08, and these counts are read off the table rather than carried.

### What deletion decided, and why it is written down

**PRIV-006 is a claim about what the user was TOLD, so nothing is confirmable
until the consequences are on screen.** Users "MUST BE TOLD THIS CLEARLY BEFORE
CONFIRMING, because it differs from the erasure many will assume". A screen that
accepted a password while the list was still failing to load would be making that
claim falsely — so the control is disabled rather than the list being treated as
optional detail.

**What differs is BR-009, and it is the surprise this screen exists for.** Posts
and comments STAY, attributed to "Deleted User", because other people replied to
them. The server puts that line **second** in the list — "where it is read,
rather than last where it is skipped" — and the client renders the list in the
order it arrives, never sorted and never filtered. Reordering it would undo a
decision the requirement made about what gets read.

**The consequences are localisation KEYS, not sentences.** That is what makes
"readable in the user's chosen language" true without the server carrying two
copies of six paragraphs, and it means the client cannot quietly reword what
deletion does. The mapping is a `when` over the six keys the contract defines.

**A seventh key would not be silently dropped.** Quietly omitting a consequence
is precisely the failure PRIV-006 exists to prevent, so an untranslatable key
still counts and the screen says the list is incomplete and asks the reader to
update. Deletion is still allowed: refusing it would trap somebody in the product
over an app version, which BR-008's reasoning rules out as firmly as it rules out
trapping a suspended account.

**Cancel is the primary button and sits ABOVE Delete.** §6.7 for a Tier-3 action,
verbatim: "Primary — Cancel, deliberately NOT delete", and "the destructive
control is not pre-focused and sits BELOW cancel". A thumb reaching for the
bottom of a long scrolling screen finds Cancel.

**The password is re-entered, and a wrong one is not a sign-out.** "The phone is
already unlocked and in somebody's hand — a friend, a relative, a partner." The
server returns 400 rather than 401 deliberately, "because a 401 would sign a
confused user out of an account they were trying not to lose", and the client
treats it the same way: the consequences stay on screen and a retry is one field.

**There is no capability check on this screen and there must not be one.**
BR-008 allows deletion in every state except already-deleted, including while
suspended: "an account that cannot leave while it is being punished is a
hostage."

**The restore offer now says by when.** SET-FR-005 gives exactly 30 days, and the
consequences endpoint has carried `scheduledErasureAt` for the restore screen
since Stage 6 — "which is how the restore offer can say how long is left rather
than just that something is pending" — and nothing called it. Somebody who
deleted at 2am and is deciding at breakfast whether to deal with this now or
later needs the date, not a reassurance. A failed read is silent: the offer
stands either way, and a screen that refused to load over a missing date would
strand somebody inside a grace period that is running out.

## Group 20 · Offline and error states

No new screens. UX-STATE-001…004 were built as components in group 01 and are
counted there; this group is about whether the app actually reaches them, and it
turned out that mostly it did not.

### Three defects, all of them a branch nobody looked at

**The session-revocation hook was a comment.** `apiCall` has taken an
`onUnauthenticated` callback since group 01. `ApiFailure.Unauthenticated`'s own
documentation says "revocation is server-driven and takes effect on the NEXT
request, so this is the app's only signal. The shell intercepts it globally,
signs out and clears the cache (SET-FR-006)." **No caller ever passed one**, so
nothing intercepted anything: a revoked session showed a generic error on every
screen, indefinitely, until somebody force-quit the app.

That is not hypothetical. SET-FR-002 exists so that changing a password signs out
every other device — "GIVEN a password change on device A, WHEN device B makes
its next request, THEN device B is signed out" — and device B is this app.
Somebody who changed their password because they believed another person was
inside their account would have watched that person's phone go on showing the
feed.

It is now raised in the **auth interceptor**, which is the one place that knows a
token was attached: a 401 on a request that carried none is a login being
refused, not a session being revoked, and signing out of nothing would be noise
on the one screen where it would confuse somebody most. A repository could not
tell those apart without being told, and there are ten of them. The flag latches,
so four requests in flight when a session dies sign out once.

**The failure mapping was twelve copies, and most of them were wrong.** §21
specifies four states with four different promises. The shape that spread across
groups 11 to 19 was two branches:

```
when (failure) {
    ApiFailure.Offline -> OfflineState(onRetry)
    else -> ServerErrorState(...)          // ← everything else
}
```

Which sent a **rate limit** to a screen that apologises for the server. A 429 is
the reader's own recent behaviour with a stated cool-down (SAFETY-FR-009,
UX-STATE-004), and "something went wrong on our end" is both untrue and useless
— it invites a retry that will be refused again. `RateLimitedState` existed from
group 01 and two screens out of fourteen reached it.

It also sent a **neutral 404** to an error page with a Try again button. BR-025's
refusal is not a failure: the content is not available and there is nothing to
retry. An error screen there teaches the reader that the app is broken rather
than that the post is gone.

There is now one `FailureState` with an **exhaustive** `when` over all eight
variants, so a ninth is a compile error in one file in front of whoever added it
— which is precisely how these two defects spread in the first place. Fourteen
call sites now route through it, and the unused imports left behind were removed.

**The offline banner covered five destinations out of forty.** §43 wants it above
the content, and it was inside `MohallaShell` — so somebody who followed a
notification into a conversation, or opened a profile from search, saw no banner
at all while every request they made failed. It moved to the navigation graph,
above the whole `NavHost`, where it appears exactly once for every destination.

### What did not change, deliberately

**Nothing is disabled because the app is offline.** §43: a hint, never a gate.
Requests are still attempted and their own failure is authoritative — a
connectivity check that refused to try would fail requests that were going to
succeed on a flaky connection, which is most connections this product will meet.

**There is still no offline write queue.** A report made offline is refused with
its text kept rather than queued (GAP-M-014), and the same applies to every other
write: the app has no persisted outbox, and one that lost work after telling
somebody it was saved would be worse than a refusal they can act on.

**A `null` failure renders nothing.** The event detail screen's failure helper
took a nullable and fell through to the generic error, so a screen that had not
finished loading could show "something went wrong" for a request still in flight.
Now the loading branch owns that frame.

## What must be true before this table can say "feature-complete"

1. Every row above `✅` in both directions with its state set covered.
2. Compose UI tests running — which needs an emulator (`00-mobile-baseline.md` §6).
3. The eleven §44 end-to-end flows executed on a device.
4. **DEP-013** fonts bundled, **DEP-011/OD-016** Urdu strings reviewed,
   **OD-015** legal content supplied — none of which is in this repository's gift.
