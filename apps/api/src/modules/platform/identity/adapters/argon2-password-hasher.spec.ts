import { describe, it, expect } from 'vitest';
import { ARGON2_DEFAULTS, Argon2PasswordHasher } from './argon2-password-hasher.js';

// Deliberately weak-but-legal parameters keep the suite fast. Production
// parameters (~236 ms/hash) are asserted separately below, once.
const fast = new Argon2PasswordHasher({ memoryCost: 19_456, timeCost: 2, parallelism: 1 });

describe('Argon2PasswordHasher', () => {
  it('produces an argon2id PHC string, never the plaintext', async () => {
    const h = await fast.hash('correct horse battery 1');
    expect(h.startsWith('$argon2id$')).toBe(true);
    expect(h).not.toContain('correct horse battery 1');
  });

  it('salts every hash, so identical passwords do not collide', async () => {
    const [a, b] = await Promise.all([fast.hash('same-password1'), fast.hash('same-password1')]);
    expect(a).not.toBe(b);
    // Both must still verify - the salt is embedded in each string.
    expect(await fast.verify(a, 'same-password1')).toBe(true);
    expect(await fast.verify(b, 'same-password1')).toBe(true);
  });

  it('verifies the correct password and rejects a wrong one', async () => {
    const h = await fast.hash('rightPassword1');
    expect(await fast.verify(h, 'rightPassword1')).toBe(true);
    expect(await fast.verify(h, 'wrongPassword1')).toBe(false);
    expect(await fast.verify(h, '')).toBe(false);
  });

  it('returns false - never throws - on a corrupt stored hash', async () => {
    // A corrupt row must read as "wrong password". Throwing would turn it into
    // a 500 that distinguishes it from a valid account (SEC-006).
    for (const bad of ['', 'not-a-hash', '$argon2id$truncated', '$argon2id$v=19$m=1']) {
      await expect(fast.verify(bad, 'anything1')).resolves.toBe(false);
    }
  });

  it('refuses to construct below the OWASP floor instead of hashing weakly', () => {
    expect(() => new Argon2PasswordHasher({ memoryCost: 1024 })).toThrow(/at least 19456/);
    expect(() => new Argon2PasswordHasher({ timeCost: 1 })).toThrow(/at least 2/);
    expect(() => new Argon2PasswordHasher({ parallelism: 0 })).toThrow(/at least 1/);
  });

  describe('needsRehash', () => {
    const current = new Argon2PasswordHasher(ARGON2_DEFAULTS);

    it('is false for a hash at current parameters', async () => {
      const h = await current.hash('x1234567');
      expect(current.needsRehash(h)).toBe(false);
    }, 20_000);

    it('is true for a hash made with weaker parameters', async () => {
      const weak = await fast.hash('x1234567');
      expect(current.needsRehash(weak)).toBe(true);
    });

    it('is true for an unparseable or non-argon2id value', () => {
      expect(current.needsRehash('garbage')).toBe(true);
      expect(current.needsRehash('')).toBe(true);
      expect(current.needsRehash('$argon2i$v=19$m=98304,t=3,p=1$abc$def')).toBe(true);
    });
  });

  it('uses host-BENCHMARKED defaults, not the OWASP floor', () => {
    // 09-authentication-authorization.md §159 requires parameters measured on
    // the host targeting ~250ms. If someone silently drops these to the floor,
    // this fails.
    expect(ARGON2_DEFAULTS.memoryCost).toBe(98_304);
    expect(ARGON2_DEFAULTS.timeCost).toBe(3);
    expect(ARGON2_DEFAULTS.parallelism).toBe(1);
    expect(ARGON2_DEFAULTS.memoryCost).toBeGreaterThan(19_456);
  });
});
