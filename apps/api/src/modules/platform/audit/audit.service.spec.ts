import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { assertNoIdentifiers } from './audit.service.js';

/**
 * The audit log is retained PSEUDONYMOUSLY after account erasure (OD-019).
 * That makes it the one place where writing a phone number defeats a deletion
 * request permanently and silently — so the guard against it is tested as a
 * privacy control, not as input validation.
 */

describe('assertNoIdentifiers — what must never reach the audit log', () => {
  it('accepts metadata that describes an action without identifying anyone', () => {
    expect(() =>
      assertNoIdentifiers('ADMIN_LOGIN_SUCCEEDED', {
        adminId: '4f6d2c8a-1111-4222-8333-444455556666',
        outcome: 'SUCCESS',
        failureCount: 2,
        reason: 'ACCOUNT',
      }),
    ).not.toThrow();
  });

  it('accepts an empty object', () => {
    expect(() => assertNoIdentifiers('X', {})).not.toThrow();
  });

  it('REFUSES A PAKISTANI MOBILE NUMBER in any of the formats users type', () => {
    for (const value of [
      '+923001234567',
      '923001234567',
      '03001234567',
      '3001234567',
      '0300 1234567',
      '0300-1234567',
    ]) {
      expect(() => assertNoIdentifiers('X', { note: value })).toThrow(/phone number/);
    }
  });

  it('refuses an email address', () => {
    expect(() => assertNoIdentifiers('X', { note: 'someone@example.org' })).toThrow(
      /email address/,
    );
  });

  it('refuses a date of birth', () => {
    expect(() => assertNoIdentifiers('X', { note: '1995-06-15' })).toThrow(/date of birth/);
  });

  it('refuses a forbidden KEY even when the value looks harmless', () => {
    // The key is the intent. `{ phone: 'redacted' }` today becomes
    // `{ phone: actualNumber }` the moment someone "fixes" the placeholder.
    for (const key of [
      'phone',
      'phoneNumber',
      'msisdn',
      'mobile',
      'email',
      'dob',
      'date_of_birth',
      'dateOfBirth',
      'password',
      'passwordHash',
      'token',
      'otp',
      'code',
    ]) {
      expect(() => assertNoIdentifiers('X', { [key]: 'harmless' })).toThrow(/must never hold/);
    }
  });

  it('looks inside nested objects and arrays, not just the top level', () => {
    expect(() =>
      assertNoIdentifiers('X', { actor: { contact: { note: '+923001234567' } } }),
    ).toThrow(/phone number/);

    expect(() => assertNoIdentifiers('X', { targets: [{ note: 'a@b.co' }] })).toThrow(
      /email address/,
    );

    expect(() => assertNoIdentifiers('X', { deep: { list: [{ phone: 'x' }] } })).toThrow(
      /must never hold/,
    );
  });

  it('NEVER PUTS THE OFFENDING VALUE IN THE ERROR MESSAGE', () => {
    // Otherwise the identifier simply moves from the audit row into the error,
    // and from there into the application log - the same leak, one hop later.
    try {
      assertNoIdentifiers('X', { note: '+923001234567' });
      throw new Error('should have thrown');
    } catch (e) {
      const message = (e as Error).message;
      expect(message).not.toContain('923001234567');
      expect(message).not.toContain('3001234567');
      // It still says WHERE, so the mistake is findable.
      expect(message).toContain("'note'");
    }
  });

  it('names the path so a nested mistake can be located', () => {
    try {
      assertNoIdentifiers('X', { a: { b: [{ c: '1995-06-15' }] } });
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as Error).message).toContain('a.b[0].c');
    }
  });

  it('does not recurse forever on a self-referencing object', () => {
    const cyclic: Record<string, unknown> = { name: 'ok' };
    cyclic.self = cyclic;
    // A depth bound rather than a seen-set: audit metadata is small and flat,
    // and a bound cannot be defeated by an unusual object graph.
    expect(() => assertNoIdentifiers('X', cyclic)).not.toThrow();
  });

  it('allows a UUID, which is the identifier the log is SUPPOSED to hold', () => {
    expect(() =>
      assertNoIdentifiers('X', { userId: '0191e5b0-7c2a-7c1a-9c0a-4d5e6f708090' }),
    ).not.toThrow();
  });

  it('DOES NOT MISTAKE A UUID FOR A PHONE NUMBER — the adversarial shapes', () => {
    // These are not hypothetical. A random-UUID loop found the second one, and
    // the reason is worth stating: a UUID's hyphen-separated digit groups can
    // concatenate into a valid number. `92312345-6789` strips to
    // `923123456789`, which is `92` + a real 03xx mobile.
    //
    // A guard that refuses legitimate audit writes has made the trail LESS
    // trustworthy, not more, so these are pinned deterministically rather than
    // left to chance.
    for (const id of [
      '92312345-6789-4abc-8def-000011112222', // 8+4 digits -> 923123456789
      '30012345-6789-4abc-8def-000011112222', // starts 300
      '12345678-9234-4123-8456-789012345678',
      '00923001-2345-4671-8000-111122223333',
      '03001234-5670-4000-8000-000000000000',
    ]) {
      expect(() => assertNoIdentifiers('X', { actorId: id, entityId: id })).not.toThrow();
    }

    for (let i = 0; i < 2_000; i += 1) {
      const id = randomUUID();
      expect(() => assertNoIdentifiers('X', { actorId: id, entityId: id })).not.toThrow();
    }
  });

  it('still catches a number sitting NEXT TO a uuid', () => {
    // Stripping UUIDs must not become a way to smuggle one past the guard.
    expect(() =>
      assertNoIdentifiers('X', {
        note: '0191e5b0-7c2a-7c1a-9c0a-4d5e6f708090 reported +923001234567',
      }),
    ).toThrow(/phone number/);
  });

  it('still catches a number written inside a sentence', () => {
    expect(() =>
      assertNoIdentifiers('X', { note: 'user called from 0300 1234567 to complain' }),
    ).toThrow(/phone number/);
  });

  it('ignores a digit string that is not a Pakistani mobile', () => {
    // A landline, an order reference, a byte count - none of these identify a
    // person the way a mobile number does, and refusing them would push
    // authors to omit useful context from the log.
    for (const value of ['0421234567', '1234567890', '99999999999999']) {
      expect(() => assertNoIdentifiers('X', { note: value })).not.toThrow();
    }
  });
});
