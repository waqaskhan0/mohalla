# 09 — Messaging and message requests

**Stage 7 · Android** · §48 module record

> Redistributed from the canonical records rather than written afresh: the screen rows come from [`17-mobile-screen-coverage.md`](17-mobile-screen-coverage.md), the requirement rows from [`18-mobile-requirement-traceability.md`](18-mobile-requirement-traceability.md), the runtime results from [`19-mobile-test-report.md`](19-mobile-test-report.md) and the open items from [`20-mobile-open-issues.md`](20-mobile-open-issues.md). Where a fact is absent it says **NOT YET VERIFIED** rather than guessing.

---

## Screens

| Screen | Name | Requirements | APIs | LTR | RTL | Loading | Empty | Error | Offline | A11y | Tests | Runtime | Status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| UX-MSG-001 | Inbox | MSG-FR-003 · BR-024 | `GET /conversations` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ |
| UX-MSG-002 | Requests | MSG-FR-005 · BR-027 | `/conversations?section=REQUESTS` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ |
| UX-MSG-003 | Conversation | MSG-FR-002/004/006/008/009 · EDGE-020/021/022 | `/conversations/:id/messages` · `/messages/since` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ |
| UX-MSG-004 | Request review | MSG-FR-005 · BR-028 | `/conversations/:id/accept` · `/decline` | ✅ | ✅ | — | — | ✅ | ✅ | ✅ | ✅ | — | ✅ |

**Runtime.** **NOT EXECUTED**: `UX-MSG-001`, `UX-MSG-002`, `UX-MSG-003`, `UX-MSG-004`.

## Requirements

| Req | Title | Pri | API | ViewModel / use case | Test | Status |
|---|---|---|---|---|---|---|
| MSG-FR-001 | Start a conversation | Must | `POST /conversations` | ProfileViewModel | ProfileTest | `IMPLEMENTED` |
| MSG-FR-002 | Send a text message | Must | `POST /conversations/{id}/messages` | ConversationViewModel | MessagingTest | `IMPLEMENTED` |
| MSG-FR-003 | Conversation inbox | Must | `GET /conversations` · `GET /conversations/unread` · `GET /conversations/{id}/messages` | InboxViewModel | MessagingTest | `IMPLEMENTED` |
| MSG-FR-004 | Near-real-time delivery | Must | `GET /conversations/{id}/messages/since` | ConversationViewModel | MessagingTest | `PARTIAL` |
| MSG-FR-005 | Message Requests from Non-Followers | Must | `POST /conversations/{id}/accept` · `POST /conversations/{id}/decline` | InboxViewModel | MessagingTest | `IMPLEMENTED` |
| MSG-FR-006 | Block enforcement in messaging | Must | — | ConversationViewModel | MessagingTest | `IMPLEMENTED` |
| MSG-FR-007 | Report a conversation | Must | `POST /reports` | ReportViewModel | SafetyTest | `IMPLEMENTED` |
| MSG-FR-008 | Send an image in a message | Could | — | ConversationViewModel | MessagingTest | `PARTIAL` |
| MSG-FR-009 | Read receipts | Could | `GET /conversations/{id}/messages` · `POST /conversations/{id}/read` | ConversationViewModel | MessagingTest | `PARTIAL` |

- **MSG-FR-004** — A two-second poll of `/messages/since`, not the socket. Stage 6 does serve a Socket.IO gateway; the API rule is that "REST is the source of truth; realtime is an accelerator" and it names this route as the polling path. Recorded as GAP-M-008.
- **MSG-FR-008** — An image sends in a conversation; the same media gate applies to anything that is not an image.
- **MSG-FR-009** — Read receipts are sent and shown. A Could, and complete for text.

## What this module decided, and why

|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| — | Message bubble (component) | §18 · MSG-FR-002/008 | — | ✅ | ✅ | ✅ | — | ✅ | — | ✅ |

UX-MSG-004 is a decision offered inside the conversation and the request row
rather than a screen of its own: replying **is** accepting, so a reader who must
first visit a separate screen to accept has already been asked to read the
message before deciding whether to receive it.

### What messaging decided, and why it is written down

**Delivery is by polling, not by a socket, and that is a recorded choice.**
MSG-FR-004 asks for delivery "within 3 seconds without manual refresh". The API
is explicit that "REST is the source of truth; realtime is an accelerator… every
route has to work with the socket switched off", and names
`GET /conversations/:id/messages/since` as the polling fallback ADR-009
sanctions; the SRS's own risk note says "polling is an acceptable fallback at
this scale". So the conversation polls that route every **two** seconds — inside
the requirement, with headroom for the request itself on 3G. A socket would add
a dependency, an auth handshake, a reconnection and backoff policy and a
lifecycle to get wrong, for a latency improvement below the threshold the
requirement sets. It is listed as **GAP-M-008** rather than presented as
finished.

**The poll is bounded to the open, foregrounded conversation.** Tied to
`ON_RESUME`/`ON_PAUSE` through a `DisposableEffect`, because composition survives
the app going to the background and a poll that kept running there would spend
data on a screen nobody is looking at. NFR-PERF-001 budgets for Pakistani mobile
data; one small request every two seconds is not free, and a phone in a pocket
now makes none.

**The client message id is the identity of a message, and the server id is a
field that arrives later.** A message the reader has just sent exists on the
device before the server knows about it and needs a stable identity from that
instant — for a list key, for a retry to find it, and for the server's eventual
copy to be recognised as the *same* message. That inversion is what makes
MSG-FR-002's criterion hold: minted once at compose time and reused on every
attempt, so "a message that fails and is retried twice… exactly one message is
delivered". The test asserts the ids **sent**, not the list rendered — asserting
the list would pass on a client that sent three distinct messages and displayed
only the last.

**A failed message is marked, never removed.** Somebody who typed three
sentences on a bus must not lose them to a tunnel, and the retry carries the body
so they do not retype it.

**Ownership is decided by the sender, and that was a defect first.** `isMine`
was derived from the presence of a client id, which answers "did *this install*
compose it" — a different question. The server echoes a client id to **both**
participants, and a message the reader sent from another device carries none at
all, so the derived answer was wrong in both directions: the reader's own message
rendered on the wrong side of the screen, and a received message carrying a
`readAt` rendered as theirs with a read receipt against it. It is now one
comparison of sender to viewer, stored on the message, and a `readAt` arriving on
a message the reader *received* is dropped rather than displayed — this device
has no business reporting on the reader to the reader.

**Requests are a separate query, never one list filtered.** BR-027 and
MSG-FR-003 make them a separate section with its own count; filtering locally
would show a request in the main inbox for as long as a page took to load, which
on a slow connection is exactly long enough for the thing the requirement exists
to prevent. The SRS calls this "the platform's principal defence against
unsolicited contact" and notes it "matters most for women users".

**The request count never reaches the bottom bar.** §14: requests "are counted
separately inside the screen and never contribute to this badge — a stranger must
not be able to make the user's navigation demand attention." Two counts, two
fields, and the shell reads only the first.

**Declining tells the sender nothing, and there is nothing in the decline path
that could.** BR-028: "informing them invites retaliation." One 204 and no
confirmation dialog — a dialog would imply a consequence that does not exist. The
thread is suppressed rather than deleted, so later messages from that sender land
in it instead of raising a new request, and stay available if the reader reports
or changes their mind.

**A block is refused with the same neutral 404 as everything else, and the client
does not try to tell them apart.** MSG-FR-006 requires a send after a block to be
"refused without disclosing the block"; the only reliable way not to disclose it
is for the refusal to be indistinguishable. EDGE-022's read-only conversation is
the one refusal that *does* explain itself, because it is about the conversation
rather than the other person's account — the compose box closes and the thread is
marked, where a neutral refusal would make a thread the reader can still scroll
look like one that vanished.

**Message images are fetched from `conversations/media/{id}` and never
`media/{id}`.** MSG-FR-008: the general media route refuses `RESTRICTED` objects
outright, so a message image would 404 on the person it was sent to.

**Three pagination shapes appear in this one module** — the inbox pages by a
`before` **timestamp**, the history by a `(createdAt, id)` **keyset**, and the
reconcile takes a **timestamp** and returns oldest-first. Using the wrong one
pages away from the data rather than through it.

**A wire-shape defect the compiler could not see.** `MessagesResponse.nextCursor`
was typed as the events list's cursor. Three keyset routes spell the same idea
three different ways: the feed and comment thread return `{createdAt, id}`, the
events list `{cursorStartsAt, cursorId}`, and message history
`{cursorCreatedAt, cursorId}`. The borrowed type has no default for its field, so
the first read *past* the newest thirty messages of a thread would have thrown
`MissingFieldException` — on long conversations only, which is precisely where
the reader needs it. It now has its own type, and a shape test says why.

**PRIV-003 is enforced by the shape of the types, not by a screen.** "Mobile
numbers, email addresses and dates of birth are never visible to another user, in
any surface, at any time. This is the platform's single most important privacy
improvement over the WhatsApp-group status quo it replaces." Two neighbours
organise about a blocked drain without either handing over a number — so
`ConversationResponse`, `ConversationPreview`, `MessageResponse` and
`UnreadCountsResponse` are asserted against their **complete** allowed field
sets, and a field added under any name fails with the requirement quoted.

## Commits

- `564dd9c Stage 7 group 22 (Accessibility, RTL and performance): RTL was clean, contrast was not, and 55 sites were below AA`
- `cfc6e29 Stage 7 group 20 (Offline and error states): a revocation hook nothing passed, a rate limit apologising for the server, and a banner covering five destinations out of forty`
- `068c0e6 Stage 7 group 17 (Safety): one acknowledgement whatever happened, and every inert Report control made real`
- `ddacc58 Stage 7 groups 14-15 (Profiles and the social graph): the client could not send a JSON null, and two features were silently broken by it`
- `3ea1bc2 Stage 7 group 12 (Messaging): one client id that survives two retries, and two defects the wire hid`

