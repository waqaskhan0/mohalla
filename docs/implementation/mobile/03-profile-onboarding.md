# 03 — Profile onboarding

**Stage 7 · Android** · §48 module record

> Redistributed from the canonical records rather than written afresh: the screen rows come from [`17-mobile-screen-coverage.md`](17-mobile-screen-coverage.md), the requirement rows from [`18-mobile-requirement-traceability.md`](18-mobile-requirement-traceability.md), the runtime results from [`19-mobile-test-report.md`](19-mobile-test-report.md) and the open items from [`20-mobile-open-issues.md`](20-mobile-open-issues.md). Where a fact is absent it says **NOT YET VERIFIED** rather than guessing.

> Requirements are `PROFILE-FR-001/002`, `MEDIA-FR-001` and `SOCIAL-FR-005`; the rest of those families sit in [`08-search-social.md`](08-search-social.md) and [`06-create-post-media.md`](06-create-post-media.md).

---

## Screens

| Screen | Name | Requirements | APIs | LTR | RTL | Loading | Empty | Error | Offline | A11y | Tests | Runtime | Status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| UX-SETUP-001 | Username selection | PROFILE-FR-002 · EDGE-007 | `/me/username` `/username/available` | ✅ | ✅ | ✅ | — | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| UX-SETUP-002 | Profile setup | PROFILE-FR-001/003 · MEDIA-FR-001 | `POST /me/profile` · `/media/*` | ✅ | ✅ | ✅ | — | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| UX-SETUP-003 | Suggested accounts | SOCIAL-FR-005 · RSK-001 | `GET /suggestions` · `/users/:id/follow` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✗ | ✅ |

**Runtime.** Exercised on an emulator: `UX-SETUP-001`, `UX-SETUP-002`. Exercised and FAILED, then fixed: `UX-SETUP-003`.

## Requirements

See the cross-reference above — this module’s requirements are recorded with the family that owns them, so they are not duplicated here (§24).

## What this module decided, and why

|---|---|---|---|---|---|---|---|---|---|---|---|---|---|

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

## Commits

- `2fcb3de MOBILE: a refusal that renders nothing is worse than a wrong one`
- `0a2b4ad MOBILE: a LazyColumn inside a scrolling scaffold crashed the suggestions screen`
- `564dd9c Stage 7 group 22 (Accessibility, RTL and performance): RTL was clean, contrast was not, and 55 sites were below AA`
- `3f764cd Stage 7 group 08 (Create and media): per-attachment uploads, an encrypted draft, and three callbacks that stop being inert`
- `4f8a022 Stage 7 groups 05-06: the navigation shell, both Home feeds, and two defects only wiring could find`
- `727871b MOBILE: profile onboarding — the username race, grapheme counting, and a compression ceiling that refuses`

