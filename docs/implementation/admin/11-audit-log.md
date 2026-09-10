# 11 — Audit Log

**Stage 8 · Group 12** · UX-ADM-009, ADMIN-FR-012, BR-039, §33.

---

## 1. Read only, and there is no server action in the directory

§33 forbids edit, delete, clear, truncate, correct, bulk delete and export.
BR-039 puts it as a property of the system rather than of the interface: "the
log is append-only and NO INTERFACE, PERMISSION OR ADMINISTRATOR can edit or
delete an entry."

The API satisfies that by having no route at any layer that writes. This screen
satisfies it the same way: one `guardedRequest` on a GET, no `'use server'`
file, no form that posts anything. **There is nothing here to disable, because
there is nothing here.**

Verified in the browser — the only controls on the page are the sidebar links,
the sign-out button in the shell, the search submit and the pager, and nothing
carries a `download` attribute. Flow K of [15](15-runtime-e2e.md) confirms that
POST, PUT, PATCH and DELETE against the route do not exist.

**No export.** §33 lists it among the forbidden operations "unless specifically
approved", and it has not been. ADMIN-FR-011 independently rules out data export
in V1.

## 2. The same false zero as the moderation queue

The audit repository computes `total` as `COUNT(*) OVER ()` with a `?? 0`
fallback — identical to the queue. Measured: `?offset=9999` returns
`{"entries":[],"total":0}` against a log of 1,691 entries.

On the queue that produced ADMIN-RUNTIME-003. On an **audit log** the same zero
would say "there is no record of this", which is a worse thing to say wrongly.
So a past-the-end page says out loud that it proves nothing, and "the log is
empty" is a claim only page one can make. `ADMIN-API-GAP-003` is therefore known
to affect two endpoints.

## 3. The action filter is an exact, case-sensitive match

Measured: `ADMIN_SUSPEND` returns 105 entries, `suspend` returns 0, `SUSPEND`
returns 0. A bare text box would turn every typo and every guess at the naming
convention into "there is no record of this".

The field is backed by a suggestion list of 22 actions in 8 groups, every
literal read from `apps/api/src` and cross-checked against the distinct values
in the local log. A **datalist** rather than a select, so an action the portal
has not heard of is still searchable. The infrastructure markers the local log
carries (`foundation.test`, `role.test`, `rehearsal.marker`) are deliberately
unlisted, because they are not product actions.

Two of those actions are grouped and labelled as **administrator access to
private data** — `ADMIN_VIEWED_SENSITIVE_DATA` and
`ADMIN_READ_REPORTED_CONVERSATION`. "Viewing is auditable, not only acting" is
what makes PRIV-008 and PRIV-009 checkable rather than aspirational, and this is
where an investigator checks it.

## 4. An entry is rendered as evidence

Metadata is rendered as key and value, never as JSON (§40) — another
administrator's free-text reason arrives in that column, and §34 names it. The
PRIV-008 entries read as "fields: phone, dateOfBirth".

`actorId` is null "for SYSTEM, and for an actor who could not be identified" —
two different things, and neither is a blank cell. The wire value of the action
stays visible beside its description, because the raw value is what gets pasted
into a filter or a ticket.

## 5. A malformed administrator id is dropped, not sent

The API takes a UUID and would answer 400, which is a confusing reply to
something somebody typed. The field is marked invalid, the note says the filter
was not applied, and the unfiltered rows are still shown.
