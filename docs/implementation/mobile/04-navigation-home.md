# 04 — Navigation shell and Home

**Stage 7 · Android** · §48 module record

> Redistributed from the canonical records rather than written afresh: the screen rows come from [`17-mobile-screen-coverage.md`](17-mobile-screen-coverage.md), the requirement rows from [`18-mobile-requirement-traceability.md`](18-mobile-requirement-traceability.md), the runtime results from [`19-mobile-test-report.md`](19-mobile-test-report.md) and the open items from [`20-mobile-open-issues.md`](20-mobile-open-issues.md). Where a fact is absent it says **NOT YET VERIFIED** rather than guessing.

---

## Screens

| Screen | Name | Requirements | APIs | LTR | RTL | Loading | Empty | Error | Offline | A11y | Tests | Runtime | Status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| UX-HOME-001 | Home — Following | FEED-FR-001/002 · FEED-FR-004/005 | `/feed/following` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| UX-HOME-002 | Home — Discover | FEED-FR-003 · FEED-FR-004 | `/feed/discover` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ |
| UX-HOME-005 | Category filter | FEED-FR-006 | `/categories` | — | — | — | — | — | — | — | — | — | ✗ |
| UX-HOME-006 | Announcement detail | NOTIF-FR-005 | `/announcements/:id` | — | — | — | — | — | — | — | — | — | ✗ |

**Runtime.** Exercised on an emulator: `UX-HOME-001`. **NOT EXECUTED**: `UX-HOME-002`, `UX-HOME-005`, `UX-HOME-006`.

## Requirements

| Req | Title | Pri | API | ViewModel / use case | Test | Status |
|---|---|---|---|---|---|---|
| FEED-FR-001 | Following Feed | Must | `GET /feed/following` | FeedViewModel | FeedStateTest | `IMPLEMENTED` |
| FEED-FR-002 | Featured and Announcements | Must | `GET /feed/featured` | FeedViewModel | FeedStateTest | `PARTIAL` |
| FEED-FR-003 | Discover feed | Must | `GET /feed/discover` | FeedViewModel | FeedPagingTest | `IMPLEMENTED` |
| FEED-FR-004 | Pagination | Must | — | FeedViewModel | FeedPagingTest · FeedStateTest | `IMPLEMENTED` |
| FEED-FR-005 | Pull to refresh | Must | `GET /feed/following` | FeedViewModel | FeedStateTest | `IMPLEMENTED` |
| FEED-FR-006 | Filter by category | Should | — | — | — | `PARTIAL` |
| FEED-FR-007 | Saved posts | Could | `GET /me/saved` · `PUT /posts/{id}/save` | SavedPostsViewModel | ProfileTest | `IMPLEMENTED` |

- **FEED-FR-002** — The Featured strip renders. UX-HOME-006, the announcement detail screen it should open, is not started.
- **FEED-FR-006** — Category filter: UX-HOME-005 is not started.

## What this module decided, and why

|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| — | Bottom navigation (component) | UI/UX §14 | — | ✅ | ✅ | — | — | — | — | ✅ |
| — | Top app bar · back header (components) | UI/UX §18.5 | — | ✅ | ✅ | — | — | — | — | ✅ |
| — | Navigation graph | UI/UX §12 | — | ✅ | ✅ | ✅ | — | — | — | ✅ |
| — | Suspension banner + explainer | UX-SAFE-004 · BR-034 | `GET /me` | ✅ | ✅ | — | — | — | — | ✅ |

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

## Commits

- `3f40a64 MOBILE: the date of birth could not be typed, so nobody could register`
- `f32b3de Stage 7 group 23 (Integration validation): a Must nobody had implemented, three declarations nothing called, and a coverage table in three shapes`
- `564dd9c Stage 7 group 22 (Accessibility, RTL and performance): RTL was clean, contrast was not, and 55 sites were below AA`
- `4c071fb Stage 7 group 21 (Deep links): a shared link the app could not open, and a link that is held rather than obeyed`
- `cfc6e29 Stage 7 group 20 (Offline and error states): a revocation hook nothing passed, a rate limit apologising for the server, and a banner covering five destinations out of forty`
- `8ac47a9 Stage 7 groups 18-19 (Account state and deletion): a list that must be read before anything can be confirmed, and a coverage count that had drifted`
- `068c0e6 Stage 7 group 17 (Safety): one acknowledgement whatever happened, and every inert Report control made real`
- `a07099d Stage 7 group 16 (Settings): a sign-out that works offline, a blocked list that cannot name anyone, and three screens that stopped being unreachable`
- `ddacc58 Stage 7 groups 14-15 (Profiles and the social graph): the client could not send a JSON null, and two features were silently broken by it`
- `bde7b89 Stage 7 group 13 (Notifications): a centre that holds what was never pushed, and two badges nothing was feeding`
- `3ea1bc2 Stage 7 group 12 (Messaging): one client id that survives two retries, and two defects the wire hid`
- `6acd24d Stage 7 group 11 (Search): a failed search that never says "nothing found", and a history that never leaves the phone`
- `d89d6d2 Stage 7 group 09-10 (Post detail and engagement): a cache that fills one frame, a comment that survives refusal, and one level of nesting`
- `3f764cd Stage 7 group 08 (Create and media): per-attachment uploads, an encrypted draft, and three callbacks that stop being inert`
- `c05ffcc Stage 7 group 07 (Events): the join gate, aggregate-only attendance, and two gaps the client cannot close`
- `4f8a022 Stage 7 groups 05-06: the navigation shell, both Home feeds, and two defects only wiring could find`
- `36beb0c MOBILE: design tokens, secure session storage, startup routing and the RTL navigation rule`

