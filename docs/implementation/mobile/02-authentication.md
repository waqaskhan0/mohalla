# 02 — Authentication

**Stage 7 · Android** · §48 module record

> Redistributed from the canonical records rather than written afresh: the screen rows come from [`17-mobile-screen-coverage.md`](17-mobile-screen-coverage.md), the requirement rows from [`18-mobile-requirement-traceability.md`](18-mobile-requirement-traceability.md), the runtime results from [`19-mobile-test-report.md`](19-mobile-test-report.md) and the open items from [`20-mobile-open-issues.md`](20-mobile-open-issues.md). Where a fact is absent it says **NOT YET VERIFIED** rather than guessing.

> `UX-AUTH-012` (restore account) belongs to [`13-account-states-deletion.md`](13-account-states-deletion.md).

---

## Screens

| Screen | Name | Requirements | APIs | LTR | RTL | Loading | Empty | Error | Offline | A11y | Tests | Runtime | Status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| UX-AUTH-003 | Welcome | AUTH-FR-001 · SEC-006 | — | ✅ | ✅ | — | — | — | ✅ | ✅ | ✅ | ✅ | ✅ |
| UX-AUTH-004 | Log in | AUTH-FR-005 · SEC-006/007 | `POST /login` | ✅ | ✅ | ✅ | — | ✅ | ✅ | ✅ | ✅ | — | ✅ |
| UX-AUTH-005 | Register — phone | AUTH-FR-001 · PROFILE-FR-006 · BR-001 | `POST /register` | ✅ | ✅ | — | — | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| UX-AUTH-006 | Register — date of birth | AUTH-FR-008 · BR-002 | — | ✅ | ✅ | — | — | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| UX-AUTH-007 | Register — password | AUTH-FR-001 · SRS §12 | — | ✅ | ✅ | — | — | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| UX-AUTH-008 | Terms & Guidelines | AUTH-FR-009 · SAFETY-FR-008 · BR-004 · PRIV-014 | `POST /register` | ✅ | ✅ | ✅ | — | ✅ | ✅ | ✅ | ✅ | ✅ | ◐ **OD-015** |
| UX-AUTH-009 | OTP verification | AUTH-FR-002/003 · SEC-003 · EDGE-005 | `POST /otp/verify` `/otp/resend` | ✅ | ✅ | ✅ | — | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| UX-AUTH-010 | Forgot password | AUTH-FR-007 | `POST /password/forgot` | ✅ | ✅ | ✅ | — | ✅ | ✅ | ✅ | ✅ | — | ✅ |
| UX-AUTH-011 | Reset password | AUTH-FR-007 | `POST /password/reset` | ✅ | ✅ | ✅ | — | ✅ | ✅ | ✅ | ✅ | — | ✅ |

**Runtime.** Exercised on an emulator: `UX-AUTH-003`, `UX-AUTH-005`, `UX-AUTH-006`, `UX-AUTH-007`, `UX-AUTH-008`, `UX-AUTH-009`. **NOT EXECUTED**: `UX-AUTH-004`, `UX-AUTH-010`, `UX-AUTH-011`.

## Requirements

| Req | Title | Pri | API | ViewModel / use case | Test | Status |
|---|---|---|---|---|---|---|
| AUTH-FR-001 | User Registration by Mobile Number | Must | `POST /register` | RegisterViewModel | AuthUniformityTest · AuthValidationTest · RegisterFlowTest | `IMPLEMENTED` |
| AUTH-FR-002 | OTP Verification | Must | `POST /otp/verify` | OtpViewModel | AuthUniformityTest | `IMPLEMENTED` |
| AUTH-FR-003 | OTP resend | Must | `POST /otp/resend` | OtpViewModel | AuthUniformityTest | `IMPLEMENTED` |
| AUTH-FR-004 | Email registration | Should | — | — | — | `REMOVED APPROVED` |
| AUTH-FR-005 | Login | Must | `POST /login` | LoginViewModel | AuthValidationTest | `IMPLEMENTED` |
| AUTH-FR-006 | Logout | Must | `POST /logout` | SettingsViewModel | SettingsTest | `IMPLEMENTED` |
| AUTH-FR-007 | Password reset | Must | `POST /password/forgot` · `POST /password/reset` | PasswordResetViewModel | RegisterFlowTest | `IMPLEMENTED` |
| AUTH-FR-008 | Age Gate | Must | `POST /register` | RegisterViewModel | RegisterFlowTest | `IMPLEMENTED` |
| AUTH-FR-009 | Terms acceptance | Must | `POST /register` | RegisterViewModel | RegisterFlowTest | `PARTIAL` |
| AUTH-FR-010 | Session management | Must | — | AuthInterceptor · SessionRevocation | SecureStorageTest · FailureRoutingTest | `IMPLEMENTED` |
| AUTH-FR-011 | Administrator login | Must | — | — | — | `OUT OF SCOPE` |
| AUTH-FR-012 | Google sign-in | Could | — | — | — | `DEFERRED SHOULD` |

- **AUTH-FR-004** — Email-primary registration removed from V1 by OD-021 Option C.
- **AUTH-FR-009** — The Terms screen exists and registration deliberately FAILS CLOSED while OD-015 leaves no published document to record acceptance of.
- **AUTH-FR-010** — Cross-cutting, so no screen of its own: the token is attached and the idle window slid on every authenticated request, and a 401 on an attached token latches `SessionRevocation`.
- **AUTH-FR-011** — Administrator login belongs to the Admin Web Portal, which the Stage 7 brief and §49 both exclude.
- **AUTH-FR-012** — A Could. The Google identity port is unbuilt at Stage 6 too — the generated contract has no route for it.

## What this module decided, and why

|---|---|---|---|---|---|---|---|---|---|---|---|---|---|

### What the authentication group decided, and why it is written down

**`UX-AUTH-003` is where a BANNED or DELETED account lands**, and it shows
nothing to distinguish that from a first-ever launch (SEC-006).

**SEC-006 is enforced in the client's TYPES, not its copy.** `LoginOutcome` has
three variants and `Failed` carries no payload; `LoginUiState` has one
`credentialsRejected` flag and no field per cause; `PasswordResetUiState` has
`requestSent` and nothing that could say whether an account exists. A screen
cannot render a distinction its state cannot hold, and the tests assert that
structurally — adding a `WrongPassword` variant fails to **compile**, not to
pass.

**Three disclosures are deliberate**, all on the same ground — the caller has
already proved the account is theirs:

| Disclosure | Why it is safe |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `VERIFICATION_REQUIRED` on login | Required the correct password |
| `PROFILE_NOT_CREATED` on `/me` | The caller's own account |
| Wrong vs expired OTP code | Required possession of the number |

They are commented at each site so the next reader neither "fixes" them into
neutrality nor cites them as precedent for the ones that must stay neutral.

**`UX-AUTH-008` is `◐`, not `✅`.** The screen, the checkbox and the BR-004
affirmative are complete; the Terms and Community Guidelines themselves do not
exist (**OD-015**), so the links report that plainly rather than opening a
placeholder that looks like a real policy.

## Commits

- `2fcb3de MOBILE: a refusal that renders nothing is worse than a wrong one`
- `3f40a64 MOBILE: the date of birth could not be typed, so nobody could register`
- `f32b3de Stage 7 group 23 (Integration validation): a Must nobody had implemented, three declarations nothing called, and a coverage table in three shapes`
- `564dd9c Stage 7 group 22 (Accessibility, RTL and performance): RTL was clean, contrast was not, and 55 sites were below AA`
- `8ac47a9 Stage 7 groups 18-19 (Account state and deletion): a list that must be read before anything can be confirmed, and a coverage count that had drifted`
- `4f8a022 Stage 7 groups 05-06: the navigation shell, both Home feeds, and two defects only wiring could find`
- `0a3bf1b MOBILE: the remaining auth screens — register steps, password reset, restore`
- `dc24edd MOBILE: authentication — the uniform failure, the OTP screen, and the LTR digits inside an RTL layout`
- `36beb0c MOBILE: design tokens, secure session storage, startup routing and the RTL navigation rule`

