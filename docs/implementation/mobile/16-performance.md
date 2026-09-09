# 16 — Performance

**Stage 7 · Android** · §48 module record

> Redistributed from the canonical records rather than written afresh: the screen rows come from [`17-mobile-screen-coverage.md`](17-mobile-screen-coverage.md), the requirement rows from [`18-mobile-requirement-traceability.md`](18-mobile-requirement-traceability.md), the runtime results from [`19-mobile-test-report.md`](19-mobile-test-report.md) and the open items from [`20-mobile-open-issues.md`](20-mobile-open-issues.md). Where a fact is absent it says **NOT YET VERIFIED** rather than guessing.

---

## Screens

This module is cross-cutting and owns no screen of its own; its behaviour appears on every screen in the other module records.

## Requirements

See the cross-reference above — this module’s requirements are recorded with the family that owns them, so they are not duplicated here (§24).

## What is enforced structurally

Performance has no screen of its own, so what exists is a set of rules asserted
over the whole source tree by `SourceInvariantTest` — chosen because a
performance rule that depends on remembering it is a rule that lasts until the
next screen.

| Rule | Why it is structural |
|---|---|
| **Every lazy list item carries a stable key** | Without one, a recomposition re-creates every row instead of moving it, and the cost is worst on exactly the long feeds that matter (NFR-PERF-004). |
| **Nothing blocks the main thread** | No `runBlocking`, no synchronous disk or network call on a composable's path. |
| **No HTTP body is ever logged** | An `OkHttp` body logger is both a performance cost on every request and a §39 violation, so the rule refuses it outright rather than depending on a build flag. |
| **One image loader** | `MohallaApplication` implements `ImageLoaderFactory`, so every entry point shares one instance with one cache. Coil's `LocalImageLoader` is deprecated precisely because providing it does not replace the singleton, and a path that missed the local would build a second loader with its own caches on the same directory. |
| **The feed cache fills one frame** | `PostCache` is populated from the feed so post detail opens against data already in memory, rather than showing a spinner for something the reader has just looked at. |

## Measurements

**None that describe a phone.** This is the honest position and it matters more
than a number would.

| What was observed | Why it is not a measurement |
|---|---|
| First composition of the splash logged `Davey! duration=12034ms` | A headless emulator on `swiftshader_indirect` — software rasterisation — on an 8 GB Windows host that was concurrently running Postgres, the API, the worker and a Gradle daemon. |
| Android SystemUI ANR'd repeatedly during Flow A, and the Pixel Launcher once | Same cause. The host had **616 MB free of 8 GB** at one point, which is a fact about the machine and not about the app. |
| The AVD was later reduced from 4 GB to 2 GB to keep the emulator usable beside the backend stack | Recorded because it explains why flow execution was slow, not because it says anything about release performance. |

**No NFR is claimed from any of this, in either direction.** Nothing above
supports a pass and nothing above supports a failure. §27 is explicit that the
3G and physical-device targets cannot be satisfied from desktop-hosted emulator
conditions, and they are not.

### What a real measurement would need

| | |
|---|---|
| Cold start | A physical mid-range device, DEP-006's installable build |
| Home first content | The same, against a seeded account with a populated feed |
| Feed scrolling · image-heavy feed | The same, plus real media through DEP-003's CDN path |
| Search · message thread | The same |
| Network shaping | §45's slow-network simulation, which needs a device |

All five are **NOT EXECUTED** and none is blocked by this codebase.

## Commits

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
- `727871b MOBILE: profile onboarding — the username race, grapheme counting, and a compression ceiling that refuses`
- `dc24edd MOBILE: authentication — the uniform failure, the OTP screen, and the LTR digits inside an RTL layout`
- `36beb0c MOBILE: design tokens, secure session storage, startup routing and the RTL navigation rule`

