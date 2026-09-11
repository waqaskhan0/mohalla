# Admin portal QA

| | |
| --- | --- |
| **Admin E2E (HTTP + database)** | **13 / 13**, both portal builds |
| **Admin security suite** | **15 / 15** |
| **Browser rendering** | 7 of 9 screens verified visually; 2 `BLOCKED_ENVIRONMENT` — reason below |

## Which build was driven, and why it had to be the development one

A browser **cannot** hold a session on the production build over `http://`.
That is QA-002's finding working as designed: a production build names its
cookie `__Host-mohalla_admin_session`, and browsers refuse a `__Host-` cookie on
an insecure origin. There is no TLS terminator on this host.

So the split is:

| Build | Driven by | Covers |
| --- | --- | --- |
| **production** (`next start`) | `e2e:admin` over HTTP, which is not bound by browser cookie rules | behaviour, authorization, decisions, audit |
| **development** (`next dev`) | a real browser | rendering, layout, copy |

Neither substitutes for the other, and the production cookie policy was not
weakened to make the browser work.

## Screens

| | Screen | Browser | Evidence |
| --- | --- | --- | --- |
| UX-ADM-001 | Login | **PASS** | renders; wrong credentials give *"That email or password is not right."* — no disclosure of whether the account exists |
| UX-ADM-002 | Dashboard | **PASS** | renders with real figures — verified below |
| UX-ADM-003 | Moderation queue | **BLOCKED_ENVIRONMENT** | content present in the DOM, reveal never runs — see below |
| UX-ADM-004 | Queue item detail | **BLOCKED_ENVIRONMENT** | same streaming pattern |
| UX-ADM-005 | Users | **PASS** | *"a lookup rather than a directory"*; result carries no phone, email or DOB |
| UX-ADM-006 | User detail | **PASS** (API) | 200, and no E.164 number anywhere in the payload |
| UX-ADM-007 | Announcements | **PASS** | English + Urdu fields, and states ADMIN-API-GAP-009 plainly |
| UX-ADM-008 | Verification | **PASS** | organization-only, no request queue, gap documented on screen |
| UX-ADM-009 | Audit log | **PASS** | *"append-only and read only… not from any other interface or permission level"* |

## The dashboard figures, checked against the backend

Section 15 forbids accepting plausible-looking metrics. The API and the
database were read in the same moment, using **the API's own SQL definitions**
rather than a naive count:

| Metric | API | Database | |
| --- | --- | --- | --- |
| `openReports` | 2,230 | 2,230 | exact |
| `totalUsers` | 8,628 | 8,628 | exact |
| `newUsersToday` | 2,692 | 2,692 | exact |
| `postsToday` | 1,937 | 1,899 | sliding window |
| `upcomingEvents` | 986 | 985 | sliding window |

My first comparison used naive SQL and differed on three metrics. Reading the
repository showed why: `postsToday` counts only `visibility_state = 'VISIBLE'`
and `upcomingEvents` the same, neither of which my query did. With the real
definitions, three match exactly and the last two differ only because both are
`now()`-relative windows that move between two measurements a minute apart.

**No defect.** The naive query was mine.

## Why two screens are BLOCKED_ENVIRONMENT rather than failed

The moderation queue renders *"Loading the queue…"* in the browser and never
resolves. That is not the product. Measured in the live DOM:

```
domBytes            73,036
visibleTableRows    26
reviewLinksInDom    40
pendingTemplates    1
hasLoadingText      true
```

The resolved queue **is in the document** — 26 rows, 40 Review links — behind a
fallback that was never removed. Chasing the mechanism:

| | |
| --- | --- |
| React's reveal functions `$RS` / `$RV` | present, and correctly nonce'd under the CSP |
| Inline scripts | 9, of which 8 carry a nonce and the 1 without is **empty** |
| `$RB` (pending boundary queue) | **2 entries waiting** |
| `document.visibilityState` | **`hidden`** |
| `requestAnimationFrame` | **never fires** (waited 2 s) |

React defers Suspense reveals to `requestAnimationFrame`; the Browser pane keeps
every page hidden; browsers suspend rAF in hidden tabs. The content arrived, the
reveal was queued, and no frame ever came. Fronting the tab does not change
`visibilityState` in this harness.

CSP was the first suspect and was **ruled out** — the one un-nonce'd inline
script is empty, and the reveal machinery is nonce'd correctly.

This also explains Stage 9's INTEGRATION-012 better than the explanation given
there. The bad cookie was real, but it was not the whole story: this rAF
mechanism is why a *correctly authenticated* streamed page still shows its
skeleton in this harness.

## Security and privacy — 15 checks, all passing

### Reported-conversation privacy (release-critical)

| Check | Evidence |
| --- | --- |
| An administrator cannot fetch a conversation without a case | 404 |
| **There is no admin route that reads a conversation by its own id** | 404 |
| An admin token cannot use the product route either (SEC-020) | 401 |
| A conversation can be reported | 202 |
| A moderation case is created for it | yes |
| **With a case, the bounded excerpt is available** | 200 |
| The access is written to the audit log | 19 → 20 |
| Holding one case does not open an unrelated conversation | unrelated id absent from the response |

The excerpt returned **0 messages** — the shape is `{ messages: [] }`. Worth
being exact about: that is *more* private than the test required, not less, and
it matches the documented ADMIN-API-GAP for reported content. Whether a
moderator can act on an empty excerpt is a product question for the owner, not
a privacy failure.

### Admin-on-admin, audit, PII

| Check | Evidence |
| --- | --- |
| **No enforcement action succeeds against an administrator id** | suspend, ban and verification all refused |
| And the administrator row is untouched | still `ACTIVE` |
| **No admin route can delete, edit or forge an audit entry** | DELETE / PATCH / PUT / POST all refused |
| **And the database refuses an `UPDATE` even as the migration owner** | rejected at the database |
| A user detail carries no raw phone number by default | no E.164 in the payload |

The database-level refusal is the one that matters most: it is the guarantee
that survives somebody adding a route by mistake later.
