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
| ✅ Complete in both directions | **16** |
| ◐ Partial | **4** (the shared state components — no Compose tests) |
| ✗ Not started | **41** |
| **Required total** | **61** |

**Coverage: 26% complete.** Stage 7 is **NOT** feature-complete.

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

**The media placeholder holds a RATIO, not a height.** §34 asks for "a
surface-sunken block at the correct aspect ratio so no layout shift occurs" and
§26 lists media height as growing with "ratio held", so a fixed dp would be
wrong twice — off the 4dp scale (§17) *and* frozen across screen sizes. The
skeleton's bars are fractions of the available width for the same reason.

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

| Screen | Name | Requirements | APIs | Status |
|---|---|---|---|---|
| UX-EVENT-001 | Events — Upcoming | EVENT-FR-001/002 | `/events` | ✗ |
| UX-EVENT-002 | Events — Mine | EVENT-FR-006 | `/events?mine=true` | ✗ |
| UX-EVENT-003 | Event detail | EVENT-FR-003/004 · BR-043/045 | `/events/:id` `/events/:id/rsvp` | ✗ |
| UX-EVENT-004 | Create event | EVENT-FR-005 | `POST /events` | ✗ |
| UX-EVENT-005 | Edit / cancel event | EVENT-FR-007 | `PATCH`/`DELETE /events/:id` | ✗ |

> **Privacy correction to carry into UX-EVENT-003.** The prototype shows
> attendee avatar stacks. The SRS prohibits exposing attendee identities in V1,
> so the detail screen must render **aggregate RSVP counts only**. Recorded here
> before the screen is built so the prototype is not followed by default.

## Group 08 · Create and media

| Screen | Name | Requirements | APIs | Status |
|---|---|---|---|---|
| UX-CREATE-001 | Composer | POST-FR-001 · EDGE-011/013 | `POST /posts` | ✗ |
| UX-CREATE-002 | Image picker & crop | MEDIA-FR-001 · NFR-PERF-005 | `/media/slots` | ✗ |
| UX-CREATE-003 | Attachment sheet | MEDIA-FR-002 | — | ✗ |
| UX-CREATE-004 | Category picker | POST-FR-003 | `/categories` | ✗ |

## Group 09–10 · Post detail and engagement

| Screen | Name | Requirements | APIs | Status |
|---|---|---|---|---|
| UX-HOME-003 | Post detail | POST-FR-004 · BR-009 | `/posts/:id` | ✗ |
| UX-HOME-004 | Image viewer | MEDIA-FR-004 | — | ✗ |

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
