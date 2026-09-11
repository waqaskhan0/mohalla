# Group 10 — notifications

Baseline: `a16d25bc2de4acdf24998d87225ab17a96cdcd90`.

28 checks at real HTTP against the running backend, PostgreSQL and the real
outbox drain. **All PASS.** Plus the Android notification centre on
emulator-5554.

**Every notification here was produced by a real domain action performed over
the product's own API.** Nothing was inserted into `notifications` directly: an
inserted row proves the table exists, not that the pipeline works, and the
pipeline is the whole subject.

## The chain, asserted link by link

| Link | Evidence |
| --- | --- |
| A fresh account starts empty | 0 notifications, unread count 0 |
| Four real domain actions | follow 204, like 204, comment 201, reply 201 |
| **The actions alone deliver nothing** | 0 notifications — the worker has not run |
| They are queued instead | 4 unprocessed events: `social.followed`, `engagement.liked`, `engagement.commented`, `engagement.replied` |
| **The worker runs** | claimed 4, processed 4, failed 0 |
| The centre fills from it | 3 for the reader: `COMMENT, LIKE, FOLLOW` |
| **The reply went to the actor, not the post's author** | the actor has `REPLY` |
| Every record carries a deep-link target | `FOLLOW→PROFILE`, `LIKE→POST`, `COMMENT→POST` |
| And an actor and a template key | `notification.follow`, `notification.like`, `notification.comment` |
| The LIKE target is the post that was liked | id matches |
| **And that target resolves for the reader** | `GET /posts/{id}` 200 — the deep link opens |

The "actions alone deliver nothing" check is the one that makes the rest mean
something. It proves the worker is the mechanism rather than a database trigger,
and that the queue is real: had a notification appeared before the drain, the
drain's later success would have proven nothing.

The reply is addressed to the **actor** rather than the post's author, which is
the right answer and not the obvious one — a pipeline that always notified the
post owner would pass a simpler test and be wrong.

## Read and unread

| Check | Evidence |
| --- | --- |
| The unread count matches the unread rows | 3 and 3 |
| Every row starts unread | `read_at` null |
| Marking one read succeeds | 200 |
| **The count drops by exactly one** | 3 → 2 |
| Read-all succeeds | 200 |
| **And the count reaches zero** | 0 |
| The notifications are still there, just read | 3 and 3 |

## The Android notification centre

Three real domain actions were performed against the device's own account by a
fresh actor, and the worker was drained.

| Level | Evidence |
| --- | --- |
| API / database | drain claimed 3, processed 3, failed 0 |
| Consuming UI — badge | the home bell reads **"Notifications, 4 unread"** |
| Consuming UI — centre | four rows: *"DevActor … commented on your post, Just now, Unread"*, *"… liked your post …"*, *"… started following you …"*, and the earlier follow from the Group 7 fixture |
| **Deep link** | tapping the like row fired `POST /notifications/read` then `GET /posts/{id}` and opened **that** post — the media post, with its attached image |
| Read state | all four `read_at` set, `unread remaining: 0`, and the bell drops back to plain "Notifications" |

The centre renders actor, action, relative time and unread state, and the
deep link resolves to the specific post rather than to a list.

## INTEGRATION-005, fourth of six

`NotificationsScreen` had the same gap, and here it was the sharpest: the screen
takes `onRetry`, which is the same call as refresh, but it is only reachable
from the **failure** branch. A reader whose centre had loaded once had no way to
ask again — on the one screen whose entire purpose is to tell them something
happened.

Verified on the device: a drag took `GET /notifications` from 13 requests to 14.
Two screens remain (saved posts, user lists).

## NOTIFICATION PIPELINE: PASS · EXTERNAL PUSH: BLOCKED_EXTERNAL

Reported separately, as required.

The pipeline's push decision is proven, per recipient, from the drain's own
output:

```
suppression: { record: true, push: false, reason: "NO_DEVICE" }
pushesSent: 0
```

| Check | Evidence |
| --- | --- |
| The pipeline reports why each push was suppressed | reason present on every decision |
| The reason is the absence of a device, not something else | `NO_DEVICE` |
| Nothing was actually sent anywhere | 0 pushes |

**EXTERNAL PUSH: BLOCKED_EXTERNAL.** No real provider is configured (DEP-002),
and the fake sender records what would have been sent and delivers nothing. The
pipeline's decision is proven; delivery to a handset is not, and is not claimed.
Group 9 separately proved the other suppression reason — `MESSAGE_REQUEST` —
which is the one that carries a requirement (BR-027) rather than a
configuration.

## A harness correction

The reply action first returned 400: a reply is `POST /comments/{id}/replies`,
not a `parentCommentId` field on the comment route. That single wrong call
cascaded into two further failures — a missing outbox event and a missing REPLY
notification — neither of which had anything to do with replies. Worth recording
because a cascade like that is exactly how a harness bug gets written up as
three product defects.

## Not claimed

Moderation-result, announcement and event-reminder notifications are produced by
groups 12–18 and are asserted there, where the domain action that causes them is
performed. Notification preferences were not exercised. External push remains
blocked.
