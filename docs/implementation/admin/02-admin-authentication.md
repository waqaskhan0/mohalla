# 02 — Authentication and Session Custody

**Stage 8 · Group 02** · UX-ADM-001, and the one architectural decision Stage 8
had to make for itself.

---

## 1. What the API gives

`POST /admin/login` returns `{ status, token, expiresAt }` in the response body.
ADR-008 defines the token as opaque, server-backed and carried as a bearer over
TLS, with an 8-hour absolute lifetime (SEC-024). The architecture does not say
where a **browser** should keep it.

## 2. The decision

**An httpOnly, Secure, SameSite=Strict cookie, set by a Route Handler, with
every admin API call made server-side.**

Two approved facts settle it. The portal "renders user-generated content and is
the highest-value XSS target" in the product, and every post, bio, report note,
display name and conversation excerpt must be assumed hostile. A token in
`localStorage` or in a JavaScript variable is readable by any script that
executes; a token in an httpOnly cookie is not.

This implements ADR-008's transport rather than departing from it — only the
custody moves server-side — and it answers §38's CSRF requirement for free,
because a cross-site form post arrives without a `SameSite=Strict` cookie at
all.

| | |
|---|---|
| Cookie name | `__Host-mohalla_admin_session` in production, unprefixed over plain HTTP locally |
| `maxAge` | derived from the API's own `expiresAt`, so the cookie cannot outlive the session it points at |
| Already-expired session | refused rather than stored with a guessed lifetime |

The `__Host-` prefix requires `Secure`, which is why HSTS matters here
specifically: a downgrade to HTTP does not weaken the session, it breaks it.

## 3. The mechanism, not the promise

`lib/admin-api/client.ts`, `lib/admin-session.ts` and `lib/admin-api/guarded.ts`
each `import 'server-only'`. A client component that imports any of them fails
the build. Measured on the shipped bundle: **zero** client chunks contain
`mohalla_admin_session`, `__Host-`, `Authorization`, `Bearer`, `readAdminToken`,
`adminRequest`, or any `/admin/...` path. They appear only in server chunks.

## 4. The login screen

One message for a wrong password AND for a locked account. The API returns
`FAILED` for both — `admin-auth.service.ts` logs `ADMIN_LOGIN_BLOCKED_LOCKOUT`
and then returns exactly the same status as a wrong password. Telling the two
apart would leak whether an address belongs to a real administrator.

Verified in flow C of [15](15-runtime-e2e.md): a wrong password and an unknown
address produce an identical code and an identical message.

There is **no** administrator signup, no Create Admin, no Invite Admin, no
bootstrap route and no role selection — absent at every layer, not hidden
(§12, OD-020).

## 5. Two runtime defects this screen produced

**ADMIN-RUNTIME-001** — a revoked session rendered the full dashboard, because
the page checked the cookie and never asked the API. Every protected page now
treats a 401 as the end of the session.

**ADMIN-RUNTIME-002** — a five-hop redirect loop between `/login` and a
just-cleared cookie. The `expired` marker in the URL is now authoritative.

A third, ADMIN-RUNTIME-004, is in [12](12-security-privacy.md): the redirect
that ends a dead session was being swallowed by the pages' own error handling.
