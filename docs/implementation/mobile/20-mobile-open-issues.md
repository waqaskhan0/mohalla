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
| **OD-015** | Terms of Service and Community Guidelines do not exist. Now a **release blocker**: `TERMS_VERSION` is empty in the release build config, `RegisterViewModel` refuses to submit a blank version, and the terms screen states that registration is unavailable. | Publish the documents **and** set the version in `apps/android/app/build.gradle.kts`. |
| **OD-016 / DEP-011** | ~400 Urdu strings are written and structurally correct — locale parity is enforced by a build-failing test — but have not been reviewed by a native speaker. This is not a substitute for that review. | Shehersaaz language review. |
| **OD-020** | No named technical owner (DEP-016), so no administrator may be provisioned and no bootstrap endpoint exists in any environment. The suspension explainer's appeal route therefore points at a support address rather than an in-app queue: a form filing into a queue nobody reads would be worse than saying where to write. | Name a technical owner. |
| **DEP-013** | Noto Naskh Arabic and Noto Nastaliq are not bundled. Both currently resolve to the platform serif, which renders Urdu correctly on API 26+ but is not the approved face. | Supply the licensed font files. |
| **Licence** | No open-source licence has been added, and none may be added without explicit authorization. | Shehersaaz. |

---

## 2 · Environment — blocks verification, not implementation

| | |
|---|---|
| **No AVD, no system image, no device** | `adb devices` is empty. Every Compose UI test and every §44/§45 end-to-end flow **cannot run** here. Needs roughly a 1 GB system-image download. |
| **What was done instead** | Every rule that can be asserted without a device was written as a JVM unit test rather than deferred: the RTL invariants, the state machines, the cursor sequences, the neutral-refusal structure, locale and zone handling, and the composer's
per-attachment upload sequencing. **194 tests, all passing.** |
| **What that does not prove** | That pixels mirror. The tests prove Create sits at index 2 of 5 and that the list is never pre-reversed; they cannot prove the row renders right-to-left. §36 makes RTL release-critical, so this gap is the largest single verification debt in Stage 7. |

The manifest defect found in group 05–06 is the argument for closing it:
`INTERNET` was missing for four groups of screens, and every API call would have
thrown a `SecurityException` on the first request. Nothing caught it because
nothing had ever run against a backend on a device.

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
| UX-EVENT-003 | The report action is present but inert — the report sheet is UX-SAFE-001, group 17. | The creator's Edit action works; a non-creator's Report does nothing yet. |
| Post card | Tapping an image does nothing — MEDIA-FR-002's full-screen viewer is `UX-HOME-004`, group 09. | Images render and the count shows; there is nowhere to open them. |
| Home | `UX-HOME-005` category filter sheet and `UX-HOME-006` announcement detail are not built. | `selectCategory` exists in the ViewModel and the filter reaches the API; there is no picker to drive it. |
| `ImagePicker.read` | Untested. It needs a real `ContentResolver` and `BitmapFactory`, so it cannot run on the JVM. | The attachment state machine around it IS tested through the real ViewModel (`AttachmentUploadTest`); the file-reading and compression path itself is only covered by an emulator run that cannot happen here. |

Three items left this table in group 08 and are now built: the event composer's
date and time picker, profile setup's photo picker, and the post card's media and
avatar rendering.

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
