# 00 — Mobile Baseline

**Stage 7 · Android Mobile Application · Shehersaaz Community Platform (Mohalla — محلہ)**
Branch `feature/stage-7-android-v1` · base `e7d3bea` · started 7 September 2026

---

## 1 · Base commit and branch strategy

```
STAGE_7_BASE_SHA = e7d3bea8610126aff65321c1b7884641212fd353
```

**Stage 6 is local-only.** `origin` carries `main` and nothing else;
`feature/stage-6-backend-v1` was 30 commits ahead of `origin/main` and had never
been pushed. Stage 7 is therefore a **local stacked branch from the exact Stage 6
HEAD**, not from `origin/main` — branching from the remote would have dropped the
entire backend.

Stage 6 commits are neither lost nor duplicated.

---

## 2 · Correction: the OpenAPI contract did not describe the backend

**This is the one finding that changed how Stage 7 integrates.**

| | Operations | Path style |
|---|---|---|
| `docs/architecture/contracts/openapi-v1.yaml` (Stage 4) | **20** | `/auth/register` · `/m/me/username` · `/a/moderation/queue` |
| Stage 6 implementation | **104** | `/register` · `/me/username` · `/admin/moderation/queue` |

The Stage 4 file is an **illustrative subset** — 20 representative paths across
the endpoint families — and Stage 6 never reconciled it. Its prefixes do not
match what the backend serves, so **a client generated from it would compile and
talk to nothing.**

§38 of the Stage 7 brief forbids inventing endpoint paths, field names, error
shapes or request bodies. Hand-writing 84 missing operations would have been
exactly that. So the real document was **generated from the running Stage 6
app**, which already carries full `@nestjs/swagger` decorators, through the
`OPENAPI_OUT` hook that already existed in `apps/api/src/main.ts`:

```bash
OPENAPI_OUT=docs/architecture/contracts/openapi-stage6-generated.json \
  node apps/api/dist/main.js
```

→ **88 paths · 104 operations** ·
[`openapi-stage6-generated.json`](../../architecture/contracts/openapi-stage6-generated.json)

Under the brief's authority order this is item 4 — *"current implemented **+**
approved Stage 6 API contract"* — and it invents nothing. **The Stage 4 file is
untouched.**

> **Needs sign-off.** Adopting the generated document as the Stage 7 transport
> contract is a decision for the product owner. It did not block starting,
> because the alternative was a client that cannot reach the server.

---

## 3 · What the Stage 5 foundation had, and did not

15 files. `MainActivity`, `FoundationScreen`, a partial theme, `AppLocale` /
`LocaleManager`, a logger, a hand-rolled HTTP client, an in-memory storage stub,
a manual DI container, `en`/`ur` strings, 3 tests.

Against what `04-mobile-architecture.md` §2 and §4 specify:

| Required | At baseline | Now |
|---|---|---|
| Retrofit + auth/correlation/language interceptors | ✗ `UrlConnectionHttpClient` | ✅ |
| `EncryptedSharedPreferences` (SEC-004) | ✗ **in-memory** | ✅ |
| Navigation | ✗ | ✅ route table |
| 91 tokens generated into Compose | ✗ 32 CSS colours, no Kotlin | ✅ generated |
| 48 components | ✗ 0 | ◐ 5 |
| Room cache · drafts | ✗ | ✗ |
| Noto Naskh / Nastaliq bundled | ✗ | ✗ **DEP-013** |

### Two defects in the foundation, both fixed

**Sessions did not survive the process.** `InMemorySecureStorage` was honest
about being a stub, and the consequence was that every cold start signed the user
out. On the 2 GB devices NFR-COMP-002 targets Android reclaims a backgrounded
process routinely, so this was the *normal* path — re-entering an OTP after
opening the launcher would have been the product's most frequent interaction.

**The theme invented a dark palette.** `MohallaTheme.kt` carried a
`darkColorScheme` whose five values (`0xFF7FB8CC` and others) appear in no
approved token. Dark mode is out of V1 scope (§49) and the prototype declares no
dark values, so there was nothing to generate and the theme was guessing.
Removed.

---

## 4 · Token vocabulary, and where each value comes from

`MohallaTheme.kt`'s own comment said the theme *"is replaced by a generated
Kotlin token source in the design-system epic rather than being hand-extended
here."* EPIC-01 never delivered that. It now exists.

| Scale | Count | Approved source | How |
|---|---|---|---|
| Colour | 24 | `docs/prototype.html` `:root` | **Generated** → `MohallaPalette.kt` |
| Spacing | 10 | UI/UX §17 | Declared, source cited |
| Radius | 5 | prototype `--r-*` | Declared |
| Elevation | 3 | prototype `--e1…e3` | Declared |
| Motion | 5 | UI/UX §16 | Declared |
| Type | 11 | UI/UX §16 `.moh` scale | Declared, two line heights each |

Generation rather than copying, because a hand-copied palette drifts the first
time a colour changes and nobody remembers the second copy exists — and then the
app and the admin portal render different brands from one approved source.

`npm run generate --workspace @mohalla/design-tokens` regenerates the Kotlin.
Editing `MohallaPalette.kt` by hand is undone by the next run.

**UI/UX §17's rule matters more than the values:** *"Any value not on this scale
is a defect. There is no 6px, no 10px, no 14px, no 18px anywhere in the
product."* Which is why they are named constants — a `dp` literal at a call site
is how 14px enters a product that forbids it, one component at a time.

---

## 5 · The RTL rule, implemented as a property

§8 calls out the case: under mirroring the navigation row reverses, **but Create
stays third of five**.

That falls out of laying the row out in **logical order** and letting
`LayoutDirection.Rtl` reverse it — the middle of an odd-length row is the same
position counted from either end. `MohallaTab.ordered` is therefore never
reversed in code, and two things are deliberately absent:

- No `.reversed()`. It would double-mirror in Urdu, restoring LTR order while
  everything around it mirrored — and moving Create off centre.
- No right-aligned labels. Alignment is not mirroring; §8 names this specifically.

Asserted on the JVM on every build, not on a device, because §36 makes RTL
release-critical and a gate that needs hardware runs late. A `require` at class
load also fails immediately if a sixth tab is ever added.

---

## 6 · Environment constraints

| | |
|---|---|
| **No AVD, no system image, no device** | `adb devices` empty. §45 emulator E2E and all `androidTest` Compose UI tests **cannot run** here. Needs a ~1 GB system-image download. |
| Fonts | Noto Naskh Arabic and Nastaliq not bundled (**DEP-013**). Both currently resolve to the platform serif, which renders Urdu correctly on API 26+ but is not the approved face. |
| Legal documents | **OD-015** — UX-SET-006/007 can only link to placeholders. |
| Urdu strings | **DEP-011 / OD-016** — ~400 strings are Shehersaaz's. What is written is structurally correct and reads as Urdu, and is **not** a substitute for that review. |

Because Compose UI tests need a device, the RTL and state assertions that *can*
run on the JVM were written as unit tests against the underlying rules rather
than deferred. That is a mitigation, not a replacement: it proves Create is at
index 2 of 5 and that the list is not pre-reversed; it does not prove pixels
mirror.

---

## 7 · Secret guard narrowed, not allowlisted

The Android route table declares `RESET_PASSWORD = "password/reset"` and
`FORGOT_PASSWORD = "password/forgot"`. The credential heuristic saw the name
`PASSWORD`, an `=` and a quoted string.

`check-secrets.mjs` says: *"If a finding is a false positive, narrow the pattern
— do not delete the check."* So the allowance is narrowed **on the value, not the
name**: the whole quoted value must be a slash-separated run of lower-case words
— no digits, no mixed case, no punctuation. `password = "Tr0ub4dor/3"` is still
caught, and that was verified with a probe file rather than assumed.

---

## 8 · Verification at this point

| | |
|---|---|
| `assembleDebug` | ✅ 13.2 MB |
| Android unit tests | ✅ **28** (was 9) |
| `lintDebug` | ✅ clean |
| Physical direction properties | ✅ none |
| Repo format · secret scan · locale parity | ✅ |
| Emulator E2E | 🔴 blocked — no device |

Android lint caught a genuine defect in the first draft of `MainActivity`: the
startup destination held in an unremembered `mutableStateOf`, which resets on
every recomposition. Moved into a `ViewModel`, which §37 asks for anyway and
which survives the `recreate()` a language switch performs.

One test written in this slice was worthless and was replaced. It compared
Naskh and Nastaliq `fontFamily` values that are currently the *same* platform
serif, so it would have passed whatever the selection rule did. The rule is now
exposed as `face()` and asserted directly, and stays correct once DEP-013 lands.

---

## 9 · Publication

**Nothing pushed.** All Stage 6 and Stage 7 commits are local, per the standing
instruction that new implementation must not reach the public remote until an
approved publication-authorization record exists. No credential, key, keystore,
real phone number or real message exists in the tree; all fixtures are
synthetic.
