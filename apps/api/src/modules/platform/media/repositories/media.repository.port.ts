import type { PoolClient } from 'pg';

export const MEDIA_REPOSITORY = Symbol.for('mohalla.media.repository');

export type MediaKind = 'IMAGE' | 'DOCUMENT';
export type MediaState = 'PENDING_UPLOAD' | 'PROCESSING' | 'READY' | 'REJECTED';

export interface MediaRecord {
  id: string;
  ownerId: string;
  kind: MediaKind;
  state: MediaState;
  quarantineKey: string;
  storageKey: string | null;
  mimeVerified: string | null;
  byteSize: number | null;
  width: number | null;
  height: number | null;
  rejectionReason: string | null;
  createdAt: Date;
  readyAt: Date | null;
}

export interface MediaRepository {
  createSlot(
    input: { id: string; ownerId: string; kind: MediaKind; quarantineKey: string },
    client?: PoolClient,
  ): Promise<MediaRecord>;

  findById(id: string, client?: PoolClient): Promise<MediaRecord | null>;

  /**
   * Move to PROCESSING, but only from PENDING_UPLOAD.
   *
   * @returns false when the row was in another state — which means a duplicate
   * `complete` call, or a retry after inspection already ran. Guarded in the
   * UPDATE rather than by a read-then-write, so two concurrent completions
   * cannot both start an inspection.
   */
  markProcessing(id: string, client?: PoolClient): Promise<boolean>;

  markReady(
    id: string,
    result: {
      storageKey: string;
      mimeVerified: string;
      byteSize: number;
      width: number | null;
      height: number | null;
    },
    client?: PoolClient,
  ): Promise<void>;

  markRejected(id: string, reason: string, client?: PoolClient): Promise<void>;

  /**
   * Rows eligible for the 24-hour orphan sweep (ADR-013).
   *
   * PENDING_UPLOAD, PROCESSING and REJECTED rows older than the cutoff. READY
   * rows are never swept by age — they are deleted with their post or account.
   */
  findSweepable(olderThan: Date, limit: number, client?: PoolClient): Promise<MediaRecord[]>;

  deleteById(id: string, client?: PoolClient): Promise<void>;
}
