# 01 — App shell, startup and localization

**Stage 7 · Android** · §48 module record

> Redistributed from the canonical records rather than written afresh: the screen rows come from [`17-mobile-screen-coverage.md`](17-mobile-screen-coverage.md), the requirement rows from [`18-mobile-requirement-traceability.md`](18-mobile-requirement-traceability.md), the runtime results from [`19-mobile-test-report.md`](19-mobile-test-report.md) and the open items from [`20-mobile-open-issues.md`](20-mobile-open-issues.md). Where a fact is absent it says **NOT YET VERIFIED** rather than guessing.

> The four `UX-STATE-*` screens live in [`14-offline-error-states.md`](14-offline-error-states.md), which owns every failure surface.

---

## Screens

| Screen | Name | Requirements | APIs | LTR | RTL | Loading | Empty | Error | Offline | A11y | Tests | Runtime | Status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| UX-AUTH-001 | Splash | NFR-PERF-003 | `GET /me` | ✅ | ✅ | ✅ | — | — | — | ✅ | ✅ | ✅ | ✅ |
| UX-AUTH-002 | Language selection | LOCALE-FR-001 · BR-040 | — | ✅ | ✅ | — | — | — | — | ✅ | ✅ | ✅ | ✅ |

**Runtime.** Exercised on an emulator: `UX-AUTH-001`, `UX-AUTH-002`.

## Requirements

| Req | Title | Pri | API | ViewModel / use case | Test | Status |
|---|---|---|---|---|---|---|
| LOCALE-FR-001 | First-launch language selection | Must | — | LocaleManager | LocaleManagerTest | `IMPLEMENTED` |
| LOCALE-FR-002 | Switch language | Must | `PUT /me/language` | LocaleManager | LocaleManagerTest | `IMPLEMENTED` |
| LOCALE-FR-003 | Right-to-left layout | Must | — | LocaleManager | LocaleManagerTest | `IMPLEMENTED` |
| LOCALE-FR-004 | Urdu font rendering | Must | — | LocaleManager | LocaleManagerTest | `PARTIAL` |
| LOCALE-FR-005 | Mixed-script content | Must | — | LocaleManager | LocaleManagerTest | `IMPLEMENTED` |
| LOCALE-FR-006 | Localized notifications | Should | — | NotificationsViewModel | NotificationsTest | `IMPLEMENTED` |

- **LOCALE-FR-004** — Urdu renders with the system font. DEP-013 has not delivered the licensed Noto Nastaliq face the spec names.

## What this module decided, and why

|---|---|---|---|---|---|---|---|---|---|---|---|---|---|

`UX-AUTH-001` is the splash: it is the `Resolving` state of the startup router
rather than a screen with content, and §9's rule — *"do not flash unauthorized
screens while state is resolving"* — is what it exists to satisfy.

The four `UX-STATE-*` screens are built as **shared components**, which is
required rather than convenient: `ContentUnavailable` takes **no `reason`
parameter**, so no caller can make the neutral refusal distinguishable
(mandatory test A). They are `◐` because they have no Compose tests yet.

## Commits

- `aa401d3 MOBILE: switching language now switches the language, not only the direction`
- `4c071fb Stage 7 group 21 (Deep links): a shared link the app could not open, and a link that is held rather than obeyed`
- `a07099d Stage 7 group 16 (Settings): a sign-out that works offline, a blocked list that cannot name anyone, and three screens that stopped being unreachable`
- `3f764cd Stage 7 group 08 (Create and media): per-attachment uploads, an encrypted draft, and three callbacks that stop being inert`
- `c05ffcc Stage 7 group 07 (Events): the join gate, aggregate-only attendance, and two gaps the client cannot close`
- `4f8a022 Stage 7 groups 05-06: the navigation shell, both Home feeds, and two defects only wiring could find`
- `36beb0c MOBILE: design tokens, secure session storage, startup routing and the RTL navigation rule`

