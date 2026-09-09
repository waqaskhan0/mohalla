# 20 — Mobile Open Issues

**Stage 7 · Android** · the register of what is blocked, missing, or knowingly
incomplete — and who can clear it.

> Nothing in this file is a to-do list for the implementation. Every item here
> is either **outside the app's control** (an authorization, a document, a
> device) or a **gap between two specifications** that the client cannot close
> by itself. Work that is simply not built yet lives in
> `17-mobile-screen-coverage.md`, which counts it.

---

## 0 · Baseline, re-audited

**Classified per the final-pass addendum §1.** This is what is actually left,
after Flow A and Flow G were executed and six defects were fixed.

| Item | Class |
|---|---|
| ~~RUNTIME-005~~ | **FIXED and runtime-verified.** `noticeFor`/`failureText` are one exhaustive `when` with no `else`, pinned by a source invariant |
| ~~RUNTIME-007~~ — logging in skipped onboarding, landing an account with no username on Home | **FIXED and runtime-verified.** `destinationForSession` extracted so the login and splash paths share one resolver |
| ~~RUNTIME-008~~ — "1 comments" | **FIXED.** `comment_count` is a `<plurals>` in both languages |
| ~~MOBILE-BACKEND-GAP-003~~ — `profiles.post_count` never maintained | **FIXED** as MOBILE-BACKEND-FIX-002: `0023_post_count_trigger`, backfilled, five database tests |
| **RUNTIME-010** — a suspended account's blocked writes explain nothing. The server refuses them (verified), but only the Create tab has an explainer | **IMPLEMENTABLE NOW** |
| **RUNTIME-011** — the delete-account confirm button sits behind the keyboard, and the screen does not scroll to it | **IMPLEMENTABLE NOW** |
| ~~DEP-ADVISORY-001~~ - two high `multer` denial-of-service advisories | **CLOSED by patching to multer 2.3.0.** No exception was needed: the vulnerable code is gone, and the dependency lane is green on the pinned CI toolchain |
| ~~RUNTIME-006~~ | **FIXED and verified at Urdu × 130%.** `EmptyFeed` had no `verticalScroll`, so at 130% both action buttons fell off the bottom and a swipe bounced back. Found by §26’s large-font run |
| ~~RUNTIME-006 (original note)~~ — Home's Urdu empty-state button compressed to ≈28dp with a clipped label | **IMPLEMENTABLE NOW** |
| **GAP-M-016** · **GAP-M-017** · **GAP-M-018** — interests, post editing, mark-all-read | **IMPLEMENTABLE NOW**, and deliberately not built: each is a Could with no designed screen, and §49 forbids adding one |
| `UX-HOME-005` category filter · `UX-HOME-006` announcement detail | **CLOSED** — both built and verified on a device in the final pass. All 61 screens now exist |
| Compose UI tests (none exist) | **IMPLEMENTABLE NOW** — the emulator exists |
| ~~§44 flows~~ | **ALL ELEVEN EXECUTED.** What remains inside them is Flow C’s image path (a system Activity result) and Flow E’s decline and block variants, each needing its own fresh request |
| ~~`UX-SETUP-003` re-render~~ | **VERIFIED.** The suggestions screen renders after the crash fix, reached by completing onboarding |
| §45 image picker · camera · large font · slow network · offline/reconnect · chat · scrolling | **RUNTIME VERIFICATION REQUIRED** |
| **GAP-M-013** — `/me/blocks` returns no display name or handle | **BACKEND GAP** — see §0.1 |
| **EVENT-FR-004** — no endpoint returns the events a user RSVP'd to, so `UX-EVENT-002` cannot list them | **BACKEND GAP** |
| **GAP-M-009** — a reply notification carries no navigable target | **BACKEND GAP** |
| **OD-015** — the three legal documents and a support address | **EXTERNAL CONTENT DEPENDENCY** |
| **OD-016** — ~400 Urdu strings unreviewed. They now actually render (RUNTIME-004), so this is newly reviewable and newly urgent | **EXTERNAL CONTENT DEPENDENCY** |
| **DEP-003** — push provider | **EXTERNAL SERVICE DEPENDENCY** |
| **DEP-013** — the licensed Noto Nastaliq face | **EXTERNAL CONTENT DEPENDENCY** |
| **ADR-013 / OD-023** — the PDF safety gate | **EXTERNAL SERVICE DEPENDENCY** |
| **DEP-006** — Play account and release keystore · **DEP-007** — the domain | **RELEASE-ONLY BLOCKER** |
| Publication authorization · licence decision | **RELEASE-ONLY BLOCKER** |
| Physical-device matrix · UAT · production environment | **RELEASE-ONLY BLOCKER** |
| Admin Web Portal · all of Phase 2 (§49) | **OUT OF SCOPE** |
| **OD-020 / DEP-016** — no named technical owner, so no administrator may be provisioned | **OUT OF SCOPE** for Stage 7, and it makes BR-011's "an administrator may correct it" currently untrue |

### 0.1 · GAP-M-013 re-evaluated as a backend gap

**Seen on a device, it is narrower than this register implied.** The
blocked-users screen does not render a blank row: it says **"Names aren't shown
here, because blocking hide…"** and labels each row "Blocked account" with the
date. The client turned the API limitation into an explanation, so the screen
works and is honest. What is missing is the name — which still matters, because
somebody who has blocked several people cannot tell which row is which.


§22D asks for this specifically. **SET-FR-003 and SAFETY-FR-007 are Musts**, the
screen is built, and `GET /me/blocks` returns no `displayName` and no `username` —
so a row cannot name the person it is about. That is not an external dependency;
it is Stage 6 not returning enough to render an approved screen.

**It is not fixed here.** MOBILE-BACKEND-FIX-001 was made because Flow A proved
the defect end to end and the SRS named the expected behaviour in one sentence.
This one needs the same standard of evidence — an executed flow reaching the
blocked-users screen with a real block relationship — and Flow H is NOT
EXECUTED. Making a privacy-sensitive projection change on a screen nobody has
run would be exactly the guesswork the earlier fix avoided. Recorded as
**MOBILE-BACKEND-GAP-002**, with the shape of the fix stated: add the same
public-profile projection `/users/{id}` already returns, for blocked users only,
visible only to the blocking user.

### 0.2 · One flake worth naming

`npm run verify`'s api-smoke lane failed once and passed on the next run, with
the same tree. Run standalone immediately afterwards it reported **413 passed,
0 failed**. The cause is the smoke suite itself: it registers real numbers
against the running API, and three runs inside a few minutes trip a rate limit
it is designed to enforce. **Not a defect in the app and not a defect in the
suite** — but it means a red api-smoke lane should be re-run once before
anybody goes looking for a cause.

## 1 · Governance — not the implementation's to clear

| ID | What is blocked | Who can clear it |
|---|---|---|
| **Publication** | `PUBLIC PUSH BLOCKED`. No Stage 6 or Stage 7 work may reach the public remote until an approved publication-authorization record exists. Local commits are permitted and are what this stage produces. The hold was confirmed directly by the user. | Shehersaaz publication authorization. **Not self-authorizable.** |
| **OD-015** | Terms of Service, Privacy Policy and Community Guidelines do not exist. Now a **release blocker**: `TERMS_VERSION` is empty in the release build config, `RegisterViewModel` refuses to submit a blank version, the terms screen states that registration is unavailable, and UX-SET-006 states that the documents have not been published rather than showing placeholder text. PRIV-017 makes a reachable Privacy Policy a Google Play submission requirement. **No support address has been published either** — `SUPPORT_EMAIL` is empty, so UX-SET-007 says so instead of mailing an invented address, which matters because this is also the suspension appeal channel (OD-020). | Publish the documents, set `TERMS_VERSION`, and supply a support address — all in `apps/android/app/build.gradle.kts`. |
| **OD-016 / DEP-011** | ~400 Urdu strings are written and structurally correct — locale parity is enforced by a build-failing test — but have not been reviewed by a native speaker. This is not a substitute for that review. | Shehersaaz language review. |
| **OD-020** | No named technical owner (DEP-016), so no administrator may be provisioned and no bootstrap endpoint exists in any environment. The suspension explainer's appeal route therefore points at a support address rather than an in-app queue: a form filing into a queue nobody reads would be worse than saying where to write. | Name a technical owner. |
| **DEP-013** | Noto Naskh Arabic and Noto Nastaliq are not bundled. Both currently resolve to the platform serif, which renders Urdu correctly on API 26+ but is not the approved face. | Supply the licensed font files. |
| **Licence** | No open-source licence has been added, and none may be added without explicit authorization. | Shehersaaz. |

---

## 2 · Environment — blocks verification, not implementation

| | |
|---|---|
| ~~No AVD, no system image, no device~~ | **RESOLVED.** `emulator` and `system-images;android-36;google_apis;x86_64` were installed (4.4 GB unpacked) and the `mohalla_test` AVD created — API 36, x86_64, 1080×2280 @ 420dpi, 4 GB, 4 cores. The full Stage 6 stack runs beside it: Postgres 18.6, 22 migrations, API, worker and Socket.IO, with `npm run smoke` at **8 passed / 0 failed / 0 blocked**. Flows A and G were executed against it. **The other nine §44 flows are NOT EXECUTED — for want of time and fixtures, no longer for want of a device.** Compose UI tests are now writable and remain unwritten. |
| **What was done instead** | Every rule that can be asserted without a device was written as a JVM unit test rather than deferred: the RTL invariants, the state machines, the cursor sequences, the neutral-refusal structure, locale and zone handling, the composer's
per-attachment upload sequencing, the comment thread's one-level nesting, and
search's failed-versus-empty rule, messaging's send idempotency and duplicate
reconciliation, the notification centre's day boundary in the reader's own
timezone, the encoded shape of a PATCH body that has to distinguish absent from
null, the ordering of the deletion consequences PRIV-006 requires a user to read,
which of the eight API failures each of §21's four states answers for, every
link shape §42 accepts and the many more it refuses, eight accessibility and RTL
invariants asserted over the whole source tree, and the exact field shape of
every type that enforces a privacy rule structurally. **514 Android, 904 backend and 95 database tests, all passing.** |
| **What group 22 added** | Eight source-level invariants: no absolute alignment, no left/right padding or text alignment, every directional icon mirrored, the tab list never reversed, `text-tertiary` never colouring informational text, no bare 40dp `TextButton`, no hardcoded user-visible string, every lazy item keyed. Each an allowlist, so a new permitted use has to be argued for in the test. The RTL rules were all already satisfied; the contrast ones were violated on 55 sites. |
| **What group 23 added** | Two integration tests over the seams a unit test cannot see. `ApiContractTest`: all 75 client routes exist in Stage 6's generated contract, 0 missing, and each of the 29 uncalled server routes carries a stated reason so a new one fails the build. `IntegrationWiringTest`: every function on every `*Source` interface reaches a caller, with the orphan set pinned at exactly three. Between them they found a **Must** requirement that had never been implemented and three declarations nothing called. |
| **What that does not prove** | That pixels mirror. The tests prove Create sits at index 2 of 5 and that the list is never pre-reversed; they cannot prove the row renders right-to-left. §36 makes RTL release-critical, so this gap is the largest single verification debt in Stage 7. |

The manifest defect found in group 05–06 is the argument for closing it:
`INTERNET` was missing for four groups of screens, and every API call would have
thrown a `SecurityException` on the first request. Nothing caught it because
nothing had ever run against a backend on a device.

**A third argument, from group 20: a callback nothing passes looks exactly like
a callback that works.** `apiCall` grew an `onUnauthenticated` parameter in group
01 and `ApiFailure.Unauthenticated`'s documentation described the shell
intercepting it globally. Nothing ever passed one, for nineteen groups. The suite
was green throughout, because every test that could have noticed was testing a
repository that did not supply it either. A revoked session — the thing
SET-FR-002 exists to cause on every other device — showed a generic error
forever. Reading the code found it; running the code would have found it in the
first minute.

**A second argument, from group 11: a green suite is not proof.** Several of this
product's privacy rules are enforced by the SHAPE of a type — SEC-006 gives the
login state no field that could distinguish a wrong password from an unknown
number, BR-025 gives the neutral 404 no discriminator, EVENT-FR-003 gives no
response body a place to put a meeting credential. Those were tested as
DENYLISTS of guessed field names, and the denylists were measured against a
probe: with `EventResponse.roomUrl` (a live meeting credential on every list
response), `EventResponse.participantIds` (attendee identities), 
`UpdatePostBody.attachmentIds` (media on an edit) and
`ApiFailure.Unavailable.reason` (a discriminator on the neutral refusal) all
added, **every one of 271 tests passed**. Each of those four is exactly the
defect its own test claimed to prevent.

The fix inverts the check: each site now names the COMPLETE set of fields the
type may declare (`assertExactFields`), so any addition fails under any name and
the message names it — and `ApiFailure`'s neutrality is additionally gated by an
exhaustive `when`, which makes a new failure variant a COMPILE error until
somebody decides whether it may explain itself. Re-running the probe against the
fixed tests fails all four, each quoting the requirement it breaks. **The lesson
generalises: a test that asserts an absence must enumerate what is permitted,
not guess at what is forbidden.**

---

## 3 · Specification gaps the client cannot close

These are places where two approved documents disagree, or where a screen's
requirement asks for something no endpoint serves. Each is implemented as far as
it can honestly go, and **each says so on the screen** rather than presenting a
partial answer as a complete one.

### GAP-M-001 · "My events" cannot include events the user responded to

**UX-EVENT-002** asks for events the user "created **or** responded to".

The API offers:

- `GET /users/:userId/events` — created-by only, newest start first.
- `GET /events` — upcoming, with a `.strict()` query that has **no** `mine`
  parameter, so passing one is a 400.

There is no endpoint for "events I responded to", and the RSVP table is not
exposed in any list shape.

**What was built.** The created-by half, with a notice on the screen stating
that events the user responded to are not listed yet.

**What was deliberately not built**, and why:

- *Filtering the upcoming page on the device* — wrong for anybody who responded
  to an event that is not on page one, and silently so.
- *Keeping a local list of RSVPs* — a second source of truth that would not
  survive a reinstall, would drift the moment an event was cancelled, and would
  disagree with the server after any action taken on another device.

**To close it:** an endpoint listing events the caller has an RSVP against —
either `GET /events?attending=true` (relaxing the strict query) or
`GET /me/events`. The client change is then one function on `EventSource` and
the removal of the notice.

### GAP-M-002 · Event responses carry no creator profile

**EVENT-FR-006** asks the detail screen for "creator with badge". The event body
carries only `creatorId`.

Posts do not have this problem: `FeedItemResponse` embeds
`author: PublicProfileResponse`. Events are inconsistent with them.

**What was built.** The detail screen makes one extra `GET /users/{id}` after
the event loads, never blocking it — the date, title and RSVP row are all
readable while the name fills in. Deliberately **not** done per list row:
twenty extra round trips to render twenty names would cost more than the list
itself on the 3G connection NFR-PERF-001 budgets for, so list cards show no
creator.

**Consequence to be aware of:** an event card in a list does not name its
organiser, which is a real reduction against §19's card design.

**To close it:** embed a `creator` object in the event body the way the feed
embeds `author`. One field, and the client drops a whole request.

### GAP-M-004 · UX-CREATE-002 has no crop step

**UX-CREATE-002** is titled "select up to 4 images, **crop**, and compress on the
device". Selection and compression are built; crop is not.

**Why it was not built.** Android's photo picker offers no crop, so this would be
a hand-rolled gesture surface: pinch, pan and a draggable frame that all have to
work under RTL mirroring, at a 130% font scale, and on a 720×1280 screen. And the
outcome it produces is largely already delivered — every image is scaled to a
1600px longest edge and re-encoded to fit NFR-PERF-005's 500KB ceiling regardless,
so the compression step is what makes a 12-megapixel photo transmittable.

**What is actually lost.** Framing. Somebody photographing a document or a street
sign cannot trim the surroundings, and MEDIA-FR-002's note that "awareness posters
must remain legible at full zoom" is about the viewer rather than the composer, so
nothing else depends on it.

**To close it:** either a crop screen, or a library — and the library choice is a
dependency decision rather than an implementation one, since none of the common
Android croppers is maintained by a party this project already trusts.

### GAP-M-005 · MEDIA-FR-003 documents are not implemented

A *Should*, not a *Must*. The backend's media module accepts `DOCUMENT` uploads
with a 10MB ceiling, content inspection and a randomised stored name (SEC-015),
so the server side exists. The client does not offer it.

**Why.** ADR-013's PDF path is gated on a review that has not happened, and
EDGE-014 — "a non-PDF file renamed with a .pdf extension" — is refused by content
inspection on the server, which the client cannot verify before uploading. So a
document row would offer a file that might be refused after the bytes had crossed
a metered connection, and the attachment sheet says so instead of offering it.

**To close it:** the ADR-013 review, then a `DOCUMENT` branch in `ImagePicker`'s
sibling and a document row in the attachment sheet. The upload plumbing is
already generic over `kind`.

### GAP-M-006 · There is no higher-resolution media variant to serve

**MEDIA-FR-002**'s rule: "awareness posters must remain legible at full zoom, so
the viewer serves a **higher-resolution variant** than the feed thumbnail."

`GET /media/{id}` takes no size parameter and the API stores exactly one object
per media id. There is no variant to request.

**What the viewer actually gains** is decode size, not a different file. The
stored image is 1,600px on its longest edge — the client's own upload ceiling
(NFR-PERF-005) — the feed decodes it down to a card's width, and the viewer
decodes at screen size and allows zoom to 5× beyond that. So a poster *is*
legible in the viewer and not in the feed, by roughly the intended amount,
through a different mechanism than the requirement describes.

**What is genuinely lost.** Above about 2.2× on a 720px screen the viewer is
interpolating rather than showing real pixels, because 1,600px is all there is.
A poster photographed at 12 megapixels and compressed for upload cannot be zoomed
into further than that ceiling allows.

**To close it:** server-side variants (a `?size=` parameter, or a second stored
derivative), which is an API and storage decision rather than a client one. Note
it interacts with NFR-PERF-005: raising the upload ceiling to serve a sharper
viewer would send more bytes over the connection the ceiling exists to protect.

### GAP-M-007 · A shared post carries no excerpt

**ENGAGE-FR-007** asks for "a link to the post **plus a short excerpt**". The
share sheet sends the link only.

**Why.** The canonical public URL is defined by §42's deep-link work (group 22),
and this group had no real host to point at — so the share base is
`mohalla.invalid`, which fails visibly rather than being a domain somebody might
register. Attaching an excerpt to a link that cannot resolve would put a quoted
fragment of somebody's words into a WhatsApp message alongside a broken URL,
neither of which the sender can edit afterwards.

The requirement's other rules are already met: the link requires login to open,
because it lands on the post route behind the startup resolver.

**Half of this closed in group 21.** The share URL is now built from the same
constant the intent filter and the resolver use, so the link the app hands to
WhatsApp is one the app agrees to open — it was not, and every shared post would
have opened a browser. What is still missing is the excerpt.

**To close the rest:** the real share host (DEP-007, with GAP-M-015), then one
line adding the first ~140 graphemes of the post body to the intent's
`EXTRA_TEXT`.

### GAP-M-008 · Realtime delivery is polled, not socketed

**MSG-FR-004** asks for a message to appear "within 3 seconds without manual
refresh", and ADR-009 describes a Socket.IO channel. **The conversation polls
`GET /conversations/:id/messages/since` every two seconds instead.**

**Why this is a defensible reading rather than a shortcut.** The API states the
rule itself: "REST is the source of truth; realtime is an accelerator… every
route here has to work with the socket switched off", and it names that route as
"the POLLING FALLBACK ADR-009 names". The SRS's own risk note agrees: "Polling is
an acceptable fallback at this scale." The requirement sets a threshold of three
seconds, not instantaneity, and two seconds meets it with headroom for the
request itself on the 3G connection NFR-PERF-001 budgets for.

**What a socket would have cost to add here.** A dependency, an auth handshake
against the same session the interceptor already manages, a reconnection and
backoff policy, a duplicate-suppression path for the switch between transports,
and a lifecycle to get wrong — for a latency improvement below the threshold. On
an implementation nobody can run on a device (§2 above), that is a class of
failure that would be written blind.

**What it costs today, stated rather than hidden.** One small request every two
seconds while a conversation is open and foregrounded. The poll is bounded by
`ON_RESUME`/`ON_PAUSE`, so a phone in a pocket makes none and a backgrounded app
makes none; a conversation left open on screen for ten minutes makes 300. That is
not free on Pakistani mobile data, and it is the honest cost of the choice.

**What is already in place for the socket.** Every message carries its client id
from both routes, so a client that switches transports "cannot duplicate
anything" — `mergedWith` reconciles by client id then server id, and
`MessagingTest` asserts that a message delivered twice renders once. The
reconcile is anchored on the newest **server** timestamp rather than the device
clock, which is exactly the anchor a reconnect needs.

**To close it:** the socket becomes a second producer feeding the same
`mergedWith`, and `POLL_INTERVAL_MS` becomes the fallback interval used when the
connection is down. No screen or state change is required, which is the point of
having built it this way.

### GAP-M-009 · A reply notification has nowhere to go

**NOTIF-FR-002** requires that "opening one navigates to the item that caused
it". For seven of the eight categories it does. For **REPLY** it cannot.

The server records a reply notification as `targetType: COMMENT` with the
**comment's** id, and builds the push deep link as `/posts/{postId}#{commentId}`
— so the information exists at delivery time. The centre's response body carries
only `targetType` and `targetId`, and there is no `GET /comments/{id}` route to
resolve the rest: the engagement module offers `GET /posts/:id/comments`,
`POST /comments/:id/replies` and `DELETE /comments/:id`, and nothing that reads
one comment.

**What the client does instead.** The row renders — it is still information, and
the sentence tells the reader what happened — and it is **not clickable**: no
ripple, no button role, nothing to tap. Opening a post chosen by guesswork would
be worse, and so would hiding the row.

**To close it:** one field. Either `postId` on the notification body, or
`targetType: 'POST'` with the comment id carried as an anchor — the second is
what the deep link already does, so the client needs no change beyond removing
the special case.

### GAP-M-010 · Push notifications are not implemented (DEP-003)

**NOTIF-FR-001** is a *Must*, and it depends on **DEP-003**, a push notification
service that has not been provisioned. There is no Firebase project, no
`google-services.json`, and therefore no device token to register.

**What that means today.** The app registers no device, requests no
`POST_NOTIFICATIONS` permission, and shows no push. `NOTIF-API-004`'s two device
routes are deliberately **absent** from `MohallaApi` rather than present and
uncallable — an endpoint that nothing can invoke is dead code that reads as
finished work.

**And a permission is not requested for a capability that does not exist.**
PRIV-015 asks for the push permission to be requested *contextually*; asking for
it before a single notification can be delivered is the least contextual moment
there is, and a decline is durable — Android will not prompt again after two
dismissals. Requesting it now would spend the one good ask on nothing.

**What ships instead is the requirement's own fallback**, working: "a declined
permission degrades to in-app notifications only", and "push service unavailable
→ notifications still accumulate in the in-app centre, so nothing is lost." The
centre is complete, and the seven push preferences are recorded server-side and
take effect the day a service exists.

**The consequence is stated plainly because it is severe.** The SRS calls push
"the primary retention mechanism — without it users do not return", and DEP-003's
own row says "retention collapses". This is not a gap the client can close.

**To close it:** provision the service (technical owner), add the Firebase
config, then a token source, the two device routes, a contextual permission
request, and a `FirebaseMessagingService` that routes a tap through the deep
links the server already builds.

### GAP-M-011 · Nothing says whether the viewer already follows somebody

**SOCIAL-FR-001** makes Follow the primary action on UX-PROFILE-002. Nothing in
the API says whether it should read *Follow* or *Following*.

A post body carries `viewerHasLiked`, so a like renders correctly on a cold
open. No response anywhere carries `viewerFollows`: the server has
`isFollowing` in `FollowService` and exposes it on **no route**, and the public
profile projection — the one shape every surface renders — has no field for it.
The only endpoint that answers the question at all is the viewer's own
`GET /users/{me}/following`, paginated at twenty, which would cost fifteen
requests for somebody following three hundred people and would still be a
guess between pages.

**What the client does instead.** `ViewerRelations` holds a TRI-STATE per id —
known-yes, known-no, unknown — seeded from actions performed this session and
from the viewer's own following list when they open it. `Unknown` renders as
**Follow**, deliberately: a repeat follow is idempotent and does not move the
count, so the wrong guess costs a wasted tap, where a wrongly-shown "Following"
would stop somebody following at all. It is session-scoped and never persisted
— a stale answer written to disk would survive a follow performed on another
device and be wrong for longer, with no way to notice.

**It also decided what the follower and following lists do NOT show.** Twenty
rows would each carry a control whose resting state is a guess; tapping through
to the profile gives the same action with the same accuracy and without the wall
of maybe-wrong buttons.

**To close it:** one boolean on `PublicProfile` — `viewerFollows` — computed
where `isFollowing` already is. The client then deletes a class.

### GAP-M-012 · Nothing says whether a post is saved, and no surface offers to save one

Two halves of the same shortfall, both under **FEED-FR-007**.

**No response carries `viewerHasSaved`**, so the save control has the same
problem the Follow control does, resolved the same way: `Unknown` offers Save,
and saving is idempotent. The saved list itself is the one place the client can
be certain, because every row in it is saved by definition.

**And the UX spec places a save control on no screen at all.** The post card
carries like, comment and share; the overflow carries report and block;
UX-PROFILE-006 lists the results of an action the design never offers. The
requirement is marked *Could* and the screen "cuttable if the schedule
tightens", but the server side is complete — list, save and unsave are all live
routes — so a Saved entry that opened an unfillable list would be worse than
either building it or cutting it.

**What the client does instead.** A star in the post detail's top bar, which is
where a reader who has decided a post is worth keeping already is. Recorded here
because it is a client decision filling a gap in the design rather than
implementing it.

**To close it:** `viewerHasSaved` on the post body, and a design decision about
where the control belongs.

### GAP-M-013 · The blocked-accounts list cannot show who is blocked

**SAFETY-FR-007** and **SET-FR-003** ask for "a list of blocked accounts with
unblock controls". The client can build the controls and cannot build the list.

`GET /me/blocks` returns `{blockedUserId, createdAt}` per row and nothing else.
The only route that turns a user id into a name is `GET /users/{id}`, and it
answers the neutral 404 for anybody blocked **in either direction** — which is
every single row on this list, by definition. Search is filtered the same way.
There is no request the client can make that would name these people.

**What the client does instead.** Rows read "Blocked account" with the DATE the
block was made, newest first, under a line explaining why no names appear. A list
of identical unlabelled rows with no explanation reads as a bug; the same list
with the explanation reads as a limitation, and somebody who blocked one person
last week can still find them. No user id is rendered: a raw UUID identifies
nobody a reader would recognise, and on a shared phone it puts a stranger's
account identifier on display for no benefit.

**The option deliberately not taken.** Unblocking to read the name and
re-blocking would work — the profile resolves the instant the block lifts — and
it would mean the app silently unblocking people in order to draw a list. A
blocked person becoming able to message somebody for the length of a network
round trip is not a trade this screen gets to make on the user's behalf.

**SET-FR-003's acceptance criterion still holds**, because it is about removal
rather than naming: "GIVEN an account is unblocked from this list, WHEN the list
reloads, THEN it is no longer present."

**To close it:** hydrate `/me/blocks` through the same public projection every
other list uses. The blocker is plainly entitled to see who they blocked, and the
server is the only party that can decide that — which is exactly why the client
must not work around it.

**A second, smaller thing found in the same route.** `nextBefore` is set to the
last row's timestamp whenever the page has rows, so it is non-null on the FINAL
page too. A client paging until it goes null re-fetches that page forever; the
repository derives the end from a short page instead.

### GAP-M-014 · A report made offline is refused, not queued

**UX-SAFE-001/002** specifies the offline case as "queued, submitted on
reconnect, user told". The app refuses it instead, keeps the reason and every
word of the note, and says so.

**Why.** Queueing honestly needs durability. A report held only in memory is lost
when the process is killed — which on a low-end device under memory pressure is
routine — and it would be lost *after* telling the reporter it was on its way.
On the one flow where somebody most needs to know whether their report went, a
claim that turns out to be false is worse than a refusal they can act on. The app
has no persisted work queue and no `WorkManager` dependency; adding one for this
alone, unrunnable on any device here (§2), would be writing a delivery guarantee
blind.

**What ships instead.** The sheet stays open with the reason chosen and the note
intact, and the copy says the report has *not* been sent and that nothing typed
was lost. A retry is one tap.

**To close it:** a small persisted outbox — the report body plus its target — and
a flush on the connectivity signal `ConnectivityObserver` already provides, or
`WorkManager` with a network constraint. The copy then changes from "try again"
to "we'll send this when you're back", and only then.

### GAP-M-015 · Deep links cannot be verified, so they open a chooser

**§42's links work. They just do not open the app directly.**

Android App Links verify by fetching `/.well-known/assetlinks.json` from the host
and matching it against the app's signing certificate. That needs two things
neither of which exists: **DEP-007**'s domain, and **DEP-006**'s Play-managed
release keystore whose SHA-256 fingerprint the file has to name.

**What ships.** The intent filter is declared for `https`, the app's host and the
four path prefixes the server publishes — without `android:autoVerify`. Android
therefore treats them as unverified web links and shows the disambiguation
dialog: the reader taps a shared post, picks Mohalla from a list, and lands on
the post. Setting `autoVerify="true"` now would fail verification on every
install and produce exactly the same dialog, so leaving it off is the same
behaviour, honestly declared.

**A custom scheme was rejected rather than overlooked.** `mohalla://posts/{id}`
would open without a chooser, and any other app on the device could declare the
same scheme and intercept it. For a link to a private conversation that is not a
trade worth making, and PRIV-003's whole premise is that this product is where
neighbours talk without handing over contact details.

**The release build claims no host at all.** `APP_HOST` is empty until DEP-007
resolves, and the resolver refuses every link when it is blank — so a release
build cannot be induced to open a link belonging to whoever registered a
plausible name. The debug build uses `mohalla.invalid`, reserved by RFC 2606 so
it can never resolve.

**To close it:** the domain, the release keystore, an `assetlinks.json` naming
the fingerprint, and `android:autoVerify="true"`. One line in the manifest, and
three things that are not this repository's to supply.

### DEP-ADVISORY-001 · `multer` advisories — CLOSED by patching

**RESOLVED.** `multer@2.3.0` is installed, `npm audit --audit-level=high`
reports 0 vulnerabilities, and the dependency lane passes on CI's pinned
toolchain. The vulnerable code is **gone from the tree** rather than merely
unreachable, so nothing is suppressed, excepted or downgraded.

| | |
|---|---|
| Advisories | GHSA-535w-7cp7-47q4 · GHSA-wc9g-mqfw-jrwm |
| Package | `multer`, transitively via `@nestjs/platform-express` |
| Was installed | 2.2.0 |
| Now installed | **2.3.0** (patched) |
| Severity | HIGH ×2 |
| Status | **CLOSED — PATCHED** |

**Why it took three attempts, and what the obstacle actually was.**
`@nestjs/platform-express@12.0.1` pins `multer: '2.2.0'` exactly and is the
latest release, so an `npm overrides` entry is the only mechanism — and npm on
this workstation never reads that field. Proven with a control rather than
assumed: an override of an unrelated package (`mime-db`) was ignored
identically, and `overrides` was never recorded in the regenerated lockfile
either time. The workstation runs Node 24.14.1 / npm 11.11.0 against a
repository target of Node 24.20.0 / npm >=11.19.0, and `engine-strict` had to be
bypassed for every command.

**How it was resolved.** Both files now carry the pin and they agree:
`package.json` declares `overrides.multer` so any future resolve keeps it, and
`package-lock.json` carries the resolved 2.3.0 with its registry integrity so
`npm ci` — which installs strictly from the lock — gets the patched version.
That is the same end state a working npm would have written by itself.

It is a safe edit because 2.3.0 and 2.2.0 declare **exactly the same four
dependencies at the same ranges** (`busboy ^1.6.0`, `type-is ^1.6.18`,
`append-field ^1.0.0`, `concat-stream ^2.0.0`), so no nested lock entry moves.
The change is one package's version, tarball and integrity, plus the root
`overrides` recording the deviation as deliberate.

`npm ls` reports multer as `invalid` on this workstation, because this npm does
not honour overrides and therefore still expects 2.2.0. No CI step runs
`npm ls`; the status is cosmetic and affects no gate.

**A scoped, expiring security exception was authorized for this and was not
used.** The authorization arrived on the reasonable belief that patching was
impossible — the advisories are indeed unreachable here, since nothing imports
`multer` and there is no `FileInterceptor` or `@UploadedFile` anywhere in
`apps/api/src` (uploads use the presigned slot flow, never multipart). But
removing the vulnerable code is strictly better than formally accepting
unreachable vulnerable code, and the authorization's own terms required any
exception to go stale the moment the dependency was patched. So there is nothing
to except, no expiry to track, and no exception machinery to maintain.

**What was not done:** no change to `--audit-level=high`, no
`continue-on-error`, no advisory-only lane, no audit suppression, no
`npm audit fix --force`, and no NestJS downgrade. npm's own remediation plan was
`@nestjs/core@7.5.5` — five majors back, the whole framework downgraded to
remove code the application never calls.

**One thing to watch.** The pin deviates from what `@nestjs/platform-express`
declares. When upstream ships a release that moves to 2.3.0 or later, the
`overrides` entry becomes redundant and should be removed so the tree returns to
plain upstream resolution.

### RUNTIME-012 · A required field the server has never sent

**Fixed. Found by building UX-HOME-005, and it had disabled a different
feature entirely.**

`GET /categories` returns `{slug, nameEn, nameUr, sortOrder}`.
`CategoryResponse` declared a **required** `val id: String`. Every category
fetch therefore threw `MissingFieldException`, the caller swallowed it into an
empty list, and **POST-FR-006's composer category picker had never worked** —
it opened onto nothing, silently, for the whole of Stage 7. Nothing in the app
ever read `id`.

**This is the third defect of one shape**, and the reason it kept happening is
that nothing could see it. `MessagesResponse.nextCursor` was typed as the
events cursor (group 12). PATCH bodies could not express a JSON null (group
14). `ApiContractTest` catches none of them and says so in its own comment: the
generated OpenAPI contract has `components.schemas` empty, so it can prove a
route exists and never that a field does.

**Closed by `WireRequiredFieldTest`**, which decodes a real captured response
body checked in beside the contract it came from. Its required-field rule is an
**allowlist, not a ban** — a required field is a risk, not automatically a
defect, and defaulting `PostResponse.id` to `""` would hide a real server fault
behind a blank. Each of the 43 entries is a claim somebody made that the server
always sends that field; a new one fails until it is added, which is the moment
to go and read a response body. That is the check nobody did here.

### RUNTIME-013 · A third top-bar action crashed the app

**Fixed. Introduced and caught within the same pass.**

`MohallaTopBar` enforces UI/UX §18.5 with a `require`, and §18.5 draws Home's
bar as `Shehersaaz · search · bell` — both slots already spent. UX-HOME-005's
filter was added as a third action and the app died with
`IllegalArgumentException: The top app bar takes at most 2 actions`.

**Nothing could catch it.** Not the compiler — the cap is a runtime `require`
over a list size. Not the 500 unit tests — no test touched the top bar at all.
Not launch-and-look either: the bar is correct until `/categories` returns, so
the crash arrives a second in, on a state no unit test constructed.

`TopBarActionTest` is source-level because it has to be: `homeActions` is
`@Composable` and cannot be called from a JVM unit test, which is exactly why
the direct test that would have caught this could not be written. It rejects
`listOfNotNull` in an actions position outright — a `listOf` of three is a
mistake any reader sees, and a length that varies with state is a mistake
nobody sees in any state but the failing one.

### RUNTIME-014 · Choosing a language did nothing when the system already held it

**Fixed. Reproduced deterministically on the device, both ways.**

`applyLanguage` stored the choice and relied on a side effect: assigning
`applicationLocales` makes the platform recreate the activity. It does — but
only when the value changes. Assigning the value it already holds is a no-op,
so nothing recreated, `attachBaseContext` never re-read the store, and every
string stayed in the previous language for the life of the process.

**Reachable without a debugger.** Android's own per-app language screen writes
`applicationLocales` and never touches the app's store, so a reader who sets
English there and then chooses English in the app gets a tick next to English
and an app that is still entirely Urdu — header, layout direction, mirrored
back arrow and body text.

Verified by installing the pre-fix binary, reaching that state through the
app's own screens, and watching it stay Urdu; then installing the fix and
repeating the identical taps, which switch immediately.

### RUNTIME-015 · Four text fields had no accessible label

**Fixed. Found by the §25 audit.**

The post composer, the message composer, the comment field and search each had
a visible placeholder drawn as a **sibling** `Text` behind the field — which is
a drawing, not a label. The composer's node on the device read
`text="" content-desc="" hint=""`, and the placeholder string appeared nowhere
in the accessibility tree. TalkBack announced "edit box" and nothing about what
belongs in it, on the screens whose entire purpose is typing that one thing.

Each field now reads the same string it draws, so the label and the placeholder
cannot drift. Verified on the device, including that the typed text is still
exposed alongside the label rather than replaced by it.

### RUNTIME-016 · The two labels the app did have were English literals

**Fixed. Found by the §25 audit.**

`OtpScreen` and `LoadingState` set `contentDescription` to hardcoded English
strings, so an Urdu screen-reader user heard English. One of them was the OTP
field's only label, on the screen where somebody is copying digits out of an
SMS.

**`LocalizationParityTest` cannot see this**, and that is the point worth
keeping: it compares `values/` against `values-ur/`, and a Kotlin literal is in
neither, so parity was green through both. Android Lint's `ContentDescription`
check looks at XML layouts, and there are none here. A Compose UI test would
have caught the missing labels above but not these — a hardcoded English label
passes a semantics assertion perfectly.

### RUNTIME-017 · Post detail rendered as a comment box in an empty screen

**Fixed. The most severe defect of the pass, and it made a top-level screen
unusable.**

Opening any post with no comments showed a comment box floating in blank
space: no header, no author, no body, no engagement row, no "Start the
conversation". Nobody had to touch anything — the comment field auto-focuses on
an empty thread, so the keyboard opened by itself.

Eleven screens apply `imePadding()`, which is the Compose way and what
`ComposerScreen` documents in its own comment: it lifts the toolbar above the
keyboard rather than shrinking the text area. **That comment assumes the window
keeps its height, and it did not.** `windowSoftInputMode` was never declared, so
the platform default `adjustResize` applied and the window shrank as well —
measured on the device, a 2280px window became 1520px with the keyboard up, and
`imePadding()` subtracted the same 760px again. Post detail was left with 700px
for a header, a scrolling thread and a composer.

**Two hypotheses were wrong first, and both are worth recording.** That
`imePadding()` was itself the problem: removing it moved the composer back to
the bottom of the window — a real improvement and the first hard evidence of
the double count — but the screen stayed blank. And that the content was merely
scrolled out of view: swiping did nothing, and the accessibility tree reported
every node at `[0,0][0,0]`, which is unplaced rather than scrolled.

Declaring `adjustNothing` keeps the window at full height and makes
`imePadding()` the single account of the keyboard.

**Why it survived every earlier pass:** the screen is only broken while
somebody is trying to type on it, and dismissing the keyboard restores it
completely. The defect was a platform **default**, not a line anybody wrote —
nothing for a reviewer to read, nothing for a unit test to call. 500 green
tests and a clean lint sat on top of a screen that did not work.

`KeyboardInsetTest` asserts both halves, because either alone is broken:
without `adjustNothing` the inset is counted twice, and without `imePadding()`
the keyboard covers the field.

### §25 · What the device accessibility audit found, and what it did not

**The audit walked** Home (both tabs), the category filter sheet, the
announcement detail, the composer, search, post detail, events, messages,
profile, settings and the language screen, reading the accessibility tree the
way an assistive technology reads it — labels, merged subtrees, touch-target
sizes and announcement order.

**Clean, and worth naming because it was checked rather than assumed:**

- **Every tappable control carries a label** on every screen audited, once the
  four fields above were fixed.
- **The selected tab and the selected navigation item expose `selected=true`
  with `clickable=false`** — you cannot activate what is already active, and
  TalkBack announces "Following, selected" rather than offering a pointless
  action.
- **Touch targets meet 48dp.** The new filter control measures exactly 48×48dp.
- **Announcement order matches visual order** on every screen audited.
- **The filter control sits at the logical end of the tab row** — leftmost in
  Urdu, rightmost in English — so the mirroring is real and not drawn twice.

**Two false findings the audit produced before its own tooling was fixed**, both
recorded because either could have become a phantom defect in this file:

1. A flat reading of the XML reported all fifteen of Home's controls as
   unlabelled. Compose puts `clickable` on a parent and the text on a child,
   and TalkBack announces the merged subtree — a control is unlabelled only
   when nothing in its subtree carries a label.
2. A dump taken while a screen was still measuring returned every node at
   `[0,0][0,0]`, and one taken mid-transition returned a half-composed tree.
   Both look exactly like findings. The auditor now refuses an unsettled tree
   instead of reporting from it.

**What the audit cannot do:** judge whether a label is a *good* label, hear the
actual speech, or test gesture navigation and focus traversal with TalkBack
itself enabled. It reads the tree TalkBack reads, which makes a violation real
but a clean result narrower than "accessible".

### RUNTIME-005 · Most failures render nothing at all

**FIXED and runtime-verified.** Found by Flow A, and it wasted an hour of this pass.

`UsernameScreen`'s notice handles `takenMessage`, `ApiFailure.Offline` and
`ApiFailure.Server`. It handles **none** of `Unauthenticated`, `Restricted`,
`Validation`, `RateLimited`, `Unavailable` or `Timeout`. So when
`POST /me/username` answered 401, the screen showed no message, no error, no
change — Continue simply did nothing, twice, with nothing on screen to say why.

The 401 had a real cause (MOBILE-BACKEND-FIX-001) and is fixed. **The silence is
a separate defect and is not.**

Group 20 built `FailureState` to make exactly this exhaustive, over all eight
`ApiFailure` variants, and the auth and setup screens predate it and were never
migrated. The fix is mechanical; what makes it worth doing carefully is that
several of those screens have never been runtime-verified, so a change to their
failure rendering cannot yet be checked by running them.

### RUNTIME-006 · An Urdu label clipped inside a 28dp button

**FIXED and re-verified at Urdu × 130%.** Found by Flow G, measured rather than eyeballed.

Home's empty-state body wraps to **three** lines in Urdu against two in English,
and the primary action button beneath it is squeezed:

| | Height |
|---|---|
| `MohallaButton` normally | 126–127px ≈ **48dp** |
| The Urdu empty-state button | **74px ≈ 28dp**, label clipped |

Group 22's 48dp minimum is real and honoured everywhere the component controls
its own height. This instance is compressed by a parent that ran out of vertical
space, which no source check can see — only a device, in Urdu.

Not fixed: the screen's own two sub-screens (`UX-HOME-005`, `UX-HOME-006`) are
unbuilt, and re-laying out around them blind would be guessing. The measurement
is recorded so the fix can be verified against it.

### OBS-001 · A live OTP is recoverable from its stored hash in under a second

**An observation, not a Stage 7 defect, recorded because it was found here.**

`hashOtpCode` is an **unsalted SHA-256 of a six-digit code**. Brute-forcing the
whole space took under a second on this machine — which is legitimately how the
development OTP was obtained for Flow A, from the local database.

The mitigations are real and documented: five attempts, ten-minute expiry, single
use, and the hash needs database read access to reach. But **anyone holding a
database read holds every live OTP**, and `read_only_support` is one of the four
roles. Whether that is acceptable is a Stage 6 security decision, not a mobile
one.

### GAP-M-016 · Interests can be read and never written

**PROFILE-FR-011** lets somebody choose topics that inform suggested accounts.
The server serves `PUT /me/interests` (PROF-API-009) and returns the chosen list
on the own-profile response. **The client reads that field and has no way to set
it.**

**Why it is recorded rather than fixed.** PROFILE-FR-011 is a **Could**, it
depends on **OD-017**, and the 61-screen UI/UX inventory contains no
interests-selection screen — so building one would be adding a screen the design
does not have, for a requirement nobody has decided to keep. §49's rule against
"nice to have" functionality outside scope applies directly.

**What it costs today.** Suggested accounts (SOCIAL-FR-005) fall back to whatever
the server does without interests, which is the documented degraded behaviour:
*"optional; skipping degrades no other function."* So the cost is quality of
suggestions, not a broken flow.

**How it was found.** `ApiContractTest` — comparing every route the client
declares against Stage 6's generated contract left 29 server routes uncalled, and
this was the one among them that no scope decision, blocked dependency or
transport choice explained.

**To close it:** OD-017, then a screen, then one call.

### GAP-M-017 · Editing a post has a route, a method, and no screen

**POST-FR-008** is a **Could**. `PATCH /posts/{id}` is served,
`PostSource.update` implements it correctly — including six lines explaining why
BR-014 keeps `mediaIds` out of the signature so no client code can attempt to
swap a published image — and **nothing calls it.** There is no edit-post screen in
the inventory.

**Why this is worth an entry rather than a deletion.** The reasoning attached to
that method is right and will be needed the day an edit screen is designed. What
was wrong was that it read like live code. The comment now says plainly that
nothing calls it and why, and `IntegrationWiringTest` pins it so it cannot drift
back into looking reached.

### GAP-M-018 · "Mark all read" was described in a comment and drawn nowhere

`NotificationSource.markAllRead` is declared, implemented against
`POST /notifications/read-all`, and called by nothing. Its neighbour's comment
asserted that *"a reader who scrolls a long way and then taps 'Mark all read' is
served by [markAllRead]"* — **and no such control exists on any screen.** No
button, no menu item, not even a string to label one.

**Not being built, deliberately.** NOTIF-FR-002 asks for "an in-app list …
newest-first with an unread count" where "opening one navigates to the item that
caused it". A bulk control is not in it, and §49 forbids adding functionality
outside scope. So the server's capability stays unused and the comment now says
so.

**The reason both of these matter more than their size.** Group 20 wrote down
that *a callback nothing passes looks exactly like a callback that works*. These
are the same defect one layer lower, and the comments were the thing that made
them invisible — each described a caller, and a described caller reads exactly
like a real one.

### GAP-M-003 · The prototype's attendee stack contradicts the SRS

Recorded as resolved rather than open, because the API settles it.

The prototype draws an attendee avatar stack. **EVENT-FR-004** permits a public
count and states the attendee list is not shown in V1
(ARCH-CONFLICT-006 / D-17). The backend agrees structurally: no
`GET /events/:id/attendees` route exists, and no response field carries an
attendee identity.

**Resolution:** aggregates only, on the card and on the detail screen.
`EventRsvpAndJoinTest` asserts by reflection that `EventResponse` carries no
attendee field, so adding one is a deliberate act with a failing test attached.
The prototype is not to be followed here.

---

## 4 · Known incompleteness inside built screens

Distinct from §3: these are things the client *can* build and has not yet.

| Screen | What is missing | Consequence today |
|---|---|---|
| Home | ~~`UX-HOME-005` and `UX-HOME-006` are not built.~~ **CLOSED.** Both built in the final pass; the filter sits on the tab row because §18.5 caps the top bar at two actions. | Building the filter exposed RUNTIME-012: `CategoryResponse.id` was required and never sent, which had silently disabled POST-FR-006's composer picker as well. |
| Home | ~~An ANNOUNCEMENT notification row is rendered and inert.~~ **CLOSED.** `onOpenAnnouncement` was an empty lambda in the graph; it now navigates. | Every notification row opens what it refers to. |
| `ImagePicker.read` | Untested. It needs a real `ContentResolver` and `BitmapFactory`, so it cannot run on the JVM. | The attachment state machine around it IS tested through the real ViewModel (`AttachmentUploadTest`); the file-reading and compression path itself is only covered by an emulator run that cannot happen here. |

**A Must requirement was found unimplemented in group 23 and is now built.**
**PROFILE-FR-006** — account type — asks the user to choose Individual or
Organization at registration. `RegisterRequest.accountType` had been declared
since group 03, typed correctly, nullable exactly as the server's own
`.optional()` schema is, and **set by nobody**: `explicitNulls = false` dropped it
from every request body and `register.service.ts` applied its
`?? 'INDIVIDUAL'` default. BR-011 makes the value *"set once, not
user-changeable"*, and **OD-020** forbids provisioning the administrator who could
correct it — so every mosque, school or union office that had signed up through
this app was permanently recorded as an individual, with no route back.

Group 04 looked straight at this and drew half the right conclusion. Its comment
in `ProfileSetupViewModel` says the create-profile body *"has no `accountType`
field at all, so there is nothing here to send: the type is set at
registration."* The first half is true. The second was an assumption, and
registration was not setting it either. The choice now sits under the phone field
on UX-AUTH-005, with the caption BR-011 requires and §13's rule that Organization
*"does not automatically show a verified badge"*; `register()` takes an
`AccountType` as a required parameter, so no caller can omit it again, and
`RegisterFlowTest` asserts the call site passes it.

**Every Report control in the app is now wired**, which is what closed the last
row of this table. Three were inert or removed while UX-SAFE-001 did not exist;
all three are back with the sheet behind them, and a comment and an account
gained entry points that never existed.

Three items left this table in group 08 and are now built: the event composer's
date and time picker, profile setup's photo picker, and the post card's media and
avatar rendering. **The bottom bar's Messages tab left it in group 12** — it now
opens the inbox. **Both shell badges left it in group 13**: the Messages count
and the Home bell's count were declared fields that nothing populated, and the
shell now reads them and re-reads them on resume.

---

## 5 · Deliberate exclusions — not gaps

Listed so nobody records them as missing.

- **Phase 2 in its entirety** (§49): iOS, private profiles, groups, video, dark
  mode, two-factor authentication. Not implemented, not scaffolded.
- **The Admin Web Portal.** Not part of Stage 7.
- **A dark theme.** One light scheme by design; §49 defers dark mode.
- **Hilt.** A manual DI container is a recorded architecture decision, not an
  omission — annotation processing adds a build step and a class of failure for
  a graph this size.
- **An HTTP logging interceptor**, in any build type. SEC-028 forbids logging
  tokens, phone numbers and message content, and a request body on this product
  contains all three. `okhttp-logging` is not on the classpath, which is easier
  to keep true than remembering to gate it behind `BuildConfig.DEBUG`.
- **A gallery-wide media permission.** `PickVisualMedia` grants access to the one
  file chosen — no runtime prompt at all. Asking for `READ_MEDIA_IMAGES` would
  request an entire photo library to obtain one picture, which PRIV-001's
  data-minimisation rule rules out as plainly as an unnecessary column. Confirmed
  built this way in group 08; the manifest still declares only `INTERNET` and
  `ACCESS_NETWORK_STATE`.
- **A client-side link preview.** POST-FR-004 fetches it **server-side by
  requirement**: SEC-014 keeps the user's IP from reaching the linked host. A
  device that fetched its own preview would defeat that, so there is no client
  action to build and the attachment sheet explains rather than offers.
- **A server-side draft.** §19: "draft persists locally, never uploads." There is
  no autosave request and no drafts endpoint.
