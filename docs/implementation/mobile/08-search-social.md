# 08 — Search, profiles and the social graph

**Stage 7 · Android** · §48 module record

> Redistributed from the canonical records rather than written afresh: the screen rows come from [`17-mobile-screen-coverage.md`](17-mobile-screen-coverage.md), the requirement rows from [`18-mobile-requirement-traceability.md`](18-mobile-requirement-traceability.md), the runtime results from [`19-mobile-test-report.md`](19-mobile-test-report.md) and the open items from [`20-mobile-open-issues.md`](20-mobile-open-issues.md). Where a fact is absent it says **NOT YET VERIFIED** rather than guessing.

---

## Screens

| Screen | Name | Requirements | APIs | LTR | RTL | Loading | Empty | Error | Offline | A11y | Tests | Runtime | Status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| UX-SEARCH-001 | Search entry · recent searches | SEARCH-FR-005 · PRIV-011 | — | ✅ | ✅ | — | ✅ | — | — | ✅ | ✅ | ✅ | ✅ |
| UX-SEARCH-002 | Results — People | SEARCH-FR-001 | `GET /search/people` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ |
| UX-SEARCH-003 | Results — Posts / Events | SEARCH-FR-002/003/004 | `/search/posts` · `/search/events` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ |
| UX-PROFILE-001 | My profile | PROFILE-FR-004/008/009 · BR-032 | `GET /me` · `/users/:id/posts` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| UX-PROFILE-002 | Other user's profile | PROFILE-FR-005/006/007 · SOCIAL-FR-001/002 · MSG-FR-001 · BR-025 | `/users/:id` · `/users/:id/follow` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ |
| UX-PROFILE-003 | Edit profile | PROFILE-FR-003/010 · BR-005 | `PATCH /me/profile` | ✅ | ✅ | ✅ | — | ✅ | ✅ | ✅ | ✅ | — | ✅ |
| UX-PROFILE-004 | Followers | SOCIAL-FR-003 | `/users/:id/followers` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ |
| UX-PROFILE-005 | Following | SOCIAL-FR-004 | `/users/:id/following` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ |
| UX-PROFILE-006 | Saved posts | FEED-FR-007 | `/me/saved` · `/posts/:id/save` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ |

**Runtime.** Exercised on an emulator: `UX-SEARCH-001`, `UX-PROFILE-001`. **NOT EXECUTED**: `UX-SEARCH-002`, `UX-SEARCH-003`, `UX-PROFILE-002`, `UX-PROFILE-003`, `UX-PROFILE-004`, `UX-PROFILE-005`, `UX-PROFILE-006`.

## Requirements

| Req | Title | Pri | API | ViewModel / use case | Test | Status |
|---|---|---|---|---|---|---|
| PROFILE-FR-001 | Create profile | Must | `POST /me/profile` | ProfileSetupViewModel | SetupOnboardingTest | `IMPLEMENTED` |
| PROFILE-FR-002 | Username Selection | Must | `GET /username/available` · `POST /me/username` | UsernameViewModel | SetupOnboardingTest | `IMPLEMENTED` |
| PROFILE-FR-003 | Edit profile | Must | `PATCH /me/profile` | EditProfileViewModel · ProfileSetupViewModel | ProfileTest · SetupOnboardingTest | `IMPLEMENTED` |
| PROFILE-FR-004 | View own profile | Must | `GET /me` | ProfileViewModel | ProfileTest | `IMPLEMENTED` |
| PROFILE-FR-005 | View another profile | Must | `GET /users/{id}` | ProfileViewModel | ProfileTest | `IMPLEMENTED` |
| PROFILE-FR-006 | Account type | Must | `POST /register` | ProfileViewModel · RegisterViewModel | ProfileTest · RegisterFlowTest | `IMPLEMENTED` |
| PROFILE-FR-007 | Verified badge display | Must | — | ProfileViewModel | ProfileTest | `IMPLEMENTED` |
| PROFILE-FR-008 | Profile post list | Must | `GET /users/{id}/posts` | ProfileViewModel | ProfileTest | `IMPLEMENTED` |
| PROFILE-FR-009 | Follower counts | Should | — | ProfileViewModel | ProfileTest | `IMPLEMENTED` |
| PROFILE-FR-010 | Profile photo upload | Must | — | EditProfileViewModel | ProfileTest | `IMPLEMENTED` |
| PROFILE-FR-011 | Interests selection | Could | `GET /suggestions` | — | ApiContractTest | `DEFERRED SHOULD` |
| SEARCH-FR-001 | Search users | Must | `GET /search/people` | SearchViewModel | SearchTest | `IMPLEMENTED` |
| SEARCH-FR-002 | Search posts | Should | `GET /search/posts` | SearchViewModel | SearchTest | `IMPLEMENTED` |
| SEARCH-FR-003 | Cross-Script Search — Urdu and Roman Urdu | Should | `GET /search/people` | SearchViewModel | SearchTest | `IMPLEMENTED` |
| SEARCH-FR-004 | Search events | Could | `GET /search/events` | SearchViewModel | SearchTest | `IMPLEMENTED` |
| SEARCH-FR-005 | Recent searches | Could | — | SearchViewModel | SearchTest | `IMPLEMENTED` |
| SOCIAL-FR-001 | Follow a user | Must | `PUT /users/{id}/follow` | ProfileViewModel | ProfileTest | `IMPLEMENTED` |
| SOCIAL-FR-002 | Unfollow | Must | `DELETE /users/{id}/follow` | ProfileViewModel | ProfileTest | `IMPLEMENTED` |
| SOCIAL-FR-003 | Followers list | Should | `GET /users/{id}/followers` | UserListViewModel | ProfileTest | `IMPLEMENTED` |
| SOCIAL-FR-004 | Following list | Should | `GET /users/{id}/following` | UserListViewModel | ProfileTest | `IMPLEMENTED` |
| SOCIAL-FR-005 | Suggested Accounts | Must | `GET /suggestions` | SuggestionsViewModel | SetupOnboardingTest | `IMPLEMENTED` |

- **PROFILE-FR-011** — A Could dependent on OD-017, with no screen in the 61-screen inventory. `interests` is read on the own-profile response and can never be written — GAP-M-016.

## What this module decided, and why

|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| — | User row (component) | §18 · SEARCH-FR-001 | — | ✅ | ✅ | — | — | — | — | ✅ |
| — | Home top app bar | §14 · §19 | — | ✅ | ✅ | — | — | — | — | ✅ |

**Home gained its top app bar in this group**, which §19 had required since
group 05–06 and which had been missed: `homeActions()` existed in
`MohallaTopBar.kt` and nothing called it. §14 places Search and Notifications
there as *actions* rather than tabs — "search is an action performed against feed
content, not a place", and notifications are "an interrupt, not a place… users go
there because something happened, not because they chose to" — so putting either
in the bottom bar would spend one of five slots on a screen visited reactively.
The bell is wired to nothing yet; UX-HOME-007 is group 12.

### What search decided, and why it is written down

**A failed search is never an empty-results state.** SEARCH-FR-003's acceptance
criterion says so outright, and this is the screen people use to ask "did anyone
raise this before?" — so a zero-results page after an outage answers *no* to a
question nobody asked it, and can convince somebody that nobody reported a
problem they in fact reported. `SearchTabState.isEmpty` is therefore false
whenever a failure is present **and** false when no request has come back, and
both conditions are asserted separately because either one alone would let the
defect through. The API is unusually candid for the same reason: 200 with an
empty list means "we looked and there is nothing", 503 means "we could not look",
and 400 with the minimum means "the query was too short to run".

**Three states, not two: never asked, asked and empty, failed.** A tab the reader
has not opened must not claim to be empty either — otherwise switching to Posts
would flash "no posts found" before the request had left.

**The empty state's advice is only sound because it is unreachable after a
failure.** §21 asks it to suggest alternative spellings, which is genuinely the
next thing to do on a platform where the same word is written in two scripts —
and exactly the wrong advice when the search never ran.

**The client sends what was typed and never transliterates.** SEARCH-FR-003 puts
normalisation on the server, against an index holding both the original text and
its transliterated form. A client-side romanisation would disagree with the index
it is querying, so "pani" would match different things depending on which side
did the folding. Asserted with an Urdu-script query reaching the source
unchanged.

**Offset pagination, and that is correct here.** Every other list in the product
pages by cursor, because a cursor names a position in a stable ordering. Search
results are ranked by relevance then recency, and relevance is not a column —
there is no `(score, id)` pair a later page could resume from, and page one's
ranking can legitimately change between requests. An offset is honest about being
approximate where a cursor would imply a stability the ordering does not have.
Results are de-duplicated on append for the same reason.

**Each tab is searched only when it is opened, and never twice for one query.**
Three simultaneous requests would triple the cost of one search on the 3G
connection NFR-PERF-001 budgets for, to fetch two sets of results the reader has
not asked to see. Changing the query clears all three and re-runs only the one on
screen.

**Typing sends one request, not one per keystroke.** 350ms — long enough that
"pani" is one query rather than four, short enough that somebody who has stopped
typing does not notice. Slightly shorter than the username check's 400ms because
a search is a read the reader is actively waiting on. A submit bypasses it.

**A query below the minimum is not sent at all.** The server would refuse it with
the minimum stated; spending a round trip to be told that is a round trip wasted.
Backspacing to one character returns the screen to the recent searches, which is
where a one-character query belongs.

**The recent-search history is encrypted, and the screen says it never leaves the
phone.** PRIV-011 is absolute — "never transmitted to or retained on the server"
— so there is no endpoint, no sync, and no request field that carries one. It is
Keystore-backed for the same reason the composer's draft is: a search history is a
list of what somebody is worried about and who they are checking on, and on a
civic platform a server that held it could be compelled to produce it. Entries are
newline-separated so that "water, drains" stays one query rather than becoming
two rows, de-duplicated case-insensitively with the newest casing winning, and
removable one at a time — somebody who looked up a name they would rather not
leave on the screen of a shared phone should not have to clear everything. Signing
out takes the history with it, because a shared phone is a common arrangement in
this market.

**The history records submissions, never keystrokes.** A history of every prefix
would fill with "p", "pa", "pan" — and would record a query somebody typed and
then thought better of.

**A search result offers no engagement controls.** Tapping a post card in results
opens the post rather than liking it: liking from a list of hits would need the
optimistic-and-revert machinery of a feed for an action nobody performs there.
Event results carry no RSVP row either, because SEARCH-FR-004 ranks past events
*down* rather than excluding them ("the upcoming list is a schedule, but search is
a memory"), so half the rows cannot be responded to — and a control that works on
some rows and not others is worse than one that lives on the detail screen.

**One test was wrong and the code was right.** An early assertion claimed that
re-submitting a query leaves the Posts tab unsearched; in fact `submit` searches
the tab **in view**, which is correct — the other two are cleared and fetched when
opened. The test was corrected to assert that behaviour rather than the code
being changed to match a mistaken expectation.

|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| — | Verified badge (component) | PROFILE-FR-007 · ADMIN-FR-010 | — | ✅ | ✅ | — | — | — | — | ✅ |

**The Profile tab is no longer a placeholder**, and neither is the Message
button that group 12 built a route for and nothing called: `conversationWith`
exists to resolve BR-024's one-conversation-per-pair, and UX-PROFILE-002 is the
screen it was written for.

### The defect this group found, which was not in this group

**The client could not send a JSON `null`, and two features were silently broken
by it.** `MohallaJson` sets `explicitNulls = false` — right for *reading*, since
a server that stops sending an optional field must not crash a screen — and it
also **omits** a null property when *writing*. The API's rule for both PATCH
routes is the exact opposite: *"send `null` to clear an optional field; omit it
to leave it alone."*

So `UpdateProfileRequest(bio = null)` serialised to `{}`. Nobody could clear a
bio, a city or a profile photo: the request said "leave it alone" every time.

**And on `PATCH /events/{id}` it broke a whole flow that shipped in group 07.**
The backend's own comment predicts it exactly: *"a caller switching a PHYSICAL
event to ONLINE — who must send a link AND null the location — would have the
old location merged back in and be told they supplied both. The type change
would be impossible, and the error message would blame a field they had just
cleared."* That is what the app did. Changing an event's type was impossible,
and the refusal named the field the creator had just emptied.

The fix is `PatchBody.kt`: PATCH bodies are built as JSON rather than as data
classes, because JSON already has three states and a Kotlin nullable field has
two. `EventChanges` and `ProfileChanges` carry a `Patch` — *unchanged*, *clear*,
*set* — so the distinction survives the trip from a ViewModel to the wire. The
test asserts the ENCODED STRING, and demonstrates the old behaviour alongside
it, so anyone tempted to replace the JsonObject with a tidier data class fails
with the encoded body in the message.

### What profiles decided, and why it is written down

**Nothing in the API says whether the viewer already follows somebody.** A post
carries `viewerHasLiked`; no response anywhere carries `viewerFollows`, and the
server has `isFollowing` internally and exposes it on no route. So the Follow
control's resting state on a cold open is a guess (**GAP-M-011**). It is
resolved as a TRI-STATE rather than a boolean — `Unknown` is a real answer and
the honest one — and `Unknown` offers **Follow**, because a repeat follow is
idempotent and moves no count, where a wrongly-shown "Following" would stop
somebody following at all. `ViewerRelations` remembers what the session has
observed, so following from a profile still reads as Following when the same
person is opened from search two taps later.

**The one place the API does answer it is the viewer's own Following list**,
twenty people at a time, incidentally — so opening it records the whole page.
Somebody *else's* following list and *anyone's* follower list prove nothing
about the viewer, and recording either would put a confident wrong answer where
an honest `Unknown` was.

**One ViewModel serves both profile screens**, because UX-PROFILE-001 and
UX-PROFILE-002 are one screen with a different action row: identity, three stat
pills and a post list are identical, and what differs is Edit and Saved versus
Follow and Message. The route composable is keyed by user id — without a key,
opening one profile from another reuses the first one's ViewModel, since
`viewModel()` scopes to the destination and both are the same route pattern.

**The header and the post list are two requests and two independent states.**
The wireframe says so by hand: "No posts → 'No posts yet'. Statistics still
render." A post list that failed must not take the identity down with it, and an
empty one is a different thing from one that could not be read.

**BR-032's under-review posts are not filtered out.** "GIVEN a post of mine is
auto-hidden, WHEN I view my own profile, THEN I see it labelled under review,
and no other user sees it at all." Both halves are the server's — it returns
those rows only to their author, marked — and the client's job is not to drop
them.

**The follower count moves optimistically and reverts.** PROFILE-FR-009 says
counts "update on follow or unfollow", and this is the one screen where the
number *is* the feedback.

**Likes work on every post list, not just the feed.** A heart that does nothing
outside Home is the kind of inert control a reader taps three times before
deciding the app is broken — so the profile and the saved list carry the same
optimistic-and-reverting toggle.

**The verified badge became one component.** PROFILE-FR-007 is a requirement
about consistency across surfaces — profile, every post and comment, search
results, the message inbox — and it was three copies of six lines drifting
independently.

**The handle is now actually forced left-to-right.** `UserRow` carried a comment
saying it was, and the code did nothing: the `@` is a NEUTRAL character, so the
bidi algorithm gives it the paragraph's direction and an unmarked
"@sana_bashir" renders in an Urdu line as "sana_bashir@" — a correct handle that
looks mistyped to the one person who knows it is not. `ltr()` wraps the run in a
directional isolate, which is the only thing that fixes it; neither alignment
nor layout direction touches it.

**Saving a post has a home, because the UX spec gives it none.** FEED-FR-007
says "user saves a post" and no surface in the design offers the action — the
card carries like, comment and share, and the overflow carries report and block.
A Saved screen nothing can fill would be a feature in name only, so the control
is a star in the post detail's top bar. Its resting state is a guess for the
same reason the Follow control's is: there is no `viewerHasSaved` (**GAP-M-012**).

**The band's tint is the brand's, not the account's.** The wireframe wants it
"from the account's most-used category"; no response carries a most-used
category, and deriving one from the first page of posts would change the band's
colour a second after the screen opened.

**Two inert safety controls were removed rather than left in place.** The
conversation header and the post detail both carried a Report button wired to
nothing, pending UX-SAFE-001 in group 17. An inert control is a small lie on
most screens and a dangerous one here: somebody being harassed who taps Report
and sees nothing happen may reasonably believe they have reported it and stop.
Both come back when the sheet is behind them.

## Commits

- `564dd9c Stage 7 group 22 (Accessibility, RTL and performance): RTL was clean, contrast was not, and 55 sites were below AA`
- `cfc6e29 Stage 7 group 20 (Offline and error states): a revocation hook nothing passed, a rate limit apologising for the server, and a banner covering five destinations out of forty`
- `068c0e6 Stage 7 group 17 (Safety): one acknowledgement whatever happened, and every inert Report control made real`
- `a07099d Stage 7 group 16 (Settings): a sign-out that works offline, a blocked list that cannot name anyone, and three screens that stopped being unreachable`
- `ddacc58 Stage 7 groups 14-15 (Profiles and the social graph): the client could not send a JSON null, and two features were silently broken by it`
- `6acd24d Stage 7 group 11 (Search): a failed search that never says "nothing found", and a history that never leaves the phone`

