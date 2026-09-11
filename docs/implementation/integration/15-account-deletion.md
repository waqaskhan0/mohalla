# Group 19 — account deletion, restore and erasure

Baseline: `a16d25bc2de4acdf24998d87225ab17a96cdcd90`.

37 checks at real HTTP against the running backend, PostgreSQL and the worker's
own erasure job. **All PASS.**

PRIV-007's thirty days exist so deletion is reversible until it is not, so the
two halves are tested separately: an account in its grace period must be
restorable and must *already* be gone from everyone else, and an erased account
must be gone for good while the threads other people were part of survive.

## Requesting deletion

| Check | Evidence |
| --- | --- |
| The consequences are served **before** anything happens (PRIV-006) | 200 |
| **Deletion refuses a wrong password** (SET-FR-004) | 400, account untouched |
| Deletion with the correct password succeeds | 200 |
| And returns the consequences with the response | 6 |
| The account is `PENDING_DELETION` | |
| A deletion request records it | 1 row |
| **With erasure scheduled thirty days out** (PRIV-007) | 30.00 days |

The schedule is its own record rather than a column on `users`, which is what
lets a restore be an event (`restored_at`) instead of a null.

## What the deletion does immediately

| Check | Evidence |
| --- | --- |
| **Every session is revoked, not just the one that asked** (BR-035) | 0 live; both devices 401 |
| The profile is gone from other people immediately | 404 |
| And out of search | 0 results |
| **But the post remains readable** (BR-009, PRIV-006) | 200 |

The last row is the point of the whole design: a departure must not delete the
conversation other people were having.

## The grace period, and the restore

| Check | Evidence |
| --- | --- |
| Logging in during the grace period succeeds | 200 |
| **With a `RESTORE_ONLY` session, not a full one** (SET-FR-005) | `capability RESTORE_ONLY` |
| And it cannot be used to post | 403 |
| **`POST /me/restore` restores the account, with no administrator** | 200 |
| The account is `ACTIVE` again | |
| The request is marked restored rather than deleted, so the history survives | `restored_at` set, `completed_at` null |
| The profile is visible to other people again | |
| **And the followers that existed before are still there** (SET-FR-005 AC) | 1 follower |
| A fresh login has `FULL` capability again | |

## Permanent erasure, through the worker

Run through the worker's real `handleAccountErasure` job with `dryRun: false`,
not by rewriting rows into a terminal state — the job's own due-date logic is
what is under test.

| Check | Evidence |
| --- | --- |
| The request is due, with its thirty-day grace intact | requested 2026-08-10, due 2026-09-10 |
| **The sweep ran and claimed the due account** | `{dryRun:false, accounts:1, rowsAnonymised:1, rowsDeleted:2}` |
| And reports every module that contributed | `content, graph, messaging, safety-and-notifications, identity` |
| **The account is `DELETED`** | |
| Its identifiers are erased | 0 |
| And the profile with them | 0 |
| **The retained post is still readable after erasure** (BR-009) | 200 |
| **Attributed to a deleted user, not a live account** | `userId 00000000-…-0001`, `displayName profile.deletedUser` |
| **Their comment stays in somebody else's thread** | present |
| Attributed the same way, so the thread still reads | same sentinel |

### Moving the clock without breaking the schema

The schedule cannot simply be backdated: `CHECK (scheduled_erasure_at >
requested_at)` — `deletion_requests_grace_is_forward`, the same constraint
INTEGRATION-003 was about. Both timestamps move instead, putting the request
thirty-one days in the past and its due date one minute in the past, which
keeps the thirty-day grace intact and is what a genuinely due account looks
like.

### EDGE-029 — the number is not freed, and that is deliberate

| Check | Evidence |
| --- | --- |
| Re-registering gets the same uniform acknowledgement as every other case (SEC-006) | 202 |
| **But no new account is created — the hash stays reserved** | 0 identifier rows |
| And the refusal is silent, so the number cannot be probed for an erased account | the same 202 |

My first version asserted the opposite — that erasure releases the number for
reuse — and failed. `register.service.ts` says why:

> `EDGE-029`: held by an account that was erased. The hash outlives the account
> precisely so this check can be made.

The row in `user_identifiers` is gone, which *is* the erasure. A reservation on
the **hash** remains, which is the protection: freeing the number would let
whoever is assigned it next inherit a departed person's history in every thread
that still mentions them.

I confirmed this was not a bug before accepting it, with an isolated probe —
create, delete, force due, erase, re-register — which showed `202` and zero
identifier rows while a brand-new number created one immediately.

## INTEGRATION-005 is now closed — all six screens

The last two were fixed here and verified on the device:

| Screen | Group | Evidence |
| --- | --- | --- |
| Home feed | 4 | `GET /feed/discover` fired |
| Events | 7 | 15 → 16 requests |
| Inbox | 8 | 3 → 4 |
| Notifications | 10 | 13 → 14 |
| **User lists** | 19 | followers 4 → 5 |
| **Saved posts** | 19 | 2 → 3 |

The saved-posts gesture first reported NO against an **empty** list:
`PullToRefreshBox` needs a scrollable child, and an empty-state column is not
one. Saving three posts and retrying fired the request — so the check was
measuring the empty branch, not the fix.

## Not claimed

The deletion flow was driven at the API as the app's own client makes it, not
tapped through the device's settings screens in this group; the pull-to-refresh
gestures above were driven on the device. A `Deleted User` rendering was
verified in the API payload the app parses, not screenshotted.
