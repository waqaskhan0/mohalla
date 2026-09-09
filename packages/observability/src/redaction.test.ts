import { describe, it, expect } from 'vitest';
import { REDACTED, isRedactedKey, redact, redactText } from './redaction.js';

/**
 * The list §15.4 forbids, tested item by item.
 *
 * Every value below is SYNTHETIC. The phone numbers are in the +92300 range but
 * belong to nobody; the tokens are not tokens. That matters here more than
 * anywhere else in the suite, because a test for a redactor is the one place a
 * real secret would be least noticed.
 */

describe('by key — what a field NAME gives away', () => {
  it('DROPS EVERY CREDENTIAL SPELLING', () => {
    for (const key of [
      'password',
      'currentPassword',
      'newPassword',
      'passwordHash',
      'password_hash',
      'passphrase',
      'clientSecret',
      'credentials',
    ]) {
      expect(isRedactedKey(key)).toBe(true);
    }
  });

  it('drops OTP codes however they are named', () => {
    for (const key of ['otp', 'otpCode', 'verificationCode', 'resetCode']) {
      expect(isRedactedKey(key)).toBe(true);
    }
  });

  it('drops session, push and API tokens', () => {
    for (const key of ['token', 'sessionToken', 'refreshToken', 'pushToken', 'authorization']) {
      expect(isRedactedKey(key)).toBe(true);
    }
  });

  it('DROPS MESSAGE BODIES AND SEARCH TEXT — the two with no recognisable shape', () => {
    // Neither can be caught by pattern. If the key check misses them, nothing
    // else will, which is why PRIV-010 lists them separately.
    for (const key of ['body', 'messageBody', 'content', 'query', 'searchTerm', 'q']) {
      expect(isRedactedKey(key)).toBe(true);
    }
  });

  it('drops identifiers and dates of birth', () => {
    for (const key of [
      'phone',
      'phoneNumber',
      'msisdn',
      'email',
      'dateOfBirth',
      'date_of_birth',
      'dob',
    ]) {
      expect(isRedactedKey(key)).toBe(true);
    }
  });

  it('normalises separators and case, so one entry covers every spelling', () => {
    expect(isRedactedKey('DATE-OF-BIRTH')).toBe(true);
    expect(isRedactedKey('date_of_birth')).toBe(true);
    expect(isRedactedKey('DateOfBirth')).toBe(true);
  });

  it('LEAVES THE FIELDS AN OPERATOR ACTUALLY NEEDS', () => {
    // A redactor that eats the diagnostics is a redactor somebody switches off,
    // and a switched-off redactor protects nothing. `requestId`, `queueDepth`
    // and `sequence` all contain the letter q - which is exactly why `q` is an
    // exact match rather than a fragment.
    for (const key of [
      'requestId',
      'correlationId',
      'queueDepth',
      'sequence',
      'contentType',
      'userId',
      'event',
      'status',
      'durationMs',
      'attempt',
    ]) {
      expect(isRedactedKey(key)).toBe(false);
    }
  });
});

describe('by shape — what a VALUE gives away wherever it appears', () => {
  it('MASKS A PHONE NUMBER INSIDE A SENTENCE', () => {
    // The case the key check cannot reach: a value embedded in a message that
    // nobody wrote a field name for.
    expect(redactText('login failed for +923001234567 after 3 tries')).toBe(
      `login failed for ${REDACTED} after 3 tries`,
    );
  });

  it('masks every form of Pakistani mobile the product accepts', () => {
    for (const number of ['+923001234567', '00923001234567', '03001234567', '0300 1234567']) {
      expect(redactText(`number ${number} here`)).toContain(REDACTED);
      expect(redactText(`number ${number} here`)).not.toContain('1234567');
    }
  });

  it('DOES NOT MANGLE A UUID, which is on every single log line', () => {
    // A correlation id appears in every entry. A redactor that ate part of one
    // would be turned off within a day, and then nothing would be redacted.
    const uuid = '0300123-4567-4000-8000-030012345678';
    expect(redactText(`correlationId=${uuid}`)).toBe(`correlationId=${uuid}`);
  });

  it('DOES NOT MASK TIMESTAMPS OR SCHEDULED DATES', () => {
    // Dates of birth are covered by NAME. Making them a shape rule as well
    // would mask every expiry, erasure date and event time in the system -
    // blinding the logs to stay ahead of something already covered.
    const line = 'erasure scheduled for 2026-10-05T12:00:00.000Z';
    expect(redactText(line)).toBe(line);
  });

  it('masks email addresses', () => {
    expect(redactText('bounced to neighbour@example.invalid')).toBe(`bounced to ${REDACTED}`);
  });

  it('masks a bearer token in a header dump', () => {
    const masked = redactText('authorization: Bearer synthetic-abcdefghijklmnop');
    expect(masked).toBe(`authorization: ${REDACTED}`);
  });

  it('leaves an ordinary diagnostic string untouched', () => {
    const line = 'connection reset by peer after 1200ms, attempt 2 of 3';
    expect(redactText(line)).toBe(line);
  });
});

describe('redact() walks a whole log entry', () => {
  it('REPLACES BY KEY AND MASKS BY SHAPE IN ONE PASS', () => {
    expect(
      redact({
        event: 'login_failed',
        phone: '+923001234567',
        password: 'synthetic-Passw0rd',
        detail: 'no account for +923009999999',
        attempt: 2,
      }),
    ).toEqual({
      event: 'login_failed',
      phone: REDACTED,
      password: REDACTED,
      detail: `no account for ${REDACTED}`,
      attempt: 2,
    });
  });

  it('reaches into nested objects and arrays', () => {
    expect(
      redact({ outer: { inner: [{ otp: '123456' }, { note: 'sent to +923001234567' }] } }),
    ).toEqual({
      outer: { inner: [{ otp: REDACTED }, { note: `sent to ${REDACTED}` }] },
    });
  });

  it('MASKS THE STACK TRACE, where unanticipated values end up', () => {
    const error = new Error('could not deliver to +923001234567');
    const out = redact(error) as { message: string; stack: string };

    expect(out.message).toBe(`could not deliver to ${REDACTED}`);
    // The message is repeated in the stack's first line, so a redactor that
    // handled only `message` would publish it anyway.
    expect(out.stack).not.toContain('923001234567');
  });

  it('FAILS CLOSED on anything it cannot walk', () => {
    expect(redact(() => 'secret')).toBe(REDACTED);
    expect(redact(Symbol('secret'))).toBe(REDACTED);
  });

  it('stops at a depth limit rather than following a cycle forever', () => {
    const cycle: Record<string, unknown> = { name: 'top' };
    cycle.self = cycle;

    // The point is that it TERMINATES and that the cut-off is a replacement
    // rather than a partially-walked - and therefore partially-redacted - value.
    const out = JSON.stringify(redact(cycle));
    expect(out).toContain(REDACTED);
  });

  it('does not throw when a getter does', () => {
    const hostile = {
      get boom(): string {
        throw new Error('nope');
      },
    };
    // A logger that crashes on a bad object turns one diagnosable error into
    // two, and loses the line that would have explained the first.
    expect(() => redact({ wrapper: hostile })).not.toThrow();
  });

  it('preserves null and undefined rather than inventing a value for them', () => {
    expect(redact({ a: null, b: undefined })).toEqual({ a: null, b: undefined });
  });
});
