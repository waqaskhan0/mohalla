# Group 20 — errors, outage, recovery, concurrency and security

Baseline: `a16d25bc2de4acdf24998d87225ab17a96cdcd90`.

33 checks at real HTTP, plus a real API outage driven against the running app
and the Admin portal. **All PASS.**

Every status below is produced by a request that genuinely deserves it, not by a
stub. The point is not that the codes exist but that each is reachable through
the product and carries an envelope a client can act on.

## The taxonomy

| Case | Status | Envelope |
| --- | --- | --- |
| A body over the length limit | 400 | `VALIDATION_FAILED` — "Please check the highlighted fields." |
| No session | 401 | `AUTHENTICATION_REQUIRED` |
| A forged token | 401 | `AUTHENTICATION_REQUIRED` |
| **A user token on an admin endpoint** | **401** | `AUTHENTICATION_REQUIRED` |
| **A suspended account attempting a write** | **403** | `ACCOUNT_SUSPENDED` with the expiry |
| Content that does not exist | 404 | `RESOURCE_UNAVAILABLE` |
| Media that is not READY | 409 | `MEDIA_NOT_READY` — "One of your attachments is still processing." |
| A semantically invalid field | 400 | `VALIDATION_FAILED` |
| **A real daily limit, actually exhausted** | 429 | "You can send up to 20 reports a day." — after 21 reports |
| A session expired mid-use | 401 | `AUTHENTICATION_REQUIRED` (EDGE-010) |

Every envelope was checked for `code`, `message` and `correlationId`, and
against SEC-018 — no stack frame, SQL fragment or file path in a user-facing
message.

**401 rather than 403 for a user token on an admin endpoint** is the better
answer and worth stating: 403 means *"we know who you are and you may not"*,
which would confirm to a prober that the token is a valid user session. The
admin surface answers a user token exactly as it answers no token. My first
version asserted 403 and failed; the real 403 in this system is capability, not
identity — a suspended account refused a write, with the expiry attached.

429 was reached by exhausting a genuine daily ceiling rather than hammering
login, which would have tripped a lockout that means something else.

## A write the client never saw succeed

The ambiguous case: the request reached the server and the answer did not reach
the client, so the client retries.

| Check | Evidence |
| --- | --- |
| Every concurrent retry is answered | 201, 200, 200 |
| **Three concurrent sends with one `clientMessageId` persist exactly one message** | 1 row |
| **Six concurrent likes persist exactly one** | 1 row |
| **Four concurrent follows persist exactly one** | 1 row |

Concurrent rather than sequential, because sequential retries can be
de-duplicated by a read-then-write that a race would defeat.

## An admin mutation must not execute twice

| Check | Evidence |
| --- | --- |
| **Two simultaneous decisions on one case: one applies, one is refused** | `200, 409` (EDGE-024) |
| **And exactly one audit decision is recorded, not two** | 1 entry |

The audit assertion is the one that matters. A second decision refused at the
API but still written to the log would leave a case with two contradictory
outcomes on its record.

## Security boundaries

| Check | Evidence |
| --- | --- |
| A session reads only its own settings and conversations | 0 conversations for a fresh account |
| **A public profile carries no phone and no date of birth** (PRIV-008) | keys are `userId, username, displayName, photoMediaId, city, bio, verifiedBadge, accountType, followerCount, followingCount, postCount` |
| An admin token is refused by a user endpoint | 401 |
| And a user token by an admin endpoint | 401 |
| An administrator cannot open a conversation for a case that does not exist | 404 |

Socket boundaries — unauthenticated handshake, bogus token, and a session
revoked mid-stream — are covered by the API smoke test and were re-confirmed in
Group 8. Blocked-pair privacy across eleven surfaces is the release gate's
TEST-A.

## The outage, driven for real

The API was **stopped** with a 34-character draft in the composer.

| Check | Evidence |
| --- | --- |
| **The app does not crash** | 0 `FATAL EXCEPTION` across the whole cycle |
| **It says what happened, and says nothing was published** | *"You are offline, so nothing was published. Your text is saved."* |
| **The draft is preserved** | still `34 / 3000` |
| And guarded even against a back press | *"Discard this post? Your text and attachments will be lost."* with **Keep writing** / Discard |
| **Cached reads still work** | the feed renders Featured and posts with no API |

On the Admin side, with the API down:

| Check | Evidence |
| --- | --- |
| **No false success** | `1 passed · 1 failed · 10 blocked` — ten flows report BLOCKED rather than passing |
| **And the console is never rendered** | `/dashboard`, `/moderation`, `/audit-log` each return 200 with **zero** console strings and an error string |

Flow E ("an invalid session ends the session instead of rendering the console")
reports FAIL while the API is down, and that is the check's shape rather than a
defect: it asserts on the HTTP status, while the page correctly renders an
**error panel** at 200. With the backend unreachable the portal cannot know
whether the session is invalid, and signing somebody out because the API blipped
would be the wrong answer. With the API up, flow E passes and the suite is 12/12.

### Recovery

| Check | Evidence |
| --- | --- |
| **The Admin side recovers fully** | `12 passed · 0 failed · 0 blocked` |
| **The app recovers without a restart** | a pull fired `GET /feed/following` and `GET /feed/featured`, both 200 |
| Zero crashes across the entire outage and recovery | 0 |

Neither client needed to be restarted or signed in again.

## A bonus piece of INT-18 evidence

While navigating during recovery, the app opened the announcement published in
Group 18 — **"Water main works 193575 — The supply will be interrupted between
9am and noon on Friday."** — from its own Featured rail, on the device. Group 18
proved the publication and both locale variants at the API; this is the same
announcement rendered in the app.

## Not claimed

A forced 500 was not manufactured: every 5xx path available would have required
breaking the database or stubbing a fault, and neither is a real request the
product can make. The taxonomy above covers every status the product actually
produces. Timeout behaviour is exercised by the outage rather than by a
throttled connection.
