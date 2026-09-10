# 09 — Announcements

**Stage 8 · Group 10** · UX-ADM-007, ADMIN-FR-009, NOTIF-FR-005.

---

## 1. Both languages, given equal weight on the screen

ADMIN-FR-009 requires both versions "because a single-language announcement
fails half the audience". The API enforces it in the schema shape, so the
refusal happens before any handler runs; the portal checks per field so the
reader is told WHICH version is missing rather than handed one message about
both.

A form with English full-width and Urdu tucked below as an afterthought would
teach the opposite of the rule it implements, so the pairs sit side by side in
identical fields. The Urdu ones carry `dir="rtl"` and `lang="ur"` **on the
controls** — verified in the browser as computed direction `rtl` with 31.45px
leading against Latin's 24px. This is the one place in an English-only portal
where Urdu is typed, and getting it wrong would mean composing Urdu in a
left-to-right box.

## 2. Two layout defects the browser found at 1440px

- The Urdu fields had a gloss line the English ones lacked, so the paired inputs
  sat at different heights. Every field carries a gloss now.
- Urdu's 1.85 leading against Latin's 1.5 made two textareas with the same
  `rows` different sizes. The cells stretch and each control fills one.

Both pairs now read as one object.

## 3. The broadcast cap is stated before the writing starts

NOTIF-FR-005 caps broadcasts at two per rolling seven days "because over-use is
a direct cause of uninstalls". The API has an allowance route for exactly this
reason — its own description says "so the portal can say so before an
administrator writes one, rather than refusing after they have".

The checkbox is opt-in and unticked: a push goes to every user, and a box that
arrived already ticked would make the expensive choice the default one.

**Measured end to end:** two broadcasts took the allowance to 1 of 2 then 2 of
2, each writing an outbox row and `ADMIN_BROADCAST_ANNOUNCEMENT`; a third
returned **429** stating the limit. With the allowance spent the checkbox
disables and publishing is still offered — the cap is on the notification, not
on the announcement.

Exercising it was safe: no worker was running, no FCM credentials are
configured, and all eight device tokens in the local database are synthetic. The
two outbox rows remain undelivered.

## 4. The response is the server's answer, not the form's intention

A publication can succeed while its broadcast is refused. Telling an
administrator a push went out when it did not is how the same announcement gets
published twice, so the confirmation reports what the API says it did.

## 5. Not a content management system

§9: "DO NOT CREATE A GENERIC CMS". Satisfied by there being nothing to edit
with — the API has one publish route and no others. There is no route that lists
announcements (`ADMIN-API-GAP-009`), none that edits one and none that withdraws
one.

That last consequence is said **before** the publish button rather than
discovered after it: a published mistake stays visible until it expires.

## 6. The expiry is the end of the chosen day

A `date` input gives `YYYY-MM-DD`. Somebody picking today means "until today is
over", not "until midnight this morning", which would already be in the past and
refused. Parsed by parts, because `new Date('2026-09-09')` is midnight UTC while
`new Date('2026/09/09')` is midnight local — and a one-day announcement is
exactly where that difference surfaces.
