# Group 4 — feed, posts and engagement

Baseline: `a16d25bc2de4acdf24998d87225ab17a96cdcd90`.

Driven on emulator-5554 against the local API, PostgreSQL 18.6 and the local
worker. Synthetic fixtures only.

## What was executed

| Flow | Evidence | Result |
| --- | --- | --- |
| Featured rail | `GET /feed/featured` 200; the five announcements the API returns are the five the app renders, in order | PASS |
| Discover, reverse chronological | UI order matches `GET /feed/discover` item order exactly, newest first | PASS |
| Following, empty state | Follows nobody, so the empty invitation renders — not an error, and Featured still renders above it (FEED-FR-002) | PASS |
| Category filter | `GET /categories` 200; eleven options in the sheet | PASS |
| Pagination | Scrolling fired two further `GET /feed/discover` requests, three pages in total, prefetched before the last item | PASS |
| **Pull to refresh** | Was missing entirely. Fixed; a slow drag on a populated feed now fires `GET /feed/discover` | FIXED — INTEGRATION-005 |
| Create post | Composer → category `Water & Sanitation` → Post → `POST /posts` 201; row in `posts` with the right body, author and `category_id`; visible in Discover and on the profile | PASS |
| Post detail | Author, `2026-09-10 · water-sanitation`, body, counts, save/delete/share, comment composer | PASS |
| Like | UI "Remove like" and 1; `likes` has exactly one row; `posts.like_count` 1 | PASS |
| Comment | `1 comment`; `comments` row with `visibility_state VISIBLE`; `posts.comment_count` 1 | PASS |
| Reply, one level | Nested under its parent in the UI; row carries `parent_comment_id`; `posts.comment_count` 2 | PASS |
| **Optimistic like reconciles with server truth** | Was broken on the detail and profile screens. Fixed | FIXED — INTEGRATION-006 |

Verification badges are not claimed here — no verified organization exists yet,
and granting one is group 17. Blocked, hidden and banned filtering is group 11.
Neither is asserted from a code reading.

## INTEGRATION-005 — FEED-FR-005 had everything except the gesture

`FeedViewModel.refresh()` existed, `FeedUiState.refreshing` was maintained
correctly, `FeedStateTest` covered both, and the traceability matrix recorded
FEED-FR-005 as a Must requirement, `IMPLEMENTED`. Nothing in any screen ever
called `onRefresh` except the failed-first-page retry button, so a reader
looking at a populated feed had no way to ask for new posts at all.

Found by posting from the app and watching the feed not change. The unit suite
could not see it: the half that was missing is the half it does not touch.

`HomeScreen` now wraps the feed branch in a `PullToRefreshBox`. It wraps the
whole branch rather than only the list, so an empty Discover feed can be pulled
too — "nothing nearby yet" is exactly the state a reader wants to retry, and it
is the one the retry button does not cover because it is not a failure.

**The same gap exists on five other screens** — events, inbox, notifications,
saved posts and user lists all compute `refreshing` and no screen renders it.
Each is fixed in the group that runs it, so that each fix is verified at the
moment it is made rather than claimed from a pattern match. Recorded in the
defect register so none is lost.

### Mutation proof

`FeedPullToRefreshTest` drives the real `HomeScreen` on a device with a
populated feed and asserts a drag reaches `onRefresh`.

| Code | Result |
| --- | --- |
| Pre-fix `HomeScreen` restored | FAIL — `expected:<1> but was:<0>` |
| Fix restored | PASS |

The first version of the test swiped from the root's top edge, which starts on
the top bar, outside the scrollable — it failed against the *fixed* code too,
which would have made it worthless. It now drags from the list's centre, slowly:
a 200 ms flick is a fling, and a pull is a drag.

## INTEGRATION-006 — a post you had liked showed an empty heart

`GET /posts/{id}` and `GET /users/{id}/posts` did not return `viewerHasLiked`.
Every feed endpoint does. The Android field defaults to `false`, so an omitted
key was not a parse error anywhere — only a wrong picture.

Measured end to end:

1. Liked the post from the feed. UI: "Remove like", 1. Database: one `likes`
   row.
2. Opened the same post at its own screen. UI: **"Like"**, 1.
3. Tapped it. UI optimistically moved to **"Remove like", 2**.
4. Database: still exactly **one** `likes` row. `GET /posts/{id}`: `likeCount 1`.
5. **Nothing reconciled.** The client had no reason to think anything had gone
   wrong, so the wrong count simply stood.

Reachable from a deep link, a notification, search, the profile post list, and a
tap in the feed.

### The fix, and why it is a port

`posts` had no way to ask. `engagement` already imports `posts` — every like and
comment checks the post's own visibility first — so `posts` importing
`engagement` back is a cycle, and this repository does not resolve cycles with
`forwardRef`: `follow-removal.port.ts` sets the precedent of inverting the
lighter edge instead. So `posts/ports/viewer-likes.port.ts` declares what it
needs, `engagement/adapters/viewer-likes.adapter.ts` supplies it from the same
`likedPostIds` the feed uses, and `PostsModule` binds the adapter directly —
`PgEngagementRepository` depends only on the global `DatabaseService`, so
binding it creates no import edge back. `likes` keeps one owner.

`npm run guard:deps` passes: 18 modules, dependency direction clean.

### Mutation proof

The smoke test already fetched `/posts/{id}` after liking and already checked
its count. It never checked the field — which is exactly how this shipped. Two
assertions were added at that existing fetch, one for each direction, because
`false` is also what a missing field produces and a `true`-only assertion would
pass against a hard-coded value.

| Code | `AND THE VIEWER LIKE STATE COMES WITH IT` |
| --- | --- |
| `viewerHasLiked: false` hard-coded, the field exactly as it was | FAIL — `viewerHasLiked false` |
| Fix restored | PASS — `viewerHasLiked true` |

API smoke: **415 passed, 0 failed** with the fix; **414 passed, 1 failed** with
the defect restored. Neither mutation was committed.

### Consuming UI after the fix

The post detail screen renders "Remove like" and 1, and the profile post list
does too — both previously showed an empty heart. API unit tests: 911 passed.

## An adjacent gap, measured but not claimed

`/posts/{id}` renders stored counts directly, while the feed passes them through
`EngagementService.adjustedCounts`, which subtracts likes and comments from
people the viewer has blocked (ENGAGE-FR-006). The same post may therefore
report different counts in a feed and on its own screen once a block is
involved. This was noticed while fixing INTEGRATION-006 and is **not** asserted
here, because no block has been exercised yet — group 11 is where a block is
created, and it is the honest place to measure it. Recorded in the defect
register as an open question rather than a defect.
