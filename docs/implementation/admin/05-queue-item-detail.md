# 05 — Queue Item Detail and the Three Peer Outcomes

**Stage 8 · Group 06** · UX-ADM-004, ADMIN-FR-002/003/004. The decision
workspace.

---

## 1. Restore and delete are peers, and this is where that is true or not

§43: "RESTORE and DELETE are peers. Same visual hierarchy, same weight... The UI
must not psychologically bias administrators toward deletion." The API says the
same about itself — "sibling states, equal API weight, equal visual weight, NO
DEFAULT" — and gives the reason, RSK-010: coordinated reporting is used to
silence legitimate criticism, and "a system that leans toward removal makes that
risk worse".

Concretely:

- The three buttons share **one** CSS selector. No primary, no danger colour — a
  red button is an instruction, and this screen has no recommendation to give.
- Nothing is preselected and nothing is autofocused. A moderator pressing Enter
  out of habit submits nothing.
- Delete is **not** in the last position of the row, which reads as the default.
- Each outcome carries one line saying what it does, and the restore line is not
  shorter or quieter than the delete line.

**The one asymmetry runs the other way.** Delete asks for a second
confirmation; restore and no-action do not. That is a thumb against deletion,
which is the direction RSK-010 and BR-032 both point — delete is the only
irreversible outcome in the product and the only one no automatic process may
ever perform.

## 2. No outcome is ever inferred

`readOutcome` matches three names and returns `null` for anything else; a
mangled submission sends no request at all. Mutation-proven: making an unknown
outcome fall through to `delete` fails the test.

## 3. EDGE-024 — the version the administrator was shown

The version rides in a hidden field and the API compares it under an optimistic
lock. It is deliberately not re-read at submit time: re-reading would make the
check pass against whatever the case looks like *now*, which is exactly the
collision the lock exists to catch.

A stale decision returns 409 carrying who resolved it, how, and the current
version. The portal renders that as **information**, not a failure — from that
reader's point of view the case IS handled and their decision was simply not
needed. Verified live: replaying a decision returned
`CASE_ALREADY_RESOLVED` with `resolvedBy`, `outcome` and `version` in `details`.

## 4. What this screen cannot show, and why it says so

§7 describes UX-ADM-004 as "full content, every report, author history". The API
provides the third and neither of the first two:

| | |
|---|---|
| `ADMIN-API-GAP-004` | no route returns the content of a reported post, comment or event — only its type and id |
| `ADMIN-API-GAP-005` | no route enumerates the individual reports; the case carries aggregates only |

Neither is invented. Adding an endpoint would be a backend change that
materially alters approved behaviour, and reading the content out of the public
API as an administrator would bypass the audit trail that makes administrator
access reviewable. The absence is stated where the content would have been,
because a blank panel reads as "there are no reports" — the same class of false
statement as ADMIN-RUNTIME-003.

For the same reason, an empty enforcement history is distinguished from an
author the API never looked up: the API skips the lookup when `targetOwnerId` is
null, so an empty list there is missing information, not a clean record.

## 5. The reported conversation

See [12](12-security-privacy.md) §3 — it is the one panel on this screen that
writes an audit entry, and it is never fetched until somebody asks.
