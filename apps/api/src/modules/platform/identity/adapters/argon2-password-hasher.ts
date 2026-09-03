import { Algorithm, hash, verify } from '@node-rs/argon2';
import type { PasswordHasher } from '../ports/password-hasher.port.js';

/**
 * Argon2id parameters (SEC-001).
 *
 * BENCHMARKED ON THIS HOST, NOT COPIED. `09-authentication-authorization.md`
 * §159 requires parameters measured on the selected machine targeting ~250 ms
 * per hash, because the right settings depend on the hardware.
 *
 * Measured (median of 5, Node 24.20.0, this workstation):
 *
 *   m=19456  t=2  p=1  ->   33.5 ms   (OWASP floor - far too fast here)
 *   m=65536  t=2  p=1  ->  108.1 ms
 *   m=98304  t=3  p=1  ->  235.9 ms   <-- selected
 *   m=131072 t=2  p=1  ->  221.6 ms
 *   m=131072 t=3  p=1  ->  318.4 ms   (over target)
 *
 * 96 MiB / 3 passes sits closest to the 250 ms target from below while keeping
 * memory hardness high - memory cost, not iteration count, is what denies an
 * attacker cheap GPU and ASIC parallelism.
 *
 * ⚠️ These are HOST-SPECIFIC. A production host is not yet selected (ADR-016,
 * OD-019). RE-BENCHMARK before launch and update the environment values - a
 * slower instance would make login painful, a faster one would weaken the hash.
 */
export const ARGON2_DEFAULTS = {
  memoryCost: 98_304, // KiB (96 MiB)
  timeCost: 3,
  parallelism: 1,
} as const;

export interface Argon2Params {
  memoryCost: number;
  timeCost: number;
  parallelism: number;
}

export class Argon2PasswordHasher implements PasswordHasher {
  private readonly params: Argon2Params;

  constructor(params: Partial<Argon2Params> = {}) {
    this.params = { ...ARGON2_DEFAULTS, ...params };

    // Refuse to start below the OWASP floor rather than silently hashing weakly.
    if (this.params.memoryCost < 19_456) {
      throw new Error('ARGON2_MEMORY_KIB must be at least 19456 (OWASP minimum)');
    }
    if (this.params.timeCost < 2) {
      throw new Error('ARGON2_ITERATIONS must be at least 2');
    }
    if (this.params.parallelism < 1) {
      throw new Error('ARGON2_PARALLELISM must be at least 1');
    }
  }

  async hash(plaintext: string): Promise<string> {
    // The library generates a per-hash random salt and encodes it, the
    // parameters and the digest into the returned string - so a parameter
    // change stays verifiable against previously stored hashes.
    return hash(plaintext, { ...this.params, algorithm: Algorithm.Argon2id });
  }

  async verify(storedHash: string, plaintext: string): Promise<boolean> {
    try {
      return await verify(storedHash, plaintext, { algorithm: Algorithm.Argon2id });
    } catch {
      // A malformed or truncated stored hash must read as "wrong password".
      // Throwing here would turn a corrupt row into a 500 that distinguishes it
      // from a valid account - an oracle (SEC-006).
      return false;
    }
  }

  /**
   * Parse the PHC string and compare its parameters with current policy.
   *
   * The library exposes no `needsRehash`, but the encoded hash carries its own
   * settings - `$argon2id$v=19$m=98304,t=3,p=1$<salt>$<digest>` - so the check
   * is a parse, not a guess. Anything weaker than current policy, a different
   * algorithm, or an unparseable value counts as stale.
   */
  needsRehash(storedHash: string): boolean {
    const m = /^\$(argon2(?:id|i|d))\$v=\d+\$m=(\d+),t=(\d+),p=(\d+)\$/.exec(storedHash);
    if (!m) return true; // unparseable or truncated - replace on next login
    if (m[1] !== 'argon2id') return true; // wrong variant

    const memoryCost = Number(m[2]);
    const timeCost = Number(m[3]);
    const parallelism = Number(m[4]);

    return (
      memoryCost < this.params.memoryCost ||
      timeCost < this.params.timeCost ||
      parallelism !== this.params.parallelism
    );
  }
}
