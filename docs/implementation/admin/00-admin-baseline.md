# 00 — Admin Baseline

**Stage 8 · Admin Web Portal** · the state of the repository at the moment Stage 8 began.

---

## 1. Where this starts

| | |
|---|---|
| Stage 7 PR | [#14](https://github.com/waqaskhan0/mohalla/pull/14) — **MERGED** 2026-09-09T06:57:07Z, squash, by `waqaskhan0` |
| Stage 7 final SHA | `32c2f51e08ae8d16eec2b99db82641d47e780a50` |
| `main` | `32c2f51` · local HEAD == `origin/main` · CI **success** |
| Stage 8 branch | `feature/stage-8-admin-v1` |
| `STAGE_8_BASE_SHA` | `32c2f51e08ae8d16eec2b99db82641d47e780a50` |
| Working tree at branch creation | clean |
| Stage 6 backend | feature-complete |
| Publication governance | public pushes authorized; `main` is not branch-protected, so the discipline is procedural — never push to `main`, never self-merge the Stage 8 PR |

---

## 2. The foundation that already exists

`apps/admin` is a Stage 5 shell, eleven files:

```
app/globals.css   app/layout.tsx   app/page.tsx
components/error-boundary.tsx      components/health-panel.tsx
lib/api-client.ts (+ .spec)        lib/env.ts (+ .spec)
lib/design-tokens.ts               lib/locale.ts
```

| | |
|---|---|
| Framework | Next.js 16.3.4 · React 19.2.8 (pinned, unchanged — §10) |
| Validation | `zod` 4.5.4 — already present, and load-bearing for Stage 8 |
| Shared | `@mohalla/contracts`, `@mohalla/design-tokens` |
| Scripts | `build` · `dev` · `start` · `typecheck` · `test` (vitest) |
| Tests | 6 passing |

**`lib/api-client.ts` is a browser-bundled client that can call the health
endpoints and nothing else** — its own comment says so. That single fact shapes
Group 01, because the admin credential must never enter a browser bundle.

---

## 3. The nine screens, and nothing else

From `05-admin-architecture.md` §2, which is the frozen Stage 4 mapping:

| Screen | Requirement | The constraint that matters |
|---|---|---|
| UX-ADM-001 Login | AUTH-FR-011 | 8-hour absolute timeout (SEC-024) |
| UX-ADM-002 Dashboard | ADMIN-FR-001/011 | **Open reports is the primary figure** |
| UX-ADM-003 Moderation queue | ADMIN-FR-002 | Severity → count → age |
| UX-ADM-004 Queue item | ADMIN-FR-002/003/004 | **Restore and Delete are peers** |
| UX-ADM-005 Users | ADMIN-FR-005 | Search by username, name, phone, email |
| UX-ADM-006 User detail | ADMIN-FR-005/006/007/008 | **The only surface exposing phone/email/DOB — every view audited** |
| UX-ADM-007 Announcements | ADMIN-FR-009 | Both languages required |
| UX-ADM-008 Verification | ADMIN-FR-010 | Organization accounts only |
| UX-ADM-009 Audit log | ADMIN-FR-012 | **Read-only; no mutation route exists** |

---

## 4. The session decision, and why it is not `localStorage`

**What Stage 6 provides.** `POST /admin/login` returns the credential *in the
response body* — `{ status: 'AUTHENTICATED', token, expiresAt }` — not a
`Set-Cookie`. ADR-008 describes it: an opaque, server-backed session, stored
hashed, **transported as a bearer token over TLS**. Guarded routes carry
`@RequiresAdmin()`.

**What the architecture does not decide** is where the browser keeps it. That is
Stage 8's to choose, and the choice is forced by two other approved facts:

- `05-admin-architecture.md` §6: *"The portal renders user-generated content and
  is the highest-value XSS target."*
- §36 of the brief: posts, comments, usernames, bios, report notes and reported
  conversation excerpts must all be assumed hostile.

A token in `localStorage` or `sessionStorage` is readable by any script that
executes on the page. Putting an 8-hour administrator session there, on the one
surface deliberately built to display attacker-controlled strings, would make a
single XSS a full moderation-account takeover.

**So:** the token is held in an **httpOnly, Secure, SameSite=Strict cookie set
by a Next.js Route Handler**, and every admin API call is made **server-side**,
attaching `Authorization: Bearer` from that cookie. The browser bundle never
receives the token and no client component can read it.

This *implements* ADR-008's bearer transport rather than departing from it — the
bearer header still goes to the API; only the custody is server-side. It also
gives §38's CSRF answer for free: `SameSite=Strict` plus mutations that only
ever originate from the portal's own server.

---

## 5. What the API contract cannot tell us

The generated Stage 6 contract has **`components.schemas`: 0 entries**, and a
success response carries only a `description`. It proves a route exists and
never what the route returns.

This is the same blind spot that cost Stage 7 its worst defect (RUNTIME-012: a
required field the server had never sent, a feature broken for the entire stage,
tests green throughout). Stage 8 answers it structurally: response shapes are
read from the API source, and **every admin response is validated against a Zod
schema at the client boundary**, so a renamed or missing field fails at the seam
with the field named rather than rendering a blank panel.

Recorded as `ADMIN-API-GAP-001` — a documentation defect, mitigated rather than
worked around. Details in [`13-admin-api-coverage.md`](13-admin-api-coverage.md).

---

## 6. Sensitive-data paths

| Path | Rule | How the portal must behave |
|---|---|---|
| `GET /admin/users/{id}/sensitive` | PRIV-008 — audited on **every** view; the architecture writes the audit entry *before* returning | A deliberate action on UX-ADM-006, never a prefetch. §24's hope for a dedicated reveal endpoint is already satisfied by Stage 6 |
| `GET /admin/moderation/cases/{id}/conversation` | PRIV-009 — reachable **only via its case**, bounded excerpt, audited | Fetched only when the administrator opens that moderation item. No conversation search, no inbox view, no DM browsing exists or will be built |
| `GET /admin/users/search` | phone and email are search *inputs* | Not logged to the console, not placed in a URL, not persisted in browser storage |
| Bulk export | **Prohibited — no endpoint exists** | Nothing to build |
| Editing user content | **Prohibited — no route exists** | Admins delete; they never edit |

---

## 7. Security gates Stage 8 must satisfy

| Gate | Source |
|---|---|
| Admin credentials never work in the app, user credentials never in the portal | SEC-020 |
| No administrator may act on another administrator — **server-side, unreachable by any request** | SEC-021 · BR-ADM-001 |
| No administrator provisioning, creation, removal or bootstrap route — *absent, not hidden* | `05-admin-architecture.md` §1 |
| A reason is mandatory on every moderation and enforcement action | BR-038 |
| The audit log is append-only; no interface may imply otherwise | BR-039 |
| Three confirmed deletions in 30 days **flags** for review — it does not auto-suspend | BR-037 |
| Output encoding by default, no raw HTML injection, strict CSP | SEC-016 |
| 8-hour absolute session; 5 failures then a 30-minute lockout; every attempt audited | SEC-024 · AUTH-FR-011 |
| No admin credential in source or client bundle | SEC-025 |

---

## 8. Responsive behaviour is a product decision, not a gap

`05-admin-architecture.md` §5, and it is deliberate:

| Width | Behaviour |
|---|---|
| ≥1024px | 240px sidebar, 1200px content cap |
| 768–1024px | sidebar collapses to a 64px icon rail |
| **<768px** | the queue is **viewable**; moderation decisions are **not takeable** |

The narrow-width fallback is defensive, not a mobile-admin commitment: a
moderation decision requires reading full content, every report reason and the
author's history, and a 360px screen cannot present that responsibly. Recorded
here so it is not later read as an omission.

---

## 9. Browser and runtime plan

Chrome/Chromium and Firefox are driven with the in-app browser against the local
Stage 6 stack. Edge is reported as executed or **NOT EXECUTED / ENVIRONMENT
BLOCKED** — never inferred (§65).

**Stage 7's lesson is the operating assumption**: eighteen defects were found by
running the app, every one on a build whose tests were green and whose
documentation said the feature worked. Type-checking, unit tests and a
successful build will not be accepted as evidence that a screen works (§50).

---

## 10. Toolchain drift on this workstation

| | Observed | Repository target |
|---|---|---|
| Node | 24.14.1 | 24.20.0 |
| npm | 11.11.0 | >=11.19.0 |

`.npmrc` sets `engine-strict=true`, so npm commands here need
`--engine-strict=false`. This is **not** equivalence: where local
package-manager behaviour differs from CI, **CI on the pinned toolchain is
authoritative**. It already mattered once — npm here never reads the
`overrides` field at all, proven with a control override of an unrelated
package, which is why the multer patch had to be written into the lockfile
directly and validated by CI.
