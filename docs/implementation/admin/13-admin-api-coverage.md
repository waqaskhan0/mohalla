# 13 — Admin API Coverage

**Stage 8 · Admin Web Portal** · every call the portal will make, mapped to the Stage 6 route that serves it.

> Built by reading `apps/api/src/modules/admin/**` and
> `apps/api/src/modules/platform/identity/transport/auth.controller.ts`, then
> cross-checking `docs/architecture/contracts/openapi-stage6-generated.json`.
> **The generated contract was not trusted for field shapes** — see the warning
> below.

---

## ⚠ The generated contract carries no schemas

`openapi-stage6-generated.json` has **`components.schemas`: 0 entries**, and a
route's success response carries only a `description`:

```
queue 200 content keys: ['description']
```

**It can prove a route exists and never what that route returns.** This is not a
footnote: it is the exact blind spot that produced Stage 7's RUNTIME-012, where
`CategoryResponse` required an `id` the server has never sent, every category
fetch threw, and POST-FR-006's composer picker had been broken for the whole
stage while its tests stayed green.

**So Stage 8 does not derive types from the contract.** Every response shape in
this document is read from the API source — the `toCaseBody`/`toActionBody`
mappers and the Zod request schemas — and every response the portal receives is
**validated against a Zod schema at the client boundary**, so a missing or
renamed field fails loudly at the seam with the field named, instead of
rendering an empty screen. `zod` is already an admin dependency; this costs
nothing new.

`ADMIN-API-GAP-001` records the contract gap itself. It is a documentation
defect, not a behavioural one, and it is mitigated rather than worked around.

---

## The 19 admin endpoints

| # | Method · Path | Screen | Requirement | Auth |
|---|---|---|---|---|
| 1 | `POST /admin/login` | UX-ADM-001 | AUTH-FR-011 · SEC-020/021/024 | public |
| 2 | `POST /admin/logout` | shell | AUTH-FR-011 | admin |
| 3 | `GET /admin/dashboard` | UX-ADM-002 | ADMIN-FR-001 · ADMIN-FR-011 | admin |
| 4 | `GET /admin/moderation/queue` | UX-ADM-003 | ADMIN-FR-002 | admin |
| 5 | `GET /admin/moderation/cases/{id}` | UX-ADM-004 | ADMIN-FR-002 | admin |
| 6 | `GET /admin/moderation/cases/{id}/conversation` | UX-ADM-004 | PRIV-009 · MSG-FR-007 | admin |
| 7 | `POST /admin/moderation/cases/{id}/restore` | UX-ADM-004 | ADMIN-FR-003 · BR-038 | admin |
| 8 | `POST /admin/moderation/cases/{id}/delete` | UX-ADM-004 | ADMIN-FR-004 · BR-038 | admin |
| 9 | `POST /admin/moderation/cases/{id}/no-action` | UX-ADM-004 | ADMIN-FR-002 · BR-038 | admin |
| 10 | `GET /admin/users/search` | UX-ADM-005 | ADMIN-FR-005 | admin |
| 11 | `GET /admin/users/{id}` | UX-ADM-006 | ADMIN-FR-005 | admin |
| 12 | `GET /admin/users/{id}/sensitive` | UX-ADM-006 | PRIV-008 | admin |
| 13 | `POST /admin/users/{id}/suspend` | UX-ADM-006 | ADMIN-FR-006 · BR-038 | admin |
| 14 | `POST /admin/users/{id}/ban` | UX-ADM-006 | ADMIN-FR-007 · BR-038 | admin |
| 15 | `POST /admin/users/{id}/reinstate` | UX-ADM-006 | ADMIN-FR-008 · BR-038 | admin |
| 16 | `PUT /admin/users/{id}/verification` | UX-ADM-008 | ADMIN-FR-010 · BR-038 | admin |
| 17 | `POST /admin/announcements` | UX-ADM-007 | ADMIN-FR-009 | admin |
| 18 | `GET /admin/announcements/allowance` | UX-ADM-007 | ADMIN-FR-009 | admin |
| 19 | `GET /admin/audit-log` | UX-ADM-009 | ADMIN-FR-012 · BR-039 | admin |

**Every approved screen has the API it needs. No Must feature is missing an
endpoint**, which is the question §46 asks — so there is no `ADMIN-API-GAP` for
absent functionality, and no backend change is required to begin.

---

## Two path facts worth recording

**Login is `/admin/login`, not `/auth/admin/login`.** `auth.controller.ts`
declares `@Controller()` with no prefix and `@Post('admin/login')`. The
hand-written design contract `openapi-v1.yaml` says `/auth/admin/login`; the
generated contract and the running code agree on `/admin/login`. Authority
order puts the current Stage 6 contract above the design document, so the
portal calls `/admin/login`.

**There is no `/api/v1/m` · `/api/v1/a` split.** `openapi-v1.yaml` describes one
("a user token is rejected on `/a`", and vice versa). The implementation carries
no such prefix — separation is enforced by the guard and the separate
credential store, not by a path segment. `05-admin-architecture.md` §1 states
the enforcement that actually exists: a separate `admins` table, a separate
hashing context and a separate guard.

Neither is a product-behaviour contradiction, so neither opens an
`ADMIN-CONFLICT`. Both are recorded because a reader of `openapi-v1.yaml` would
otherwise write the wrong URL.

---

## `no-action` — a third disposition the brief does not name

`POST /admin/moderation/cases/{id}/no-action` exists in Stage 6 and the Stage 8
brief names only Restore and Delete.

It is **not** an unapproved extra: closing a case without acting on the content
is the outcome for a report that was simply wrong, and without it an
administrator's only ways to clear such a case are to delete content that should
stay or to restore content that was never hidden. It carries the same mandatory
reason (BR-038) and the same audit entry as the other two.

It will be surfaced on UX-ADM-004 as a third disposition, visually subordinate to
neither Restore nor Delete — §43's peer requirement is about those two not
biasing each other, and a "no action needed" outcome is a different kind of
answer rather than a third competitor.

---

## Shapes read from source, not from the contract

### Moderation case (`toCaseBody`)

```
id, targetType, targetId, targetOwnerId, state, maxSeverity,
distinctReportCount, autoHidden, resolutionReason, resolvedByAdminId,
resolvedAt, version, createdAt
```

`version` is returned on **every** read, because every decision must carry back
the version it was made against (EDGE-024). `targetOwnerId`, `resolutionReason`,
`resolvedByAdminId` and `resolvedAt` are nullable.

### Queue page

```
{ cases: [...], total: number }
```

**Offset-based, not keyset** — `limit` and `offset` — and the API's own comment
says why: the ordering key is mutable, because a new report changes a case's
severity or count and moves it.

**Ordering is the server's**: severity, then distinct report count, then **age
ascending** — the oldest of equal cases first, so an item at the bottom cannot
wait forever. §16 forbids re-sorting client-side, and the portal will render the
order it is given.

### Case detail

Adds the reports, the author, `repeatOffenderFlag` (BR-037) and
`enforcementHistory[]` of `{id, kind, reason, expiresAt, createdAt}` — §4 of the
architecture wants proportionality judged "without navigating away".

### Enforcement result

```
{ action: { id, kind, expiresAt, sessionsRevoked } }
```

Sessions are revoked **by the server**. §25 is explicit that the frontend must
not be relied on for this, and the response reports what the server did.

---

## Error codes the portal must render

| Code | When | Rendered as |
|---|---|---|
| `CASE_ALREADY_RESOLVED` (409) | a second administrator submits a stale decision | **An informational panel naming who resolved it and how** — never an error toast. The architecture calls it "information rather than a fault" |
| `ADMIN_CANNOT_ACT_ON_ADMIN` | an enforcement request targets an administrator | Server-side refusal (SEC-021). The UI offers no such control, and hiding the control is **not** the boundary |
| `RESOURCE_UNAVAILABLE` (404) | a case or user is gone | The neutral unavailable state |
| `AUTHENTICATION_REQUIRED` (401) | session expired or absent | Return to login (§37) — without recording a partial enforcement action |
