# Stage 10 — QA completion report

## QA STATUS: **NO CRITICAL KNOWN BUGS — AND NO OPEN HIGH**

## RELEASE VALIDATION: **NOT APPROVED**

The two verdicts are independent and both are stated plainly. Zero critical
defects were found or remain, and the one HIGH that was still open at the first
version of this report (QA-009, the absent Android push client) has since been
implemented, tested on a device, and closed. Release is still not approved, for
reasons that are external and enumerated below rather than hidden in a summary.

*Updated 2026-09-12, after QA-009 closed. The earlier text is not rewritten
where it recorded something that was true at the time; where a verdict changed,
the change and its reason are stated.*

---

## 1. Branch, base, head

| | |
| --- | --- |
| Branch | `feature/stage-10-qa-bugfix` |
| Base | `a00597586b3877fdf2fc2c49f565c3154edab838` (Stage 9, PR #16) |
| Head at report | `595df6b47f9e563c077049778dc91f8017b5b6bf` |
| PR | [#17](https://github.com/waqaskhan0/mohalla/pull/17) — **DRAFT, not merged** |

## 2. PR status

**Not merged.** No merge authorization exists for PR #17 and none is assumed.

The reason for the draft has changed, and that is worth saying rather than
quietly deleting. It was held in draft because **QA-009** was an open HIGH. The
owner then supplied the DEP-003 client configuration, the push client was built
and tested on the device, and QA-009 is **CLOSED**. **No HIGH or CRITICAL defect
is open.** The PR stays as the owner left it until the owner says otherwise.

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
| Permissions / manifest audit | PASS — one dangerous permission (`POST_NOTIFICATIONS`), which is the one the requirements ask for; re-audited after the Firebase SDK was added |
| RTL technical | **23 / 23** |
| **Human Urdu language quality** | **NOT EXECUTED** — no fluent reviewer |
| Accessibility, structural + font scaling | **14 / 14** |
| **Human TalkBack review** | **NOT EXECUTED** — nobody listened |
| Network resilience | **16 / 16** |
| Media pipeline | **24 / 24** |
| Chat, realtime, idempotency, requests | **33 / 33** |
| Notifications, in-app | **17 / 17** |
| **Android push client, device lifecycle** | **36 / 36** |
| **Push delivery on device** (granted 6, refused 2, rotation 1) | **9 / 9** |
| **Backend payload ↔ client parser seam** | **6 / 6** |
| **OS notification permission flow** | **PASS** — allow, deny, grant-later, revoke-later, all executed |
| **Real FCM delivery** | **BLOCKED_EXTERNAL — DEP-003-B** (service-account credential) |
| API + object-level authorization + security | **33 / 33** |
| Admin E2E (both builds) | **13 / 13** |
| Admin security and privacy | **15 / 15** |
| Admin browser rendering | 7 of 9 screens; 2 `BLOCKED_ENVIRONMENT` |
| Observability / QA-008 regression | PASS |
| Database tests | 95 passed, 3 skipped |
| **Backup + restore rehearsal** | **PASS — executed and verified** |
| `db:backup` / `db:restore:rehearsal` lanes | `BLOCKED_ENVIRONMENT` |

**Executed QA checks in the Stage 10 suites: 275** (224 before QA-009 was
reopened, plus 51 for the push client: 36 device lifecycle, 9 on-device
delivery and rotation, 6 payload seam). Android unit tests gained 17. Unit and integration
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
| **QA-009** | **HIGH** | the Android push client did not exist | **CLOSED** |
| QA-011 | LOW | the notification permission was re-asked on every cold start after a refusal | CLOSED (found while closing QA-009) |
| QA-010 | LOW | Stage 9/10 docs attributed push to the wrong dependency | CLOSED |

| | Found | Fixed | Open |
| --- | --- | --- | --- |
| CRITICAL | 0 | 0 | **0** |
| HIGH | 2 | 2 | **0** |
| MEDIUM | 6 | 6 | 0 |
| LOW | 3 | 3 | 0 |

**No CRITICAL and no HIGH defect is open.**

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
`POST`/`DELETE /notifications/devices` — and the Android app had no push SDK,
no token, no channel, no permission and no payload handling. It shipped a screen
for choosing which push notifications you want and no ability to receive any.

It is now **CLOSED**. The owner supplied the DEP-003 client configuration; the
client was implemented and executed on the device (36/36 lifecycle, 9/9
delivery and rotation, 6/6 payload seam), and a real Firebase registration
token now reaches the backend from the app. The full record is in
`qa-defects.md`. Two things about the closure are worth carrying forward:

- **Testing it found a second defect.** The permission prompt reappeared on
  every cold start after a refusal, because "have we asked?" lived only in
  `rememberSaveable`. Fixed, and mutation-proven. That is QA-011, and it exists
  only because the lifecycle was actually driven on a handset rather than
  reasoned about.
- **The lesson generalises.** The original error was letting a missing external
  dependency stand in for a missing implementation. Nothing in this stage found
  a second instance, but the shape of the mistake — *an unavailable provider
  makes the requirement inapplicable* — is the one to watch for in DEP-002's
  vicinity too.

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
| **DEP-003** | **FCM / push**. Two halves: the **client configuration** is now supplied and QA-009 closed on it; the **server service-account credential** is not, and is tracked as DEP-003-B |

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
| File | `app-debug.apk` |
| Bytes | 15,886,374 |
| SHA-256 | `debb9fbd76847d52ea4d62d8ac1441a5940d1e5b098b6a6ac708653cac5fdf04` |
| applicationId | `org.shehersaaz.mohalla` |
| versionName / versionCode | `0.0.1-foundation` / 1 |
| minSdk / compileSdk | 26 / 37 |

It grew by **1,167,919 bytes** over the previous QA APK. That is the Firebase
messaging SDK and its Play-services dependencies, and nothing else: no other
dependency was added. The build does **not** contain `google-services.json`
itself as a file — the plugin folds its values into generated resources, which
is why the source file stays git-ignored and is never printed here.

No release APK is claimed or producible: the signing config is deliberately
absent, and a release build hard-codes `API_BASE_URL=https://api.invalid`,
`TERMS_VERSION=""` (OD-015), `APP_HOST=""` (DEP-007) and `SUPPORT_EMAIL=""`.

## 37. Release blockers

| ID | What | Owner | Impact |
| --- | --- | --- | --- |
| **DEP-002** | SMS / OTP provider unselected | Owner | registration impossible in any real environment |
| ~~DEP-003 (client)~~ | ~~FCM project / `google-services.json`~~ | Owner | **SUPPLIED** — QA-009 closed on it |
| **DEP-003-B** | Firebase **service-account credential** for the FCM v1 API, plus a real `FirebasePushSender` adapter | Owner | no push can actually be delivered; the backend can only compose and record what it would send |
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

### READY FOR UAT ON THIS BUILD — NOT READY FOR RELEASE

**No engineering blocker remains.** 275 Stage 10 checks pass, every critical
flow was driven end to end with three levels of evidence, no critical defect
was found at any point, and the one HIGH that was open — QA-009, the absent
push client — is closed and verified on a handset.

UAT can now measure the product that is intended to ship. Push notifications
exist on the device: the permission is asked for contextually, refusing it
costs notifications and nothing else, the token is registered, rotated, retired
on logout and reassigned on an account switch, and an arriving message becomes a
notification that opens the right screen.

**What UAT still cannot exercise, and testers must be told:** a notification
will not arrive *by itself*, because the backend has no credential to send one
through Google (DEP-003-B). Every step on either side of that hop is proven;
the hop is not. A UAT plan that says "we will observe push engagement" will
measure nothing until the service-account credential exists.

**Release remains NOT APPROVED**, for the reasons in §37 — all of them external:
no SMS provider (DEP-002) means nobody can register in a real environment; the
Terms are unpublished (OD-015); there is no app domain (DEP-007), no named
technical owner (OD-020 / DEP-016), no physical devices, and no human Urdu or
TalkBack review. None of these is an engineering gap, and none of them is
something QA can close.
