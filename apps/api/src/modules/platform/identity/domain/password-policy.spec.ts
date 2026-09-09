import { describe, it, expect } from 'vitest';
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  checkPassword,
  isPasswordAcceptable,
} from './password-policy.js';

describe('checkPassword (SRS §12: 8-64, letter + digit)', () => {
  it('accepts a conforming password', () => {
    expect(checkPassword('abcd1234')).toBeNull();
    expect(isPasswordAcceptable('Str0ngEnough')).toBe(true);
  });

  it('enforces the lower bound exactly', () => {
    expect(checkPassword('abcd123')).toBe('TOO_SHORT'); // 7
    expect(checkPassword('abcd1234')).toBeNull(); // 8
  });

  it('enforces the upper bound exactly', () => {
    const at = `${'a'.repeat(PASSWORD_MAX_LENGTH - 1)}1`;
    expect(checkPassword(at)).toBeNull();
    expect(checkPassword(`${at}1`)).toBe('TOO_LONG');
  });

  it('caps length to stop a long-password DoS against a ~236ms hash', () => {
    expect(checkPassword('a1'.repeat(5000))).toBe('TOO_LONG');
  });

  it('requires a letter and a digit', () => {
    expect(checkPassword('12345678')).toBe('NEEDS_LETTER');
    expect(checkPassword('abcdefgh')).toBe('NEEDS_DIGIT');
  });

  it('accepts a non-Latin letter - Urdu users must not be excluded', () => {
    // \p{L}, not [a-z]: an Urdu-script password is a valid password.
    expect(checkPassword('پاسورڈ1234')).toBeNull();
  });

  it('counts by code point, so an emoji is one character not two', () => {
    // 7 emoji + 1 digit = 8 code points. UTF-16 .length would say 15 and pass
    // for the wrong reason; a 7-code-point value must still be rejected.
    expect(checkPassword('😀😀😀😀😀😀1')).toBe('TOO_SHORT');
    expect(checkPassword('😀😀😀😀😀😀😀1')).toBe('NEEDS_LETTER');
  });

  it('rejects non-string input rather than coercing it', () => {
    for (const bad of [undefined, null, 12345678, {}, []]) {
      expect(checkPassword(bad)).toBe('NOT_A_STRING');
    }
  });

  it('exposes the documented bounds', () => {
    expect(PASSWORD_MIN_LENGTH).toBe(8);
    expect(PASSWORD_MAX_LENGTH).toBe(64);
  });
});
