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
| 7 | Search/follow/events | NOT_EXECUTED |
| 8 | Socket.IO/chat/idempotency | NOT_EXECUTED |
| 9 | Message requests | NOT_EXECUTED |
| 10 | Notifications | NOT_EXECUTED |
| 11 | Blocking | NOT_EXECUTED |
| 12 | User report to Admin | NOT_EXECUTED |
| 13 | Admin restore to Android | NOT_EXECUTED |
| 14 | Admin delete to Android | NOT_EXECUTED |
| 15 | Suspension | NOT_EXECUTED |
| 16 | Ban/reinstate | NOT_EXECUTED |
| 17 | Organization verification | NOT_EXECUTED |
| 18 | Announcements | NOT_EXECUTED |
| 19 | Account deletion | NOT_EXECUTED |
| 20 | Errors/recovery/security/concurrency | NOT_EXECUTED |

## INT flow results

| Flow | Result | Evidence |
| --- | --- | --- |
| INT-01 Signup → Profile → Feed | PASS | [03-authentication.md](03-authentication.md) |
| INT-02 Login → Create Post → Feed → Detail | PASS | [05-feed-posts-engagement.md](05-feed-posts-engagement.md) |
| INT-03 Media Upload → Post Render | PASS | [06-media.md](06-media.md) |
| INT-04…INT-20, INT-22…INT-25 | NOT_EXECUTED | — |
| INT-21 Session expiry | NOT_EXECUTED | reset-driven revocation is proven; expiry is group 20 |

Record exact individual results and evidence as each group executes.
