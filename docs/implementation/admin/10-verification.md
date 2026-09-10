# 10 — Organization Verification

**Stage 8 · Group 11** · UX-ADM-008, ADMIN-FR-010, S2-CR-006.

---

## 1. There is no request queue, and the screen says so first

Verification is by invitation in V1: organizations do not apply through the app,
and the admin API has no route that lists accounts awaiting a decision. An
administrator who opened this expecting a worklist would conclude the feature
was broken when it showed nothing, so the screen is built as a lookup and
explains why.

## 2. Verified against the running API

| | |
|---|---|
| Granting to an INDIVIDUAL | **400 `NOT_ELIGIBLE_FOR_VERIFICATION`** — "Only organization accounts can be verified" |
| Granting to an ORGANIZATION | **204**, and the account view then reads `verifiedBadge: true` |
| **Revoking** on an individual | **204** — the eligibility gate is on the grant path only |

That last result shaped the interface. Revoking is deliberately unrestricted,
and the reason is worth preserving: if a badge sits on an account that should
not hold one, removing it must not be blocked by the same check that should have
prevented it. So grant is gated on the account type and revoke only on the badge
being there.

## 3. The refusal states the rule

ADMIN-FR-010 is explicit that an administrator verifying an individual "has made
a category error, not a security probe". A neutral refusal would leave them
retrying, so the copy names the eligibility rule — and says it is the rule, not
a permission problem.

## 4. The result list is not filtered to eligible accounts

It would be tidier and it would be wrong. The local fixtures make the point:
searching "Masjid" returns "Masjid Noor Trust", registered as an **INDIVIDUAL**.
An administrator asked to verify it needs to see that, because it is the answer
to why it cannot be verified. A filtered list would simply appear not to contain
the account.

## 5. A local check that was not one

The reason check ran in `onClick` on a `type="submit"` button without
`preventDefault`, so a three-character reason — which passes the `required`
attribute — showed a validation message AND sent the request, after which the
server's message replaced the local one. A local check that does not stop the
submission is not a check; it is a second opinion arriving too late.

Fixed, and measured: clicking grant with a three-character reason now leaves the
verification audit count unchanged.

## 6. A 204 is confirmed by re-reading

`PUT .../verification` returns no body, so success is confirmed by re-reading
the account rather than by the absence of an error. A screen that reported
success from a silent response would be reporting its own intention.
