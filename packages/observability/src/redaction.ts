/**
 * REDACTION BEFORE WRITE (NFR-OBS-001 · PRIV-010 · SEC-002 · SEC-028).
 *
 * §15.4 states the rule and its direction: "Redaction runs BEFORE WRITE, not as
 * a filter afterwards."
 *
 * THAT DIRECTION IS THE WHOLE DESIGN. A filter downstream — in the aggregator,
 * in a log-shipping rule — only removes what it sees, and it sees the line only
 * after the process has already written a phone number to stdout, where the
 * platform has already collected it. By then the data has left. Redacting at
 * the point of write means the sensitive value never becomes a byte on a
 * stream: no window, no shipper to misconfigure, no retention policy to get
 * right afterwards.
 *
 * WHAT MUST NEVER APPEAR, verbatim from §15.4: "passwords · OTP codes · session
 * tokens · message bodies · search query text · phone · email · DOB".
 *
 * TWO MECHANISMS, BECAUSE NEITHER IS SUFFICIENT ALONE.
 *
 *   1. BY KEY — any field whose NAME says what it holds is replaced wholesale.
 *      This is the reliable half, and the only one that can catch a password or
 *      a message body, neither of which has a recognisable shape.
 *
 *   2. BY SHAPE — any string that LOOKS like a phone number, an email address
 *      or a bearer token is masked wherever it appears: inside a message, a
 *      URL, a third party's error text, a stack trace. This is the half that
 *      catches what nobody anticipated, such as `"login failed for
 *      +923001234567"`, which no field name would have flagged.
 *
 * The four shapes are the four §4.9 names for the mobile crash reporter —
 * "anything resembling a phone number, email, token or message body". A DATE OF
 * BIRTH IS DELIBERATELY NOT A SHAPE RULE: a bare ISO date is indistinguishable
 * from an event timestamp, an expiry or a scheduled erasure, and masking those
 * would blind the logs to stay ahead of a field that `dateOfBirth`,
 * `date_of_birth` and `dob` already cover by name.
 *
 * A FALSE POSITIVE COSTS A MASKED LOG FIELD. A false negative costs somebody's
 * phone number, in a system somebody else operates, for as long as it is
 * retained. The rules below are tuned in that direction on purpose.
 *
 * WHY IT LIVES IN A PACKAGE. Three consumers apply the same rule: the API's
 * logger, the worker's, and — per §4.9 — the Android crash reporter, which
 * strips before TRANSMISSION. The first two share this code. The third cannot
 * (it is Kotlin), so the rules are stated here as data a Kotlin port must
 * match, and any change here is a change the mobile side owes.
 */

/** What a redacted value becomes. One fixed string, so it is greppable. */
export const REDACTED = '[REDACTED]';

/**
 * Field-name FRAGMENTS. A key is dropped when its normalised form contains any
 * of these, so `hashedPassword`, `passwordConfirm` and `currentPassword` are
 * one entry rather than three.
 *
 * Every fragment here is long enough to be unambiguous. Short or common
 * substrings belong in `REDACTED_KEY_EXACT` instead — `q` as a fragment would
 * mask `requestId`, `queueDepth` and `sequence`, which is how a redactor stops
 * being trusted and starts being switched off.
 */
export const REDACTED_KEY_FRAGMENTS: readonly string[] = [
  // SEC-002 — credentials, in every spelling.
  'password',
  'passphrase',
  'secret',
  'credential',
  // OTP codes (SEC-003).
  'otp',
  'verificationcode',
  'resetcode',
  // Session, push and API tokens (SEC-028).
  'token',
  'authorization',
  'cookie',
  'apikey',
  // Message and comment BODIES (PRIV-010) - the most valuable field in the
  // product to an attacker and the least useful in a log. `body` as a fragment
  // also masks `bodyLength` and `bodyGraphemes`; losing two counts is the
  // right trade against ever printing what somebody wrote.
  'body',
  // Search query TEXT (PRIV-010). §15.4 lists it separately from message
  // bodies, because what somebody searched for is as revealing as what they
  // wrote and is easy to think of as harmless.
  'query',
  'searchterm',
  // Identifiers (PRIV-002/003).
  'phone',
  'msisdn',
  'dateofbirth',
  // Not collected by this product. Listed so that the day it is, it is already
  // covered rather than discovered in a log.
  'latitude',
  'longitude',
];

/**
 * Whole field names, matched exactly.
 *
 * These are the ones too short or too common to match as substrings. `q` is a
 * search parameter across this API and must go; `content` must go without
 * taking `contentType` with it, which media debugging needs.
 */
export const REDACTED_KEY_EXACT: readonly string[] = ['q', 'dob', 'email', 'mobile', 'content'];

/**
 * Value shapes masked wherever they appear inside a string.
 *
 * ORDER MATTERS: the most specific patterns run first, so a bearer token is
 * masked as a token rather than partly consumed by a narrower rule.
 */
export const REDACTION_RULES: readonly { name: string; pattern: RegExp }[] = [
  {
    // Sessions are opaque random strings (ADR-008), so the `Bearer` prefix is
    // the only reliable signal that what follows is a credential.
    name: 'bearer',
    pattern: /\b[Bb]earer\s+[A-Za-z0-9._~+/=-]{8,}/g,
  },
  {
    // Nothing in this product issues a JWT, but third-party SDKs and providers
    // do, and their error messages end up in these logs.
    name: 'jwt',
    pattern: /\beyJ[A-Za-z0-9._-]{10,}/g,
  },
  {
    name: 'email',
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
  },
  {
    /**
     * Pakistani mobile numbers in every form the product accepts:
     * `+923001234567`, `00923001234567`, `03001234567`. The mobile prefix is
     * `3xx` and the subscriber part is seven more digits.
     *
     * THE BOUNDARIES ARE LOAD-BEARING. Without them this matches an eleven-digit
     * run inside a UUID, and correlation ids appear on every log line — a
     * redactor that mangles them would be turned off within a day.
     */
    name: 'phone',
    pattern: /(?<![\w-])(?:\+92|0092|92|0)3\d{2}[\s-]?\d{7}(?![\w-])/g,
  },
];

const normaliseKey = (key: string): string => key.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Is this field name one that is dropped whatever it holds? */
export function isRedactedKey(key: string): boolean {
  const k = normaliseKey(key);
  if (k === '') return false;
  if (REDACTED_KEY_EXACT.includes(k)) return true;
  return REDACTED_KEY_FRAGMENTS.some((fragment) => k.includes(fragment));
}

/** Mask every sensitive SHAPE in a string. */
export function redactText(text: string): string {
  let out = text;
  for (const rule of REDACTION_RULES) {
    out = out.replace(rule.pattern, REDACTED);
  }
  return out;
}

/**
 * How deep to walk before giving up.
 *
 * A log line is no place for a deep object, and a cycle or a hostile payload
 * must not be able to spin the logger. Past the limit the value is REPLACED
 * rather than truncated, because a half-walked object is a half-redacted one.
 */
const MAX_DEPTH = 6;

/**
 * Redact an arbitrary value. The entry point a logger calls on every field.
 *
 * FAILS CLOSED. Anything it cannot recognise or walk becomes `[REDACTED]`
 * rather than passing through, and a throwing getter is caught rather than
 * allowed to escape — a logger that crashes on a bad object turns one
 * diagnosable error into two.
 */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return REDACTED;

  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return redactText(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();

  // A function or symbol in a log line is a mistake; naming it is more useful
  // than printing it, and printing one could include a closure's source text.
  if (typeof value === 'function' || typeof value === 'symbol') return REDACTED;

  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactText(value.message),
      // The stack is where an unanticipated value most often ends up: a number
      // or a token embedded in a thrown message and carried up the frames.
      stack: value.stack === undefined ? undefined : redactText(value.stack),
    };
  }

  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));

  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    let entries: [string, unknown][];
    try {
      entries = Object.entries(value as Record<string, unknown>);
    } catch {
      return REDACTED;
    }

    for (const [key, item] of entries) {
      out[key] = isRedactedKey(key) ? REDACTED : redact(item, depth + 1);
    }
    return out;
  }

  return REDACTED;
}
