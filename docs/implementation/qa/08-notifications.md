# Notifications QA

Two things are kept apart here, because conflating them is how this stage's
worst reporting error happened: the **in-app notification pipeline**, which
works, and the **Android push client**, which does not exist.

| | |
| --- | --- |
| **PUSH BACKEND PIPELINE** | **PASS** |
| **IN-APP NOTIFICATION CENTRE** | **PASS** — 17 checks, 0 failed |
| **PUSH CLIENT IMPLEMENTATION** | **FAIL — absent (QA-009, HIGH)** |
| **OS NOTIFICATION PERMISSION FLOW** | **NOT IMPLEMENTED** |
| **REAL EXTERNAL PROVIDER DELIVERY** | **BLOCKED_EXTERNAL — DEP-003** |

## Produced by real actions, never inserted

No notification row was written directly. Each was caused by an action a person
could take and followed through the outbox, the worker and the API.

| Action | Notified | Category observed |
| --- | --- | --- |
| A follows B | B | `FOLLOW` |
| A likes B's post | B | `LIKE` |
| A comments on B's post | B | `COMMENT` |
| B replies to A's comment | A | `REPLY` |

## The rules

| Check | Evidence |
| --- | --- |
| **No notification ever has its own recipient as the actor** | 0 self-actor rows |
| Ordered newest first (NOTIF-FR-002) | 36 items, monotonically descending |
| The unread count matches the unread rows | claimed 34, actual 34 |
| A notification can be marked read | 200 |
| And the unread count drops | 34 → 33 |
| **A blocked person cannot reach the post at all** | 404 |
| **And no notification to A has the blocked person as its actor** | 0 |
| Message Requests generate no push | 0 outbox rows (proven in the chat suite) |

### Three assertions of mine that were wrong first

All three compared **totals** across an asynchronous drain, which measures the
worker's timing rather than the product:

- *"B is notified of the follow / comment"* failed because the worker had been
  started moments earlier in the same run and its first drain had not landed.
  Both categories were present once it caught up.
- *"liking your own post notifies nobody"* failed 3 → 4 while an unrelated
  `REPLY` notification triggered seconds earlier was still draining.
- *"a blocked user generates no notification"* failed 2 → 3 for the same reason.

Each is now asserted on **identity** — is this person ever the actor? — which is
both exact and immune to timing. A count delta taken either side of an async
queue is not evidence.

## Push: what exists and what does not

| Layer | State |
| --- | --- |
| Outbox → worker → notification row | implemented, working |
| `PUSH_SENDER` port, `FakePushSender` | implemented |
| `POST` / `DELETE /notifications/devices` | **implemented and routed** |
| Notification preferences API | implemented |
| Android in-app notification centre | implemented, working |
| Android notification **preferences screen** | implemented |
| Android push SDK, token, channel, permission, payload handling | **none of it** |

`device_tokens` holds 8 rows, every one created **2026-09-05** by backend tests
calling the endpoint directly. Nothing was registered by the app, because no
code path can.

**The app ships a screen for choosing which push notifications you want, and no
ability to receive any of them.** That is QA-009, and it is HIGH.

## A correction to this stage's own earlier report

The device checkpoint concluded the notification-permission lifecycle was
"N/A because DEP-002 means there is nothing to deliver". That inference was
wrong — a missing provider does not make a missing client acceptable — and the
dependency was wrong too: **DEP-002 is SMS/OTP; DEP-003 is FCM** (QA-010).
