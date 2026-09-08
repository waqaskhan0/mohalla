# 20 — Mobile Open Issues

**Stage 7 · Android** · the register of what is blocked, missing, or knowingly
incomplete — and who can clear it.

> Nothing in this file is a to-do list for the implementation. Every item here
> is either **outside the app's control** (an authorization, a document, a
> device) or a **gap between two specifications** that the client cannot close
> by itself. Work that is simply not built yet lives in
> `17-mobile-screen-coverage.md`, which counts it.

---

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
| **No AVD, no system image, no device** | `adb devices` is empty. Every Compose UI test and every §44/§45 end-to-end flow **cannot run** here. Needs roughly a 1 GB system-image download. |
| **What was done instead** | Every rule that can be asserted without a device was written as a JVM unit test rather than deferred: the RTL invariants, the state machines, the cursor sequences, the neutral-refusal structure, locale and zone handling, the composer's
per-attachment upload sequencing, the comment thread's one-level nesting, and
search's failed-versus-empty rule, messaging's send idempotency and duplicate
reconciliation, the notification centre's day boundary in the reader's own
timezone, the encoded shape of a PATCH body that has to distinguish absent from
null, the ordering of the deletion consequences PRIV-006 requires a user to read,
which of the eight API failures each of §21's four states answers for, and the
exact field shape of every type that enforces a privacy rule structurally. **442 tests, all passing.** |
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

**To close it:** the real share host, then one line adding the first ~140
graphemes of the post body to the intent's `EXTRA_TEXT`.

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
| Home | `UX-HOME-005` category filter sheet and `UX-HOME-006` announcement detail are not built. | `selectCategory` exists in the ViewModel and the filter reaches the API; there is no picker to drive it. |
| Home | `UX-HOME-006` announcement detail is not built, so an ANNOUNCEMENT notification row is rendered and inert. | Every other notification row opens what it refers to. |
| `ImagePicker.read` | Untested. It needs a real `ContentResolver` and `BitmapFactory`, so it cannot run on the JVM. | The attachment state machine around it IS tested through the real ViewModel (`AttachmentUploadTest`); the file-reading and compression path itself is only covered by an emulator run that cannot happen here. |

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
