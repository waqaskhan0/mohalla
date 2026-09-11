# Group 8 — realtime, chat and idempotency

Baseline: `a16d25bc2de4acdf24998d87225ab17a96cdcd90`.

Two real sessions, two real Socket.IO clients, one real database. Nothing here
is asserted from a ping.

## What the existing suite already proves, and still does

The API smoke test covers the Socket.IO transport at real HTTP: an
unauthenticated handshake refused, a bogus token refused, an authenticated
socket connected, a send acknowledged, **a message reaching a live recipient
inside three seconds** (NFR-PERF-007), the same `clientMessageId` over REST
resolving to the same row rather than a second one (ADR-009 step 6), and a
revoked session dying mid-stream (BR-035). Those are named here because Group 8
covers them, not re-derived.

## What this group adds — 15 checks, all PASS

The two properties the suite could not answer: what happens to somebody who was
**not** connected when the message was written, and what happens when a client
that never saw an ack tries again.

### Retrying the same send over the same transport

| Check | Evidence |
| --- | --- |
| Three `message:send` events, one `clientMessageId` | all three acknowledged `ok` |
| **Exactly one persisted message** | one row in `messages` for that id |
| One id across all three acks | the sender can only draw one bubble |
| The receiver sees exactly one | 1 of 1 in the thread |

The gateway's own reason is the right one: fan-out happens only when the call
actually created the row, so a retry that resolved to an existing message is
not delivered twice (EDGE-021).

### The recipient was offline

| Check | Evidence |
| --- | --- |
| B disconnects | `connected false` |
| A's send is acknowledged with nobody listening | `ok: true` with the message |
| **Persisted anyway** | one row in `messages` |
| **On reconnection B reconciles to exactly one copy** | 1 copy in a thread of 2 |
| The reconnected socket still receives live messages | delivered inside 5 s |
| And the live message is one row too | 1 |

Reconciliation is by reading the thread, not by the socket replaying history —
which is right: a socket that replayed everything on connect would be a second,
weaker copy of the conversation endpoint.

### Negative

A send to a recipient id that does not exist returns `{"ok":false,"error":"NOT_AVAILABLE"}` —
an answer, not a 500 and not a silent drop.

Three consecutive runs: 15 passed, 0 failed each time.

## The app's side, and one thing worth being plain about

Opening the conversation on the device showed **exactly one bubble** for
`retry me exactly once` — the message sent three times over the socket with one
client id — alongside the offline message and the live one, each once, each
marked `Sent`. That is INT-09's consuming-UI evidence, and it is stronger than
a database count: the app renders what a person would actually see.

Sending from the app worked: `POST /conversations/{id}/messages`, the bubble
appears, `Sent`.

**The Android app holds no Socket.IO connection.** It polls
`GET /conversations/{id}/messages/since` about every two seconds while the
conversation is open — measured, twelve polls in twenty-four seconds — and
there is no socket client in its dependencies at all. This is within the
approved design rather than against it: `12-messaging-notifications.md` states
"REST is the source of truth. Realtime is an accelerator", and ADR-009 names a
polling fallback that reuses the identical id. A two-second poll also satisfies
NFR-PERF-007's three seconds.

So Group 8's verdict is split honestly:

- **Socket.IO transport: PASS.** Proven between two real socket clients,
  including reconnection and idempotency.
- **Android chat delivery: PASS, by polling.** The socket path is not what
  carries a message to or from the app today.

## INTEGRATION-009 — a REST send did not reach a connected socket (now FIXED)

Measured, not inferred:

```
POST /conversations/{id}/messages -> 201
B socket connected: true | events received during 5s: 0
```

The fan-out lives only in `MessagingGateway.onSend`. The REST route calls the
same `messaging.send(...)` and never emits `message:new`, so whether a recipient
gets pushed depends on **how the sender happened to send**. The same asymmetry
applies to the sender's own other devices, which the gateway explicitly fans out
to and the REST route does not.

**Nothing user-visible is broken today**, and that is why this is recorded
rather than changed: the only client is Android, Android has no socket, so every
participant is polling and every message arrives inside the poll interval. The
asymmetry becomes real the moment a second client type holds a socket — a web
client, or an Android build that adds one — because then a message typed on a
phone would sit unpushed until the other end polled, while the same message
typed on the socket would arrive immediately.

**Left OPEN at the time, and subsequently FIXED on the owner's instruction.**

The fan-out moved into `MessagingService`, which is the one place that knows a
row was created, so both transports accelerate identically. It runs after the
transaction commits, and the originating socket id travels with the send so a
socket client is not echoed a message it already holds the ack for. The two
questions that made this a contract decision were answered the way the gateway
already answered them: the sender's other devices ARE echoed, and EDGE-021 is
preserved by the same `created` guard, now checked once instead of per
transport.

Measured after the fix: a REST send reaches a connected recipient exactly once.
Full evidence and the mutation proof are in the defect register.

## INTEGRATION-005, third of six

`InboxScreen` had the same gap: `InboxViewModel` maintains `refreshing` and
nothing rendered it. Fixed the same way, and it matters most here — the socket
is exactly the thing that can quietly stop delivering, so an inbox with no way
to ask is an inbox with no recourse.

Verified on the device: a drag on the inbox took `GET /conversations` from 3
requests to 4. Three screens remain (notifications, saved posts, user lists).

## Not claimed

Message requests, their badge suppression and the accept/decline/block privacy
rules are group 9. Push notifications are group 10. Blocked socket pairs are
group 19.
