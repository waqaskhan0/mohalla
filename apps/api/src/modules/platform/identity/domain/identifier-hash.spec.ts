import { describe, it, expect } from 'vitest';
import { IdentifierHasher } from './identifier-hash.js';

const PEPPER_A = 'a'.repeat(48);
const PEPPER_B = 'b'.repeat(48);

describe('IdentifierHasher', () => {
  it('refuses a missing or weak pepper rather than hashing with it', () => {
    expect(() => new IdentifierHasher('')).toThrow(/at least 32/);
    expect(() => new IdentifierHasher('short')).toThrow(/at least 32/);
  });

  it('is deterministic for the same number and pepper', () => {
    const h = new IdentifierHasher(PEPPER_A);
    expect(h.hash('+923001234567').equals(h.hash('+923001234567'))).toBe(true);
  });

  it('never stores anything resembling the number itself', () => {
    const digest = new IdentifierHasher(PEPPER_A).hash('+923001234567');
    expect(digest).toBeInstanceOf(Buffer);
    expect(digest.length).toBe(32);
    expect(digest.toString('utf8')).not.toContain('3001234567');
    expect(digest.toString('hex')).not.toContain('3001234567');
  });

  it('produces different digests under different peppers', () => {
    // This is why rotating the pepper silently unbans everyone.
    const a = new IdentifierHasher(PEPPER_A).hash('+923001234567');
    const b = new IdentifierHasher(PEPPER_B).hash('+923001234567');
    expect(a.equals(b)).toBe(false);
  });

  it('distinguishes different numbers', () => {
    const h = new IdentifierHasher(PEPPER_A);
    expect(h.hash('+923001234567').equals(h.hash('+923001234568'))).toBe(false);
  });

  it('matches only the correct number', () => {
    const h = new IdentifierHasher(PEPPER_A);
    const stored = h.hash('+923001234567');
    expect(h.matches('+923001234567', stored)).toBe(true);
    expect(h.matches('+923001234568', stored)).toBe(false);
  });

  it('does not throw on a wrong-length stored value', () => {
    const h = new IdentifierHasher(PEPPER_A);
    expect(h.matches('+923001234567', Buffer.from([1, 2, 3]))).toBe(false);
  });
});
