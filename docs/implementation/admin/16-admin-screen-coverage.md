# 16 — Screen Coverage

**Stage 8** · the nine approved screens (§7), and nothing else.

---

## 1. The nine

| Screen | Route | Group | State |
|---|---|---|---|
| UX-ADM-001 Login | `/login` | 02 | Implemented |
| UX-ADM-002 Dashboard | `/dashboard` | 04 | Implemented |
| UX-ADM-003 Moderation Queue | `/moderation` | 05 | Implemented |
| UX-ADM-004 Queue Item Detail | `/moderation/[caseId]` | 06 | Implemented |
| UX-ADM-005 Users | `/users` | 07 | Implemented |
| UX-ADM-006 User Detail | `/users/[userId]` | 08, 09 | Implemented |
| UX-ADM-007 Announcements | `/announcements` | 10 | Implemented |
| UX-ADM-008 Verification | `/verification` | 11 | Implemented |
| UX-ADM-009 Audit Log | `/audit-log` | 12 | Implemented |

**9 of 9.**

Supporting routes: `/` (redirects to the dashboard) and `/session-expired` (a
Route Handler that clears the cookie where Next permits it and forwards to
`/login?expired=1`).

## 2. What was deliberately not built

§9, §21, §33 and §73 name these, and none of them exists at any layer:

- no generic CMS — no arbitrary post editing, no changing user text, no content
  scheduling, no hidden authoring tools
- no conversation search, no arbitrary DM browsing, no inbox viewing, no "view
  all messages", no global messaging panel
- no audit-log edit, delete, clear, truncate, correction, bulk delete or export
- no administrator provisioning, creation, removal, invitation or bootstrap
- no granular admin roles, moderator tiers or superadmin UI
- no advanced BI, no arbitrary data export, no per-user analytics
- no AI moderation, no automated bans, no appeals workflow, no user
  impersonation

## 3. Phase 2 is untouched

§49: iOS, private profiles, groups, video, dark-mode *product* work and 2FA are
not in Stage 8 and were not started.
