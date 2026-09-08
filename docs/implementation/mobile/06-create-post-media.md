# 06 — Create post and media

**Stage 7 · Android** · §48 module record

> Redistributed from the canonical records rather than written afresh: the screen rows come from [`17-mobile-screen-coverage.md`](17-mobile-screen-coverage.md), the requirement rows from [`18-mobile-requirement-traceability.md`](18-mobile-requirement-traceability.md), the runtime results from [`19-mobile-test-report.md`](19-mobile-test-report.md) and the open items from [`20-mobile-open-issues.md`](20-mobile-open-issues.md). Where a fact is absent it says **NOT YET VERIFIED** rather than guessing.

---

## Screens

| Screen | Name | Requirements | APIs | LTR | RTL | Loading | Empty | Error | Offline | A11y | Tests | Runtime | Status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| UX-CREATE-001 | Composer | POST-FR-001/003/006 · BR-012/013 · EDGE-011/013 | `POST /posts` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ |
| UX-CREATE-002 | Image picker & compress | MEDIA-FR-001/005 · NFR-PERF-005 | `/media/upload-slot` | ✅ | ✅ | ✅ | — | ✅ | ✅ | ✅ | ✅ | — | ✅ |
| UX-CREATE-003 | Attachment sheet | POST-FR-002/004/005 | — | ✅ | ✅ | — | — | — | — | ✅ | ✅ | — | ◐ |
| UX-CREATE-004 | Category picker | POST-FR-006 · BR-017 | `GET /categories` | ✅ | ✅ | ✅ | ✅ | — | — | ✅ | ✅ | — | ✅ |

**Runtime.** **NOT EXECUTED**: `UX-CREATE-001`, `UX-CREATE-002`, `UX-CREATE-003`, `UX-CREATE-004`.

## Requirements

| Req | Title | Pri | API | ViewModel / use case | Test | Status |
|---|---|---|---|---|---|---|
| MEDIA-FR-001 | Image upload and compression | Must | `POST /media/upload-slot` | ImageUploader · ProfileSetupViewModel | AttachmentUploadTest · SetupOnboardingTest | `IMPLEMENTED` |
| MEDIA-FR-002 | Image viewer | Must | — | — | PostCacheTest | `IMPLEMENTED` |
| MEDIA-FR-003 | Document upload | Should | — | ComposerViewModel | AttachmentUploadTest | `BLOCKED EXTERNAL` |
| MEDIA-FR-004 | Document open | Should | — | — | — | `BLOCKED EXTERNAL` |
| MEDIA-FR-005 | Upload limits enforcement | Must | `POST /media/upload-slot` · `POST /media/{id}/complete` | ImageUploader | AttachmentUploadTest | `IMPLEMENTED` |
| POST-FR-001 | Create a Post | Must | `POST /posts` | ComposerViewModel | ComposerTest | `IMPLEMENTED` |
| POST-FR-002 | Attach single image | Must | — | ComposerViewModel | AttachmentUploadTest | `IMPLEMENTED` |
| POST-FR-003 | Attach multiple images | Should | — | ComposerViewModel | ComposerTest | `IMPLEMENTED` |
| POST-FR-004 | Attach link | Should | — | ComposerViewModel | AttachmentUploadTest | `PARTIAL` |
| POST-FR-005 | Attach PDF | Should | — | ComposerViewModel | AttachmentUploadTest | `BLOCKED EXTERNAL` |
| POST-FR-006 | Category tag | Should | `GET /categories` | ComposerViewModel | ComposerTest | `IMPLEMENTED` |
| POST-FR-007 | Delete own post | Must | `DELETE /posts/{id}` | PostDetailViewModel | PostDetailTest | `IMPLEMENTED` |
| POST-FR-008 | Edit own post | Could | `PATCH /posts/{id}` | PostSource.update (uncalled) | IntegrationWiringTest | `DEFERRED SHOULD` |
| POST-FR-009 | View post detail | Must | `GET /posts/{id}` | PostDetailViewModel | PostDetailTest | `IMPLEMENTED` |
| POST-FR-010 | Length enforcement | Must | — | PostDetailViewModel | PostDetailTest | `IMPLEMENTED` |

- **MEDIA-FR-003** — Document upload ships only behind the ADR-013 PDF safety gate, which OD-023 leaves conditional and Technical-Lead unapproved. The attachment sheet refuses PDFs rather than pretending.
- **MEDIA-FR-004** — Opening a document depends on the same ADR-013 gate; `GET /media/{id}` is served but nothing may call it yet.
- **POST-FR-004** — Link attachment is built; the preview depends on the server’s own fetch.
- **POST-FR-005** — PDF attachment ships only if ADR-013 safe inspection is built and Technical-Lead approved; OD-023 says otherwise it is CUT. The attachment sheet therefore refuses a PDF and says why, which is the approved behaviour rather than a missing feature.
- **POST-FR-008** — A Could with no designed screen. The route and the repository method both exist and nothing calls them — GAP-M-017, now pinned so it cannot read as live code again.

## What this module decided, and why

|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| — | Media rendering · avatar · strip | MEDIA-FR-001 · §34 | `GET /media/:id` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| — | Upload tile ×5 states | §19 · §34 · EDGE-013 | `/media/*` | ✅ | ✅ | ✅ | — | ✅ | ✅ | ✅ |
| — | Date and time picker | §18 | — | ✅ | ✅ | — | — | — | — | ✅ |

**UX-CREATE-002 has no crop step, and is still `✅`.** The screen's title in §19
names "select up to 4 images, crop, and compress on the device". Selection and
compression are built; crop is not. Android's own picker offers none, and a
hand-rolled cropper is a gesture surface that has to work under RTL mirroring, at
130% font scale, on a 720×1280 screen — for an outcome the compression step
already delivers, since every image is scaled to a 1600px longest edge and
re-encoded regardless. Marked `✅` rather than `◐` because the screen's *purpose*
— get a transmittable image onto a post — is met; the omission is recorded as a
reduction in `20-mobile-open-issues.md` rather than hidden.

**UX-CREATE-003 is `◐` — two of its three offers do not exist to build.** The
sheet offers images, and explains the other two rather than faking them:

- *A link* (POST-FR-004) has **no client action by requirement**. SEC-014: "the
  preview is fetched server-side, never by the device, so the user's IP is not
  disclosed to the linked host." A URL typed into the post is detected and
  previewed by the server, so an "attach a link" button would paste nothing. The
  sheet says a link in the text is enough — the honest version of the same offer.
- *A document* (MEDIA-FR-003) is a *Should*, and its 10MB PDF path is gated on
  the ADR-013 review that has not happened. Absent rather than greyed: a disabled
  row invites a tap that reports nothing useful.

### What the create-and-media group decided, and why it is written down

**Each attachment uploads independently and retries alone, and this is enforced
by the type rather than by care.** EDGE-013's acceptance criterion is that
retrying the third of four does not re-upload the other three. A `Ready`
attachment **drops its bytes** the moment its upload succeeds, so a retry has
nothing to send even if one were requested — and `retryAttachment` can only reach
a `Failed` one. The test counts upload calls and asserts **five** for four images
plus one retry; asserting the final state would pass on a composer that re-sent
everything.

**`Failed` and `Rejected` are separate states, and collapsing them is the defect
the type prevents.** A dropped connection keeps the bytes and offers a retry; a
file the server inspected and refused drops both, because retrying the same bytes
will be refused again. One "upload failed" state produces a retry button that can
never work — worse than none, because people keep pressing it.

**No post is created until every attachment is ready.** EDGE-011: an upload
interrupted at 80% leaves "no post created" and the text preserved. Publishing is
gated in `canPost`, and the draft is cleared **only after** a successful publish —
clearing it optimistically and then failing would lose the words to exactly the
dropped connection the requirement is about.

**The draft is encrypted, and the reason is not the obvious one.** A published
post is public by definition (BR-VIS-001), so plain preferences would do. An
*unpublished* draft is different: somebody half-way through writing about a local
official or a contested project, who has not decided whether to send it. That is
the one piece of user text on the device whose exposure the author has explicitly
not consented to, and the Keystore-backed store already exists. Attachments are
deliberately **not** persisted — a media id would name a quarantine object the
server's sweep may already have collected.

**The composer holds no Android types, and that was a design change made for
testability.** `ComposerViewModel` takes an `ImageSource` and speaks in URI
strings rather than `android.net.Uri`, because `Uri.parse` throws off a device —
a ViewModel holding one would have put every rule in the attachment state machine
behind Robolectric. The `Uri` is parsed at the picker, which is the boundary where
the Android type belongs. The alternative considered and rejected was a
`FakeComposer` in the test file, which would have asserted that the test file
works.

**The full photo is never buffered.** `ImageCompressor` takes a *stream factory*
and opens it twice — once for the header alone with `inJustDecodeBounds`,
allocating nothing, and once for the pixels with a sample size already chosen.
Reading a 12-megapixel photo into a `ByteArray` first would commit tens of
megabytes of heap on the 2GB device NFR-COMP-002 targets, to hand it to something
that was going to downsample it anyway.

**No storage permission was added.** `PickVisualMedia` grants access to the one
file chosen — no runtime prompt, no gallery-wide read. Asking for
`READ_MEDIA_IMAGES` would request an entire photo library to obtain one picture,
which PRIV-001's data-minimisation rule rules out as plainly as an unnecessary
column, and it is the difference between a dialog a cautious user declines and no
dialog at all.

**Coil's singleton is set on the `Application`, not through a composition
local.** This was Coil's own deprecation notice, and it is right: providing an
`ImageLoader` through `LocalImageLoader` does *not* replace the singleton, so any
path reaching `AsyncImage` without the local in scope quietly builds a second
loader — with its own caches on the same directory and **no auth interceptor**.
`GET /media/:id` is authenticated, so the symptom would have been images loading
on some screens and not others. `MohallaApplication` implements
`ImageLoaderFactory` instead. This is the first `Application` class in the
project, and it deliberately does nothing else — eagerly building repositories
and a Keystore store there would move all of it onto the cold-start path that
NFR-PERF-003 budgets.

**A media id is resolved to a URL in exactly one place.** Every call site that
composed its own `"$base/media/$id"` would be a call site that could get the base
wrong, forget the token, or leak an id into a log.

**§17 and §19 disagree about the thumbnail, and the grid won.** §19 specifies
"thumbnails 82 with 10 gap"; both numbers are off the 4dp grid that §17 calls a
defect ("no 6px, no 10px, no 14px, no 18px anywhere in the product"). Resolved to
80dp tiles with an 8dp gap: a 2dp difference in a thumbnail is invisible, an
off-grid value is a rule broken, and four 80dp tiles with three 8dp gaps come to
344dp — which fits a 360dp screen's margins with nothing spare, so the row scrolls
rather than wrapping. The 3px progress bar §34 asks for stays 3px, because that
is the thickness of a drawn rule rather than a gap between things — the same
category as the top bar's 1dp hairline.

**Three callbacks that had been inert since earlier groups are now real:** the
post card renders its media and its author's avatar, profile setup can choose a
photo (PROFILE-FR-002), and the event composer can pick a date and time — which
is what closes UX-EVENT-004 and UX-EVENT-005.

## Commits

- `f32b3de Stage 7 group 23 (Integration validation): a Must nobody had implemented, three declarations nothing called, and a coverage table in three shapes`
- `564dd9c Stage 7 group 22 (Accessibility, RTL and performance): RTL was clean, contrast was not, and 55 sites were below AA`
- `3f764cd Stage 7 group 08 (Create and media): per-attachment uploads, an encrypted draft, and three callbacks that stop being inert`
- `727871b MOBILE: profile onboarding — the username race, grapheme counting, and a compression ceiling that refuses`

