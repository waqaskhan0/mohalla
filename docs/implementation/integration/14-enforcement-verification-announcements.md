# Groups 15–18 — suspension, ban, reinstatement, verification, announcements

Baseline: `a16d25bc2de4acdf24998d87225ab17a96cdcd90`.

52 checks at real HTTP against the running backend and PostgreSQL. **All PASS.**

Every enforcement is applied to a real account with a real live session, and
every consequence is read back from the surface an ordinary user would use.
These are the requests the portal makes, with an administrator session.

The `BLOCKED_LOCAL` marker this group carried for the Admin **rendered** UI is
withdrawn — INTEGRATION-012 was my measurement error, and the portal has since
been driven in a browser.

## Group 15 — suspension

| Check | Evidence |
| --- | --- |
| **A suspension without a reason is refused** | 400 |
| Suspend succeeds | 200 |
| The account is `SUSPENDED` with an end date | until 2026-09-17 |
| **The suspension revoked the sessions, with its own reason** (BR-035) | 1 revoked as `SUSPENDED`, 0 live |
| So the old token is refused on its next request (EDGE-010) | 401 |
| Logging in again succeeds rather than being refused | 200 |
| **And the new session is `READ_ONLY`** (BR-034) | `capability READ_ONLY` |
| Carrying the date it ends, so the app can say *when* rather than just "no" | `2026-09-17` |
| A suspended account can still read | `GET /feed/discover` 200 |
| But cannot post | 403 |
| **And the refusal carries the reason and the expiry, not a bare 403** | `ACCOUNT_SUSPENDED`, `details: [{path: "suspendedUntil", message: "2026-09-17T…"}]` |
| Nor like, nor comment | 403, 403 |
| **Their existing content stays visible** — a suspension is not a purge | 200 for them and for a neighbour |

### An assumption of mine that produced seven false failures

The first version asserted that *"a suspension is not a sign-out"* — that the
existing session keeps working and its capability simply changes on the next
request. Seven checks failed against entirely correct behaviour.

`09-authentication-authorization.md` says the opposite, plainly:

> **Revocation cascade** — suspension, ban, deletion, password change and
> password reset all revoke sessions in the **same transaction** as the state
> change (BR-007, BR-035).

And the code agrees: the suspend path passes `revokeReason: 'SUSPENDED'`. So the
suspended experience is reached by signing in again, and **that** is where
BR-034 has to hold — which it does, including the part that matters most for the
app's banner: the refusal names the reason and the expiry, so the client can say
"you can read until the 17th" rather than showing a generic error.

The lesson is the one this stage keeps teaching: a check written from what the
tester expects, rather than from what the requirement says, reports the
requirement as broken.

## Group 16 — ban, then reinstatement

| Check | Evidence |
| --- | --- |
| A neighbour can see their post before the ban | 200 |
| Ban succeeds; the account is `BANNED` | 200 |
| **Every session is revoked** | 0 live |
| The old token is refused on its next request | 401 |
| **Login is refused** | 401 |
| And the refusal does not volunteer that the account is banned | `INVALID_CREDENTIALS`, "That number or password isn't right." |
| **Their content is gone from everyone else** | 404 |
| And so is the profile | 404 |
| And they are unfindable in search | 0 results |
| Re-registering the number returns the uniform acknowledgement (SEC-006) | 202 |
| **And the number is still held by the banned account, not a new one** | 1 row, `BANNED` |

The refusal wording is the interesting one: a login that said "this account is
banned" would confirm the account exists to anyone who typed the number.
`INVALID_CREDENTIALS` is the same answer a wrong password gets.

Content going with the account is the difference from a deletion: BR-009 has a
deleted account's posts *remain*, attributed to "Deleted User", while a ban
takes them.

| Reinstatement | Evidence |
| --- | --- |
| Reinstate succeeds; the account is `ACTIVE` again | 200 |
| With no suspension left behind | `suspended_until null` |
| **Login works again, with full capability** | 200, `FULL` |
| **And their content returns for everyone else** | 200 |
| And the profile with it | 200 |
| **But the sessions the ban revoked stay revoked** | old token still 401 |

The last row is the one worth having: a reinstatement restores the *account*,
not the sessions the ban destroyed. Stale mobile state clears because the old
token is still dead and the app must sign in again.

## Group 17 — verification

| Check | Evidence |
| --- | --- |
| The organisation starts unverified | `verifiedBadge false` |
| **Verifying an individual is refused** (BR-020) | 400 |
| And the individual has no badge | `verifiedBadge false` |
| Granting verification to an organisation succeeds | 204 |
| **The badge appears on the profile the app reads** | `verifiedBadge true` |
| **And on their posts in the feed** | `author.verifiedBadge true` |
| Revoking succeeds | 204 |
| **The badge disappears** | `verifiedBadge false` |
| And from their posts too | `author.verifiedBadge false` |

Both the profile *and* the feed are checked, because the feed is where a reader
actually meets a badge — a badge that appeared only on a profile page would be
invisible to most of the audience it exists to inform.

## Group 18 — announcements, both languages

| Check | Evidence |
| --- | --- |
| **A single-language announcement is refused** (ADMIN-FR-009) | 400 |
| And the refusal names the missing fields | `titleUr`, `bodyUr` |
| Publishing with both languages succeeds | 201 |
| Both languages are stored | `title_en` and `title_ur` both present |
| **The English variant reaches Featured** | `?locale=en` → "Water main works …" |
| **And the Urdu variant reaches Featured in Urdu** | `?locale=ur` → "پانی کی مرمت …" |
| **And the two are genuinely different text** | not one language served twice |

ADMIN-FR-009's reason for requiring both is that *"a single-language
announcement fails half the audience"*, and it is enforced by the schema shape
rather than a handler check — so the refusal happens before any code runs and
names which half is missing.

The last check is the one that catches the plausible failure: a locale parameter
that is accepted and ignored would pass "reaches Featured" twice with the same
English text.

## External broadcast: BLOCKED_EXTERNAL

Announcement broadcast beyond the in-app Featured rail depends on the same push
provider that Group 10 recorded as unavailable (DEP-002). The in-app publication
is proven in both languages; delivery to a handset is not, and is not claimed.

## Not claimed

The Android suspended-state banner and the Featured rail were verified through
the API as the app's own client reads them, not driven on the device in these
groups — the emulator's own Featured rail was exercised in Groups 4 and 10. The
author notification for an enforcement action is `BLOCKED_EXTERNAL` on OD-015,
recorded with Groups 13–14.
