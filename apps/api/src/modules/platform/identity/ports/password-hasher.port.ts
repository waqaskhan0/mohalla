/**
 * Password hashing port.
 *
 * An interface so the algorithm is one swap away. That matters more than usual
 * here: Argon2id parameters are host-specific and are expected to be
 * re-benchmarked when a production host is finally selected (ADR-016 leaves
 * hosting open), and a future parameter increase must be able to re-hash on
 * next successful login without touching any caller.
 */
export const PASSWORD_HASHER = Symbol.for('mohalla.identity.passwordHasher');

export interface PasswordHasher {
  /** @returns an encoded hash string safe to store in `users.password_hash`. */
  hash(plaintext: string): Promise<string>;

  /**
   * Constant-time verification.
   *
   * MUST NOT throw on a malformed stored hash - a corrupt row has to read as
   * "wrong password", never as a 500 that distinguishes it from a good one.
   */
  verify(storedHash: string, plaintext: string): Promise<boolean>;

  /**
   * True when `storedHash` was produced with weaker parameters than current
   * policy, so the caller can transparently re-hash after a successful login.
   */
  needsRehash(storedHash: string): boolean;
}
