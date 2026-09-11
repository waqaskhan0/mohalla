# 09 — Authentication & Authorization

**Stage 4 · Shehersaaz Community Platform** · Version 1.1 · Status: **Complete**
**Diagram:** `diagrams/auth-flow.mmd` · **Decisions:** ADR-008

> 🟦 **REQUIREMENT** approved · 🟩 **ARCHITECTURE** decision · 🟨 **PROPOSED DEFAULT** changeable · 🟥 **PROPOSED PRODUCT CHANGE** not approved

---

## 1. Identity model

✅ **APPROVED DECISION — OD-021 Option C, 1 September 2026**

**Every normal V1 user account must possess a verified Pakistani mobile number.** Phone + SMS OTP is the required registration and identity mechanism.

| | |
|---|---|
| Primary identifier | 🟦 **Phone, always.** No exceptions, no alternative path |
| Email | 🟩 Optional **secondary** recovery/contact information only |
| Email-primary registration | ✅ **Removed from V1.** AUTH-FR-004 is removed as an approved product change |
| BR-036 | 🟦 **Unchanged** — a banned account's registered mobile number cannot create a new account |
| Anti-enumeration | 🟦 **Preserved unchanged** — uniform body and timing on every auth path (SEC-006) |

🟩 **Ban enforcement simplifies.** With phone mandatory, `banned_identifiers` keys on the phone hash and the swappable-policy abstraction is no longer needed — BR-036 binds to the identity every account is required to hold. **This is exactly why Option C was the safest for ban durability.**

🟩 **Extensibility is preserved deliberately.** `user_identifiers` remains polymorphic; the V1 restriction is one constraint:

```sql
CHECK (NOT is_primary OR kind = 'PHONE')   -- relax this line to admit a future identity method
```

**A future version changes one constraint, not a schema.** Recorded in ADR-021.

---

## 2. Registration

🟦 AUTH-FR-001/002/003/008/009 · BR-001…004 · EDGE-001…006

| Step | Enforcement |
|---|---|
| Number format | `CHECK` on `user_identifiers` + DTO validation |
| Age ≥ 13 | **Server clock**, `CHECK` on `users.date_of_birth` (BR-002) |
| Password policy | 8–64, letter + digit (SRS §12) |
| Terms accepted | Explicit affirmative; version and timestamp stored (BR-004, PRIV-014) |
| Not already registered | `UNIQUE (value_hash)` inside the creating transaction (EDGE-001) |
| Not banned | `banned_identifiers` lookup via the active policy (BR-036) |
| Duplicate submit | `Idempotency-Key` + the unique constraint |

🟩 **Response is uniform.** `202` regardless of whether the number was free, already active, pending deletion or banned (SEC-006, EDGE-003, EDGE-004). The distinction is delivered by the OTP — which only reaches the number's actual holder.

**OTP:** 🟨 6 digits · 10 min · 5 attempts · 15-min lockout · 60 s resend cooldown · max 3 resends/hour. Stored **hashed**, single-use, invalidated on success, resend or exhaustion (SEC-003, EDGE-005).

> **Stage 10 addendum (QA-005).** "Stored hashed" is now specifically a
> **keyed HMAC-SHA256** under a dedicated `OTP_HASH_KEY`, bound to the
> challenge id and purpose. The earlier implementation used an unkeyed
> SHA-256, which QA demonstrated was reversible from a database read in about
> half a second — a six-digit code has only 10^6 possibilities. See
> [otp-digest-supersession.md](../security/otp-digest-supersession.md). The
> lifetimes, attempt cap, lockout and single-use semantics above are unchanged.

---

## 3. Login and sessions

🟦 AUTH-FR-005/010 · BR-006/035 · EDGE-009/010 · SEC-006/007

🟩 **Opaque server-backed sessions** (ADR-008). Token cryptographically random, **stored hashed**, transported as a bearer token over TLS.

| Property | Value | Source |
|---|---|---|
| Idle expiry | 🟨 60 days | AUTH-FR-010 |
| Max devices | 5; sixth evicts the oldest | 🟦 AUTH-FR-010, EDGE-009 |
| Revocation | Row update — effective on the **next request** | 🟦 BR-035, EDGE-010 |
| Admin timeout | 8 hours absolute | 🟦 SEC-024 |

**Uniformity (SEC-006)** — wrong password, unknown number and banned account return the identical body **and** comparable timing. 🟩 The password hash is computed even when the account does not exist, so the timing signal is removed rather than merely reduced.

**Login by account state:**

| State | Outcome |
|---|---|
| `ACTIVE` | Session issued |
| `SUSPENDED` | Session issued **read-only**, with reason and expiry (BR-034) |
| `PENDING_DELETION` | Session issued with a restore offer (SET-FR-005) |
| `UNVERIFIED` | Routed to OTP |
| `BANNED` | Refused with the uniform failure |
| `DELETED` | Refused with the uniform failure |

**Revocation cascade** — suspension, ban, deletion, password change and password reset all revoke sessions in the **same transaction** as the state change (BR-007, BR-035).

---

## 4. Authorization — three checks, always in order

🟦 **SEC-009** — every check is server-side. Hiding a control is never enforcement.

**1 · Authentication** — valid unrevoked session in the correct store.
**2 · Capability** — does this account state permit the action?
**3 · Object-level** — may this actor touch *this* object? 🟦 **SEC-011.**

🟩 Check 3 is where IDOR lives, so it is a shared guard composing `VisibilityPolicy`, not a per-controller `if`.

### Capability matrix by account state

| Action | ACTIVE | SUSPENDED | BANNED | PENDING_DELETION |
|---|---|---|---|---|
| Read feed, profiles, posts | ✅ | ✅ | ❌ | ✅ |
| Post · comment · like · follow · message · create event · RSVP | ✅ | **❌ BR-034** | ❌ | ❌ |
| Report · block | ✅ | ✅ | ❌ | ✅ |
| Edit own profile | ✅ | ✅ | ❌ | ❌ |
| **Delete account** | ✅ | **✅ BR-008** | ❌ (cannot log in) | — |

🟩 A suspended user may still report and block — a suspension restricts contribution, not self-protection.

### Object-level rules

| Resource | Read | Write |
|---|---|---|
| Profile | Any authenticated, minus block | Owner only — **an admin cannot edit a profile** |
| Post / comment / event | Any authenticated, minus block, `VISIBLE` only | Author only |
| Own auto-hidden content | **Author only**, marked under review (PROFILE-FR-004) | — |
| Conversation | **Participants only** | Participants |
| Reported conversation | Admin, **only via its case**, audited (PRIV-009) | — |
| Media | Post media: authenticated. **Conversation media: participants, signed URL** (MSG-FR-008) | Owner until attached |
| Notifications / settings | Owner only | Owner only |
| Audit log | Admin, **read-only** | **Nobody** |
| **Administrator account** | — | **Nobody, via any route** (BR-ADM-001) |

---

## 5. Blocking — enforced on every path

🟦 **BR-025 · SEC-019** — mutual in effect, never disclosed.

🟩 One predicate, one owner (`safety`), composed by every read path:

```
blocked(viewer, other) :=
  EXISTS(blocks WHERE blocker=viewer AND blocked=other)
  OR
  EXISTS(blocks WHERE blocker=other  AND blocked=viewer)
```

Applied in: feed · discover · search · profile · post detail · comments · likes · counts · messaging · notifications · events · suggestions · mentions · followers and following lists.

🟩 **A blocked user requesting the blocker's content by direct identifier receives the same `404 RESOURCE_UNAVAILABLE` as for deleted, hidden, banned or nonexistent content** — identical body, identical timing. Any variance is a disclosure.

---

## 6. Admin authentication

🟦 SEC-020 · SEC-021 · SEC-024 · S2-CR-005 · AUTH-FR-011

Separate table, separate guard, separate session store. Email + password; 8-hour absolute timeout; 5 failures → 30-minute lockout; **every login audited**.

🟩 **Provisioning is a CLI**, run by the technical owner with the migration credential the runtime never holds. Every provisioning action is audited. **There is no bootstrap endpoint in any environment.**

🟩 **`EnforcementService` rejects any target resolving to an administrator, unconditionally, server-side** — before authorization, before validation, before anything. Combined with the schema (no FK from `enforcement_actions` to `admins`), BR-ADM-001 has two independent enforcement points.

---

## 7. Password storage

🟦 **SEC-001** — modern, deliberately slow, salted.

🟩 **Argon2id.** 🟨 Parameters are **benchmarked on the selected host** at EPIC-00 targeting ~250 ms per hash, rather than copied from a document — the correct settings depend on the machine. Recorded in `17-open-decisions.md` as a value to fix, not a decision to make.

🟦 SEC-002 — never logged, never in an error, never in a URL.
