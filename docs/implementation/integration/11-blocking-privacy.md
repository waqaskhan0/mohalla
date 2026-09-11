# Group 11 — blocking and privacy

Baseline: `a16d25bc2de4acdf24998d87225ab17a96cdcd90`.

23 checks at real HTTP against the running backend and PostgreSQL. **All PASS,
after two defects were found and fixed.**

## What was already covered, and is not repeated

The release gate's TEST-A proves the half that matters most, and still does:
eleven surfaces answer a blocked person with **one identical neutral refusal**,
exact-username search finds nothing, the Discover feed carries none of the
blocked person's content, and no surface answers in a conspicuously different
time. That is the non-disclosure requirement (BR-025, SEC-019, PRIV-013).

This group covers the other side of the same block, which nothing covered: what
the **blocker** sees, what happens to engagement and notifications already
earned, and what the unblock does and does not restore.

## The blocker's own view

| Check | Evidence |
| --- | --- |
| BR-024: both follows are gone, in one transaction with the block | 2 rows → 0 |
| The blocker cannot open the blocked profile either | 404 |
| Nor find them by exact username | 0 results |
| Nor see their content in Discover | absent |
| Nor reach their post by direct id | 404 |
| **But they do appear on the blocker's own blocked-users screen** | listed in `/me/blocks` |

A block is symmetric in effect: the blocker loses sight of the blocked person
everywhere except the one screen that exists to undo it.

## The unblock

| Check | Evidence |
| --- | --- |
| Unblock succeeds | 204 |
| **Visibility returns** — the profile opens again | 200 |
| Their post is reachable again | 200 |
| They are findable again | 1 result |
| And they leave the blocked-users screen | absent |
| **But the follow relationship does not automatically restore** | 0 follow rows |
| So their posts do not reappear in the Following feed | absent |
| Following again is possible, as a deliberate act | 204 |

The last three are the point. An unblock restores *visibility*, not
*relationship* — re-establishing a follow somebody chose to destroy would be the
system deciding something the user did not.

## INTEGRATION-010 — the same post reported different counts on different screens

This is the question Group 4 deliberately deferred, because measuring it needed
a block and Group 4 had none.

Measured with one block in place, one like and one comment from the blocked
person:

```
feed:         likes 0  comments 0     ← correct
post detail:  likes 1  comments 1     ← wrong
profile list: likes 1  comments 1     ← wrong
stored:       likes 1  comments 1
```

`07-database-design.md` lists the read paths the block predicate is applied on
and names **post detail** among them: *"feeds, search, profile, post detail,
comments, messaging, notifications and events (SEC-019, BR-025)"*. The feed did
it, through `EngagementService.adjustedCounts`. A post's own screen and a
profile's post list rendered the stored counters straight.

Two things were wrong at once. The reader was shown engagement from somebody
they had blocked, as a number — and the comment **thread** was already
filtered, so the screen contradicted itself: **"1 comment" above an empty
thread**.

**The fix.** `adjustedCounts` was a private method on `EngagementService`; the
arithmetic moved to `engagement/domain/adjusted-counts.ts` so both callers use
one implementation. Copying it into the adapter would have reproduced exactly
the drift that caused the defect. The `ViewerLikes` port grew `adjustedFor`,
delivered by the same adapter and the same two repository lookups the feed uses,
and `PostService.render` now takes the per-viewer projection instead of a bare
`viewerHasLiked` flag.

The stored counters are deliberately untouched — they remain the platform-wide
truth moderation and ranking read. After the fix: detail 0/0, stored 1/1.

## INTEGRATION-011 — a block did not reach the notification centre

Measured: **3 of 3** notifications the blocked person had caused were still
listed to the blocker after the block.

`domain/eligibility.ts` states the requirement without ambiguity — *"a blocked
user's like must not appear in the centre either; BR-025 says neither party sees
the other's activity, and a notification centre is a surface like any other"* —
and eligibility rule 2 does suppress the record at write time. That covers
everything **after** a block and nothing **before** it. So blocking somebody
left them in front of the person who blocked them.

**The fix, and the tier problem it had to solve.** The block predicate is
`safety`'s, which is PRODUCT tier; `notifications` is PLATFORM, and
`06-backend-modules.md` §3 forbids the upward import. The module already
documents the answer for exactly this case: `OutboxDrainService` is composed at
the application root because it needs the same predicate. So
`NotificationController` moved there too — it is the piece that needs both — and
`NotificationService` stays free of the dependency, taking the exclusion set as
an argument.

`BlockCheck` gained `blockCounterparts(userId)`: the set of everyone with a
block either way, rather than a predicate per pair. A page of twenty
notifications would otherwise be twenty round trips, which is the per-row call
`visibility-policy.ts` warns about. The exclusion is applied in SQL so a page
emptied by blocks still pages correctly instead of returning short, and
`actor_id IS NULL` survives it — a system notification has no actor to be
blocked and must not vanish.

The unread count takes the same exclusion. A badge counting rows the centre will
not show is a badge that never clears: the reader taps it, sees nothing new, and
the number stays.

`npm run guard:deps` passes: 18 modules, dependency direction clean.

## Mutation proof

Both regressions were added to the API smoke test, which runs in CI, and both
were proven against the exact original defects:

| Mutation | Result |
| --- | --- |
| Post read paths render `post.likeCount` / `post.commentCount` again | FAIL — `detail 1, stored 1` on both counts |
| The centre passes an empty exclusion set again | FAIL — `2 of 2 notifications name them`, `badge 0 vs 2 listed` |
| Both fixes restored | PASS — 422 passed, 0 failed |

With the defects restored: 417 passed, 5 failed. Neither mutation was committed.

### The regression had to be rewritten before it proved anything

The first version created the post and engaged with it **after** the block. But
once a block exists the blocked person cannot like or comment at all, so the
stored counter was zero and `detail 0` was trivially correct — it passed against
the defect. The check now engages **before** the block, and asserts the stored
counters are still `1/1` while the viewer sees `0/0`, so it cannot pass either
by the adjustment working or by there being nothing to adjust.

The notification half had the same flaw: it reported "0 of 0", which is vacuous.
It now drains the outbox first and asserts the notifications **existed** before
the block.

## One consequence worth stating: the OpenAPI snapshot reordered

Moving `NotificationController` to the root module changed where Nest discovers
it, so the generated document serialises the `/notifications` paths first. The
drift gate caught it, correctly.

The document is otherwise unchanged, and that was checked rather than assumed:
**88 paths before and after, 37 request schemas before and after, none added,
none removed, none altered** — and both `paths` and `components.schemas` compare
byte-identical once key order is normalised. The regenerated snapshot is
committed on that basis.

## Not claimed

The Android blocked-users management screen was not driven on the device; the
`/me/blocks` contract it renders was proven at the API. Blocking's interaction
with moderation is groups 12–14.
