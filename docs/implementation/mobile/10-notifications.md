# 10 — Notifications

**Stage 7 · Android** · §48 module record

> Redistributed from the canonical records rather than written afresh: the screen rows come from [`17-mobile-screen-coverage.md`](17-mobile-screen-coverage.md), the requirement rows from [`18-mobile-requirement-traceability.md`](18-mobile-requirement-traceability.md), the runtime results from [`19-mobile-test-report.md`](19-mobile-test-report.md) and the open items from [`20-mobile-open-issues.md`](20-mobile-open-issues.md). Where a fact is absent it says **NOT YET VERIFIED** rather than guessing.

---

## Screens

| Screen | Name | Requirements | APIs | LTR | RTL | Loading | Empty | Error | Offline | A11y | Tests | Runtime | Status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| UX-HOME-007 | Notification centre | NOTIF-FR-002/003/004/005 · LOCALE-FR-006 | `/notifications` · `/notifications/read` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ |
| UX-SET-003 | Notification preferences | NOTIF-FR-007 · SET-FR-007 | `/notifications/preferences` | ✅ | ✅ | ✅ | — | ✅ | ✅ | ✅ | ✅ | — | ✅ |

**Runtime.** **NOT EXECUTED**: `UX-HOME-007`, `UX-SET-003`.

## Requirements

| Req | Title | Pri | API | ViewModel / use case | Test | Status |
|---|---|---|---|---|---|---|
| NOTIF-FR-001 | Push notifications | Must | — | — | — | `BLOCKED EXTERNAL` |
| NOTIF-FR-002 | Notification centre | Must | `GET /notifications` · `GET /notifications/unread-count` · `POST /notifications/read` · `POST /notifications/read-all` | NotificationsViewModel | NotificationsTest | `PARTIAL` |
| NOTIF-FR-003 | Engagement notifications | Must | — | NotificationsViewModel | NotificationsTest | `PARTIAL` |
| NOTIF-FR-004 | Message notifications | Must | — | NotificationsViewModel | NotificationsTest | `IMPLEMENTED` |
| NOTIF-FR-005 | Admin broadcast | Should | — | NotificationsViewModel | NotificationsTest | `PARTIAL` |
| NOTIF-FR-006 | Event reminders | Should | — | — | — | `BLOCKED EXTERNAL` |
| NOTIF-FR-007 | Notification preferences | Should | `GET /notifications/preferences` · `PUT /notifications/preferences/{key}` | NotificationPreferencesViewModel | NotificationsTest | `PARTIAL` |

- **NOTIF-FR-001** — Push. DEP-003 has never been provisioned, so there is no token to register and `/notifications/devices` goes uncalled (GAP-M-010).
- **NOTIF-FR-002** — The centre is complete for in-app notifications; a reply notification still has no destination to open (GAP-M-009).
- **NOTIF-FR-003** — Engagement notifications render and navigate, except a reply, which the API gives no target for (GAP-M-009).
- **NOTIF-FR-005** — Admin broadcasts arrive in the centre and render. The detail screen, UX-HOME-006, is not started.
- **NOTIF-FR-006** — Event reminders are push. Same block as NOTIF-FR-001.
- **NOTIF-FR-007** — The seven switches are built and persist. What they gate — push — does not exist yet (DEP-003).

## What this module decided, and why

|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| — | Notification row (component) | §18 · NOTIF-FR-002/003 | — | ✅ | ✅ | ✅ | — | — | — | ✅ |

**The Home bell is no longer inert**, and neither is the Messages tab's badge.
Both were declared in group 05–06 and group 12 respectively and neither was fed
by anything — `ShellUiState.unreadConversations` and `unreadNotifications`
existed and were permanently `0`. The shell now reads both counts, and re-reads
them on `ON_RESUME` along with the account capability, which `ShellViewModel`'s
own comment had claimed happened since group 05–06 and which nothing had ever
called. A suspension applied by a moderator while the app was open would not have
taken effect until the process restarted.

### What notifications decided, and why it is written down

**The centre always has everything, and that is enforced by the shape of the
response rather than by a code path.** NOTIF-FR-001's acceptance criterion is
that a user who *denied* the push permission still finds the notification here;
NOTIF-FR-007's is that disabling a category stops the push and leaves the entry.
They are the same claim from opposite ends — a preference and a permission cost
the *buzz*, never the *record* — so `NotificationResponse` carries no `pushed`
flag and no `deliveredAt`, and the test asserts its complete field set with both
requirements quoted. A field saying whether a push happened would invite a client
to draw the distinction both requirements exist to erase.

**Not one notification sentence exists in `strings.xml`.** The server renders
each one at *read* time in the language the request names, which is what makes
LOCALE-FR-002 — "the entire interface updates without reinstall" — true on this
screen: a centre of pre-rendered Urdu would still be Urdu after somebody switched
to English. So the locale rides every request rather than being read from the
stored preference, because the client is the only party that knows what it is
displaying *now* and the server's copy can be a sync behind. What the client owns
is the chrome: the day headings, the relative times, and the empty state.

**Relative times go through plural tables, and the formatter returns a number.**
Urdu and English do not share pluralisation rules, so `"$n hours ago"` is wrong
in both — "1 hours ago" is the visible English failure and the Urdu one is
subtler, heard as wrong by a native reader who cannot point at the word.
`RelativeTime` returns a sealed `Ago` carrying a unit and a count, and
`plurals.xml` turns it into words. This also closes the shape of a defect
`PostCard` still has: its `relativeTime` renders the ISO date's day part with a
`TODO` waiting for exactly this formatter.

**Day grouping is by calendar date in the reader's zone, and the boundary is the
only interesting thing about it.** A notification stamped 23:58 and read at 00:02
belongs under *Yesterday*, not "4 minutes ago and Today" — that is how a person
reads their own day. Grouping by UTC would put an evening notification in Karachi
under *Today* for five hours after midnight had passed for the reader. Both are
asserted; the clock is injected rather than read, because a function that reads
`System.currentTimeMillis()` cannot be tested at a boundary.

**When a notification becomes read was settled by what the wireframe does not
contain.** Every row carries an unread dot and the screen's secondary action is
"None" — no *Mark all read* control. That rules out both obvious
implementations: marking everything on open would blank every dot before the
reader had looked at one, making the dot decoration; marking only on tap would
leave the badge lit for somebody who read the list and opened nothing, making the
badge a nag. So the dots survive the visit and *leaving* marks what was actually
shown — never `read-all`, which would also clear notifications further down a
list the reader never scrolled to. Somebody who opens the centre, sees three new
things and leaves has read three things, not ninety.

**A row with nowhere to go is not clickable.** `onClick` is nullable, and a null
one leaves the row with no ripple and no button role. Three cases reach it today
— a reply (GAP-M-009), an announcement (UX-HOME-006 is not built) and an
unrecognised target — and in each the row is still information worth rendering.
Inviting a tap that does nothing is worse than a row that plainly does not offer
one.

**The destination is derived from the target, never from the category.** A like
and a batched like both point at a post; an event notification points at an event
whether it was an RSVP, a change, a cancellation or a reminder. Branching on the
category would be four cases doing the same thing and a fifth that would be
missed. It is returned as a sealed type rather than a route string, so the
navigation graph's `when` is exhaustive and the feature does not import the
graph.

**An unrecognised category is still a row.** The text is rendered server-side, so
a category this client has never heard of still displays a correct sentence — it
gets the neutral mark instead of a specific one. Refusing to render it would hide
a notification the reader was meant to see, which is the one outcome NOTIF-FR-001
and NOTIF-FR-007 both exist to prevent.

**Message requests are absent because the server never creates one.** BR-027 and
NOTIF-FR-004: "no notification is ever sent for a Message Request." There is no
client-side filter, which is the right place for it not to be — a filter here
would silently stop working the day the category was renamed.

**The preferences screen states what a switch does, in a sentence, above the
switches.** NOTIF-FR-007's rule is that preferences "apply to push only; the
in-app centre always records everything, so disabling push never loses
information" — and a reader cannot deduce that from a switch labelled *Likes*.
Without the sentence, somebody who turns everything off to stop the buzzing
either believes they have stopped being notified at all, or opens the centre
later and thinks it is broken.

**A failed read of the preferences shows no switches at all.** Seven switches in
their default position after a failed request state something about the account
that was never learned, and the reader acts on it. A toggle is optimistic and
moves *back* if the server refused, with the refusal stated in place rather than
in a toast — this is a setting nobody checks twice.

**The actor's photo is fetched per distinct actor and never blocks the list.**
The sentence already names the actor, so a row whose avatar has not arrived is
fully readable. There is no batch profile route, so a page of twenty
notifications from twelve people costs twelve requests — which is why they are
fetched *after* the list renders and why a failure is silent per person.

## Commits

- `f32b3de Stage 7 group 23 (Integration validation): a Must nobody had implemented, three declarations nothing called, and a coverage table in three shapes`
- `564dd9c Stage 7 group 22 (Accessibility, RTL and performance): RTL was clean, contrast was not, and 55 sites were below AA`
- `cfc6e29 Stage 7 group 20 (Offline and error states): a revocation hook nothing passed, a rate limit apologising for the server, and a banner covering five destinations out of forty`
- `bde7b89 Stage 7 group 13 (Notifications): a centre that holds what was never pushed, and two badges nothing was feeding`

