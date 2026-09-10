# 06 — Account Lookup

**Stage 8 · Group 07** · UX-ADM-005, ADMIN-FR-005.

---

## 1. A lookup, not a directory

The API offers `GET /admin/users/search?q=` and nothing that lists accounts, so
this page cannot become a browsable register of every citizen on the platform —
and it should not. The resting state is a search box, not the first page of
everybody, and it makes no request at all until something is searched for.

## 2. The row carries no identifier

No phone, no email, no date of birth. The API's own description gives the
reason: "a lookup must not itself be a sensitive-data view, or PRIV-008 would be
audited on every screen and mean nothing."

The privacy rule is enforced by the **response** containing no identifier, not
by the portal choosing not to render one — which is why the test asserts it on
the Zod shape rather than on the markup. Adding a phone to that route fails the
test even though the page would still not draw one.

## 3. What it can and cannot search by

Username and display name, as substrings. ADMIN-FR-005 also lists phone as a
search key, and the API explains why that is not a substring search: the number
is stored as a peppered hash, "and a hash has no substrings, so there is no
partial-number search to build". The exact-lookup path exists in the identity
module but is not exposed on an admin route, so the portal cannot search by
phone at all. Recorded as `ADMIN-API-GAP-007` and **said in the form**, rather
than left for somebody to discover by typing a number and getting nothing.

A useful consequence: because the only searchable fields are the two that
already appear publicly in the app, the GET form can put the query in the URL —
linkable, back-button safe, reloadable — without an identifier ever reaching the
address bar.

## 4. No paging, and the screen says so

The route takes `q` and `limit` and returns a bare array: no total, no offset.
Twenty rows might be twenty matches or the first twenty of five thousand, and
the API cannot tell the difference.

Measured against a term matching 5,178 accounts: the page shows twenty and
states that the list is capped, that the API does not report how many matched,
and that this is not the complete set. Showing them silently would be
ADMIN-RUNTIME-003's mistake in a different column.

It also states the ordering, which is newest-first and **not** relevance — a
reader who assumes the best match is first stops at row one.

## 5. A failed search is not an empty result

The wrong one of those two answers sends an administrator away believing an
account does not exist.
