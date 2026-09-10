# 18 — Test Report

**Stage 8** · what runs, what it proves, and what it cannot.

---

## 1. Totals

| | |
|---|---|
| Unit and source-rule tests | **252**, 16 files, in `apps/admin` |
| E2E flows | **12**, all passing (`npm run e2e:admin`) |
| `verify` | 9 passed · 0 failed · 7 blocked · 16 lanes |
| CI on the branch | green on every pushed commit |

The seven blocked lanes are the database-backed ones (`DATABASE_URL` is not set
locally) plus the admin E2E lane (no credentials in that environment). **They
are recorded as BLOCKED and never converted to PASS.** CI runs the database
lanes with a real Postgres and they pass there.

## 2. Every safety rule is mutation-proven

A test that passes against the defect it names is worse than no test, because it
reads like evidence. Each rule below was proven by breaking the code and
confirming the test fails **by exit code**:

| Group | Mutations run | All caught |
|---|---|---|
| 05 queue | 2 | yes |
| 06 case detail | 5 | yes |
| 07 users | 4 | yes |
| 08 account | 4 | yes |
| 09 enforcement | 6 | yes |
| 10 announcements | 7 | yes, after four were rewritten |
| 11 verification | 6 | yes |
| 12 audit log | 9 | yes, after two were rewritten |
| 13 security | 6 | yes |
| 14 accessibility | 5 | yes |
| 15 E2E harness | 1 | yes |

## 3. Where my own tests were wrong

Roughly a dozen assertions passed against the exact defect they described. Every
one was the same fault — **a partial match on a condition is not a test of that
condition**:

- `toContain("values[field] === ''")` survived appending `&& !field.endsWith('Ur')`,
  which made Urdu optional.
- `toContain('useState(false)')` matched a *different* piece of state, so ticking
  a broadcast box by default passed.
- Asserting both `state.broadcast` and `state.broadcastRequested` appear survived
  swapping the branches.
- Asserting a `<dl>` exists did not stop a raw `JSON.stringify` dump beside it.
- Asserting a guard variable appears *somewhere* passed after the guard was
  removed from the call.
- Asserting the CHECKBOX's disabled expression left the publish button free to
  be disabled by a spent allowance.

A sibling fault is feeding a rule the wrong input: assertions matched the file's
own comments saying the thing must not happen, an import path
(`'./conversation-panel'` matched `/conversation`), the JS keyword `export`, a
`&apos;` where an apostrophe was written, and prose prettier had reflowed across
a line. `lib/test-support/read-source.ts` exists because of this, and carries
`readFile`, `readCode`, `readLogic`, `readProse` and `functionSource` so a rule
can be handed exactly the text it is about.

One further lesson: a broken regex in that helper once made three spec files
fail to **collect** while vitest still printed "Tests 25 passed", and a mutation
went unnoticed. A test-count line is not a suite result — the suite is checked by
exit code.

## 4. What the tests cannot prove

- **Only Chromium was exercised.** Firefox and Safari are not available here.
- **No assistive technology was used.** The ARIA structure is asserted; how it
  sounds in NVDA, JAWS or VoiceOver is not.
- **`script-src` was not tested from the browser**, because Chrome exempts
  devtools evaluation from it. It is verified structurally: no `unsafe-inline`,
  and a per-request nonce on every script tag.
- **A real user token was never offered to an admin route.** OTP codes are
  hashed at rest and the plaintext is only reachable from the app's in-process
  fake SMS provider. Verified structurally instead.
- **No load, soak or performance testing** was performed on the portal.
