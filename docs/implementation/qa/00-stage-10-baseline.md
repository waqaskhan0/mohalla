# Stage 10 — QA baseline

Recorded before any QA test was executed, so that later results can be read
against a known starting point rather than against Stage 9's closing claims.

## Repository

| | |
| --- | --- |
| Latest `main` | `a00597586b3877fdf2fc2c49f565c3154edab838` |
| Stage 9 PR | [#16](https://github.com/waqaskhan0/mohalla/pull/16) — **MERGED**, squashed |
| Stage 10 branch | `feature/stage-10-qa-bugfix` |
| `STAGE_10_BASE_SHA` | `a00597586b3877fdf2fc2c49f565c3154edab838` |
| Working tree at branch creation | clean |
| Branch protection on `main` | enabled — 7 required checks, strict, force-push and deletion blocked |

`main` carried no commits newer than the Stage 9 merge, so nothing was reset or
skipped.

## CI on the baseline commit

All three workflows green on `a005975`: **CI**, **Android**, **Push on main**.

## Verify, re-run rather than quoted

Stage 9 closed at *16 passed · 0 failed · 3 blocked*. Stage 10 re-ran it rather
than inheriting the number, and got a **different** result:

```
15 passed · 1 failed · 3 blocked · 19 total
VERIFY: FAILED
```

The failure is `admin portal E2E (flows A–L)`, at 11 of 12. It is **QA-001**,
the first Stage 10 defect: the harness could not authenticate against a
production portal build. It is fixed and closed; see the defect register.

The three blocked lanes are unchanged and were each re-investigated rather than
carried forward on Stage 9's say-so:

| Lane | Why it is blocked | Owner |
| --- | --- | --- |
| release gate (REL-001…008) | REL-002 / REL-008 need three physical low-to-mid-range devices; the ADMIN criterion needs OD-020 / DEP-016, which have no named technical owner | Owner |
| backup for the rehearsal (SEC-026) | `pg_dump` is not on this host's PATH — `spawnSync pg_dump ENOENT` | Environment |
| restore rehearsal (REL-007) | depends on the backup above | Environment |

The backup pair is revisited in Stage 10 §45: the client tools exist **inside**
the Postgres container, which may be enough to execute the rehearsal without
installing anything on the host. That is attempted, not assumed.

## Services at baseline

| Component | State |
| --- | --- |
| PostgreSQL 18.6 | up, healthy, migrations current through `0023_post_count_trigger` |
| API | up on `:3000`, built artifact, `/health` 200 |
| Worker | up, draining the notification outbox (`claimed 3, processed 3, failed 0, pushesSent 0, suppressed 3`) |
| Socket.IO | mounted in the API, path `/realtime` |
| Admin portal | up in **both** modes — production `:3001`, development `:3002` |
| Android emulator | up, API 36, headless, after the profile correction recorded in the environment matrix |
| Media adapter | development adapter in use |
| SMS / push | `FakeSmsProvider` / `FakePushSender` — nothing leaves the host |

## Android build

`assembleDebug` from the Stage 10 base: **14,718,455 bytes**,
`org.shehersaaz.mohalla`, `0.0.1-foundation`, versionCode 1, `minSdk 26`.
Installed clean on the emulator; the app launches to *"Choose your language"*.

There is no release APK and one is not producible: signing config is
deliberately absent, and a release build hard-codes `API_BASE_URL=https://api.invalid`,
`TERMS_VERSION=""` (OD-015), `APP_HOST=""` (DEP-007) and `SUPPORT_EMAIL=""`.

## Security posture at baseline

| Gate | State |
| --- | --- |
| `npm audit --audit-level=high` | 0 vulnerabilities |
| Secret guard | clean, 829 files |
| Public-data / contract specimen guard | clean |
| CodeQL open alerts | **1** — #6, high, `js/xss-through-dom`, `docs/prototype.html:1401` |

CodeQL #6 was investigated at baseline rather than restated. Findings:

- the file contains **no external input source at all** — no `location.search`
  or `.hash`, no `fetch`, no `postMessage`, no storage reads, no `prompt`;
- the flagged flow is document-internal, `e.innerHTML` → a `data-en` attribute →
  back to `e.innerHTML`, over **311 statically authored** `data-ur` attributes;
- **GitHub Pages is not enabled** on the repository, so the file is not served
  anywhere;
- no application serves it; the only reference in `apps/` is a code comment.

So it is category **B — frozen historical prototype only**, and **not
exploitable in any deployed artifact**. Governance is explicit —
`00-repository-audit.md` marks `docs/prototype.html` **"KEEP — do not modify"**
and `02-monorepo-structure.md` calls it *"Stage 3 — approved, frozen"* — so it
is left untouched and the disposition is the owner's. Stage 10 does not dismiss
the alert and does not claim zero CodeQL alerts.

## External blockers inherited from Stage 9

| Blocker | Nature |
| --- | --- |
| **OD-015** | Terms / Community Guidelines unpublished. SAFETY-FR-008 requires an enforcement notification to cite the guideline breached. Owner content decision; not a code defect. |
| **DEP-002** | **SMS / OTP provider.** Owner-held. This is what `FakeSmsProvider` stands in for, and OD-021 made it the single most important external dependency by removing email registration as a fallback. |
| **DEP-003** | **FCM / push provider.** Owner-held. This line originally said DEP-002 was the push credential — see QA-010; that was documentation drift, not an approved renumbering. |
| **DEP-007** | App domain not provisioned — release build has no `APP_HOST`. |
| **OD-020 / DEP-016** | No named technical owner, so no administrator may be provisioned in a real environment. |

## Defect count at baseline

Zero Stage 10 defects at the moment of the baseline; **QA-001** was raised by
the baseline verify run itself, within minutes of it.

## First QA suite

Functional Android QA on the emulator, starting from a clean install: the
authentication chain (splash → language → signup → account type → OTP →
username → profile → login → logout → password reset → restore), then home,
posts, social, search, messaging, events, notifications, settings and safety —
followed by API and object-level authorization testing, which does not depend on
the UI and must not be inferred from it.
