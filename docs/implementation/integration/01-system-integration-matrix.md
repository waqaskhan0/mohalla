# Stage 9 integration matrix

Baseline: `a16d25bc2de4acdf24998d87225ab17a96cdcd90`.
Earlier-stage evidence is not automatically a Stage 9 PASS. A state-changing
flow needs initiating UI, API/database, and consuming UI evidence.

| Group | Scope | Status |
| --- | --- | --- |
| 1 | Contract audit | PASS |
| 2 | Android authentication | PASS |
| 3 | Admin authentication | PASS |
| 4 | Feed/posts | PASS |
| 5 | Likes/comments | PASS |
| 6 | Media | PASS |
| 7 | Search/follow/events | PASS |
| 8 | Socket.IO/chat/idempotency | PASS |
| 9 | Message requests | PASS |
| 10 | Notifications | PASS |
| 11 | Blocking | PASS |
| 12 | User report to Admin | PASS (API/DB); Admin UI BLOCKED_LOCAL |
| 13 | Admin restore to Android | PASS (author notice BLOCKED_EXTERNAL) |
| 14 | Admin delete to Android | PASS (author notice BLOCKED_EXTERNAL) |
| 15 | Suspension | PASS |
| 16 | Ban/reinstate | PASS |
| 17 | Organization verification | PASS |
| 18 | Announcements | PASS (external broadcast BLOCKED_EXTERNAL) |
| 19 | Account deletion | PASS |
| 20 | Errors/recovery/security/concurrency | PASS |

## INT flow results

| Flow | Result | Evidence |
| --- | --- | --- |
| INT-01 Signup → Profile → Feed | PASS | [03-authentication.md](03-authentication.md) |
| INT-02 Login → Create Post → Feed → Detail | PASS | [05-feed-posts-engagement.md](05-feed-posts-engagement.md) |
| INT-03 Media Upload → Post Render | PASS | [06-media.md](06-media.md) |
| INT-04 Follow → state propagation | PASS | [07-search-social-events.md](07-search-social-events.md) |
| INT-10 Event RSVP | PASS | [07-search-social-events.md](07-search-social-events.md) |
| INT-06 Realtime Message | PASS | [08-realtime-chat.md](08-realtime-chat.md) |
| INT-09 Reconnect / idempotent message | PASS | [08-realtime-chat.md](08-realtime-chat.md) |
| INT-07 Message Request Accept | PASS | [09-message-requests.md](09-message-requests.md) |
| INT-08 Message Request Decline/Block privacy | PASS | [09-message-requests.md](09-message-requests.md) |
| INT-05 Like/Comment → Notification | PASS | [10-notifications.md](10-notifications.md) |
| INT-20 Block → Privacy → Unblock | PASS | [11-blocking-privacy.md](11-blocking-privacy.md) |
| INT-11 Android Report → Admin Queue | PASS at API/DB; Admin UI BLOCKED_LOCAL | [12-report-to-admin.md](12-report-to-admin.md) |
| INT-12 Admin Restore → Android restored | PASS; author notice BLOCKED_EXTERNAL | [13-admin-decisions.md](13-admin-decisions.md) |
| INT-13 Admin Delete → Android removal | PASS; author notice BLOCKED_EXTERNAL | [13-admin-decisions.md](13-admin-decisions.md) |
| INT-24 Admin collision | PASS | [13-admin-decisions.md](13-admin-decisions.md) |
| INT-14 Admin Suspend → Android state | PASS | [14-enforcement-verification-announcements.md](14-enforcement-verification-announcements.md) |
| INT-15 Admin Ban → Android/login/content | PASS | [14-enforcement-verification-announcements.md](14-enforcement-verification-announcements.md) |
| INT-16 Admin Reinstate → Android restored | PASS | [14-enforcement-verification-announcements.md](14-enforcement-verification-announcements.md) |
| INT-17 Org verification → Android badge | PASS | [14-enforcement-verification-announcements.md](14-enforcement-verification-announcements.md) |
| INT-18 Announcement → Android Featured | PASS; external broadcast BLOCKED_EXTERNAL | [14-enforcement-verification-announcements.md](14-enforcement-verification-announcements.md) |
| INT-19 Account deletion → Restore | PASS | [15-account-deletion.md](15-account-deletion.md) |
| INT-21 Session expiry | PASS | [16-errors-recovery-security.md](16-errors-recovery-security.md) |
| INT-22 API outage → Recovery | PASS | [16-errors-recovery-security.md](16-errors-recovery-security.md) |
| INT-23 Media/network retry | PASS | [16-errors-recovery-security.md](16-errors-recovery-security.md) |
| INT-25 Reported conversation privacy/audited access | PASS | [16-errors-recovery-security.md](16-errors-recovery-security.md) |

All twenty groups and all twenty-five INT flows are executed. Two results are
qualified rather than plain passes and the qualification is the point:
INT-11's Admin **rendered** leg is `BLOCKED_LOCAL` (INTEGRATION-012, an
environment blocker), and INT-12/INT-13's author notification is
`BLOCKED_EXTERNAL` on OD-015, an owner decision. Neither is a pass and neither
is dressed as one.
