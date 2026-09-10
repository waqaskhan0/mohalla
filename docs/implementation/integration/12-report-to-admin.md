# Group 12 — a user report reaching the Admin queue

Baseline: `a16d25bc2de4acdf24998d87225ab17a96cdcd90`.

29 checks at real HTTP against the running backend and PostgreSQL. **All PASS**
at the API and database levels. The Admin **rendered-UI** leg is
`BLOCKED_LOCAL` for an environment reason recorded below, and is not claimed as
a pass.

## Threshold logic, measured one reporter at a time

| Check | Evidence |
| --- | --- |
| A report is accepted | 202 |
| **One report does not hide a post** — the threshold is three (BR-044) | `VISIBLE` |
| And it stays readable by everyone else | 200 |
| But a moderation case exists from the first report | 1 case, `OPEN` |
| **A second report from the same person cannot move the threshold** | still `VISIBLE`, 1 distinct reporter |
| Two distinct reporters still do not hide it | `VISIBLE` |
| **The third distinct reporter auto-hides it** | `AUTO_HIDDEN` |
| **And nothing is deleted** — the row and its body are intact, only hidden | state `AUTO_HIDDEN`, body unchanged |
| The case records three distinct reporters | 3 |
| And that it was auto-hidden | `auto_hidden true` |

The re-report check is the one worth having: a threshold that counted reports
rather than *distinct reporters* would let one person hide anything by tapping
three times.

There is no `deleted_at` column — deletion is a visibility state, which is
itself why auto-hide is reversible: `AUTO_HIDDEN` is a different value from
`AUTHOR_DELETED` and `ADMIN_REMOVED`, and the row and its body survive
untouched. A threshold that destroyed content would make a brigade a delete
button.

## Thresholds differ by target, and that is deliberate

| Target | Threshold | Measured |
| --- | --- | --- |
| POST | 3 | 1 no, 2 no, 3 hides |
| EVENT | **2** | 1 no, **2 hides** |
| PROFILE | none | 3 reports, still `ACTIVE`, but a case reaches a moderator |

EVENT is 2 rather than 3 (BR-044, S2-CR-003) *"because a fake gathering wastes
real travel and time"* — the one place the safety bar is deliberately lower.
Asserted rather than trusted, because a single shared constant would silently
unify them and nothing would notice.

A PROFILE has no threshold: hiding a person on report count would be a
denial-of-service on identity. The case still reaches a moderator, which is the
whole mechanism for profiles.

## What each surface sees after the auto-hide

| Surface | Evidence |
| --- | --- |
| **The author** still sees their own hidden post (BR-032) | 200, `underReview: true` — so they can appeal what they can see |
| **Everyone else** gets the neutral refusal | 404 `RESOURCE_UNAVAILABLE`, "This content is no longer available." |
| And that refusal names no moderation, report, hide or review | asserted against the body |
| The feed | the post is gone from it |

## The Admin queue, at the API

| Check | Evidence |
| --- | --- |
| **The case is in the moderation queue** | found, severity `HIGH` |
| With the distinct reporter count the backend computed | 3 |
| Flagged auto-hidden, so a moderator knows it is already down | `autoHidden true` |
| Typed as a post | `POST` |
| The case detail opens for an administrator | 200 |
| **The case is OPEN and undecided** | `state OPEN`, `resolved_at null` |

The last row matters: an auto-hide is a holding action, not a decision. A queue
entry that arrived already resolved would mean the threshold had decided the
outcome.

### ADMIN-API-GAP-004 and -005, carried forward unchanged

§7 describes UX-ADM-004 as *"full content, every report, author history"*. The
API provides the third and neither of the first two, and Stage 8 recorded both
and deliberately declined to invent endpoints — adding one would materially
alter approved behaviour, and reading the content through the public API as an
administrator would bypass the audit trail that makes administrator access
reviewable.

So this group asserts the **documented shape**, not the aspiration:

| Check | Evidence |
| --- | --- |
| The case carries aggregates; individual reports are still absent (GAP-005) | `reports` absent, `distinctReportCount 3` |
| The reported content is still absent (GAP-004) | body absent, as documented |
| But the author history the API does provide is present | `enforcementHistory`, `repeatOffenderFlag` |

My first version of these checks asserted UX-ADM-004's intent and failed. That
was the assertion being wrong about the current approved state, not a new
defect — and the gaps are unchanged since Stage 8.

## INTEGRATION-012 — the Admin portal cannot be rendered in this environment

The Admin consuming-UI leg of this flow could not be verified, and this is
recorded rather than skipped because groups 13–18 depend on the same surface.

What was measured:

- `next dev` serves these pages **truncated**. `/moderation` returns 22,177
  bytes containing the loading skeleton and exactly **one** `self.__next_f.push`
  chunk — the resolved segment is never flushed. Reproducible three times in a
  row **over plain `curl`, with no browser involved**, so it is not the in-app
  browser's blocked HMR WebSocket (which is also present, and was the first
  suspect).
- The API is answering. `GET /admin/moderation/queue` and
  `GET /admin/moderation/cases/{id}` both returned **200** while the page sat on
  its skeleton, so the server-side fetch completes and the render does not.
- `next build` fails locally, deterministically, prerendering Next's own
  `/_global-error`: `TypeError: Cannot read properties of null (reading 'useContext')`.
  So the production path cannot be used as a comparison either.

What argues against a source defect:

- `apps/admin` is **unchanged since Stage 8's merge** (`a16d25b`).
- CI builds the portal green on every push, including the commit this was
  measured on.
- `npm run e2e:admin` passes **12 of 12** flows — it drives HTTP and the
  database rather than a browser, and it exercises sign-in, the dashboard
  figures, the queue, a moderation decision, the audit log and sign-out.
- The `Admin parses current backend responses` verify lane passes, so the
  portal's own Zod parsers still accept every current API shape.
- **The portal rendered correctly earlier in this same session.** Group 3 drove
  it in a browser: sign-in, the dashboard with real figures, the moderation
  queue with 1,510 open cases and 20 rows and a working pager, the audit log,
  sign-out, and an expired session landing on `/login?expired=1`.
- A single React 19.2.8 resolves from `apps/admin`; there is no duplicate copy.

So the portal works, and something about this Windows host's Next 16.3.4 dev and
build paths has stopped cooperating partway through the session. It is an
environment blocker, and calling it a product defect on this evidence would be
wrong.

**Consequence for the remaining groups, stated plainly:** the Admin legs of
groups 13–18 will be proven at the API and database levels and through
`e2e:admin`, which does exercise the portal's own request and parse paths. The
rendered-browser leg for those groups is `BLOCKED_LOCAL` on the same cause, and
will be reported as such rather than as a pass.

## Not claimed

The Android reporting UI was not driven on the device in this group; the report
contract and the threshold behaviour it drives were proven at the API. Restore,
delete and no-action decisions are groups 13 and 14.
