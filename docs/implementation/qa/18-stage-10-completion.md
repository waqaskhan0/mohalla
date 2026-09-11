# Stage 10 — QA completion report

## QA STATUS: **NO CRITICAL KNOWN BUGS**

## RELEASE VALIDATION: **NOT APPROVED**

The two verdicts are independent and both are stated plainly. Zero critical
defects were found or remain. Release is not approved, for reasons that are
external and enumerated below rather than hidden in a summary.

---

## 1. Branch, base, head

| | |
| --- | --- |
| Branch | `feature/stage-10-qa-bugfix` |
| Base | `a00597586b3877fdf2fc2c49f565c3154edab838` (Stage 9, PR #16) |
| Head at report | `595df6b47f9e563c077049778dc91f8017b5b6bf` |
| PR | [#17](https://github.com/waqaskhan0/mohalla/pull/17) — **DRAFT, not merged** |

## 2. PR status

**Kept in Draft.** One **HIGH** defect (QA-009) is open. Stage 10's own rule is
that an unresolved High keeps the PR a draft, and that rule is not bent because
the High happens to be externally blocked.

## 3. Environments tested

| | |
| --- | --- |
| Host | Windows 10, 8.47 GB RAM, Node 24.14.1, Docker 29.7.2, JDK 21 |
| Database | PostgreSQL **18.6** in Docker |
| API | built artifact + a local QA harness exposing the fake SMS outbox |
| Worker | built artifact, draining the notification outbox |
| Admin portal | **both** builds — production `next start`, development `next dev` |
| Android | emulator, **API 36**, 3 GB / 4 cores, headless |
| Browser | in-app Browser pane against the development portal |

## 4. Physical devices

**None.** `adb devices -l` lists the emulator only. Every physical-device lane
is `BLOCKED_EXTERNAL`, and no emulator result is offered as a substitute.

## 5. Device profiles

One: API 36. **API 26–35 is an uncovered gap**, stated rather than omitted —
this host already drives a single emulator into system-process ANRs, and a
second profile would produce measurements that would have to be discarded.

## 6–26. Results

| Area | Result |
| --- | --- |
| Functional Android | **36 / 36** |
| Clean install | PASS |
| Upgrade install (over the real Stage 9 CI artifact) | PASS — session and language preserved |
| Permissions / manifest audit | PASS — no dangerous permission declared at all |
| RTL technical | **23 / 23** |
| **Human Urdu language quality** | **NOT EXECUTED** — no fluent reviewer |
| Accessibility, structural + font scaling | **14 / 14** |
| **Human TalkBack review** | **NOT EXECUTED** — nobody listened |
| Network resilience | **16 / 16** |
| Media pipeline | **24 / 24** |
| Chat, realtime, idempotency, requests | **33 / 33** |
| Notifications, in-app | **17 / 17** |
| **Push client implementation** | **FAIL — absent (QA-009)** |
| **OS notification permission flow** | **NOT IMPLEMENTED** (consequence of QA-009) |
| **External push delivery** | **BLOCKED_EXTERNAL — DEP-003** |
| API + object-level authorization + security | **33 / 33** |
| Admin E2E (both builds) | **13 / 13** |
| Admin security and privacy | **15 / 15** |
| Admin browser rendering | 7 of 9 screens; 2 `BLOCKED_ENVIRONMENT` |
| Observability / QA-008 regression | PASS |
| Database tests | 95 passed, 3 skipped |
| **Backup + restore rehearsal** | **PASS — executed and verified** |
| `db:backup` / `db:restore:rehearsal` lanes | `BLOCKED_ENVIRONMENT` |

**Executed QA checks in the Stage 10 suites: 224.** Unit and integration
suites on top: API 950, admin 259, database 95, worker 18, validation 11.

## 27–30. Defects

| ID | Severity | Area | Status |
| --- | --- | --- | --- |
| QA-001 | MEDIUM | `e2e:admin` could not authenticate against a production build | CLOSED |
| QA-002 | MEDIUM | portal advertised a plain-HTTP escape hatch that never worked | CLOSED |
| QA-003 | LOW | Stage 9's `next build` observation not reproducible | CLOSED |
| QA-004 | MEDIUM | registration's legal links were inert | CLOSED |
| QA-005 | MEDIUM | OTP digest was an enumerable unkeyed SHA-256 | CLOSED |
| QA-006 | MEDIUM | API recorded acceptance of Terms versions that do not exist | CLOSED |
| QA-007 | MEDIUM | a NUL byte in search returned 503 | CLOSED |
| QA-008 | **HIGH** | every failed request was logged as `status: 200` | CLOSED |
| **QA-009** | **HIGH** | **the Android push client does not exist** | **OPEN** |
| QA-010 | LOW | Stage 9/10 docs attributed push to the wrong dependency | CLOSED |

| | Found | Fixed | Open |
| --- | --- | --- | --- |
| CRITICAL | 0 | 0 | **0** |
| HIGH | 2 | 1 | **1** (QA-009, externally blocked) |
| MEDIUM | 6 | 6 | 0 |
| LOW | 2 | 2 | 0 |

### The two that matter most

**QA-008** — the access log recorded *every* failed request as `status: 200`.
401s from the session guard, 400s from validation, 503s from handlers, all
logged as successes, because the interceptor read `res.statusCode` from an rxjs
`tap` that runs before the exception filter. No data impact, rated HIGH for
what it disables: error-rate alerting could never fire, and a brute-force run
against `/login` looked like a wall of 200s.

**QA-009** — and this one corrects a mistake of my own. The device checkpoint
concluded the notification permission lifecycle was "N/A because there is no
push provider". The observation was right; the inference was wrong. A missing
external credential does not make a missing client implementation
inapplicable. NOTIF-FR-001 is a retained **Must**, `04-mobile-architecture.md`
requires the client behaviour explicitly, the backend implements and routes
`POST`/`DELETE /notifications/devices` — and the Android app has no push SDK,
no token, no channel, no permission and no payload handling. It ships a screen
for choosing which push notifications you want and no ability to receive any.

## 31. Verify

```
16 passed · 0 failed · 3 blocked · 19 total
```

Each blocked lane re-investigated rather than inherited:

| Lane | Status | Exact reason | Owner |
| --- | --- | --- | --- |
| release gate (REL-001…008) | BLOCKED_EXTERNAL | REL-002 / REL-008 need three physical low-to-mid-range devices; the ADMIN criterion needs OD-020 / DEP-016 | Owner |
| backup for the rehearsal | BLOCKED_ENVIRONMENT | `backup.mjs` spawns `pg_dump` **without a shell** (the URL carries a password) so a container-delegating `.cmd` shim cannot satisfy it, and host client tools may not be installed here | Environment / Owner |
| restore rehearsal | BLOCKED_ENVIRONMENT | depends on the above | Environment / Owner |

The backup lanes are blocked while the **capability is proven** — see §12. The
lane reason is now precise instead of "pg_dump ENOENT", which read like a
missing binary; the binary exists, one process boundary away.

## 32. Dependency IDs corrected

`14-infrastructure-environments.md` is authoritative:

| ID | Dependency |
| --- | --- |
| **DEP-002** | **SMS / OTP provider** — blocks registration in any real environment |
| **DEP-003** | **FCM / push** — blocks QA-009 |

Stage 9 and the Stage 10 baseline both called DEP-002 "the push provider".
That was drift, not an approved renumbering (QA-010). It mattered: it hid the
fact that **two** external dependencies are open, not one. Stage 9's frozen
records are not rewritten; the correction is recorded.

## 33–34. CodeQL and dependency audit

| | |
| --- | --- |
| CodeQL open alerts | **1** — #6, `js/xss-through-dom`, `docs/prototype.html` |
| `npm audit --audit-level=high` | **0 vulnerabilities** |
| Secret scan | clean, 848 files |
| Architecture guards | dependency direction clean; en/ur parity complete |

CodeQL #6 is unchanged and **not dismissed**: no external input source exists
in that file, GitHub Pages is not enabled, nothing serves it, and governance
marks it *"KEEP — do not modify"*. Zero alerts is **not** claimed.

## 35. CI

Green on every pushed checkpoint. Final result recorded on the head commit.

## 36. Final QA APK

**A debug artifact, not a release build.**

| | |
| --- | --- |
| Commit | `595df6b47f9e563c077049778dc91f8017b5b6bf` |
| File | `app-debug.apk` |
| Bytes | 14,718,455 |
| SHA-256 | `74556e81b8e7940869aa4cafbcda004630459ea8cd31281006819468e4be0556` |
| applicationId | `org.shehersaaz.mohalla` |
| versionName / versionCode | `0.0.1-foundation` / 1 |
| minSdk / compileSdk | 26 / 37 |

No release APK is claimed or producible: the signing config is deliberately
absent, and a release build hard-codes `API_BASE_URL=https://api.invalid`,
`TERMS_VERSION=""` (OD-015), `APP_HOST=""` (DEP-007) and `SUPPORT_EMAIL=""`.

## 37. Release blockers

| ID | What | Owner | Impact |
| --- | --- | --- | --- |
| **DEP-002** | SMS / OTP provider unselected | Owner | registration impossible in any real environment |
| **DEP-003** | FCM project / `google-services.json` | Owner | QA-009 cannot be implemented |
| **OD-015** | Terms and Community Guidelines unpublished | Owner | enforcement notifications cannot cite a guideline; release registration fails closed |
| **DEP-007** | app domain not provisioned | Owner | release build has no `APP_HOST` |
| **OD-020 / DEP-016** | no named technical owner | Owner | no administrator may be provisioned |
| Physical devices | none available | Owner | REL-002 / REL-008 unexecutable |
| Human Urdu review | no fluent reviewer | Owner | language quality unverified |
| Human TalkBack review | nobody listened | Owner | screen-reader experience unverified |

None of these is an engineering gap. Every one needs something only the owner
can supply.

## 38. Merge status

**NOT MERGED — AWAITING OWNER REVIEW.** No merge authorization exists.

---

## Final recommendation

### NOT READY FOR UAT — QA BLOCKER REMAINS

Not because the software is unstable. 224 Stage 10 checks pass, every critical
flow was driven end to end with three levels of evidence, and no critical
defect was found at any point.

It is **QA-009**: a retained V1 Must has no client implementation at all. Running
user acceptance testing on a neighbourhood social product whose push
notifications cannot exist would produce findings about engagement, retention
and responsiveness that would all have to be re-gathered once push arrives.

The shortest path to UAT is one thing: **supply the DEP-003 Firebase
configuration.** With it, QA-009 is ordinary work against endpoints that already
exist and a backend pipeline already proven. Without it, UAT measures a product
that is not the one intended to ship.

Everything else is ready.
