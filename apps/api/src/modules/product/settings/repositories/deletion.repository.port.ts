import type { PoolClient } from 'pg';

export const DELETION_REPOSITORY = Symbol.for('mohalla.settings.deletionRepository');

export interface DeletionRequestRecord {
  id: string;
  userId: string;
  requestedAt: Date;
  scheduledErasureAt: Date;
  restoredAt: Date | null;
  completedAt: Date | null;
}

export interface DeletionRepository {
  createRequest(
    input: {
      id: string;
      userId: string;
      requestedAt: Date;
      scheduledErasureAt: Date;
    },
    client: PoolClient,
  ): Promise<DeletionRequestRecord>;

  /** EDGE-003 / EDGE-029 — is there an open request for this account? */
  findOpenRequest(userId: string, client?: PoolClient): Promise<DeletionRequestRecord | null>;

  /**
   * THE CONCURRENCY GUARD (ADR-019).
   *
   * `SELECT … FOR UPDATE` on the open request. "A restore at day 29 and an
   * erasure at day 30 CANNOT INTERLEAVE — whichever commits first determines
   * the outcome, and the second observes the new state and aborts."
   *
   * Both paths call this, and both re-check `restoredAt` and `completedAt`
   * afterwards, because holding the lock is only half of it: the row may have
   * changed before the lock was granted, and a lock without a re-read proves
   * nothing.
   */
  lockOpenRequest(userId: string, client: PoolClient): Promise<DeletionRequestRecord | null>;

  markRestored(id: string, at: Date, client: PoolClient): Promise<boolean>;

  /**
   * EDGE-030 — withdraw the message requests this user sent.
   *
   * "Requests are withdrawn from recipients' views. EXISTING ACCEPTED
   * CONVERSATIONS REMAIN for the other participant." The distinction is the
   * whole rule: an accepted conversation is a relationship two people have, and
   * BR-046 keeps the counterpart's copy. A pending request is a message
   * somebody has not yet agreed to receive, from an account that no longer
   * exists — leaving it in the inbox would invite a reply into a void.
   *
   * PHASE ONE CHANGES ONLY STATE, so this is reversible and `reinstate` puts it
   * back. `WITHDRAWN` is produced by this path and no other, which is what
   * makes reinstatement unambiguous.
   */
  withdrawMessageRequests(userId: string, client: PoolClient): Promise<number>;

  /** The other half of EDGE-030, run on restore. */
  reinstateMessageRequests(userId: string, client: PoolClient): Promise<number>;
  markCompleted(id: string, at: Date, client: PoolClient): Promise<boolean>;

  /** The day-30 sweep. Oldest first, bounded. */
  findDue(now: Date, limit: number, client?: PoolClient): Promise<DeletionRequestRecord[]>;

  setState(
    userId: string,
    state: 'ACTIVE' | 'PENDING_DELETION' | 'DELETED',
    client: PoolClient,
  ): Promise<boolean>;

  /**
   * EDGE-029 — is this identifier reserved, or attached to a pending deletion?
   *
   * Two different answers with two different responses. A RESERVED hash belongs
   * to an account that no longer exists, so registration is refused neutrally.
   * A PENDING one belongs to an account that can still be restored, and
   * EDGE-003 says the user is "told the account exists and CAN BE RESTORED BY
   * LOGGING IN" — which is more disclosure than this codebase usually permits,
   * and correct here because they are being told about their own account.
   */
  identifierStatus(
    hash: Buffer,
    client?: PoolClient,
  ): Promise<'FREE' | 'RESERVED' | 'PENDING_DELETION'>;
}
