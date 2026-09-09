/**
 * Object storage (ADR-012 · ADR-013 · SEC-015).
 *
 * TWO PREFIXES WITH DIFFERENT ACCESS POLICIES, and the separation is the whole
 * security boundary:
 *
 *   QUARANTINE — private, never CDN-fronted, no public URL. Bytes land here
 *                unvalidated, and "a guessed quarantine key returns nothing".
 *   SERVED     — the only place a client can read from, and nothing arrives
 *                here without passing inspection.
 *
 * Promotion is a COPY-THEN-DELETE under a NEW random key. Not a rename: the
 * final key must be unrelated to the quarantine key as well as to the original
 * filename (SEC-015), because the quarantine key was returned to the uploader
 * and would otherwise be a guessable handle on the served object.
 *
 * WHY A PORT, AND WHAT THE ADAPTERS ARE.
 *
 * The frozen stack chooses S3-compatible storage (02-technology-stack §36), but
 * Stage 6 provisions nothing paid. So the port exists now with a local
 * filesystem adapter, and the S3 adapter arrives with the bucket. The shape
 * below is deliberately the one S3 supports — key-addressed, copy-then-delete,
 * a presign step — so swapping adapters is not a redesign.
 *
 * `presignUpload` is where the two genuinely differ: S3 returns a URL the
 * device uploads to directly, keeping bytes off the API (ADR-013's whole
 * point). A filesystem cannot do that, so the local adapter returns an API path
 * and the bytes cross the API. That is a development and CI arrangement, and
 * it is recorded rather than hidden — see `LocalMediaStorage`.
 */
export const MEDIA_STORAGE = Symbol.for('mohalla.media.storage');

export interface UploadTarget {
  /** Where the client sends the bytes. */
  url: string;
  /** HTTP method the client must use. */
  method: 'PUT' | 'POST';
  /** Headers the client must send, if any. */
  headers: Record<string, string>;
  /** When the target stops working, so a stale slot cannot be reused. */
  expiresAt: Date;
}

export interface MediaStorage {
  /**
   * Issue an upload target for a QUARANTINE key.
   *
   * The key is chosen by the server. A client-chosen key would let an uploader
   * overwrite another object or place bytes where they are served from.
   */
  presignUpload(quarantineKey: string, expiresInSeconds: number): Promise<UploadTarget>;

  /** Read a quarantined object for inspection. Never used for serving. */
  readQuarantined(quarantineKey: string): Promise<Uint8Array | null>;

  /** Write bytes directly to quarantine (the local adapter's upload path). */
  writeQuarantined(quarantineKey: string, bytes: Uint8Array): Promise<void>;

  /**
   * Copy quarantine → served under a new key, then delete the quarantine copy.
   *
   * Copy-then-delete rather than move, so a failure leaves the object in
   * quarantine — recoverable and unserved — rather than in an unknown state.
   */
  promote(quarantineKey: string, servedKey: string): Promise<void>;

  /** Remove a quarantined object. Rejected files are deleted, not accumulated. */
  deleteQuarantined(quarantineKey: string): Promise<void>;

  /** Remove a served object, when its post or account is deleted. */
  deleteServed(servedKey: string): Promise<void>;

  /** Read a served object, for the API to stream to a client. */
  readServed(servedKey: string): Promise<Uint8Array | null>;
}
