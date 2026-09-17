# Chat, realtime and message requests

Two real sessions, two real Socket.IO clients, one real database. Nothing is
asserted from a ping, and no unit-test result is accepted as evidence for a
property the brief asks to be forced at runtime.

**Result: 33 checks, 33 PASS, 0 FAIL.**

## Live exchange

| Check | Evidence |
| --- | --- |
| Both users open authenticated sockets | connected |
| A opens a conversation with B | 201 |
| The first message is accepted | 201 |
| **B receives it over the socket inside 3 s** (NFR-PERF-007) | 1 event |
| And exactly one row was written | 1 |

## Ambiguous delivery — the case that duplicates (EDGE-021 · ADR-009)

The same logical send, three times, **across both transports**: two REST posts
and one socket emit, all carrying one `clientMessageId`.

| Check | Evidence |
| --- | --- |
| Every retry is acknowledged rather than refused | 201 / 200 / `ok:true` |
| **All three resolve to the SAME message id** | 1 distinct id |
| **Exactly one row is persisted** | 1 |
| **And the receiver sees it exactly once** | 1 delivery |

That is the property in full: one row, one id, one bubble, from three attempts
over two transports.

## Rapid sends

Six concurrent sends:

| Check | Evidence |
| --- | --- |
| All six arrive | 6 received |
| None arrives twice | 6 distinct of 6 |
| Six rows, not more | 6 |

## History

| Check | Evidence |
| --- | --- |
| B can read the thread | 200 |
| A page is bounded by its limit | 5 of 5 |
| The next page does not repeat the first | 0 repeated |

## Socket and conversation authorization

| Check | Evidence |
| --- | --- |
| An unauthenticated socket is refused | never connects |
| A bogus token is refused | never connects |
| **A non-participant cannot post into the conversation** | 404 |
| **Nor read it** | 404 |

404 rather than 403 throughout: the refusal does not confirm the conversation
exists.

## A session revoked while the socket is open (BR-035)

| Check | Evidence |
| --- | --- |
| A fresh session is established and holds a live socket | connected |
| **A send on the now-revoked session is refused, not accepted** | no ack |
| And nothing was written | 0 rows |

### A vacuous pass this nearly produced

The first version used a fixture token. On the second run that account had
already been logged out by the first, so the socket never connected — and the
two checks after it **passed vacuously**, because "the send was refused" is
trivially true when there is no connection to send on. The suite now logs in to
mint a fresh session, and the assertions are guarded on the socket actually
being up.

## Message requests (BR-027, MSG-FR-009)

A stranger is **registered fresh inside the suite** rather than taken from the
fixtures — conversations are unique per user pair, so reusing an account meant
the second run found the pair already `DECLINED` by the first and reported a
correct system as broken.

| Check | Evidence |
| --- | --- |
| A stranger may send a first message | 201 |
| **The recipient's participant row is PENDING** | `conversation_participants.request_state = PENDING` |
| **It does not raise the ordinary unread badge** (BR-027) | `count 0` |
| If delivered live, it is **flagged as a request** | `isRequest=true` |
| **No ordinary push is generated** | 0 outbox rows |
| B can decline | 204 |
| **The sender is not told they were declined** | thread still reads 200, no "declined" anywhere |
| And no surface names a decline | conversation list clean |

The request state lives on the **recipient's** participant row, not on the
conversation, which is the right shape: it is B who has a decision to make, and
the sender's own row is `ACCEPTED` from the start.

## A harness mistake worth recording

`POST /conversations` takes `{ userId }` and opens the thread; the message is a
separate `POST /conversations/{id}/messages`. The first version guessed a
combined payload, got a 400, and **cascaded into eleven downstream failures,
none of which were real**. One wrong payload shape at the top of a suite can
manufacture an entire fake outage — which is why every failure here was traced
to a cause before being written down.
