# 15 — Accessibility and RTL

**Stage 7 · Android** · §48 module record

> Redistributed from the canonical records rather than written afresh: the screen rows come from [`17-mobile-screen-coverage.md`](17-mobile-screen-coverage.md), the requirement rows from [`18-mobile-requirement-traceability.md`](18-mobile-requirement-traceability.md), the runtime results from [`19-mobile-test-report.md`](19-mobile-test-report.md) and the open items from [`20-mobile-open-issues.md`](20-mobile-open-issues.md). Where a fact is absent it says **NOT YET VERIFIED** rather than guessing.

---

## Screens

This module is cross-cutting and owns no screen of its own; its behaviour appears on every screen in the other module records.

## Requirements

See the cross-reference above — this module’s requirements are recorded with the family that owns them, so they are not duplicated here (§24).

## Runtime evidence — Flow G, measured

§15 makes runtime RTL release-critical, and this is the only runtime
accessibility evidence the stage has. English → اردو was switched **at runtime,
without reinstalling**, and the bottom navigation was read out of the view
hierarchy before and after:

| Tab | English x | Urdu x | |
|---|---|---|---|
| Home / ہوم | 125 | **955** | mirrored |
| Events / تقریبات | 331 | **748** | mirrored |
| **Create / نیا** | 539 | **541** | **stays centre** |
| Messages / پیغامات | 747 | **333** | mirrored |
| Profile / پروفائل | 955 | **125** | mirrored |

"Create remains third/center" holds to within 2px, and the order is mirrored by
layout direction rather than reversed in code. The back arrow moved 84 → 996 and
the glyph itself mirrored; `Masjid Ittehad Welfare` and `@masjid_ittehad` stayed
left-to-right inside an RTL screen.

**Two findings came out of it.**

`RUNTIME-004` — the switch mirrored the layout and left every string in English.
All ~400 Urdu strings had never once been rendered. The manifest's
`android:localeConfig` opts the app into the platform's per-app language
feature, and from API 33 the system applies its own locale list after
`attachBaseContext`, discarding a `createConfigurationContext` done there.
Fixed via `LocaleManager.applicationLocales` on 33+, with `attachBaseContext`
kept for 26–32.

`RUNTIME-006`, **open** — Home's Urdu empty-state body wraps to three lines
against two in English, and the primary button beneath it is compressed to
**74px (≈28dp)** with its label clipped, against 126px (48dp) everywhere the
component owns its own height. The 48dp minimum is real and honoured; this
instance is squeezed by a parent that ran out of vertical space, which no source
check can see — only a device, in Urdu.

## What has NOT been audited on a device

§25 and §26 both remain outstanding, and neither is blocked by anything external:

| Check | State |
|---|---|
| TalkBack labels and announcements | **NOT EXECUTED** |
| Focus order | **NOT EXECUTED** |
| Error announcements (`liveRegion`) | declared in code; **never heard** |
| Dynamic type / font scale | **NOT EXECUTED** — and `RUNTIME-006` is a strong hint that 130% will find more |
| Colour-independent state | asserted structurally; **not seen** |
| Contrast | asserted structurally against the spec's own table; **not measured on a display** |

## What this module decided, and why

No new screens. This group audited all 55 built ones against §26, §35 and §36,
and the honest summary is that **RTL was clean and contrast was not**.

### RTL held up

Nothing to fix. No absolute alignment anywhere, no left/right padding, no
left/right text alignment, every directional icon already `AutoMirrored`, and the
tab list never reversed in code. §36's "do not treat RTL as final polish" was
followed group by group — every screen was written with logical direction from
the start — and the audit found the discipline had held across all 55.

### Contrast had not

**`text-tertiary` was carrying informational text on 44 sites.** The UI/UX
spec's own contrast audit is unambiguous: *"text-tertiary on white 2.9:1 — Fails
AA and is therefore FORBIDDEN for text. Permitted only for decorative dividers,
disabled-state icons, and non-informative placeholder glyphs."* And the same
table names `text-secondary` (5.4:1, AA) for what those 44 sites actually held:
*"Metadata, timestamps, helper text."*

Every post's timestamp and city, every handle, every comment's time, every day
heading in the notification centre, the three stat-pill labels on every profile,
the character counters, the settings rows' values, the helper text on the OTP
screen — all below AA, on the platform whose target user (persona MI) runs the
system font at 130%.

**Eleven more were conditional picks**, classified one at a time:

- A **departed author's placeholder** still answers "who wrote this", so BR-009's
  "Deleted User" is information — raised.
- A **cancelled event's title** still has to be readable. The banner says it is
  cancelled; the title says *which* event, and somebody checking whether their
  Saturday is free needs to read it. Dimming it below AA would leave the
  cancellation notice as the only legible thing on the card.
- The **request count badge** was white on `text-tertiary` — **2.6:1**, making
  BR-027's count the least legible thing in the tab it belongs to. Now white on
  `text-secondary` at 5.6:1, and still deliberately neutral: §18.5 wants "a
  number rather than a red dot", because a dot demands attention and a number is
  information.
- **Four of the five bottom-navigation labels are unselected at any moment**, and
  unselected was `text-tertiary`. The a11y checklist requires that "bottom
  navigation labels are always visible, never icon-only" — so most of the app's
  navigation was below AA. Locked stays tertiary: WCAG 1.4.3 exempts an inactive
  control, and §35's shape change carries that meaning.

What remains tertiary is enumerated with a reason at each site: two bullet
glyphs, a text-field placeholder, disabled and in-flight states, and decorative
icon tints where the words beside them carry the meaning.

### Touch targets were 40dp in twelve places

Material 3's `TextButton` is 40dp tall; the checklist says **"48×48dp minimum
everywhere"**. Twelve were bare — including **Forgot password** and **Resend
code**, both on recovery paths where the reader is already stuck and a missed tap
is the second thing that has gone wrong. `MohallaTextButton` now carries the
height, so the thirteenth caller cannot forget it; three sites that had already
been done by hand in group 04 were converted too, so the number has one
definition rather than four.

### And the invariants are now tests

Ten of them, over the source tree, because **a rule enforced by reading is a
rule that holds until the next screen** — which is what this audit measured.
Absolute alignment, left/right padding, left/right text alignment, unmirrored
directional icons, a reversed tab list, `text-tertiary` on text, a bare
`TextButton`, a hardcoded user-visible string, a lazy list item without a stable
key, and a blocking call or an HTTP logger.

Each is an **allowlist**, following the lesson group 11 measured: a denylist of
guessed names let four real defects through a suite of 271 tests. A new
permitted use has to be added to the test, which is the moment somebody reads why
the rule exists.

**What this still cannot prove is that pixels mirror.** It proves the mistakes
that make mirroring fail are absent, and that the contrast tokens are used as
the audit permits. Seeing the result needs a device, and there is none — §36
makes RTL release-critical, so that remains the largest verification debt in
Stage 7.

## Commits

- `2fcb3de MOBILE: a refusal that renders nothing is worse than a wrong one`
- `564dd9c Stage 7 group 22 (Accessibility, RTL and performance): RTL was clean, contrast was not, and 55 sites were below AA`
- `cfc6e29 Stage 7 group 20 (Offline and error states): a revocation hook nothing passed, a rate limit apologising for the server, and a banner covering five destinations out of forty`
- `ddacc58 Stage 7 groups 14-15 (Profiles and the social graph): the client could not send a JSON null, and two features were silently broken by it`
- `bde7b89 Stage 7 group 13 (Notifications): a centre that holds what was never pushed, and two badges nothing was feeding`
- `3ea1bc2 Stage 7 group 12 (Messaging): one client id that survives two retries, and two defects the wire hid`
- `6acd24d Stage 7 group 11 (Search): a failed search that never says "nothing found", and a history that never leaves the phone`
- `3f764cd Stage 7 group 08 (Create and media): per-attachment uploads, an encrypted draft, and three callbacks that stop being inert`
- `c05ffcc Stage 7 group 07 (Events): the join gate, aggregate-only attendance, and two gaps the client cannot close`
- `4f8a022 Stage 7 groups 05-06: the navigation shell, both Home feeds, and two defects only wiring could find`
- `0a3bf1b MOBILE: the remaining auth screens — register steps, password reset, restore`
- `dc24edd MOBILE: authentication — the uniform failure, the OTP screen, and the LTR digits inside an RTL layout`
- `36beb0c MOBILE: design tokens, secure session storage, startup routing and the RTL navigation rule`

