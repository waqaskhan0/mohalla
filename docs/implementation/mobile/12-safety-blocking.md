# 12 — Safety, reporting and blocking

**Stage 7 · Android** · §48 module record

> Redistributed from the canonical records rather than written afresh: the screen rows come from [`17-mobile-screen-coverage.md`](17-mobile-screen-coverage.md), the requirement rows from [`18-mobile-requirement-traceability.md`](18-mobile-requirement-traceability.md), the runtime results from [`19-mobile-test-report.md`](19-mobile-test-report.md) and the open items from [`20-mobile-open-issues.md`](20-mobile-open-issues.md). Where a fact is absent it says **NOT YET VERIFIED** rather than guessing.

---

## Screens

| Screen | Name | Requirements | APIs | LTR | RTL | Loading | Empty | Error | Offline | A11y | Tests | Runtime | Status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| UX-SAFE-001 | Report — reason | SAFETY-FR-001/002/003 · MSG-FR-007 | — | ✅ | ✅ | — | — | ✅ | ✅ | ✅ | ✅ | — | ✅ |
| UX-SAFE-002 | Report — note & submit | SAFETY-FR-001 · EDGE-023 | `POST /reports` | ✅ | ✅ | ✅ | — | ✅ | ✅ | ✅ | ✅ | — | ✅ |
| UX-SAFE-003 | Block confirmation | SAFETY-FR-005 · BR-025 | `PUT /users/:id/block` | ✅ | ✅ | ✅ | — | ✅ | ✅ | ✅ | ✅ | — | ✅ |
| UX-SAFE-004 | Suspension explainer | BR-034 · ADMIN-FR-006 | — | ✅ | ✅ | — | — | — | — | ✅ | ✅ | — | ✅ |
| UX-SET-005 | Blocked accounts | SET-FR-003 · SAFETY-FR-006/007 | `/me/blocks` · `DELETE /users/:id/block` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | ◐ **GAP-M-013** |

**Runtime.** **NOT EXECUTED**: `UX-SAFE-001`, `UX-SAFE-002`, `UX-SAFE-003`, `UX-SAFE-004`, `UX-SET-005`.

## Requirements

| Req | Title | Pri | API | ViewModel / use case | Test | Status |
|---|---|---|---|---|---|---|
| SAFETY-FR-001 | Report content | Must | `POST /reports` | ReportViewModel | SafetyTest | `PARTIAL` |
| SAFETY-FR-002 | Report a user | Must | `POST /reports` | ReportViewModel | SafetyTest | `IMPLEMENTED` |
| SAFETY-FR-003 | Report reason categories | Must | — | ReportViewModel | SafetyTest | `IMPLEMENTED` |
| SAFETY-FR-004 | Threshold Auto-Hide | Must | — | FailureState | FailureRoutingTest | `IMPLEMENTED` |
| SAFETY-FR-005 | Block a user | Must | `PUT /users/{id}/block` | ProfileViewModel | SafetyTest | `IMPLEMENTED` |
| SAFETY-FR-006 | Unblock | Must | `DELETE /users/{id}/block` · `GET /me/blocks` | BlockedUsersViewModel | SettingsTest | `PARTIAL` |
| SAFETY-FR-007 | Blocked users list | Must | `GET /me/blocks` | BlockedUsersViewModel | SettingsTest | `PARTIAL` |
| SAFETY-FR-008 | Community Guidelines | Must | — | RegisterViewModel | RegisterFlowTest | `PARTIAL` |
| SAFETY-FR-009 | Rate limiting | Should | — | FailureState | FailureRoutingTest | `IMPLEMENTED` |

- **SAFETY-FR-001** — Reporting works everywhere it should. An offline report is refused rather than queued (GAP-M-014).
- **SAFETY-FR-006** — Unblock works; the row it sits on cannot name the person (GAP-M-013).
- **SAFETY-FR-007** — Same list, same limitation (GAP-M-013).
- **SAFETY-FR-008** — Community Guidelines has a screen and no document to show in it (OD-015).

## What this module decided, and why

|---|---|---|---|---|---|---|---|---|---|---|---|---|---|

UX-SAFE-004 was built in group 05–06 with the shell that shows it; it is counted
here because this is the group its siblings arrive in.

**Every inert Report control is now real.** Three were removed rather than left
wired to `{}` — the conversation header and the post detail in group 14–15, and
the event detail was the last one left. All three are back with the sheet behind
them, and two more entry points exist that never had one: a comment, and an
account.

### Where reporting and blocking can start

| Surface | Reports | Blocks | Why |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Post detail | `POST` | via the sheet | The bar's second slot; Save has the first. Exclusive with Delete. |
| Comment row | `COMMENT` | via the sheet | The only surface a comment has. Exclusive with Delete. |
| Event detail | `EVENT` | — | An event is not a person. No block is offered, because there is nobody behind it. |
| Other profile | `PROFILE` | ⋯ menu | SAFETY-FR-002 — the account, when the pattern rather than one item is the problem. |
| Conversation | `CONVERSATION` | ⋯ menu | MSG-FR-007. Always has a person behind it, so both are real. |

### What safety decided, and why it is written down

**The acknowledgement is identical every time, and the client has no way to make
it otherwise.** A first report, a fourth from the same account and the one that
crossed the auto-hide threshold all return the same empty 202 — so there is one
success branch, one sentence, and nothing in the state it renders from that
could vary. SAFETY-FR-001 requires exactly that: a repeat shows "the
acknowledgement again without incrementing the count, SO THE REPORTER CANNOT
INFER THE CURRENT TALLY".

**Why the tally matters this much.** It is what a coordinated group needs — it
tells them how many more accounts to bring — and RSK-010 rates coordinated
reporting used to silence civic criticism as this platform's characteristic
abuse, on a platform whose entire purpose is civic criticism. The test asserts
the request's complete field set with that reasoning quoted, so a count added
under any name fails.

**Severity is the server's and there is no field for it.** Each of the eight
reasons carries a severity that orders the moderation queue; a reporter who could
set it would make CRITICAL the rational choice every time, and the ordering would
stop carrying information for the one reviewer who depends on it.

**Two taps to send, one tap to change your mind.** Choosing a reason moves to the
note step rather than submitting — a sheet that sent on the first tap would never
show the optional note SAFETY-FR-001 offers — and the reason can be changed
without losing what has already been typed. Both sheets dismiss by tapping
outside: "reporting is never a trap", and that includes having opened the menu by
accident.

**The note is optional, and requiring one would have been the wrong default.**
It would make the fastest path through this sheet — the one somebody uses while
distressed — the one that asks them to write about it. It is counted in graphemes
(BR-012), so an Urdu note gets its full 500 rather than 250.

**A failed report keeps every word.** The reason and the note stay exactly where
they were and the sheet stays open, so a retry is one tap. Somebody who has just
typed three sentences about being harassed must not have to type them again
because a train went into a tunnel.

**What it does NOT do is claim the report was queued.** The wireframe asks for
"Offline → queued, submitted on reconnect, user told", and the app has no durable
queue — so a claim of queueing that an app kill silently discarded would be worse
than the refusal, on the one flow where the user most needs to know whether it
went. **GAP-M-014.**

**The block is offered from the acknowledgement, because "in practice the two go
together".** It is an offer and never a side effect: blocking removes follows in
both directions and SAFETY-FR-006 restores visibility and never the follows, so
it stays a deliberate second tap.

**The block sheet states what changes for BOTH parties, in four lines** — and the
two that decide it are the ones people do not expect. The follows are removed and
unblocking does not bring them back; and the blocked person is never told
(BR-025). Somebody deciding whether to block a neighbour they will see at the
shops tomorrow is deciding on exactly that second question, and leaving it unsaid
would make the safest option look like the most confrontational one.

**The safe choice is the primary button and it sits ABOVE the destructive one.**
§6.7 for a Tier-2 action: a thumb reaching for the bottom of a sheet finds
Cancel, and Block is the outlined control beside it rather than a filled red
button.

**Delete and Report are mutually exclusive on both content surfaces.** §18.5 caps
the top bar at two actions and Save has one of them — but the exclusivity is
right anyway, because SAFETY-FR-001 refuses a report of your own content. An
author has nothing to report and everybody else has nothing to delete.

**A departed author's comment offers neither.** PRIV-007 keeps what remains of a
deleted account carrying no link back, and there is nobody left to action.

## Commits

- `564dd9c Stage 7 group 22 (Accessibility, RTL and performance): RTL was clean, contrast was not, and 55 sites were below AA`
- `068c0e6 Stage 7 group 17 (Safety): one acknowledgement whatever happened, and every inert Report control made real`
- `4f8a022 Stage 7 groups 05-06: the navigation shell, both Home feeds, and two defects only wiring could find`

