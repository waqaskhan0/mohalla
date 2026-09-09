# 05 — Events

**Stage 7 · Android** · §48 module record

> Redistributed from the canonical records rather than written afresh: the screen rows come from [`17-mobile-screen-coverage.md`](17-mobile-screen-coverage.md), the requirement rows from [`18-mobile-requirement-traceability.md`](18-mobile-requirement-traceability.md), the runtime results from [`19-mobile-test-report.md`](19-mobile-test-report.md) and the open items from [`20-mobile-open-issues.md`](20-mobile-open-issues.md). Where a fact is absent it says **NOT YET VERIFIED** rather than guessing.

---

## Screens

| Screen | Name | Requirements | APIs | LTR | RTL | Loading | Empty | Error | Offline | A11y | Tests | Runtime | Status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| UX-EVENT-001 | Events — Upcoming | EVENT-FR-005 | `GET /events` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ |
| UX-EVENT-002 | Events — Mine | EVENT-FR-004/007 | `GET /users/:id/events` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | ◐ |
| UX-EVENT-003 | Event detail | EVENT-FR-003/004/006 · BR-045 | `/events/:id` · `/rsvp` · `/join` | ✅ | ✅ | ✅ | — | ✅ | ✅ | ✅ | ✅ | — | ✅ |
| UX-EVENT-004 | Create event | EVENT-FR-001/002 · BR-043 | `POST /events` | ✅ | ✅ | ✅ | — | ✅ | ✅ | ✅ | ✅ | — | ✅ |
| UX-EVENT-005 | Edit / cancel event | EVENT-FR-007 | `PATCH`/`DELETE /events/:id` | ✅ | ✅ | ✅ | — | ✅ | ✅ | ✅ | ✅ | — | ✅ |

**Runtime.** **NOT EXECUTED**: `UX-EVENT-001`, `UX-EVENT-002`, `UX-EVENT-003`, `UX-EVENT-004`, `UX-EVENT-005`.

## Requirements

| Req | Title | Pri | API | ViewModel / use case | Test | Status |
|---|---|---|---|---|---|---|
| EVENT-FR-001 | Create an Event | Must | `GET /users/{userId}/events` · `POST /events` | EventComposerViewModel | EventValidationTest | `IMPLEMENTED` |
| EVENT-FR-002 | Event type | Must | `PATCH /events/{id}` | EventComposerViewModel | EventValidationTest | `IMPLEMENTED` |
| EVENT-FR-003 | External meeting link | Must | `POST /events/{id}/join` | EventDetailViewModel | EventRsvpAndJoinTest | `IMPLEMENTED` |
| EVENT-FR-004 | RSVP | Must | `DELETE /events/{id}/rsvp` · `GET /events` · `PUT /events/{id}/rsvp` | EventDetailViewModel · EventsViewModel | EventRsvpAndJoinTest · EventTimesTest | `PARTIAL` |
| EVENT-FR-005 | Upcoming events list | Must | `GET /events` | EventsViewModel | EventTimesTest | `IMPLEMENTED` |
| EVENT-FR-006 | Event detail | Must | `GET /events/{id}` | EventDetailViewModel | EventRsvpAndJoinTest | `IMPLEMENTED` |
| EVENT-FR-007 | Edit or cancel an event | Should | `DELETE /events/{id}` · `GET /events` · `PATCH /events/{id}` | EventComposerViewModel · EventsViewModel | EventTimesTest · EventValidationTest | `PARTIAL` |
| EVENT-FR-008 | Event reminder | Should | — | — | — | `BLOCKED EXTERNAL` |

- **EVENT-FR-004** — RSVP and withdrawal work on the detail screen. "Events — Mine" cannot list the events somebody RSVP’d to, because no endpoint returns them.
- **EVENT-FR-007** — Edit and cancel work. The owner’s own list is the partial half.
- **EVENT-FR-008** — An event reminder is a push notification. DEP-003 is unprovisioned, so no reminder can be delivered (GAP-M-010).

## What this module decided, and why

|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| — | Event card · date block · RSVP row | UI/UX §18 | — | ✅ | ✅ | ✅ | — | — | — | ✅ |

**The privacy correction was applied, and the API turned out to agree.** The
prototype draws an attendee avatar stack — three faces and a "+15" beside "18
people going". EVENT-FR-004 permits a public **count** and states the attendee
list is not shown in V1 (ARCH-CONFLICT-006 / D-17), and the backend already
enforces it: there is no `GET /events/:id/attendees` route, and no response
field carries an attendee identity. So the card and the detail screen render
aggregates only, and `EventRsvpAndJoinTest` asserts by reflection that
`EventResponse` has no attendee field — adding one is now a deliberate act with
a failing test attached.

### One screen is `◐` because an endpoint does not exist

**UX-EVENT-002 is `◐` — the API cannot serve half the requirement.** The screen
asks for events the user "created **or** responded to". The backend offers
`GET /users/:id/events`, which is created-by only, and `GET /events` takes a
`.strict()` query with no `mine` parameter — so the responded-to half cannot be
requested at all. The screen ships the half that exists and **says so on the
screen**, rather than either workaround: filtering a page of twenty upcoming
events on the device (wrong for anybody who responded to an event on page three)
or keeping a local list of RSVPs (a second source of truth that would not
survive a reinstall and would drift the moment an event was cancelled). The
endpoint that would close it is recorded in `20-mobile-open-issues.md`.

**UX-EVENT-004 and UX-EVENT-005 closed in group 08.** They were `◐` only for
want of a date and time picker; that was built with the composer's media work and
is now wired, so an event can be published from the UI.

### What the events group decided, and why it is written down

**The meeting link is absent from every response type, not hidden in the UI.**
EVENT-FR-003 gates it behind an RSVP *and* a 30-minute window, "which limits
scraping of open meeting rooms" — a room link is a credential anybody holding it
can walk in with, and the people most likely to be targeted are those organising
a meeting about something contested. `EventResponse` therefore has no
`meetingUrl` field at all: the link arrives only from `POST /events/:id/join`,
is delivered as a one-shot outcome, is handed straight to the system, and is
cleared. Nothing parks it in a `StateFlow` where it would survive rotation and
appear in a state dump.

**`joinLinkAvailable` is the server's answer and is never recomputed.** The
client could compare `startsAt` to the clock; it must not. A device half an hour
fast would show a Join button the server refuses, and one behind would hide a
link that works.

**Four join refusals are told apart — the opposite of the rule everywhere
else.** `ApiFailure.Restricted` gained a `code` and a `details` map for this,
and `ApiFailure.Unavailable` deliberately did **not**. The asymmetry is the
point: a 404 concerns *existence*, so its causes must stay indistinguishable
(BR-025, mandatory test A); a 403 concerns permission on an event whose title,
time and attendee count are already public, so a refusal discloses nothing new —
and EVENT-FR-003's acceptance criterion demands the availability time be stated,
which one anonymous 403 cannot do. The refusals are matched on the **code**,
never the message, because the message is already localised and text-matching
would work in English and silently fail in Urdu.

**Upcoming is the only ascending list in the product.** EVENT-FR-005 is "soonest
first", so its cursor walks *forward* in time. `FeedCursor` was deliberately not
reused: the two have the same shape and opposite meanings, and a cursor read in
the wrong direction pages away from the data rather than through it — which
looks like an empty list, not like a bug. The test asserts the **cursor
sequence** rather than the assembled list, because asserting the list would pass
even if every page were fetched from the start.

**RSVP counts come from the server; only the button is optimistic.** Interested →
Going moves one person between two counts and the person must be counted once
(EVENT-FR-004's acceptance criterion). Simulating that on the device
double-counts anybody whose previous response the screen held stale, and the
server sends both numbers in the same response — so there is nothing to guess.
Tapping the response already held withdraws it, which is how "change or withdraw
at any time" fits a row that has to work at 360dp in Urdu.

**Cancelling is one intention with an outcome the creator does not choose.**
EVENT-FR-007: with no RSVPs the event is deleted, and once anybody has committed
"deletion outright is not offered" — it stays visible and marked cancelled until
its original date passes, so somebody who never opened the notification still
finds out. The control is therefore labelled "Cancel this event" and never
"Delete": a Delete button would be a promise the requirement forbids keeping.

**An unknown event status is treated as SCHEDULED.** The permissive direction,
because the two mistakes are not symmetric: an event wrongly shown as going
ahead is corrected the moment somebody opens it, while an event wrongly shown as
cancelled is one nobody opens again — and a new status string from the server
would otherwise mark a whole list cancelled at once.

**An online event's icon is "opens elsewhere", not a camera.**
material-icons-core carries no video glyph, and that turned out to be the better
answer: BR-045 is that the platform hosts **no** video of any kind and an online
event always links out, so a camera would promise playback the product
deliberately does not have. The icon is directional, so it is the auto-mirrored
variant — out of the app is the other way in Urdu.

**Dates are formatted with an explicit locale and zone, both passed in.** A
formatter with no locale silently uses the JVM default: English on a test
machine, so the bug ships and the test passes. And the server sends UTC — an
event at 09:00 Pakistan time arrives as `04:00Z`, and rendering that literally
would send everybody five hours early, which is the worst available bug in an
events feature. `EventTimesTest` catches a dropped locale by asserting the same
instant renders *differently* in Urdu and English, and a dropped zone by
asserting a late-evening UTC timestamp lands on the next day in Karachi.

One claim was corrected while writing this: the numerals do **not** become
Eastern Arabic-Indic in Urdu. CLDR's default for `ur-PK` is Latin digits —
Eastern Arabic-Indic is the Indian Urdu convention — so `14` is correct and
forcing `۱۴` would have been wrong rather than thorough. Verified against the
JDK's own `ur-PK` data, which renders `14` beside the Urdu month name `ستمبر`.

## Commits

- `564dd9c Stage 7 group 22 (Accessibility, RTL and performance): RTL was clean, contrast was not, and 55 sites were below AA`
- `cfc6e29 Stage 7 group 20 (Offline and error states): a revocation hook nothing passed, a rate limit apologising for the server, and a banner covering five destinations out of forty`
- `ddacc58 Stage 7 groups 14-15 (Profiles and the social graph): the client could not send a JSON null, and two features were silently broken by it`
- `c05ffcc Stage 7 group 07 (Events): the join gate, aggregate-only attendance, and two gaps the client cannot close`

