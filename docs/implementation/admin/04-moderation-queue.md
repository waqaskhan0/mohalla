# 04 — Moderation Queue

**Stage 8 · Group 05** · UX-ADM-003, ADMIN-FR-002. The daily workspace, and the
screen the whole portal exists to serve.

---

## 1. The order is the server's

Severity, then distinct report count, then **age ascending**. The API explains
the last one: the oldest of equal cases first, "because a queue that surfaced
the newest would let an item at the bottom wait forever".

§16 forbids re-sorting client-side, so this page renders `cases` in the order it
receives them and offers no column sorting at all — a sortable header would be a
second ordering policy competing with the one the server enforces. The ordering
is named in the column headers themselves (`1st`, `2nd`, `3rd`), so the reason
row three sits above row four is on screen rather than in a document.

Verified against the database: LOW 1,100 · HIGH 242 · MEDIUM 55, no CRITICAL; a
HIGH case with four distinct reporters, oldest first, tops the queue.

## 2. Paging is offset-based because the ordering key is mutable

A new report changes a case's severity or count and moves it, so keyset paging
over that key would skip and repeat rows. `limit` 1-50, `offset` 0-5000, both
clamped here rather than passed through — a hand-edited `?offset=99999` would
otherwise come back a validation error, which is a confusing answer to a URL
somebody typed.

## 3. ADMIN-RUNTIME-003 — the queue said it was clear with 1,397 cases open

The first version rendered "Nothing is waiting for review" whenever
`total === 0`. Measured: `GET /admin/moderation/queue?offset=1400` returns
`{"cases":[],"total":0}`.

The API's total is a window function — `COUNT(*) OVER ()` — so it is the genuine
pre-LIMIT count, but it rides on each ROW. An offset past the end returns no
rows, so nothing carries it, and the repository falls back to
`Number(r.rows[0]?.total ?? 0)`. The zero is a missing value dressed as a real
one. Recorded as `ADMIN-API-GAP-003`.

The rule is now the safe one:

```ts
const queueIsGenuinelyClear = offset === 0 && page.total === 0 && shown === 0;
const pagedPastTheEnd = offset > 0 && shown === 0;
```

"The queue is clear" is a claim only page one can make. Everything else at an
empty page says "you have paged past the end", which is a different statement
and the true one — and it makes no claim about how many cases are open, because
at that offset the API cannot tell us.

Verified at four offsets in the browser, and again in flow G of
[15](15-runtime-e2e.md). **The same defect was later found in the audit log** —
see [11](11-audit-log.md).

## 4. Severity is never colour alone

A coloured dot plus a text label, always, on every row. NFR-ACC-005 requires it
and §44 repeats it; roughly one man in twelve has some colour vision deficiency,
and this is the column that decides what gets opened first. An unrecognised
severity renders as itself rather than falling back to something that looks
deliberate.

## 5. No author column

The queue response carries `targetOwnerId` and nothing else about the author —
no handle, no display name. §16 says "author summary as approved", and what is
approved puts the author on the DETAIL screen. A bare UUID in a column a
moderator scans would be noise, and fetching a profile per row would be a query
per row. Recorded as an observation rather than a gap.
