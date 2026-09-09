# 13 — Account states and deletion

**Stage 7 · Android** · §48 module record

> Redistributed from the canonical records rather than written afresh: the screen rows come from [`17-mobile-screen-coverage.md`](17-mobile-screen-coverage.md), the requirement rows from [`18-mobile-requirement-traceability.md`](18-mobile-requirement-traceability.md), the runtime results from [`19-mobile-test-report.md`](19-mobile-test-report.md) and the open items from [`20-mobile-open-issues.md`](20-mobile-open-issues.md). Where a fact is absent it says **NOT YET VERIFIED** rather than guessing.

> Requirements are `SET-FR-004/005` and `BR-008/009`; the suspension surface `UX-SAFE-004` is in [`12-safety-blocking.md`](12-safety-blocking.md).

---

## Screens

| Screen | Name | Requirements | APIs | LTR | RTL | Loading | Empty | Error | Offline | A11y | Tests | Runtime | Status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| UX-SET-009 | Delete account | SET-FR-004 · PRIV-006 · BR-008/009 | `/me/deletion-consequences` · `DELETE /me` | ✅ | ✅ | ✅ | — | ✅ | ✅ | ✅ | ✅ | — | ✅ |
| UX-AUTH-012 | Restore account | SET-FR-005 · EDGE-003 | `POST /me/restore` | ✅ | ✅ | ✅ | — | ✅ | ✅ | ✅ | ✅ | — | ✅ |

**Runtime.** **NOT EXECUTED**: `UX-SET-009`, `UX-AUTH-012`.

## Requirements

See the cross-reference above — this module’s requirements are recorded with the family that owns them, so they are not duplicated here (§24).

## What this module decided, and why

|---|---|---|---|---|---|---|---|---|---|---|---|---|---|

**The other account states were already built and are listed where they were
made**: UX-AUTH-012's restore offer in group 03, the suspension banner and the
read-only capability in group 05–06, and UX-SAFE-004's explainer in group 17.
What this group adds to them is the one thing the restore screen was missing.

### The counts in this file had drifted, and are now derived from the table

The progress figures above were being carried forward by hand from group to
group and had fallen out of step with the rows they summarise. Counted from the
table itself, the position before this group was **50 done · 8 partial · 3 not
started**, not the 52 · 3 · 6 previously reported. Two things caused it: the four
`UX-STATE-*` rows were still `◐` in the table although group 08's prose recorded
them as complete, and the running totals were adjusted by the number of screens
each group added rather than recounted.

Both are fixed. The `UX-STATE-*` rows now say what the prose has said since group
08, and these counts are read off the table rather than carried.

### What deletion decided, and why it is written down

**PRIV-006 is a claim about what the user was TOLD, so nothing is confirmable
until the consequences are on screen.** Users "MUST BE TOLD THIS CLEARLY BEFORE
CONFIRMING, because it differs from the erasure many will assume". A screen that
accepted a password while the list was still failing to load would be making that
claim falsely — so the control is disabled rather than the list being treated as
optional detail.

**What differs is BR-009, and it is the surprise this screen exists for.** Posts
and comments STAY, attributed to "Deleted User", because other people replied to
them. The server puts that line **second** in the list — "where it is read,
rather than last where it is skipped" — and the client renders the list in the
order it arrives, never sorted and never filtered. Reordering it would undo a
decision the requirement made about what gets read.

**The consequences are localisation KEYS, not sentences.** That is what makes
"readable in the user's chosen language" true without the server carrying two
copies of six paragraphs, and it means the client cannot quietly reword what
deletion does. The mapping is a `when` over the six keys the contract defines.

**A seventh key would not be silently dropped.** Quietly omitting a consequence
is precisely the failure PRIV-006 exists to prevent, so an untranslatable key
still counts and the screen says the list is incomplete and asks the reader to
update. Deletion is still allowed: refusing it would trap somebody in the product
over an app version, which BR-008's reasoning rules out as firmly as it rules out
trapping a suspended account.

**Cancel is the primary button and sits ABOVE Delete.** §6.7 for a Tier-3 action,
verbatim: "Primary — Cancel, deliberately NOT delete", and "the destructive
control is not pre-focused and sits BELOW cancel". A thumb reaching for the
bottom of a long scrolling screen finds Cancel.

**The password is re-entered, and a wrong one is not a sign-out.** "The phone is
already unlocked and in somebody's hand — a friend, a relative, a partner." The
server returns 400 rather than 401 deliberately, "because a 401 would sign a
confused user out of an account they were trying not to lose", and the client
treats it the same way: the consequences stay on screen and a retry is one field.

**There is no capability check on this screen and there must not be one.**
BR-008 allows deletion in every state except already-deleted, including while
suspended: "an account that cannot leave while it is being punished is a
hostage."

**The restore offer now says by when.** SET-FR-005 gives exactly 30 days, and the
consequences endpoint has carried `scheduledErasureAt` for the restore screen
since Stage 6 — "which is how the restore offer can say how long is left rather
than just that something is pending" — and nothing called it. Somebody who
deleted at 2am and is deciding at breakfast whether to deal with this now or
later needs the date, not a reassurance. A failed read is silent: the offer
stands either way, and a screen that refused to load over a missing date would
strand somebody inside a grace period that is running out.

## Commits

- `2fcb3de MOBILE: a refusal that renders nothing is worse than a wrong one`
- `8ac47a9 Stage 7 groups 18-19 (Account state and deletion): a list that must be read before anything can be confirmed, and a coverage count that had drifted`
- `0a3bf1b MOBILE: the remaining auth screens — register steps, password reset, restore`

