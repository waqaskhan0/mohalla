# 17 — Requirement Traceability

**Stage 8** · where each approved requirement is implemented and where it is
proven.

---

## 1. Functional requirements

| Requirement | Implemented in | Proven by |
|---|---|---|
| ADMIN-FR-001 dashboard counts | `app/(portal)/dashboard` | E2E flow F; `metric-tile.spec.ts` |
| ADMIN-FR-002 moderation queue and case detail | `app/(portal)/moderation` | `queue.spec.ts`, `case-detail.spec.ts`; flows G, H |
| ADMIN-FR-003 restore | `[caseId]/actions.ts` | `case-detail.spec.ts` §43 block; browser run |
| ADMIN-FR-004 delete | `[caseId]/decision-panel.tsx` | confirmation exercised in the browser |
| ADMIN-FR-005 account lookup and identifiers | `app/(portal)/users` | `users.spec.ts`, `account.spec.ts`; flow I |
| ADMIN-FR-006 suspend | `[userId]/actions.ts` | live API: 2 sessions revoked; EDGE-027 measured |
| ADMIN-FR-007 ban | `enforcement-panel.tsx` | live API 200; confirmation exercised |
| ADMIN-FR-008 reinstate | `enforcement-panel.tsx` | live API 200, idempotent |
| ADMIN-FR-009 announcements, both languages | `app/(portal)/announcements` | `announcements.spec.ts`; browser publish |
| ADMIN-FR-010 verification | `app/(portal)/verification` | live API 400/204/204; `verification.spec.ts` |
| ADMIN-FR-011 aggregates only, no export | dashboard + audit log | flow F asserts no UUID in the response |
| ADMIN-FR-012 audit log search | `app/(portal)/audit-log` | `audit-log.spec.ts`; flow K |

## 2. Business rules

| Rule | Where | Proven by |
|---|---|---|
| BR-025 auto-hidden content | `VisibilityFlag` on queue and detail | rendered from `autoHidden` |
| BR-032 no automatic deletion | delete is the only path, and it is manual | no automatic caller exists |
| BR-034 a suspended user keeps READ access | stated on the enforcement panel | copy asserted |
| BR-035 all sessions invalidated | `sessionsRevoked` reported | live: 2 sessions revoked |
| BR-036 ban list | stated in the ban confirmation | copy asserted |
| BR-037 repeat-offender flag | case detail, as a fact to weigh | rendered `true` against a real fixture |
| BR-038 a reason on every action | every action, client and server | one-character reason refused, 400 |
| BR-039 append-only audit log | no write route at any layer | flow K: POST/PUT/PATCH/DELETE absent |
| BR-041 / LOCALE-FR-003 logical properties | `guard:rtl` over `apps/admin` | rule proven to fire on a probe |
| BR-ADM-001 no admin acts on an admin | API refuses | flow J: 403, and 404 on both account routes |

## 3. Security and privacy

| Requirement | Where | Proven by |
|---|---|---|
| SEC-006 uniform auth refusal | login copy map | flow C: identical code and message |
| SEC-020 separate credential stores | API | admin token refused 401 by user routes |
| SEC-021 prohibition regardless of interface state | API | flow J |
| SEC-022 / PRIV-008 audited identifier view | `sensitive-panel.tsx` | 50 → 50 → 51, fields not values |
| SEC-024 8-hour absolute session | cookie `maxAge` from `expiresAt` | flow B asserts `expiresAt` |
| SEC-025 no credential in the client bundle | `server-only` | zero client chunks contain it |
| PRIV-009 / MSG-FR-007 audited conversation read | `conversation-panel.tsx` | 0 entries on 3 loads, 1 on a press |
| §34 no `dangerouslySetInnerHTML` | every screen | asserted per screen and repo-wide |
| §38 CSRF | `SameSite=Strict` + server actions | cookie attributes asserted |
| §40 no internals on screen | `messages.ts` code map | no stack, no envelope, no raw message |

## 4. Edge cases

| Edge | Behaviour | Proven by |
|---|---|---|
| EDGE-024 concurrent decisions | 409 naming who resolved it and how | flow H, live replay |
| EDGE-027 re-suspension replaces | 30 days = 30.00 days from now | measured against the API |
| EDGE-028 suspension lifts by itself | stated; `formatExpiry` shows the tense | copy and unit tests |

## 5. Accessibility

| | |
|---|---|
| NFR-ACC-005 severity never colour alone | dot + label, always |
| §44 visible focus | all 14 focusables on a page carry an indicator |
| Contrast AA | measured in both themes; worst sample 5.99 |
| Reflow | 320px viewport, no sideways page scroll |
