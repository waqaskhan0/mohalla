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

## Push — implemented and executed (QA-009 closed, 2026-09-12)

The section this replaces read "*Android push SDK, token, channel, permission,
payload handling — **none of it***", and it was accurate when written. The owner
then supplied the DEP-003 client configuration and the client was built.

| Layer | State |
| --- | --- |
| Outbox → worker → notification row | implemented, working — 17/17 |
| `PUSH_SENDER` port, `FakePushSender` | implemented |
| `POST` / `DELETE /notifications/devices` | implemented, routed, **and now called by the app** |
| Notification preferences API | implemented |
| Android in-app notification centre | implemented, working |
| Android notification preferences screen | implemented, plus a permission notice when the OS is refusing |
| Android push SDK, token, channel, permission, payload handling | **implemented** — Firebase BOM 33.7.0, one channel, contextual permission, data-only payloads |

### What was executed

| Lane | Checks | Result |
| --- | --- | --- |
| Notification centre and rules (`qa10_notifications.mjs`) | 17 | **PASS** |
| Device token lifecycle on the emulator (`qa10_push.py`) | 36 | **PASS** |
| Delivery with permission granted (`PushMessageDeliveryTest`) | 6 | **PASS** |
| Delivery with permission refused (`PushDeniedDeliveryTest`) | 2 | **PASS** |
| Rotation wiring on device (`PushTokenRotationTest`) | 1 | **PASS** |
| Backend payload ↔ client parser (`qa10_push_payload.mjs`) | 6 | **PASS** |
| Registrar and deep-link units | 17 | **PASS** |

`device_tokens` now holds a **real Firebase registration token** written by the
app itself — 142 characters with the separator at 22, which is the shape the
earlier synthetic rows (17–26 characters, no separator) do not have. The value
is never printed, logged or committed; only its length and separator position
are ever recorded.

### The rules that say "no push", re-checked with a device actually registered

These previously could not fail, because nothing was registered. They can now.

| Rule | Evidence |
| --- | --- |
| A Message Request produces no push (BR-027) | `qa10_chat.mjs` — "no ordinary push is generated for a request", 0 outbox rows, with the handset live |
| A blocked person produces no notification at all | `qa10_notifications.mjs` — 0 notifications from that actor |
| Own actions never notify the actor | the drain logs `notification_suppressed, reason: OWN_ACTION` |
| An account with no device is recorded, not pushed | the drain logs `notification_recorded_no_push, reason: NO_DEVICE` — which is the honest distinction NOTIF-FR-007 asks for |
| Preferences apply to push only; the centre keeps everything | the preferences screen states it, and the centre gained every row regardless |

### The payload contract, checked from both sides

`qa10_push_payload.mjs` drains in-process and inspects what `FakePushSender` was
handed. For the notification produced by a real like on a real post:

- it was addressed to **the registered handset's own token**, not to some other row;
- it carried `title`, `body`, `deepLink`, `correlationId` and **nothing else** (ADR-014);
- its `deepLink` — `/posts/<uuid>` — is a path `DeepLinks.resolvePath` accepts.

That last check reimplements the client's allowlist deliberately, so a change to
either side without the other fails this file instead of silently shipping a
notification that opens nothing.

## Real FCM delivery — BLOCKED_EXTERNAL

None of the above shows that Google's servers deliver anything. That needs a
Firebase **service-account credential**, which is a production secret this
public repository must not hold, and no real `FirebasePushSender` adapter exists
yet. It is tracked as **DEP-003-B** in `qa-defects.md` and must not be reported
as a pass.

## A correction to this stage's own earlier report

The device checkpoint concluded the notification-permission lifecycle was
"N/A because DEP-002 means there is nothing to deliver". That inference was
wrong — a missing provider does not make a missing client acceptable — and the
dependency was wrong too: **DEP-002 is SMS/OTP; DEP-003 is FCM** (QA-010). The
lifecycle has since been executed in full; see `04-device-permissions.md`.

## Verdicts, kept separate

| | |
| --- | --- |
| **IN-APP NOTIFICATION CENTRE** | **PASS** |
| **ANDROID PUSH CLIENT** | **PASS** |
| **DEVICE TOKEN REGISTRATION** | **PASS** |
| **OS PERMISSION FLOW** | **PASS** |
| **BACKEND PUSH PIPELINE** | **PASS** |
| **REAL FCM DELIVERY** | **BLOCKED_EXTERNAL — DEP-003-B** |
