# Release validation — Mohalla (محلہ)

**EPIC-16.** What must be true before V1 ships, who has to make each thing true,
and which of them a machine can check.

Run the gate:

```bash
npm run release:gate
```

It exits `0` only when every criterion is satisfied, `1` when something it
checked is broken, and `3` while any criterion remains **BLOCKED**. It has no
override flag. A release decision is not something a test run may make on
somebody's behalf, and a `--force` here would be exactly that.

---

## The three answers

| | meaning |
|---|---|
| **PASS** | checked by the gate, and it holds |
| **FAIL** | checked by the gate, and it does not hold |
| **BLOCKED** | *not checked* — it needs a device, a published document, or a person with authority this repository does not have |

**BLOCKED is not a soft pass.** Recording it as one is how something untested
ships with a green tick beside it. Recording it as a failure would put a
permanent red line next to work that is simply somebody else's, and a gate that
is always red is a gate people stop reading.

---

## What the gate verifies itself

| Criterion | What it proves |
|---|---|
| **Test A** — block privacy | Eight refusal surfaces plus search and the feed all return the **identical** `404 RESOURCE_UNAVAILABLE`, within a timing band. BR-025 · SEC-019 · PRIV-013 |
| **Test B** — session revocation | Ban and deletion reject on the **next** request, on **every** device. Suspension keeps reading and refuses the next write (BR-034). |
| **Test E** — message idempotency | Six concurrent submissions of one `clientMessageId` → one stored message, one id in every response, one rendering, one outbox event. EDGE-020/021 |
| **REL-003** | Three distinct reporters hide a post platform-wide, one case opens, the author still sees it under review, nothing is auto-deleted. |
| **REL-004** | Editing, deleting, cancelling and reading another account's post, event, comment and conversation are all refused, and the data is unchanged afterwards. |
| **REL-005** | An account that follows nobody gets a populated Featured section and Discover feed. RSK-001 |

Tests **C**, **D** and **F** are equally mandatory and run in `packages/db`
against real PostgreSQL, because they are about transaction interleaving and an
HTTP client cannot hold two transactions open:

```bash
npm run test --workspace @mohalla/db
```

---

## What is BLOCKED, and who unblocks it

### REL-001 · REL-008 · NFR-COMP-002 — physical devices
The core journey on a clean install, and on **three distinct low-to-mid-range
physical devices**. The SRS is explicit that emulators do not reproduce real
low-end performance, so this cannot be automated away.
**Owner: Shehersaaz.** Needs the Android build, which is outside Stage 6.

### REL-002 · Test G — RTL through every screen
Every screen in all fifteen modules, right-to-left, with nothing clipped,
overlapping or untranslated, at 130% font scale.

The locale-parity guard (`npm run verify`) proves the **catalogue** has an Urdu
string for every English one. It cannot prove a **layout**. Blocked on the
Android UI and on **DEP-011 / OD-016** — roughly 400 Urdu strings, owned by
Shehersaaz.

### REL-006 — legal documents
Privacy Policy, Terms and Community Guidelines, at reachable URLs, in both
languages, readable in-app, before Play submission.

**Blocked on OD-015.** The content does not exist and is Shehersaaz's to write.
No URL can be verified until it does.

### REL-007 — a proven restore
The mechanism is built (EPIC-15) and has not been run against a production
backup. On a host with the PostgreSQL client tools:

```bash
RESTORE_TARGET_URL=postgres://…/mohalla_rehearsal npm run db:backup
RESTORE_TARGET_URL=postgres://…/mohalla_rehearsal npm run db:restore:rehearsal
```

The target must be a **disposable** database; the script refuses to restore over
anything matching a live URL. It compares row counts recorded *at backup time*
— including `audit_log` — because `pg_restore` exiting zero proves a file was
readable, not that the data arrived.

§15.5 then requires staging to be pointed at the restored copy and the smoke
suite run against it. That step is a human's, because it involves a deployment.

**SEC-027** requires backups encrypted at rest. `pg_dump` does not encrypt, and
the script says so on every run: the destination must provide it before any
deployed use.

### An administrator exists
**OD-020 / DEP-016.** There is no named technical owner, so no administrator may
be provisioned, and no bootstrap endpoint exists in any environment — by design,
not by omission.

This blocks more than the admin portal. **A3** — that somebody reviews the
moderation queue daily — is rated *Severe*, and the queue-age alert built in
EPIC-15 pages when the oldest open case passes 24 hours. Right now it would page
nobody, because nobody has that role.

---

## Before the public invitation

**Seed the platform first.** REL-005 is written as *"GIVEN the platform is
seeded before launch"*. A new user who follows nobody and lands on an empty feed
has nothing to come back for — that is RSK-001, and it is a launch-sequencing
decision rather than a code one.

---

## Publication

Pushing this work to the public remote requires an approved Shehersaaz
publication-authorization record. Local commits are permitted; the push is not,
and this document does not grant it.
