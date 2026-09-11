# Groups 13 and 14 — admin restore and delete, back to the product

Baseline: `a16d25bc2de4acdf24998d87225ab17a96cdcd90`.

33 checks at real HTTP against the running backend and PostgreSQL. **All PASS.**

Each decision is driven on **its own** auto-hidden case, built the way a real
one arrives: a fresh author, a fresh post, three fresh distinct reporters
crossing the BR-044 threshold. Every request below is the one the portal makes,
with an administrator session, through the same admin endpoints.

The Admin **rendered** queue and case detail were recorded here as
`BLOCKED_LOCAL` when this group ran. That marker is withdrawn: INTEGRATION-012
turned out to be my own measurement error, and the rendered surface has since
been verified — the queue at 250,673 bytes with 20 Review links, and a case
detail at 131,862 bytes carrying Restore, Delete, No action, the reason field
and REPORTED BY.

## Group 13 — restore

| Check | Evidence |
| --- | --- |
| **A restore without a reason is refused** | 400 |
| Restore with a reason succeeds | 200 |
| **The post is visible again** | `VISIBLE` |
| The case is resolved | `RESOLVED_RESTORED` |
| With the reason the administrator gave | recorded verbatim |
| Attributed to the administrator who decided it | `resolved_by_admin_id` matches |
| **The case has left the queue** | absent from every page |
| An ordinary reader can see it again | 200 |
| And it is no longer marked under review | `underReview false` |
| The author sees it as ordinary content too | `underReview false` |

The mandatory reason is asserted first, because a decision without one is an
audit entry nobody can review.

### The report reset, and an assertion I had backwards

`13-moderation-audit.md` is explicit: **"Restore | Visible again; report count
resets to zero so the same reporters cannot immediately re-hide it
(ADMIN-FR-003)"**.

My first version asserted the opposite — that the reports were *retained as a
record* — and failed. That was the assertion contradicting the requirement, not
a defect. The record of the decision lives in the append-only audit log; the
reports are cleared precisely so a coordinated group cannot put restored
content straight back down. **RSK-010** names that risk: *"coordinated
reporting silences legitimate criticism; a system that leans toward removal
makes that risk worse."*

| Check | Evidence |
| --- | --- |
| **The report count resets to zero** (ADMIN-FR-003, RSK-010) | 0 reports, counter 0 |
| **And the reset is real, not cosmetic** — one report does not put it back down | still `VISIBLE` after a fresh report |

The second check is the one that matters. A counter reset with the rows left
behind would still be one report from the threshold.

## Group 14 — delete

| Check | Evidence |
| --- | --- |
| **A delete without a reason is refused** | 400 |
| Delete with a reason succeeds | 200 |
| The post is `ADMIN_REMOVED` | |
| **And the row survives, body intact** | so the decision stays reviewable |
| The case is resolved | `RESOLVED_DELETED` |
| With the reason recorded | verbatim |
| A reader gets the neutral refusal | 404 |
| **And so does the author** — an admin removal is not appealable in place | 404 |
| **No stale feed result after a refresh** | absent from Discover |
| And gone from the author's own post list | absent |

The author/reader symmetry is the difference between an admin removal and an
auto-hide: BR-032 lets an author see their *auto-hidden* post so they can appeal
it, and a removal is a decision already taken.

### EDGE-024 — a second decision on the same case

| Check | Evidence |
| --- | --- |
| A second decision, on the version the administrator was shown, is refused | 409 `CASE_ALREADY_RESOLVED` |
| **And the first decision stands** | still `ADMIN_REMOVED` |

## The audit trail carries the whole history

Both decisions were checked against the real `audit_log`, and the trail is
better than a single entry:

```
SYSTEM | CONTENT_AUTO_HIDDEN         | POST | {caseId, severity, distinctReportCount: 3}
ADMIN  | MODERATION_RESOLVED_RESTORED| POST | {caseId, reason: "…coordinated pile-on…"}
```

| Check | Evidence |
| --- | --- |
| The auto-hide is recorded as a **SYSTEM** action, with the count that caused it | `distinctReportCount 3` |
| The decision as an **ADMIN** one, attributed to the administrator | `actor_id` matches |
| Carrying the reason and the case it resolved | both present |
| And the auto-hide is **still there beside the removal** (BR-039, append-only) | `CONTENT_AUTO_HIDDEN → MODERATION_RESOLVED_DELETED` |

So a reviewer can see that content went down on a threshold and came back — or
stayed down — on a judgement, with who and why.

### The audit check had to be fixed twice before it proved anything

First it queried a `payload` column that does not exist, swallowed the error and
reported `n/a` — a check that could not fail. Then it keyed on the case id,
while the trail is keyed on the **target** with the case in `metadata`. Only the
third version actually read the trail.

## ADMIN-FR-004's author notification: BLOCKED_EXTERNAL

`13-moderation-audit.md` requires it twice — *"mandatory reason → append-only
audit → author notified"* and *"Delete | Permanent; author notified with the
reason (ADMIN-FR-004)"*. Measured: **zero notifications** to the author after
both a restore and a delete.

This is **not** a defect found here. It is carried in the source as a
deliberate deferral:

> `TODO(EPIC-14)`: notify the target with the reason (ADMIN-FR-004/006's "the
> author is notified of the removal and the reason", and the suspension
> banner). The pipeline exists; the enforcement templates and the SAFETY-FR-008
> guideline citation wait on OD-015's content.

**OD-015** is the unpublished Terms and Community Guidelines — the same open
decision that keeps `TERMS_VERSION` empty in a release build. SAFETY-FR-008
requires the notification to cite the guideline that was breached, and a
citation cannot be written before the guideline exists.

So the checks assert the **current** state and report the gap, rather than
failing against a decision the owner has not made:

| Check | Evidence |
| --- | --- |
| The author is not yet notified of a restore — `TODO(EPIC-14)`, blocked on OD-015 | 0 notifications |
| Nor of a removal | 0 notifications |

**Consequence for INT-13 and INT-14:** the "author notification/reason" leg of
both is `BLOCKED_EXTERNAL` on an owner decision, not on engineering. Every other
leg of both flows passes. This is the first thing to revisit once OD-015 is
resolved.

## Not claimed

The Android view of a restored or removed post was verified through the API as
the app's own client would see it (200 with `underReview false`, and 404
respectively), not driven on the device in this group.
