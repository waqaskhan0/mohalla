# 16 — Implementation Epics

**Stage 4 · Shehersaaz Community Platform (Mohalla — محلہ)**
Version 1.1 · Status: **Complete**

> 🟦 **REQUIREMENT** approved · 🟩 **ARCHITECTURE** decision · 🟨 **PROPOSED DEFAULT** changeable · 🟥 **PROPOSED PRODUCT CHANGE** not approved
>
> **No implementation begins until Stage 4 is approved.** This document defines the order, not a start.

---

## 1. Estimating basis

✅ **OD-011 APPROVED 1 September 2026.**

| | Working days |
|---|---|
| **Committed planning baseline** | **68** |
| Internal stretch target | ~65 |

🟦 Two full-time developers with supervised AI-agent assistance.

✅ **Explicitly protected by the approval — the schedule may NOT be met by:** removing private messaging · removing safety controls · skipping RTL · reducing QA · bypassing security work · skipping staging · skipping physical-device testing. **Must requirements are protected first.**

🟩 Estimates are **developer-days including tests**, assuming supervised AI-agent use. They exclude the Stage-3 corrections and the content dependencies in `17`, which are Shehersaaz's, not the build's.

**"Agent-safe"** means an AI agent can implement it inside one module boundary with a bounded diff and a human review gate. It never means unsupervised.

---

## 2. Epic list

### EPIC-00 · Foundation — **6 days** · agent-safe: ❌
**Goal:** a repository two developers and an agent can work in safely.
**Requirements:** NFR-MAIN-001/003 · SEC-025
**Backend:** monorepo, NestJS skeleton, 15 empty modules with declared dependency directions, global guards/interceptors/error sanitiser · **Database:** migration tooling, four roles, `audit_log` grants + CI assertion · **Infra:** three environments, CI lanes, secret management · **Mobile:** Gradle project, `minSdk 26` · **Admin:** Next.js skeleton
**DoD:** CI green on all lanes · architecture-conformance and cycle checks fail on a violation · `audit_log` grant check passes · **all versions pinned and recorded** (`02` §8)
**Human review:** all of it.

### EPIC-01 · Contracts & design tokens — **4 days** · agent-safe: ⚠️ partial
**Requirements:** UI/UX §14–18 · LOCALE-FR-004
**Deliver:** OpenAPI as source of truth; generated TS + Kotlin clients; **91 tokens generated into Compose theme and TS**; 48 component shells; localization catalogues with **CI failing on a missing Urdu key**; bundled Urdu typefaces; shared validation rules from SRS §12
**DoD:** a token cannot drift between API, app and admin · missing-Urdu-key check works
**Depends on:** EPIC-00

### EPIC-02 · Authentication & sessions — **8 days** *(was 10; OD-021 removes the second identity path)* · agent-safe: ❌ **security-critical**
**Requirements:** AUTH-FR-001…011 · BR-001…007 · SEC-001…008, 020 · EDGE-001…010
**Screens:** UX-AUTH-001…012 · UX-SETUP-001
**Backend:** identity module · Argon2id (host-benchmarked) · OTP · **opaque sessions with five-device eviction** · admin auth · **provisioning CLI** · SMS port + sandbox adapter
**Database:** users, user_identifiers, banned_identifiers, sessions, otp_challenges, admins, admin_sessions
**Mobile:** auth flow **in both directions from the first screen**
**Tests:** **mandatory test B** · uniform response and timing · OTP limits · device eviction
**DoD:** a banned user's session fails on the next request · admin credentials rejected by the app
**Human review:** mandatory — every line.
✅ **OD-021 Option C decided — AUTH-FR-004 is removed from V1.** Email-primary accounts are **not implemented**. Phone + SMS OTP is the only registration path. `user_identifiers` stays polymorphic with `CHECK (NOT is_primary OR kind = 'PHONE')`, so a future identity method relaxes one constraint. Email may exist only as optional secondary recovery/contact. **This removes ~4 days from EPIC-02** (second identity path across auth, deletion and moderation).

### EPIC-03 · Localization & RTL foundation — **6 days** · agent-safe: ⚠️
**Requirements:** LOCALE-FR-001…006 · BR-040/041 · NFR-USAB-004 · **REL-002**
**Deliver:** language selection as first screen · runtime switch via activity recreation · **logical-property lint rule** · dual line-heights per type token · mixed-script rendering · **RTL screenshot test harness**
🟩 **This epic exists early on purpose.** 🟦 The first production screen is validated in both directions before the second is built. Retrofitting RTL is how RSK-004 materialises.
**DoD:** every EPIC-02 screen passes the RTL screenshot pass.

### EPIC-04 · Profiles & verification — **7 days** · agent-safe: ✅
**Requirements:** PROFILE-FR-001…011 · BR-005/010/011 · PRIV-003/004 · ADMIN-FR-010
**Screens:** UX-SETUP-002 · UX-PROFILE-001…005
**Key:** `PublicProfileProjection` — **the type has no phone/email/DOB field to populate** · immutable username with concurrent-claim handling (EDGE-007/008)
**Depends on:** EPIC-02, EPIC-03

### EPIC-05 · Social graph & blocking — **6 days** · agent-safe: ❌ **privacy-critical**
**Requirements:** SOCIAL-FR-001…005 · SAFETY-FR-005/006/007 · BR-018…025 · SEC-019
**Screens:** UX-SETUP-003 · UX-PROFILE-004/005 · UX-SAFE-003 · UX-SET-005
**Key:** 🟩 **`VisibilityPolicy` is built here and consumed by every later epic.** Getting it wrong contaminates everything downstream.
**Tests:** **mandatory test A** — the full block-privacy matrix
**Human review:** mandatory.

### EPIC-06 · Posts & media — **12 days** · agent-safe: ⚠️ (upload path ❌)
**Requirements:** POST-FR-001…010 · MEDIA-FR-001…005 · SEC-012/013/014/015 · EDGE-011…014
**Screens:** UX-CREATE-001…004 · UX-HOME-003/004
**Key:** on-device compression under 500 KB · **presigned → private quarantine → content inspection → promotion** · **server-side SSRF-guarded link preview** · trigger blocking non-`READY` media
**Human review:** mandatory on upload and link preview.

✅ **PDF is a CONDITIONAL deliverable within this epic (OD-023).** Structural validation and active-content rejection must be implemented, and the capability **approved by the Technical Lead before production enablement**. **If no practical safe mechanism fits, PDF is cut** — POST-FR-005, MEDIA-FR-003 and MEDIA-FR-004 are Should, and SEC-013 is not weakened to keep them. Budget 2 days for the PDF path; cutting it returns those 2 days.

### EPIC-07 · Feed & engagement — **9 days** · agent-safe: ✅
**Requirements:** FEED-FR-001…007 · ENGAGE-FR-001…008 · BR-026…031/033 · EDGE-015/017/018
**Screens:** UX-HOME-001/002/005/006
**Key:** keyset pagination · **Featured as an independent endpoint** (RSK-001) · denormalised counts with per-viewer correction
**Depends on:** EPIC-05 (VisibilityPolicy), EPIC-06

### EPIC-08 · Search — **5 days** · agent-safe: ✅
**Requirements:** SEARCH-FR-001…005 · BR-042 · PRIV-011
**Screens:** UX-SEARCH-001…003
**Key:** normalised column + transliteration dictionary · **failure returns 503, never zero results** · **no server-side history**

### EPIC-09 · Messaging & requests — **12 days** · agent-safe: ❌ **privacy-critical**
**Requirements:** MSG-FR-001…009 · BR-024…028/046 · EDGE-019…022 · NFR-PERF-007
**Screens:** UX-MSG-001…004
**Key:** `UNIQUE (conversation_id, client_message_id)` · **per-participant request state** · Socket.IO with **per-event re-authorisation** · polling fallback reusing the same id
**Tests:** **mandatory test E**
**Human review:** mandatory.
✅ **OD-022 decided — MSG-FR-005 is a MUST.** On the critical path and **removed from the cut order**.

### EPIC-10 · Events — **7 days** · agent-safe: ✅
**Requirements:** EVENT-FR-001…008 · BR-043/044/045
**Screens:** UX-EVENT-001…005
**Key:** 🟦 **no attendee endpoint** (ARCH-CONFLICT-006) · join link gated to 30 minutes with **split 403/404 semantics** · event threshold is **2**

### EPIC-11 · Notifications — **7 days** · agent-safe: ⚠️
**Requirements:** NOTIF-FR-001…007 · LOCALE-FR-006 · BR-027
**Screens:** UX-HOME-007 · UX-SET-003
**Key:** **outbox in the producing transaction** · **Message Requests never push** · like batching · recipient-language rendering · token lifecycle

### EPIC-12 · Safety & moderation — **10 days** · agent-safe: ❌ **integrity-critical**
**Requirements:** SAFETY-FR-001…009 · BR-030/032/037/038/044 · EDGE-023/025/026
**Screens:** UX-SAFE-001/002/004
**Key:** **atomic threshold in one transaction with `FOR UPDATE`** · per-type thresholds · repeat-offender **flagging, not auto-suspension**
**Tests:** **mandatory test C**
**Human review:** mandatory.

### EPIC-13 · Admin Portal — **12 days** · agent-safe: ⚠️ (enforcement ❌)
**Requirements:** ADMIN-FR-001…012 · BR-034/035/036/039 · BR-ADM-001 · SEC-021/022/024 · EDGE-024/027
**Screens:** UX-ADM-001…009
**Key:** **Restore and Delete as peers** · `version` collision handling · **admin-target rejection** · **audited sensitive views** · read-only audit log
**Tests:** **mandatory test D**
**🟦 Built from UI/UX §27 and SRS §10.14 — the prototype has no admin screens** (ARCH-CONFLICT-009).
**Human review:** mandatory on enforcement and audit.

### EPIC-14 · Settings & account deletion — **8 days** · agent-safe: ❌ **irreversible**
**Requirements:** SET-FR-001…010 · BR-008/009/046 · PRIV-005/006/007 · EDGE-029/030
**Screens:** UX-SET-001…009 · UX-AUTH-012
**Key:** deletion state machine · **per-module anonymisation contract** · day-30 erasure with **dry-run mode** · restore/erasure locking
**Tests:** **mandatory test F**
**Human review:** mandatory.

### EPIC-15 · Observability, security & recovery — **6 days** · agent-safe: ⚠️
**Requirements:** NFR-OBS-001…004 · SEC-026/027 · REL-007
**Key:** structured logs with **redaction before write** · crash reporting with PII stripping · metrics and alerts including **moderation queue age** · daily backups · **restore rehearsal**

### EPIC-16 · Release validation — **8 days** · agent-safe: ❌
**Requirements:** REL-001…008 · NFR-COMP-002
**Key:** **all 8 release criteria** · **mandatory test G** — RTL E2E through every module · three physical devices · Play submission with policy URLs · **seeded platform before public invitation**
**Blocked by:** OD-015, OD-016, OD-018, OD-020, DEP-006, DEP-010

---

## 3. Dependency graph

```
EPIC-00 Foundation
   └─ EPIC-01 Contracts & tokens
        └─ EPIC-02 Auth ──┬─ EPIC-03 RTL foundation
                          │      └─ (gates every later UI epic)
                          └─ EPIC-04 Profiles
                                 └─ EPIC-05 Social graph & blocking  ★ VisibilityPolicy
                                      ├─ EPIC-06 Posts & media
                                      │     └─ EPIC-07 Feed & engagement
                                      │           ├─ EPIC-08 Search
                                      │           └─ EPIC-11 Notifications
                                      ├─ EPIC-09 Messaging
                                      ├─ EPIC-10 Events
                                      └─ EPIC-12 Safety & moderation
                                            └─ EPIC-13 Admin Portal
EPIC-14 Settings & deletion   (needs 02,04,05,06,09)
EPIC-15 Observability         (parallel from EPIC-06)
EPIC-16 Release validation    (last)
```

★ **EPIC-05 is the true bottleneck.** `VisibilityPolicy` is consumed by feed, search, messaging, events, notifications and moderation. Six epics inherit its correctness.

---

## 4. Critical path

```
00 → 01 → 02 → 03 → 04 → 05 → 06 → 07 → 12 → 13 → 16
 6    4   10    6    7    6   12    9   10   12    8   = 90 days
```

With two developers working the parallelisable branches (08, 09, 10, 11, 14, 15 alongside the spine):

| | Working days |
|---|---|
| Total scope | ~95 developer-days |
| Two developers, realistic parallelism | 62–68 |
| **✅ Committed baseline** | **68** |
| ✅ Stretch target | ~65 |

✅ **OD-011 is decided.** The 50-day figure is superseded. The cut order below applies **only** if the 68-day baseline itself comes under pressure — and Must requirements are protected first.

---

## 5. Priority and safe cut order

🟦 **MoSCoW is inherited from the SRS and is not re-litigated here.**

| Cut order — applies only if the **68-day** baseline comes under pressure | Saves | Cost |
|---|---|---|
| 1 · Saved posts (FEED-FR-007, Could) | 1.5 d | Minor |
| 2 · @mentions (ENGAGE-FR-008, Could) | 2 d | Minor |
| 3 · Interests (PROFILE-FR-011, Could) | 1 d | Weaker suggestions |
| 4 · Event search (SEARCH-FR-004, Could) | 1 d | Minor |
| 5 · Read receipts, DM images (MSG-FR-008/009, Could) | 3 d | Minor |
| ✋ **Message Requests (MSG-FR-005)** | — | ✅ **PROMOTED TO MUST by OD-022 — not cuttable** |
| 6 · Post search (SEARCH-FR-002, Should) | 3 d | **Loses the largest advantage over WhatsApp** |
| 7 · PDF attachments (POST-FR-005, Should) | 3 d | **Weakens "awareness material"** |
| 8 · Edit post (POST-FR-008, Could) | 2 d | Minor |
| **— stop here: ~16.5 days recovered —** | | |
| ✋ **Private messaging (MSG-FR-001…009)** | 12 d | 🟦 **Do not cut.** It is the no-phone-number-exposure proposition — objective O2 and the product's core differentiator |

🟩 **Cutting items 1–8 recovers roughly 16.5 days.** Everything above the line is Could, or a Should whose loss is survivable. **Private messaging and Message Requests are below the line and stay there** — the first is objective O2, the second is now a Must.

---

## 6. AI-agent operating model

🟦 **No agent may:** push to main · deploy production · rotate secrets · run destructive production migrations · create administrator accounts · change security rules without human review.

**Cycle:** requirement + screen IDs selected → **human writes a bounded task** → agent reads the source documents → implements in a feature branch → adds tests → runs required checks → **human reviews the diff** → staging validation → merge.

### 🟦 Mandatory human review — no exceptions

Authentication · authorization · session management · OTP · **database migrations** · blocking · messaging privacy · moderation thresholds · audit logging · account deletion · file uploads · link-preview fetching · infrastructure · secrets · production deployment.

🟩 Enforced by CODEOWNERS on those paths, branch protection, and a production approval step no automation can satisfy.

**PR checklist:** requirement and screen IDs named · tests including the relevant mandatory test · **both language directions** where UI is touched · no new dependency without justification · no hardcoded token or literal colour · migration reviewed separately · **`VisibilityPolicy` composed on any new read path**.

---

## 7. Stage 6 delivery status

> 🟦 **Recorded during Stage 6, appended to an approved Stage 4 artefact.**
> Sections 1–6 above are the approved plan and are unchanged. This section records
> what was **delivered against** that plan; it does not revise it.
>
> Full evidence: [`../implementation/backend/stage-6-completion.md`](../implementation/backend/stage-6-completion.md)

**Stage 6 — Backend Implementation: 🟢 COMPLETE.** Fourteen backend epics delivered on
`feature/stage-6-backend-v1`. 1,059 tests passing · `smoke:api` 413/413 ·
`release:gate` 47/47 · `verify` 12 lanes pass, 0 fail, 3 BLOCKED.

**The release itself is 🔴 NOT APPROVED** — seven criteria remain BLOCKED on devices,
legal content, a named owner and a proven restore. See §7 of the completion report.

| Epic | Backend | Note |
|---|---|---|
| EPIC-00 · Foundation | ✅ | Stage 5 |
| EPIC-01 · Contracts & design tokens | ◐ | Foundation outputs only — **not delivered as an epic** |
| EPIC-02 · Authentication & sessions | ✅ | **mandatory test B** ✅ |
| EPIC-03 · Localization & RTL foundation | ◐ | Catalogues + parity guard exist; **RTL across the UI is Android work** |
| EPIC-04 · Profiles & verification | ✅ | |
| EPIC-05 · Social graph & blocking | ✅ | **mandatory test A** ✅ |
| EPIC-06 · Posts & media | ✅ | ADR-013 PDF gated **off**; the decision stays open |
| EPIC-07 · Feed & engagement | ✅ | |
| EPIC-08 · Search | ✅ | |
| EPIC-09 · Messaging & requests | ✅ | **mandatory test E** ✅ |
| EPIC-10 · Events | ✅ | |
| EPIC-11 · Notifications | ✅ | |
| EPIC-12 · Safety & moderation | ✅ | **mandatory test C** ✅ |
| EPIC-13 · Admin Portal | ✅ **API only** | **mandatory test D** ✅ · front end not built |
| EPIC-14 · Settings & account deletion | ✅ | **mandatory test F** ✅ |
| EPIC-15 · Observability, security & recovery | ✅ | REL-007 mechanism built, **never run against a production backup** |
| EPIC-16 · Release validation | ✅ **gate built** | **mandatory test G** 🔴 blocked — Android |

◐ = partial. Neither EPIC-01 nor EPIC-03 was delivered as an epic; their Stage 5
foundation outputs exist and should not be read as completion.

**Out of Stage 6's scope by design:** the Android application · the Admin Portal front
end · any deployment · real SMS or push delivery.

### What §6's operating model still requires

The cycle in §6 is *feature branch → tests → checks → **human reviews the diff** →
staging validation → merge*. **Only the first three have happened.** Nine of the fourteen
epics carry ❌ or ⚠️ ratings and six say human review is mandatory (02, 05, 09, 12, 13, 14);
none of that review has taken place, and 🟦 *no agent may push to main* remains in force.
