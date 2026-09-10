# 19 — Open Issues

**Stage 8** · everything known and unresolved at the end of the stage.

---

## 1. Runtime defects found and fixed

| | | |
|---|---|---|
| ADMIN-RUNTIME-001 | a revoked session rendered the full dashboard | fixed — every protected page treats a 401 as the end of the session |
| ADMIN-RUNTIME-002 | a five-hop redirect loop between `/login` and a cleared cookie | fixed — the `expired` marker is authoritative |
| ADMIN-RUNTIME-003 | the queue said "Nothing is waiting" with 1,397 cases open | fixed — "clear" is a claim only page one can make |
| ADMIN-RUNTIME-004 | an expired session rendered the signed-in console, because the redirect was swallowed by the pages' own catch | fixed — `apiFailure` re-throws what it does not recognise |

All four were found by running the portal, on builds where typecheck, tests and
`next build` were green.

Also fixed, and found the same way: the case page showing the queue's loading
skeleton; a heading reading "POST case"; a raw ISO instant in a column of coarse
ages; a bilingual field pair that did not align; a dark theme measuring 2.31:1;
a skip link that moved the scroll position and not the focus; a local validation
check that showed an error and sent the request anyway.

## 2. API gaps — open, and not worked around

None of these is resolved by adding an endpoint or by reading the public API as
an administrator. Each is **stated on the screen** where the information would
have appeared, because a blank panel reads as "there is nothing here".

| | | Consequence |
|---|---|---|
| `ADMIN-API-GAP-001` | the generated contract carries no schemas | every admin response is parsed by a Zod schema read from the API source |
| `ADMIN-API-GAP-002` | no `/admin/me` and no administrator listing | the shell shows no administrator name; the audit filter takes an id, not a name |
| `ADMIN-API-GAP-003` | `total` is `COUNT(*) OVER ()` with a `?? 0` fallback, so an offset past the end reports zero — **on two endpoints**: the moderation queue and the audit log | both screens refuse to read that zero as emptiness |
| `ADMIN-API-GAP-004` | no route returns reported content, only its type and id | the case detail says so where the content would be |
| `ADMIN-API-GAP-005` | no route enumerates the individual reports | the case carries aggregates only, and says so |
| `ADMIN-API-GAP-006` | the sensitive route returns phone and date of birth; PRIV-008 also names email | the panel says email is absent rather than implying none exists |
| `ADMIN-API-GAP-007` | no phone search — the number is a peppered hash | the form says so instead of returning nothing |
| `ADMIN-API-GAP-008` | no route returns an account's enforcement history, and the audit log cannot be filtered by the account acted on | the account page says this is missing information, not a clean record |
| `ADMIN-API-GAP-009` | no route lists announcements, and none edits or withdraws one | said before the publish button, not after |

`ADMIN-API-GAP-003` and `-008` are the two worth raising with the backend: the
first is a correctness bug in two endpoints, and the second leaves the screen
where enforcement happens unable to show proportionality, which BR-037 exists to
support.

## 3. Verification lanes not executed

| | |
|---|---|
| Firefox and Safari | not available in this environment (§65 — not claimed) |
| Assistive technology | no NVDA / JAWS / VoiceOver pass |
| `script-src` enforcement | untestable from the console; verified structurally |
| A user token against admin routes | OTP codes are hashed at rest; verified structurally |
| Six database `verify` lanes | `DATABASE_URL` unset locally; green in CI |
| Performance / load | not performed |

## 4. Carried from earlier stages, unchanged

**OD-020 / DEP-016** — there is no named technical owner, so no administrator may
be provisioned through any product route, and no bootstrap endpoint exists in
any environment. The synthetic administrator used for local verification was
created as a local fixture using the API's own Argon2id parameters; its password
was generated into a scratchpad, never printed, never committed, and never
placed on a command line.

**DEP-ADVISORY-001** — the Multer advisories were resolved in Stage 7 by
patching to 2.3.0 rather than by an exception. Nothing in Stage 8 changes it.
