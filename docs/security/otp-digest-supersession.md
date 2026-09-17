# Security decision — OTP challenge digests move to a keyed HMAC

**Raised by:** Stage 10 QA (QA-005)
**Status:** APPROVED and implemented
**Type:** security hardening of an existing approved decision — **not** a new
product feature, and not a change to any user-facing behaviour.

This is an addendum. It supersedes an earlier engineering choice; it does not
rewrite it. The previous decision was made deliberately and for a stated
reason, and that reasoning is reproduced below so the record shows what was
believed, what was measured, and what changed.

---

## Previous decision

`otp_challenges.code_hash` stored an **unkeyed SHA-256 digest** of the
six-digit code:

```ts
export function hashOtpCode(code: string): Buffer {
  return createHash('sha256').update(code, 'utf8').digest();
}
```

The rationale, recorded in `apps/api/src/modules/platform/identity/domain/otp.ts`:

> A plain SHA-256 is correct here, unlike for passwords: the code lives for ten
> minutes, is single-use, and is capped at five attempts, so the slow-hash
> property Argon2id provides buys nothing while costing latency on every
> verification. What matters is that the stored value is not the code itself.

**That argument is sound, and it remains sound.** Stretching a six-digit value
with Argon2id or bcrypt buys very little, and this addendum does not do that.

What the argument answers is *"should the digest be slow?"*. What it does not
answer is *"should the digest be keyed?"* — and the codebase had already
answered that question, in the opposite direction, one directory away in
`identifier-hash.ts`:

> a phone number has only ~10^9 possibilities, so an unkeyed SHA-256 of the
> whole space is enumerable in seconds. The pepper is what makes a stolen
> database dump useless for recovering identifiers.

A six-digit OTP has **10^6** possibilities — a thousand times smaller than the
space that reasoning already deemed enumerable. The two decisions were
inconsistent with each other, and the weaker one guarded the more valuable
secret.

## QA evidence

Measured, not argued. Stage 10's QA harness needed verification codes to drive
the Android signup flow, and obtained them by reading the stored digest and
enumerating the entire six-digit space:

```
register -> 202
challenge purpose : REGISTRATION
digest length     : 32 bytes

enumerated 10^6 six-digit codes in 554 ms
RESULT: RECOVERED the live code from the database row alone.
        matches the code the provider delivered: true
```

Every run. Under a second. Against a live, unconsumed challenge created by the
real endpoint.

**`PASSWORD_RESET` challenges live in the same table**, so the same read
recovers a live password-reset code, which is account takeover.

The TTL, the five-attempt cap and the fifteen-minute lockout are all real and
none of them applies to this: somebody who can read the row does not guess.
They compute the code offline and use it on the first attempt.

### What this is, and what it is not

Exploitation requires **database read access** — an SQL-injection with read, a
leaked backup, a compromised replica, or the `runtime_app` role itself. It is
not a standalone authentication bypass reachable from the internet, and it is
not classified as one.

It is in scope because **this project's own threat model already treats a
stolen database dump as in scope** — that is the entire justification for
peppering identifier hashes. Under that model, OTP digests were undefended.

## New decision

`otp_challenges.code_hash` stores a **keyed HMAC-SHA256**:

```
HMAC-SHA256(OTP_HASH_KEY, encode([
  "mohalla:otp:v2",
  challengeId,
  purpose,
  code,
]))
```

where `encode` writes each part as a 4-byte big-endian length followed by its
UTF-8 bytes, so the fields cannot be slid past one another — plain
concatenation would make `("ab", "c")` and `("a", "bc")` collide.

### Why the challenge id and purpose are in the input

Not decoration. Two live challenges that happen to draw the same six digits
store **different** digests, so the table reveals nothing by collision; and a
digest lifted from a `REGISTRATION` row cannot be replayed against a
`PASSWORD_RESET` one.

### Key separation is mandatory

`OTP_HASH_KEY` is a **dedicated secret**. It is deliberately *not*
`IDENTIFIER_HASH_PEPPER`, and not the session, password, admin or push
credential. Two reasons:

1. One secret leaking must not compromise the other.
2. They have opposite rotation properties. The identifier pepper can **never**
   be rotated — doing so silently unbans every banned identifier. `OTP_HASH_KEY`
   can be rotated freely; the only cost is that outstanding codes stop working,
   and they expire in ten minutes anyway.

### Production fails closed

`loadEnv` refuses to start a production process when `OTP_HASH_KEY` is absent
or still set to the development default. The refusal names the variable and
never prints its value. Development keeps a default so local work is
frictionless, and that default contains the literal string
`not-for-production-use`.

## Migration

`0024_otp_hmac_transition.js` **deletes every row in `otp_challenges`**.

Existing rows cannot be migrated: the new digest needs the plaintext code, and
the entire point of the stored value is that the plaintext is not kept.
Recomputing it would mean performing the attack in order to fix it, and would
leave recovered codes in a migration log.

**No hash-version column, and no legacy verification window.** A bounded
fallback would be a bounded window in which nothing is fixed — any row still
verifiable under `sha256(code)` is a row an attacker with a database read can
still solve. The bound that matters already exists in the data: OTPs live ten
minutes.

**User impact:** somebody holding an unused code at the moment of deploy finds
it rejected and requests a new one — the same experience as a code that expired
while they were reading it, which the app already handles. No account, session
or content is affected; the table holds only in-flight challenges.

## Verification

| | Evidence |
| --- | --- |
| Mutation proof | restoring `sha256(code)` fails 4 domain tests, including the one that pins the enumeration |
| Legacy behaviour | brute-force recovered the live code in **554 ms**, matching the delivered code |
| Fixed behaviour | the same full 10^6 sweep, on a real row, recovered **nothing** |
| API suite | 920 passing |
| Production gate | starting production on the development default throws, without printing the key |

## Consequence for QA tooling

The QA driver can no longer read codes out of the database — which is the
acceptance criterion, not a regression. It now reads the **in-process
`FakeSmsProvider` outbox** through a local harness that composes the same
`AppModule` and adds one route beside it. That harness lives in the git-ignored
`.emulator-evidence/`, refuses to start outside development, refuses a
non-local database, refuses a real SMS provider, and binds to loopback only.
Nothing was added to `apps/api`: production runs `apps/api/dist/main.js`, which
has no such route.

Explicitly **not** used: a debug endpoint in the app, an admin route, a
plaintext column, a log line containing a code, or a committed secret.
