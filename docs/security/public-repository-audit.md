# Public Repository Exposure Audit

**Stage 6 addendum · `waqaskhan0/mohalla` · PUBLIC**
Audit date: **3 September 2026** · Scope: working tree, all 266 tracked files, **all 14
commits across every ref**, all branches, all tags, PRs, workflow configuration, GitHub settings

---

# PUBLIC REPOSITORY AUDIT STATUS: **SANITIZATION REQUIRED** → *remediated in this change*

**Not** `SECRET ROTATION REQUIRED` — **no secret of any kind was found**, in the tree or in
history. The status was driven by **one personal-data finding** (a non-fictional phone number
used as an API example), which is fixed in the current tree by this change.

An **organizational publication authorization record does not exist**, so the residual status
is **ORGANIZATIONAL APPROVAL REQUIRED** — see §6 and
[`../governance/PUBLIC-REPOSITORY-AUTHORIZATION-REQUIRED.md`](../governance/PUBLIC-REPOSITORY-AUTHORIZATION-REQUIRED.md).

---

## 1. Method

Per the addendum §39 — *"Do not assume the repository is safe merely because the previous
secret scan reported zero findings"* — this audit did **not** rely on the Stage 5 scan. It
searched **content across every commit reachable from every ref**, not just `HEAD`:

```bash
git rev-list --all                 # 14 commits
git grep -I -n -E "<pattern>" $(git rev-list --all)
git log --all --diff-filter=A --name-only    # every file ever ADDED
```

Independently, **GitHub's own secret scanning was enabled during this audit** and reports
**0 alerts** — a second, non-self-reported confirmation.

---

## 2. Secrets — **PASS**

Searched all 14 commits for: private-key blocks, OpenSSH keys, TLS certificates, AWS access
keys, GitHub PAT/OAuth tokens (`ghp_`, `gho_`, `github_pat_`), Google API keys, Slack tokens,
service-account JSON, and quoted credential assignments of ≥12 characters.

| Check | Result |
|---|---|
| Secret-shaped strings in any commit | ✅ **none** |
| Hardcoded credential literals | ✅ **none** |
| Sensitive file types **ever added** (`.env`, `.pem`, `.key`, `.jks`, `.keystore`, `.p12`, `google-services.json`, `serviceAccount*.json`, dumps, archives) | ✅ **none** |
| GitHub secret scanning alerts | ✅ **0** |
| GitHub Actions secrets configured | ✅ **none** (nothing to leak) |

**No secret rotation is required.** No provider needs to be notified.

### Deliberate non-secrets, assessed and accepted

| Value | Where | Assessment |
|---|---|---|
| `mohalla_local_dev_only` | `infrastructure/docker/docker-compose.yml`, `.env.example` | Local Docker PostgreSQL password, bound to `127.0.0.1`. Authenticates nothing that exists outside a developer's machine. Documented as local-only. |
| `ci_*` role passwords | `.github/workflows/ci.yml` | Synthetic credentials for an **ephemeral CI service container** that is destroyed with the job. Not used by any deployed environment. |
| `CHANGE_ME` | `.env.example` | Placeholder by design. |

These are **not** credentials for any real system. They are retained because replacing them
with indirection would make the local setup harder without reducing any real risk.

---

## 3. Personal information — **ONE FINDING, REMEDIATED**

### 🟠 PD-001 — non-fictional phone number used as an OpenAPI example

> ## PD-001 STATUS (classified 3 September 2026, on repository-owner instruction)
>
> **SYNTHETICALLY GENERATED / SANITIZED / NO KNOWN PERSONAL-DATA SOURCE /
> NO CURRENT HISTORY REMEDIATION REQUIRED**
>
> | Field | Value |
> |---|---|
> | Path | `docs/architecture/contracts/openapi-v1.yaml` (line 114) |
> | Commits | present in the 14 commits preceding the sanitization commit |
> | Data category | Mobile telephone number used as an API example |
> | Belongs to a real person? | **No known data subject.** Generated during Stage 4 documentation authoring |
> | Synthetic / example data? | **Yes** — not copied from any employee, beneficiary, partner, client, application user, production or staging database, contact list, or any external personal-data source |
> | Already public and approved? | The repository is public; publication authorization remains an open governance item |
> | Current exposure | **Working tree: sanitized.** Value remains in Git history |
> | Recommended treatment | **No history rewrite at this time.** Reassess immediately if evidence emerges that the value belongs to a real person |
> | Secret rotation | **Not required** — this is not a credential |
>
> **Why it was still unsafe:** the value visually resembled a valid Pakistani
> mobile number and could theoretically coincide with a real one. That is the
> defect — realism, not provenance.
>
> **Standing rule going forward:** never use a realistic complete mobile number
> as a public documentation sample. Use an unmistakable placeholder such as
> `+92 3XX XXXXXXX`, or a structured synthetic fixture value that cannot be
> mistaken for a real person's contact data.
>
> The original value is **not reproduced** in documentation, output, commit
> messages, issues or pull requests.


| | |
|---|---|
| **Location** | `docs/architecture/contracts/openapi-v1.yaml:114` |
| **Value** | `+9230044719xx` *(redacted here; the full value is in Git history)* |
| **Present in** | working tree **and all 14 commits** |
| **Severity** | 🟠 Medium — a **plausibly routable** Pakistani mobile number published in a public repository |
| **Why it is a finding** | Addendum **§24** requires the OpenAPI document to use **synthetic examples** and contain no real phone numbers; **§5** requires fixtures to be **visibly fictional**. Unlike `+923001234567` (an obvious sequential placeholder), this value is not visibly fictional and could belong to a real person. |
| **Status** | ✅ **Fixed in the current tree** (classification above) — replaced with the visibly-fictional `+923001234567`, matching the placeholder already used in `packages/validation`. |
| **History** | ⚠️ **Still present in Git history.** Per addendum §2 and §4.8, **history was NOT rewritten** — that requires explicit owner approval. See §7. |

**Whether the number belongs to a real person is unknown** — it was generated during Stage 4
authoring. It is treated as potentially real rather than assumed harmless.

### Other numbers found — all visibly fictional, no action

`+923001234567`, `+92300123456`, `+9230012345678`, `+13001234567` — all in
`packages/validation/src/primitives.test.ts` as valid/invalid parser cases. Sequential
placeholders, visibly fictional. **Compliant with §5.**

### Other personal-data checks

| Check | Result |
|---|---|
| Email addresses in tracked content | ✅ none real (only package scopes and `example.*`) |
| Dates of birth | ✅ none |
| Home addresses, beneficiary details | ✅ none |
| Private messages, user reports, moderation notes | ✅ none — no product data exists yet |
| Screenshots | ✅ none committed |

### 🟡 PD-002 — committer email address is public (informational)

Every commit carries `Muhammad Waqas <m.waqas@shehersaaz.org.pk>` — a **real organisational
email address**, now publicly readable in commit metadata. This is ordinary Git behaviour and
the identity was chosen by the repository owner, so it is **not treated as a defect**. It is
recorded because §3 lists real email addresses as personal information, and the owner may
prefer GitHub's `@users.noreply.github.com` identity going forward. **Owner's decision — no
change made.** (Later commits already use the `noreply` identity.)

---

## 4. Internal organizational information — **PASS**

| Check | Result |
|---|---|
| Internal server addresses / hostnames | ✅ none |
| Private IP addresses | ✅ none. `10.0.2.2` appears in `apps/android/app/build.gradle.kts` — the **Android emulator's host-loopback alias**, not internal infrastructure |
| VPN details, intranet references | ✅ none |
| Production database names | ✅ none — only `mohalla` / `mohalla_restore_check` (local) |
| Admin usernames, emergency credentials | ✅ none |
| Internal phone directories, escalation contacts | ✅ none |
| Vendor account IDs, budgets, contracts | ✅ none |
| Incident-response material | ✅ none |

The `10.x` matches reported by a broad regex were **`package-lock.json` integrity hashes and
version strings** — false positives, verified individually.

---

## 5. Workflow and CI exposure — **ONE FINDING, REMEDIATED**

### 🟠 WF-001 — workflows declared no token permissions

| | |
|---|---|
| **Finding** | Neither `ci.yml` nor `android.yml` declared a `permissions:` block, contrary to addendum **§8**. |
| **Mitigating fact** | The **repository default** was already `read` (verified via the Actions API), so no job actually held write access. |
| **Status** | ✅ **Fixed** — both workflows now declare `permissions: contents: read` at workflow level, so least privilege is explicit in-repo and does not depend on a remote setting that could change. |

### Fork pull-request threat model — **PASS**

| Check | Result |
|---|---|
| `pull_request_target` used anywhere | ✅ **no** |
| `workflow_run` / `issue_comment` privileged workflows | ✅ **none** |
| Triggers in use | only `push` and `pull_request` — fork code runs **unprivileged**, per §7 |
| Secrets available to fork PRs | ✅ **none exist** in the repository |
| Self-hosted runners | ✅ **none** — GitHub-hosted, disposable (§9) |
| Untrusted event values interpolated into shell | ✅ none — no `${{ github.event.* }}` in any `run:` block |
| CI database | ✅ ephemeral `postgres:18` **service container**, synthetic credentials, destroyed with the job (§31) |
| Artifacts | only an **unsigned debug APK** from `android.yml`, 14-day retention. No `.env`, dumps, keys or logs (§12) |

---

## 6. Organizational publication authorization — **MISSING**

No record exists showing that Shehersaaz approved public publication of the source,
requirements, architecture, database design, API contracts, security design, UI/UX documents
or prototype.

The repository was made public on the **individual owner's explicit instruction** (recorded in
[`../foundation/01-github-repository.md`](../foundation/01-github-repository.md) §1). That is
an owner decision; it is **not** a documented organizational authorization.

**Per §2, a draft request has been created and must be completed by Shehersaaz:**
[`../governance/PUBLIC-REPOSITORY-AUTHORIZATION-REQUIRED.md`](../governance/PUBLIC-REPOSITORY-AUTHORIZATION-REQUIRED.md).

**No confidential or clearly-internal material was found** (§4), so per §2 this does not block
local implementation or further pushes. It remains an **open governance item**.

---

## 7. Git history remediation plan (NOT executed)

PD-001 remains in history. **No rewrite was performed** — §2 and §4.8 forbid automatic history
rewriting or force-pushing.

**If the owner decides to purge it**, the plan is:

1. Confirm whether the number is real (if not, no action is warranted — the tree is fixed).
2. Rewrite with `git filter-repo --replace-text` mapping the value to `+923001234567`.
3. Because `main` is protected against force-push, **temporarily** relax the ruleset, force-push
   the rewritten history, then immediately restore it.
4. Notify anyone who cloned or forked; their history retains the old value.
5. Re-run this audit and GitHub secret scanning.

**Recommendation:** given that PD-001 is a single phone number of unknown provenance and the
tree is already sanitized, a history rewrite is **optional** and is the owner's call. A rewrite
invalidates every existing clone and fork — a real cost against a modest benefit.
**Do not treat PD-001 as closed merely because `HEAD` is clean** (§4.10).

---

## 8. Result

| Category | Status |
|---|---|
| Secrets (tree + full history) | ✅ **PASS** — none; 0 GitHub alerts; no rotation needed |
| Sensitive file types ever committed | ✅ **PASS** |
| Personal data | 🟠 **1 finding (PD-001) — tree remediated; history retained by policy** · 1 informational (PD-002) |
| Internal organizational information | ✅ **PASS** |
| Workflow security / fork threat model | ✅ **PASS** — WF-001 remediated |
| Public CI artifacts | ✅ **PASS** |
| Organizational publication authorization | ⚠️ **REQUIRED — draft raised** |
| Licensing decision | ⚠️ **REQUIRED — draft raised** |

**Overall: SAFE TO CONTINUE PUBLICLY**, with two **open governance decisions** (publication
authorization, licence) that are the owner's and Shehersaaz's to make and which do not block
implementation.
