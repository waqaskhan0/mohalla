import { describe, it, expect } from 'vitest';
import {
  PhoneNumberError,
  maskForOwner,
  normalizePakistaniMobile,
  tryNormalizePakistaniMobile,
} from './phone-number.js';

/**
 * OD-021 Option C makes this the mandatory identity for every V1 account, so a
 * normalization gap is a duplicate-account and a ban-evasion bug at once.
 */
describe('normalizePakistaniMobile', () => {
  it.each([
    ['03001234567', '+923001234567'],
    ['3001234567', '+923001234567'],
    ['+923001234567', '+923001234567'],
    ['00923001234567', '+923001234567'],
    ['+92 300 1234567', '+923001234567'],
    ['+92-300-1234567', '+923001234567'],
    ['(0300) 123-4567', '+923001234567'],
    ['0092 300 1234567', '+923001234567'],
  ])('reduces %s to %s', (input, expected) => {
    expect(normalizePakistaniMobile(input)).toBe(expected);
  });

  it('maps every accepted spelling of one number to a SINGLE stored value', () => {
    const forms = ['03001234567', '3001234567', '+923001234567', '+92 300 1234567'];
    const normalized = new Set(forms.map(normalizePakistaniMobile));
    // If this is ever >1, uniqueness and the ban list both leak duplicates.
    expect(normalized.size).toBe(1);
  });

  it.each([
    ['+13001234567', 'NOT_PAKISTANI'],
    ['+443001234567', 'NOT_PAKISTANI'],
    ['+8613001234567', 'NOT_PAKISTANI'],
  ])('rejects the non-Pakistani number %s', (input, reason) => {
    expect(() => normalizePakistaniMobile(input)).toThrow(PhoneNumberError);
    try {
      normalizePakistaniMobile(input);
    } catch (e) {
      expect((e as PhoneNumberError).reason).toBe(reason);
    }
  });

  it.each([
    ['+92211234567'], // Karachi landline (21x)
    ['+924212345678'], // Lahore landline
    ['+923501234567'], // 35x is outside the 30x-34x mobile range
    ['+923901234567'],
  ])('rejects the non-mobile Pakistani number %s', (input) => {
    expect(() => normalizePakistaniMobile(input)).toThrow(PhoneNumberError);
  });

  it.each(['', '   ', 'abc', '+92', '030012345', '030012345678', '+92300abc4567'])(
    'rejects malformed input %s',
    (bad) => {
      expect(() => normalizePakistaniMobile(bad)).toThrow(PhoneNumberError);
    },
  );

  it('accepts every operator prefix 30x-34x', () => {
    for (let p = 0; p <= 4; p += 1) {
      expect(normalizePakistaniMobile(`03${p}01234567`)).toBe(`+923${p}01234567`);
    }
  });

  it('never returns a partially-normalized value on failure', () => {
    expect(tryNormalizePakistaniMobile('+13001234567')).toBeNull();
    expect(tryNormalizePakistaniMobile('nonsense')).toBeNull();
  });

  it('carries no input detail in the error message (neutral outward)', () => {
    try {
      normalizePakistaniMobile('+13001234567');
    } catch (e) {
      expect((e as Error).message).toBe('invalid phone number');
      expect((e as Error).message).not.toContain('1300');
    }
  });
});

describe('maskForOwner', () => {
  it('reveals only the last two digits', () => {
    const masked = maskForOwner('+923001234567');
    expect(masked).toBe('+92 3** *** **67');
    expect(masked).not.toContain('0012345');
  });
});
