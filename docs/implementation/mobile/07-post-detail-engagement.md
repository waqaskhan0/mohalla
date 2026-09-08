# 07 — Post detail and engagement

**Stage 7 · Android** · §48 module record

> Redistributed from the canonical records rather than written afresh: the screen rows come from [`17-mobile-screen-coverage.md`](17-mobile-screen-coverage.md), the requirement rows from [`18-mobile-requirement-traceability.md`](18-mobile-requirement-traceability.md), the runtime results from [`19-mobile-test-report.md`](19-mobile-test-report.md) and the open items from [`20-mobile-open-issues.md`](20-mobile-open-issues.md). Where a fact is absent it says **NOT YET VERIFIED** rather than guessing.

---

## Screens

| Screen | Name | Requirements | APIs | LTR | RTL | Loading | Empty | Error | Offline | A11y | Tests | Runtime | Status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| UX-HOME-003 | Post detail | POST-FR-007/009/010 · ENGAGE-FR-001…007 | `/posts/:id` · `/comments` · `/like` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ |
| UX-HOME-004 | Image viewer | MEDIA-FR-002 | `GET /media/:id` | ✅ | ✅ | ✅ | — | ✅ | ✅ | ✅ | ✅ | — | ✅ |

**Runtime.** **NOT EXECUTED**: `UX-HOME-003`, `UX-HOME-004`.

## Requirements

| Req | Title | Pri | API | ViewModel / use case | Test | Status |
|---|---|---|---|---|---|---|
| ENGAGE-FR-001 | Like and unlike | Must | `DELETE /posts/{id}/like` · `PUT /posts/{id}/like` | PostDetailViewModel | PostDetailTest | `IMPLEMENTED` |
| ENGAGE-FR-002 | Comment on a post | Must | `GET /posts/{id}/comments` · `POST /posts/{id}/comments` | PostDetailViewModel | PostDetailTest | `IMPLEMENTED` |
| ENGAGE-FR-003 | Reply to a comment | Should | `POST /comments/{id}/replies` | PostDetailViewModel | PostDetailTest | `IMPLEMENTED` |
| ENGAGE-FR-004 | Delete own comment | Must | `DELETE /comments/{id}` | PostDetailViewModel | PostDetailTest | `IMPLEMENTED` |
| ENGAGE-FR-005 | Post author deletes a comment | Should | — | PostDetailViewModel | PostDetailTest | `IMPLEMENTED` |
| ENGAGE-FR-006 | Engagement counts | Must | — | PostDetailViewModel | PostDetailTest | `IMPLEMENTED` |
| ENGAGE-FR-007 | Share externally | Should | — | PostDetailViewModel | PostDetailTest | `IMPLEMENTED` |
| ENGAGE-FR-008 | Mentions | Could | — | — | — | `DEFERRED SHOULD` |

- **ENGAGE-FR-008** — A Could. `GET /mentions/suggest` exists in the Stage-4 API design and is not served by Stage 6, so there is nothing to call.

## What this module decided, and why

|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| — | Comment item · reply item | ENGAGE-FR-002/003 · BR-033 | — | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

### What post detail and engagement decided, and why it is written down

**The post renders from cache instantly; only comments load.** §19 says so in
those words, and honouring it needed something to hold the object between two
screens that pass only an id. `PostCache` is that — bounded at one feed page,
insertion-ordered, in memory only, and **never a source of truth**: the detail
screen renders the cached copy AND fetches the real one, and `postConfirmed`
gates anything irreversible so a post is never *deleted* on the strength of a
cached author id. A post the server reports gone is forgotten from the cache, or
"renders instantly" would keep showing a withdrawn post for the life of the
process.

**A refused comment keeps its text.** ENGAGE-FR-002's error case is exact —
"post deleted while composing → submission refused with a clear explanation and
the text preserved for copying" — so the draft is cleared only on success. Its
acceptance criterion ("the typed text is not lost") is asserted directly, for
both the deleted-post case and offline.

**Replies nest exactly one level, and the client aims at the parent.** BR-033
allows one level and says "a reply to a reply attaches to the same parent
thread". The server would correct a mis-aimed reply, but relying on that would
mean the client sends something it knows to be wrong — so `replyTo` resolves a
reply to its thread parent before the request. The threading itself is a pure
function over the flat list the server sends, which is why it has no recursive
case to get wrong.

**An orphaned reply is promoted, not dropped.** A reply whose parent is on a
later page or was deleted between pages would otherwise vanish, and silently
losing somebody's words is worse than a small ordering oddity.

**Deleting a comment removes its replies in one request.** ENGAGE-FR-004's
acceptance criterion is that three replies go with their parent; the server does
that, and the client mirrors it locally rather than re-requesting — otherwise the
thread briefly shows orphaned replies, and three extra round trips achieve what
one already did. A **failed** deletion removes nothing: a comment that vanished
and came back is worse than one that took a moment to go.

**Two people may delete a comment.** Its author, and the **post's** author
(BR-020, "which distributes moderation away from administrators"). Anybody else
gets the same neutral 404, so a third party cannot probe who wrote what — and the
Delete control is *absent* rather than disabled for them, because a visible
Delete on somebody else's comment suggests the product permits it.

**The author may like their own post.** BR-031 says so explicitly, so there is no
author check on the like path — and there is a test for it, because "don't let
people like their own posts" is the kind of rule somebody adds by instinct.

**Rapid taps send one request.** ENGAGE-FR-001's acceptance criterion is that six
taps change the count by at most one. The server guarantees that through its
composite key; the client guard is about the *visible* state, which two racing
requests would leave up to whichever landed last.

**Zoom and paging fight for the same gesture, and paging loses while zoomed.** In
the image viewer a horizontal drag means "next image" at 1× and "pan" once
magnified, so the pager is disabled above 1× and re-enabled on return. Without
that, panning a zoomed-in poster sideways flicks to the next image — which makes
zoom useless for exactly the awareness posters MEDIA-FR-002 names. The zoom
resets on every page change, because landing on the next image already magnified
and off-centre leaves no visible way back to the whole picture.

**The viewer is on a dark ground, and that is not dark mode.** §49 defers dark
mode; a viewer's job is to get out of the way of what is being looked at, and
light chrome around a photograph competes with it. Every other surface stays on
the light scheme.

**A comment's counter appears only near the limit, and a post's is always
visible.** Deliberately different: a comment is usually a sentence and a
permanent counter on a one-line field is furniture, while the post composer is
the one field in the product where people write to the 3,000-grapheme limit on
purpose.

**Sharing produces a link and no excerpt yet.** ENGAGE-FR-007 asks for "a link to
the post plus a short excerpt", and the excerpt is withheld on purpose: the
canonical share URL is group 22's deep-link work, and a placeholder host would
put a broken link into a WhatsApp message nobody can edit. The share base is
`mohalla.invalid`, which fails visibly rather than being a domain somebody might
register. The requirement's login rule needs no extra work — the deep link lands
on the post route behind the startup resolver, so an unauthenticated arrival is
routed to Welcome by the same rule as every cold start.

**One defect this group found in itself:** a KDoc containing a slash-star glob
(`/feed/` followed by an asterisk) silently swallowed the rest of the file.
Kotlin block comments **nest**, so the sequence opened a comment that never
closed, and the compiler reported it 400 lines later as an unrelated unresolved
reference. Worth knowing, because it is invisible on inspection.

## Commits

- `564dd9c Stage 7 group 22 (Accessibility, RTL and performance): RTL was clean, contrast was not, and 55 sites were below AA`
- `068c0e6 Stage 7 group 17 (Safety): one acknowledgement whatever happened, and every inert Report control made real`
- `ddacc58 Stage 7 groups 14-15 (Profiles and the social graph): the client could not send a JSON null, and two features were silently broken by it`
- `d89d6d2 Stage 7 group 09-10 (Post detail and engagement): a cache that fills one frame, a comment that survives refusal, and one level of nesting`

