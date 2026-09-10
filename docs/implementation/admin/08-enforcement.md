# 08 — Suspend, Ban and Reinstate

**Stage 8 · Group 09** · ADMIN-FR-006/007/008, BR-034/035/036/038.

---

## 1. Verified against the running API before the UI was trusted

| | |
|---|---|
| A 24-hour suspension | revoked **2** live sessions — BR-035 made visible |
| Re-suspending for 30 days | landed at exactly **30.00** days from now, so EDGE-027 REPLACES rather than accumulates |
| Suspending an administrator id | **403 `ADMIN_CANNOT_ACT_ON_ADMIN`** |
| A one-character reason | **400**, with the rule in `details.reason` (BR-038) |
| Reinstating an already-active account | **200** — it is idempotent |

That last result shaped the interface. `ALREADY_IN_STATE` is declared in the
rejection type and handled in the controller, but `checkEnforceable` never
produces it — so there is no state in which offering Reinstate is wrong, and it
is offered in all of them.

## 2. These three are not peers the way restore and delete are

The difference is deliberate. §43's peer rule is about two outcomes for a piece
of CONTENT, where leaning toward removal makes RSK-010 worse. Here they are not
alternative answers to one question:

- **Suspend** is a pause. BR-034 keeps READ access, because "somebody who cannot
  read cannot see the banner explaining why". It lifts on its own (EDGE-028) —
  no administrator has to do anything when the time is up.
- **Ban** is permanent, adds the registered number to the ban list (BR-036), and
  **hides** content rather than deleting it, "so that it remains available to the
  audit trail if the ban is later disputed". The refusal a returning person
  meets is neutral and does not disclose the ban.
- **Reinstate** is a CORRECTION, and ADMIN-FR-008 gives the reason it is always
  available: "administrators make mistakes and the product must let them be
  corrected." So it is never hidden, never behind a confirmation, and never
  harder to reach than the action it undoes. It also takes the number off the
  ban list — a reinstatement that left somebody unable to register would not be
  a correction.

What **is** carried over from §43: nothing preselected, nothing autofocused, no
red button, and ban not in the last position of a row. Ban asks for a second
confirmation, which is friction against the irreversible action rather than
toward it.

## 3. EDGE-027 is on the screen, not only in the API

An administrator looking at an account already suspended for a week is told that
a new suspension REPLACES the old one — so 30 days means thirty from now, not
thirty-seven. Two administrators independently applying 30 days would otherwise
produce 60, which neither of them decided.

## 4. A deleted account is refused, with the reason

The API refuses every action against a DELETED account. Its reasoning is worth
carrying into the copy: an action against an account already gone records
something nobody can experience, and reinstating it would restore what that
person asked to remove.

## 5. The session count is the evidence

"All sessions are invalidated" is a claim; `sessionsRevoked` is what makes it
visible. Zero is informative too — it means the account had nobody signed in,
not that the suspension failed to take.
