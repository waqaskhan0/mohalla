# Group 9 — message requests

Baseline: `a16d25bc2de4acdf24998d87225ab17a96cdcd90`.

35 checks at real HTTP and real sockets against the running backend and
PostgreSQL. **All PASS.**

This group is mostly about what must **not** happen. A Message Request is the
product's answer to unsolicited contact, and its whole value is that the sender
learns nothing — not that they were declined, not that they were blocked, not
even that the recipient opened the thread. Every check that reads as a double
negative is deliberate.

Accept, decline and block were each tested on **their own fresh pair**. Running
them in sequence on one pair would let an earlier outcome explain a later one.

## Routing, and the two counts

| Check | Evidence |
| --- | --- |
| The pair do not follow each other | 0 follow rows — the precondition, asserted rather than assumed |
| The first message is accepted | 201 |
| **A request is absent from the main conversation list** | 0 rows in B's default list |
| And present in the Requests section as `PENDING` | `requestState PENDING` |
| **The main Messages badge does not count it** | `{"conversations":0,"requests":1}` |
| The request count is carried separately | same response, own field |

The controller states the rule outright — a request is "a separate section with
its own count" and is "never mixed into the main list" — so the **absence** from
the default list is the assertion, and presence in `section=REQUESTS` is the
other half.

## No push, and the distinction that nearly produced a false defect report

BR-027 is **"Message Requests never produce a push"**. It is not "produce no
notification". The first version of this check asserted no notification record
and failed — against entirely correct behaviour.

The pipeline's own decision, read straight out of the drain:

```
suppression: { record: true, push: false, reason: "MESSAGE_REQUEST" }
pushesSent: 0
```

| Check | Evidence |
| --- | --- |
| Nothing reaches the recipient before the pipeline runs | 0 notifications |
| The queued domain event carries `isRequest` | 1 event, `isRequest true` |
| **The drain actually runs** | claimed 6, processed 6, failed 0 |
| A request is recorded, as the notification-centre entry | 1 delivery decision, `record: true` |
| **But no push is sent, and the reason is the request itself** | `push=false reason=MESSAGE_REQUEST sent=0` |
| The recorded entry is the message category, nothing more | 1 notification, `MESSAGE` |
| **And the badge still does not count it after the pipeline ran** | `{"conversations":0,"requests":1}` |

An unprocessed queue proves nothing about a pipeline. The worker was drained and
the result inspected per recipient, which is the difference between "no push has
happened yet" and "no push will happen".

## Opening a request tells the sender nothing

| Check | Evidence |
| --- | --- |
| The sender has a live socket to be told on | connected |
| **B opening the request sends no read receipt** | 0 socket events in 2.5 s (MSG-FR-009) |
| Nor does the sender's conversation row carry a read marker | keys are `conversationId, otherUserId, requestState, unreadCount, lastMessageAt, preview, readOnly` — no `readAt`, `lastReadAt` or `seenAt` |

## Accept

| Check | Evidence |
| --- | --- |
| Accept succeeds | 204 |
| The thread moves into the main list | 1 row |
| `requestState` becomes `ACCEPTED` | |
| The recipient can now reply | 201 |
| And it counts toward the main badge | `{"conversations":1,"requests":0}` |

## Decline — the sender must not learn

| Check | Evidence |
| --- | --- |
| Decline succeeds | 204 |
| **No socket event reaches the sender** | 0 events in 2.5 s |
| **The sender's own view of the thread is byte-identical before and after** | `identical` |
| Nothing in it says declined, rejected or blocked | asserted against the serialized row |
| The sender's next message is not answered with a giveaway | 201 — the same answer as before |
| And that response names no decline | asserted against the body |
| The sender gets no notification | 0 |

The sender's row reads `requestState: ACCEPTED` both before and after the
decline. That is the uniform answer working as designed: from the sender's side
an outgoing request always looks the same, so there is nothing to compare and
nothing to infer. The assertion is that it did not **change**, which is the
property that matters.

## Block — the sender must not learn

| Check | Evidence |
| --- | --- |
| Block succeeds | 204 |
| **No socket event reaches the blocked sender** | 0 events in 2.5 s |
| The recipient's profile answers the same way a missing account does | 404 |
| And says nothing about a block | `RESOURCE_UNAVAILABLE` — "This content is no longer available." |
| Writing to the thread is refused neutrally | 404 |
| And that refusal names no block | same neutral envelope |
| The blocked sender gets no notification | 0 |

Decline and block are indistinguishable from each other and from ordinary
unavailability, at every surface checked: socket, profile read, thread write,
error body and notification.

## What this group changed in the harness

Three harness defects were fixed here, each of which had first presented as a
product problem:

- `makeUser` generated usernames over `USERNAME_MAX_LENGTH` (20), so
  `acceptrecipient` plus seven digits was refused with a 400 that looked like a
  provisioning failure. The label is now trimmed to leave room.
- The fake-provider outbox file is rewritten every 500 ms with a plain
  `writeFileSync`, so a reader can catch it mid-write. That threw
  `Unexpected end of JSON input` and read as "the provider recorded nothing",
  which is the shape of INTEGRATION-008. A torn read is now retried.
- The conversation-shape probe asserted on the wrong envelope and the wrong
  section, reporting `requestState undefined` for a request that was correctly
  filed under `section=REQUESTS`.

## Not claimed

Blocking's effects across search, feed, followers and notifications are group 11.
External push delivery is group 10 and remains `BLOCKED_EXTERNAL` while no
provider is configured. The Android Requests tab was not driven on the device in
this group; the badge and routing were proven at the API, which is where the
rule lives.
