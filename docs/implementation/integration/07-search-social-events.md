# Group 7 — search, follow and events

Baseline: `a16d25bc2de4acdf24998d87225ab17a96cdcd90`.

Two synthetic local users, both provisioned **through the product's own API** —
register, OTP from the existing fake adapter, username, profile — so nothing was
inserted behind the endpoints. The second user's display name is deliberately
unique in both scripts, for a reason given below.

## Search — 14 checks, all PASS

| Check | Evidence |
| --- | --- |
| People, English name | 200, the fixture is in `results` |
| People, Urdu name | 200, the same account by the Urdu half of the same display name |
| People, handle | 200 |
| **Roman Urdu** | `q=Ayesha` returns 20 accounts whose display names are written **only** in Urdu script (`عائشہ خان`). A Latin query really does match Urdu-script names |
| Posts, English body | 200, the fixture post |
| Posts, Urdu body | 200, `گلی کی صفائی کا شیڈول …` |
| Events, Urdu query | 200 |
| Zero results — people, posts, events | 200, `results: []`, **no error envelope** |
| Cannot be served — people, posts, events | 401, and **no `results` key at all** |
| Empty query | 400 with an error envelope, not "everything" |

**Zero results and service error are genuinely distinguishable**, in both
directions and on all three surfaces. That is the requirement worth stating
plainly: a client that could not tell them apart would either retry forever or
tell somebody their neighbourhood is empty. The empty case is `200` with an
empty array and no error; the unservable case is `401` with no array at all.

In the app, the zero-result state reads as guidance rather than failure: *"No
events found — Try the other spelling — Urdu script instead of Roman Urdu, or
the other way round. A shorter search often finds more."*

### An assertion that had to be fixed before it meant anything

The first version asserted the fixture appeared in the results for `Ayesha` and
for `عائشہ`, and failed. It was not a search defect: the seed contains **twenty**
accounts sharing the display name `عائشہ خان`, the page is twenty long, and the
fixture ranked below it. Asserting against a shared name is a race with
page-one ranking, not a test of search. The fixture was given a name unique in
both scripts, and the romanisation behaviour got its own explicit check instead
of being smuggled into a name lookup.

A second false alarm is worth recording because it nearly became a defect
report: `curl --data-urlencode` with Urdu text through this shell returned zero
results, which looked exactly like "Urdu people search is broken" while Urdu
post search worked. Re-run from Node with clean UTF-8, the same query returned
20. **The shell was mangling the bytes, not the API.** Anything measured through
a shell with non-Latin input needs confirming in a UTF-8-clean client before it
is called a defect.

## Follow — 9 checks, all PASS, with three-level evidence

| Level | Evidence |
| --- | --- |
| Initiating UI | Search `Zubaida…` → profile → **Follow** → the button becomes **Following** and Followers reads **1** |
| API / database | Exactly one `follows` row A→B; `profiles.follower_count = 1`, `following_count = 0` |
| Consuming UI | A appears in B's followers list; B's posts arrive in A's **Following** feed |

Also asserted at HTTP: following twice is still one follow, unfollow returns the
count to its original value, and B's posts leave A's Following feed when the
follow does.

## Events — 6 checks at HTTP plus the UI legs

| Check | Evidence |
| --- | --- |
| List | `GET /events` 200, 20 items |
| Detail | 200 |
| **No attendee identity list** | The detail's keys are `id, creatorId, title, description, startsAt, eventType, locationText, categorySlug, status, goingCount, interestedCount, joinLinkAvailable, joinLinkAvailableFrom, myResponse, underReview, editedAt, createdAt`. Counts and the viewer's own response; never who else responded |
| Join link is gated | The detail says *"Respond to this event to get the joining link"* until the viewer responds |
| RSVP from the app | `PUT /events/{id}/rsvp` 200; the card gains **"1 person going"** |
| Database | `events.going_count = 1` and one `event_rsvps` row with `response = GOING` for that user |

INT-10 therefore has all three levels: the app initiated it, the database
recorded it, and the app rendered the result.

### A near-miss worth recording

The database check first reported `going_count 0` and no RSVP row, which looked
like the UI showing an optimistic count the server never accepted. **76 events
share the title "Another gathering"**, and the query had taken the newest rather
than the one on screen. Looking the event up by the id the request actually used
showed `going_count 1` and a `GOING` row. A fixture set with duplicate titles
cannot be addressed by title.

## INTEGRATION-005, second of six

`EventsScreen` had the same gap as `HomeScreen`: `EventsViewModel` maintains
`refreshing` and nothing rendered it. Fixed the same way — `PullToRefreshBox`
around the whole branch, so an empty Upcoming tab can be pulled too.

Verified on the device: a drag on the events list took `GET /events` from 15
requests to 16. Four screens remain (inbox, notifications, saved posts, user
lists), each to be fixed in the group that exercises it.

## Why the device kept signing out, and why that is correct

Three times during this group the emulator returned to the Welcome screen
mid-flow. The cause is in `sessions`: every probe login created a session and
older ones were revoked with `revoked_reason = EVICTED`. There is a per-account
session cap and it is being enforced exactly as intended — a harness that logs
in repeatedly evicts the device it is trying to drive. Recorded because it looks
like a defect and is not, and because the harness should reuse a token rather
than re-authenticate.

## Not claimed

Verification badges (group 17) and blocked/hidden filtering in search results
(group 11) are not asserted here. Event creation and editing from the app were
not exercised; the RSVP path was.
