# 17 — Mobile Screen Coverage

**Stage 7 · Android** · 61 required screens · last updated at commit `dc24edd`+

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
| ✅ Complete in both directions | **11** |
| ◐ Partial | **4** (the shared state components — no Compose tests) |
| ✗ Not started | **46** |
| **Required total** | **61** |

**Coverage: 18% complete.** Stage 7 is **NOT** feature-complete.

**Group 03 (authentication) is now finished** — all twelve `UX-AUTH-*` screens
exist in both directions. That was the security-critical group and the one the
whole product is gated behind; the remaining 46 screens are product surface.

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

| Screen | Name | Requirements | APIs | Status |
|---|---|---|---|---|
| UX-SETUP-001 | Username selection | PROFILE-FR-001 · EDGE-007 | `/me/username` `/username/available` | ✗ |
| UX-SETUP-002 | Profile setup | PROFILE-FR-002/003 | `POST /me/profile` | ✗ |
| UX-SETUP-003 | Suggested accounts | SOCIAL-FR-004 | `/users/suggested` | ✗ |

## Group 05–06 · Navigation shell and Home

| Screen | Name | Requirements | APIs | Status |
|---|---|---|---|---|
| — | Bottom navigation (component) | UI/UX §14 | — | ✅ |
| UX-HOME-001 | Home — Following | FEED-FR-001/003 | `/feed/following` | ✗ |
| UX-HOME-002 | Home — Discover | FEED-FR-004 | `/feed/discover` | ✗ |
| UX-HOME-005 | Category filter | FEED-FR-005 | `/categories` | ✗ |
| UX-HOME-006 | Announcement detail | NOTIF-FR-005 | `/announcements/:id` | ✗ |

The navigation component is complete and carries §8's RTL rule; the tabs it
routes to are not built.

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
