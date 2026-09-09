# 14 — Offline and error states

**Stage 7 · Android** · §48 module record

> Redistributed from the canonical records rather than written afresh: the screen rows come from [`17-mobile-screen-coverage.md`](17-mobile-screen-coverage.md), the requirement rows from [`18-mobile-requirement-traceability.md`](18-mobile-requirement-traceability.md), the runtime results from [`19-mobile-test-report.md`](19-mobile-test-report.md) and the open items from [`20-mobile-open-issues.md`](20-mobile-open-issues.md). Where a fact is absent it says **NOT YET VERIFIED** rather than guessing.

---

## Screens

| Screen | Name | Requirements | APIs | LTR | RTL | Loading | Empty | Error | Offline | A11y | Tests | Runtime | Status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| UX-STATE-001 | Content unavailable | SAFETY-FR-004 · SEC-019 · BR-025 | — | ✅ | ✅ | — | — | — | — | ✅ | ✅ | — | ✅ |
| UX-STATE-002 | Offline | NFR-AVAIL-002 | — | ✅ | ✅ | — | — | — | ✅ | ✅ | ✅ | — | ✅ |
| UX-STATE-003 | Server error | SEC-018 · SRS §16 | — | ✅ | ✅ | — | — | ✅ | — | ✅ | ✅ | — | ✅ |
| UX-STATE-004 | Rate limited | SAFETY-FR-009 | — | ✅ | ✅ | — | — | — | — | ✅ | ✅ | — | ✅ |

**Runtime.** **NOT EXECUTED**: `UX-STATE-001`, `UX-STATE-002`, `UX-STATE-003`, `UX-STATE-004`.

## Requirements

See the cross-reference above — this module’s requirements are recorded with the family that owns them, so they are not duplicated here (§24).

## What this module decided, and why

No new screens. UX-STATE-001…004 were built as components in group 01 and are
counted there; this group is about whether the app actually reaches them, and it
turned out that mostly it did not.

### Three defects, all of them a branch nobody looked at

**The session-revocation hook was a comment.** `apiCall` has taken an
`onUnauthenticated` callback since group 01. `ApiFailure.Unauthenticated`'s own
documentation says "revocation is server-driven and takes effect on the NEXT
request, so this is the app's only signal. The shell intercepts it globally,
signs out and clears the cache (SET-FR-006)." **No caller ever passed one**, so
nothing intercepted anything: a revoked session showed a generic error on every
screen, indefinitely, until somebody force-quit the app.

That is not hypothetical. SET-FR-002 exists so that changing a password signs out
every other device — "GIVEN a password change on device A, WHEN device B makes
its next request, THEN device B is signed out" — and device B is this app.
Somebody who changed their password because they believed another person was
inside their account would have watched that person's phone go on showing the
feed.

It is now raised in the **auth interceptor**, which is the one place that knows a
token was attached: a 401 on a request that carried none is a login being
refused, not a session being revoked, and signing out of nothing would be noise
on the one screen where it would confuse somebody most. A repository could not
tell those apart without being told, and there are ten of them. The flag latches,
so four requests in flight when a session dies sign out once.

**The failure mapping was twelve copies, and most of them were wrong.** §21
specifies four states with four different promises. The shape that spread across
groups 11 to 19 was two branches:

```
when (failure) {
    ApiFailure.Offline -> OfflineState(onRetry)
    else -> ServerErrorState(...)          // ← everything else
}
```

Which sent a **rate limit** to a screen that apologises for the server. A 429 is
the reader's own recent behaviour with a stated cool-down (SAFETY-FR-009,
UX-STATE-004), and "something went wrong on our end" is both untrue and useless
— it invites a retry that will be refused again. `RateLimitedState` existed from
group 01 and two screens out of fourteen reached it.

It also sent a **neutral 404** to an error page with a Try again button. BR-025's
refusal is not a failure: the content is not available and there is nothing to
retry. An error screen there teaches the reader that the app is broken rather
than that the post is gone.

There is now one `FailureState` with an **exhaustive** `when` over all eight
variants, so a ninth is a compile error in one file in front of whoever added it
— which is precisely how these two defects spread in the first place. Fourteen
call sites now route through it, and the unused imports left behind were removed.

**The offline banner covered five destinations out of forty.** §43 wants it above
the content, and it was inside `MohallaShell` — so somebody who followed a
notification into a conversation, or opened a profile from search, saw no banner
at all while every request they made failed. It moved to the navigation graph,
above the whole `NavHost`, where it appears exactly once for every destination.

### What did not change, deliberately

**Nothing is disabled because the app is offline.** §43: a hint, never a gate.
Requests are still attempted and their own failure is authoritative — a
connectivity check that refused to try would fail requests that were going to
succeed on a flaky connection, which is most connections this product will meet.

**There is still no offline write queue.** A report made offline is refused with
its text kept rather than queued (GAP-M-014), and the same applies to every other
write: the app has no persisted outbox, and one that lost work after telling
somebody it was saved would be worse than a refusal they can act on.

**A `null` failure renders nothing.** The event detail screen's failure helper
took a nullable and fell through to the generic error, so a screen that had not
finished loading could show "something went wrong" for a request still in flight.
Now the loading branch owns that frame.

## Commits

- `2fcb3de MOBILE: a refusal that renders nothing is worse than a wrong one`
- `cfc6e29 Stage 7 group 20 (Offline and error states): a revocation hook nothing passed, a rate limit apologising for the server, and a banner covering five destinations out of forty`
- `ddacc58 Stage 7 groups 14-15 (Profiles and the social graph): the client could not send a JSON null, and two features were silently broken by it`
- `4f8a022 Stage 7 groups 05-06: the navigation shell, both Home feeds, and two defects only wiring could find`

