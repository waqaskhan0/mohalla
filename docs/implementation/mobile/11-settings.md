# 11 — Settings

**Stage 7 · Android** · §48 module record

> Redistributed from the canonical records rather than written afresh: the screen rows come from [`17-mobile-screen-coverage.md`](17-mobile-screen-coverage.md), the requirement rows from [`18-mobile-requirement-traceability.md`](18-mobile-requirement-traceability.md), the runtime results from [`19-mobile-test-report.md`](19-mobile-test-report.md) and the open items from [`20-mobile-open-issues.md`](20-mobile-open-issues.md). Where a fact is absent it says **NOT YET VERIFIED** rather than guessing.

> `UX-SET-005` (blocked accounts) is in [`12-safety-blocking.md`](12-safety-blocking.md) and `UX-SET-009` (delete account) in [`13-account-states-deletion.md`](13-account-states-deletion.md).

---

## Screens

| Screen | Name | Requirements | APIs | LTR | RTL | Loading | Empty | Error | Offline | A11y | Tests | Runtime | Status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| UX-SET-001 | Settings index | AUTH-FR-006 · SET-FR-001…010 | `GET /me/settings` | ✅ | ✅ | ✅ | — | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| UX-SET-002 | Language | SET-FR-001 · LOCALE-FR-002/003/004/005 | `PUT /me/language` | ✅ | ✅ | — | — | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| UX-SET-004 | Change password | SET-FR-002 · SEC-005 | `POST /password/change` | ✅ | ✅ | ✅ | — | ✅ | ✅ | ✅ | ✅ | — | ✅ |
| UX-SET-006 | Legal documents | SET-FR-008 | — | ✅ | ✅ | — | — | — | — | ✅ | ✅ | — | ✅ **OD-015** |
| UX-SET-007 | Help & support | SET-FR-009 | — | ✅ | ✅ | — | — | — | — | ✅ | ✅ | — | ✅ **OD-015** |
| UX-SET-008 | About | SET-FR-010 | — | ✅ | ✅ | — | — | — | — | ✅ | ✅ | — | ✅ |

**Runtime.** Exercised on an emulator: `UX-SET-001`, `UX-SET-002`. **NOT EXECUTED**: `UX-SET-004`, `UX-SET-006`, `UX-SET-007`, `UX-SET-008`.

## Requirements

| Req | Title | Pri | API | ViewModel / use case | Test | Status |
|---|---|---|---|---|---|---|
| SET-FR-001 | Switch language | Must | `PUT /me/language` | LocaleManager · SettingsViewModel | LocaleManagerTest · SettingsTest | `IMPLEMENTED` |
| SET-FR-002 | Change password | Must | `POST /password/change` | ChangePasswordViewModel · SettingsViewModel | SettingsTest | `IMPLEMENTED` |
| SET-FR-003 | Blocked users list | Must | — | BlockedUsersViewModel · SettingsViewModel | SettingsTest | `PARTIAL` |
| SET-FR-004 | Delete Account | Must | `DELETE /me` · `GET /me/deletion-consequences` | DeleteAccountViewModel · SettingsViewModel | DeleteAccountTest · SettingsTest | `IMPLEMENTED` |
| SET-FR-005 | Restore account | Must | `POST /me/restore` | RestoreAccountViewModel · SettingsViewModel | DeleteAccountTest · SettingsTest | `IMPLEMENTED` |
| SET-FR-006 | Logout | Must | — | SettingsViewModel | SettingsTest | `IMPLEMENTED` |
| SET-FR-007 | Notification preferences | Should | `GET /notifications/preferences` | NotificationPreferencesViewModel · SettingsViewModel | NotificationsTest · SettingsTest | `IMPLEMENTED` |
| SET-FR-008 | Legal documents | Must | — | SettingsViewModel | SettingsTest | `PARTIAL` |
| SET-FR-009 | Help and support | Should | — | SettingsViewModel | SettingsTest | `PARTIAL` |
| SET-FR-010 | About and version | Could | — | SettingsViewModel | SettingsTest | `IMPLEMENTED` |

- **SET-FR-003** — The blocked list loads and unblocks, but the API returns no display name or handle, so a row cannot name who it is (GAP-M-013).
- **SET-FR-008** — Legal documents: the screen and the routing are built; the three documents do not exist (OD-015).
- **SET-FR-009** — Help and support opens a mail intent to a support address that OD-015 has not yet established.

## What this module decided, and why

|---|---|---|---|---|---|---|---|---|---|---|---|---|---|

UX-SET-005 is `◐` because the rows carry no names — see below. UX-SET-006 and
UX-SET-007 are `✅` because the screens are complete and correct: what they show
is that the documents and the support address do not exist, which is true.

**Three things stopped being unreachable in this group.** The language switch had
existed only at first launch; `MohallaNavHost` took an `onRequestLanguageChange`
that was wired to `{}`; and the notification preferences built in group 13 had no
in-app path to them at all. All three now hang off the Settings row on My
profile, which is where §14's navigation tree puts them.

### What settings decided, and why it is written down

**The index renders without its request.** Every row is a destination that exists
whether or not `GET /me/settings` came back; what the request adds is two
SUBTITLES — which language the account has stored, and how many accounts are
blocked. A settings screen replaced by an error page strands the person who came
to use it, and people come here when something is already wrong. A failed request
therefore greys out two subtitles and leaves eight working rows.

**Signing out clears this device whatever the server says.** SET-FR-006's
criterion is about what this device shows afterwards — "the welcome screen is
shown and no cached personal content is visible" — and the local clear is what
satisfies it. The revocation call is still made, and made FIRST because it needs
the token, but its answer does not gate the clear: a sign-out that failed because
a train went into a tunnel, on a shared phone, is the worst possible moment to
leave somebody signed in.

**The language is written to the device synchronously and to the account
afterwards, and a failed request does not undo the switch.** The device's copy is
what decides the layout direction of the very first frame of the next cold start,
before any request could have answered — and the caller recreates the activity
the moment the choice returns, so an asynchronous write would lose that race and
compose the whole app in the old direction. The ACCOUNT's copy is what makes
SET-FR-001's criterion true — "GIVEN Urdu is selected on one device, WHEN the
user logs in on another device, THEN Urdu is applied there too" — and when that
request fails, LOCALE-FR-002's promise has already been kept: the interface
changed. Reverting would flip the whole app back under somebody who is reading
it. Choosing again is the retry.

**Each language names itself, in itself.** "English" and "اردو", whichever
language the interface is currently in, so somebody who cannot read the current
one can still find theirs. That is the first-launch screen's reasoning applied
to the same decision made later.

**Change password is not a preferences screen.** It is what somebody reaches for
when they think another person is inside their account: "GIVEN a password change
on device A, WHEN device B makes its next request, THEN device B is signed out."
The screen says that above the fields, because leaving it unsaid means the change
either surprises the person who only wanted a new password or is missed by the
person who needed it. The confirmation field is not ceremony either — a typo here
locks the owner out with every other session already dead. And the new password
must differ from the current one, checked on the device as well as the server:
re-entering the same one would still kill the other sessions and still look like
it worked, leaving somebody believing they had removed an intruder who knows the
password they just re-entered.

**Blocked accounts cannot be named, and the screen says so.** `GET /me/blocks`
returns an id and a date per row, and `GET /users/{id}` answers the neutral 404
for anybody blocked in either direction — which is every row on this list. There
is no request the client can make that would name these people. **GAP-M-013.**
The rows show WHEN each block was made, newest first, with a line explaining the
absence: a list of identical unlabelled rows with no explanation reads as a bug,
and the same list with the explanation reads as a limitation.

**The one thing deliberately not done there** is unblocking to read a name and
re-blocking. It would work, and it would mean the app silently unblocking people
to render a list — a blocked person becoming able to message somebody for the
length of a network round trip is not a trade this screen gets to make on the
user's behalf. No user id is rendered either: a raw UUID identifies nobody a
reader could recognise, and on a shared phone it puts a stranger's account
identifier on display for no benefit.

**A pagination trap in `/me/blocks`, handled at the repository.** The server sets
`nextBefore` to the last row's timestamp whenever the page has rows — so it is
non-null on the FINAL page too, and a client that paged until it went null would
re-fetch that page forever. The end is derived from a page shorter than the limit
instead.

**The legal screens show nothing rather than something official-looking.** OD-015
leaves the Terms, the Privacy Policy and the Community Guidelines unwritten;
PRIV-017 makes a publicly reachable Privacy Policy a Google Play submission
requirement, so this is a release blocker rather than an app gap. There is no
placeholder text and no link to an unpublished URL — these documents are the
stated basis for every enforcement action on the platform (PRIV-018), and a user
who read an invented version would have been told the rules wrongly.

**And no support address has been published either.** `SUPPORT_EMAIL` is a build
field, empty in both build types exactly as `TERMS_VERSION` is, and the Help
screen states that rather than opening a mail composer addressed to somewhere
invented. This is also the appeals channel for a suspension (OD-020) — the one
place where sending into a void has a real cost. When an address exists the
screen offers `ACTION_SENDTO` with a `mailto:` URI, which reaches mail clients
only: `ACTION_SEND` would also offer every messaging app on the device, and
somebody appealing a suspension does not need that going to WhatsApp.

**Delete account is absent, not inert.** UX-SET-009 is group 18–19, and an
account-deletion row that does nothing is the worst possible control to leave
wired to `{}`.

## Commits

- `564dd9c Stage 7 group 22 (Accessibility, RTL and performance): RTL was clean, contrast was not, and 55 sites were below AA`
- `cfc6e29 Stage 7 group 20 (Offline and error states): a revocation hook nothing passed, a rate limit apologising for the server, and a banner covering five destinations out of forty`
- `8ac47a9 Stage 7 groups 18-19 (Account state and deletion): a list that must be read before anything can be confirmed, and a coverage count that had drifted`
- `a07099d Stage 7 group 16 (Settings): a sign-out that works offline, a blocked list that cannot name anyone, and three screens that stopped being unreachable`

