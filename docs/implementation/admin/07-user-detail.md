# 07 — Account Detail

**Stage 8 · Group 08** · UX-ADM-006, ADMIN-FR-005, PRIV-008, SEC-022.

---

## 1. The identifiers are closed until asked

§24 requires that viewing a phone number, email or date of birth "must itself
produce the required backend audit event", and adds the rule that makes it work:
"do not prefetch sensitive fields unnecessarily."

Those two sentences are one idea. If the panel fetched on render, every visit to
an account — a mistaken click, a refresh, a bookmark, opening it to check whether
somebody is suspended — would record that an administrator read that person's
phone number. The log would fill with accesses nobody made, and the entries that
mattered would be lost among them. An audit trail that records everything
records nothing.

**Measured against the `audit_log` table:**

| | |
|---|---|
| Three loads of an account page | `ADMIN_VIEWED_SENSITIVE_DATA` unchanged at **50** |
| One press of "Show phone number and date of birth" | **51** |
| What the entry records | the administrator, the account, and `{"fields": ["phone", "dateOfBirth"]}` |
| What the entry does **not** record | the values — a log holding the number to prove somebody looked at the number would be a second, worse copy of it |
| After a real reveal | the values appear in no URL, no `localStorage`, no `sessionStorage` and no attribute |

The number is rendered as text rather than a `tel:` link, which would hand it to
whatever application the administrator's machine has registered for that scheme
— one more copy than the audit trail knows about. A reload closes the panel, and
reopening writes a new entry, which is correct: it is a new access.

`ADMIN-API-GAP-006`: the route returns phone and date of birth. PRIV-008 also
names email, so the panel says email is absent rather than letting its absence
imply the account has none.

## 2. What an administrator cannot see from here, and it matters

There is **no route** that returns an account's enforcement history. The
repository has the query and `EnforcementService.history()` calls it, but the
only place it is exposed is the moderation CASE detail, for the author of that
case. And the audit log filters by administrator, action and date range — **not**
by the account acted on.

So there is no way, from this screen or any other, to ask "what has been done to
this person before?" Recorded as `ADMIN-API-GAP-008`.

That is stated on the page rather than left implicit, because this is the screen
where enforcement decisions get made and BR-037's whole point is
proportionality: "an administrator deciding whether a first offence warrants 30
days should not have to open another screen to find out it is the fourth" — and
here they cannot open any screen that would tell them. An empty space would read
as a clean record, which is exactly the inference nothing supports.

## 3. An administrator is not reachable here, and the UI is not the reason

Verified against the API: both `GET /admin/users/:id` and its `/sensitive` route
answer **404** for an administrator id, because an administrator has no row in
`users` and no `UserState` — the API's own type "refuses to express the action"
BR-ADM-001 forbids. SEC-020 keeps the two credential stores apart.

Hiding a control is never the boundary (§28). This is what the boundary actually
looks like.
