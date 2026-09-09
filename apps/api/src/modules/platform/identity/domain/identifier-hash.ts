import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Peppered identifier hashing.
 *
 * BR-036 requires a permanent ban to survive re-registration, but the data
 * minimisation decision forbids retaining the raw number for that purpose. The
 * resolution is a KEYED hash: `banned_identifiers` and `user_identifiers` store
 * HMAC-SHA256(pepper, normalized), never the number.
 *
 * HMAC with a secret pepper, not a bare digest: a phone number has only ~10^9
 * possibilities, so an unkeyed SHA-256 of the whole space is enumerable in
 * seconds. The pepper is what makes a stolen database dump useless for
 * recovering identifiers.
 *
 * ROTATING THE PEPPER SILENTLY UNBANS EVERYONE - every stored hash becomes
 * unmatchable, with no error and no log line. It is generated once and never
 * rotated (docs/security/… and 12-secret-management.md).
 */
export class IdentifierHasher {
  private readonly pepper: Buffer;

  constructor(pepper: string) {
    if (!pepper || pepper.length < 32) {
      // Refuse to start rather than silently hash with a weak key.
      throw new Error('IDENTIFIER_HASH_PEPPER must be at least 32 characters');
    }
    this.pepper = Buffer.from(pepper, 'utf8');
  }

  /** @param normalized canonical E.164 - normalize BEFORE hashing, always. */
  hash(normalized: string): Buffer {
    return createHmac('sha256', this.pepper).update(normalized, 'utf8').digest();
  }

  /** Constant-time compare, so a lookup cannot be timed to probe the space. */
  matches(normalized: string, stored: Buffer): boolean {
    const computed = this.hash(normalized);
    return computed.length === stored.length && timingSafeEqual(computed, stored);
  }
}
