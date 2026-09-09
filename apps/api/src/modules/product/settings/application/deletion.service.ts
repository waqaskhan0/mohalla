import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { DatabaseService } from '../../../../database/database.service.js';
import { StructuredLogger } from '../../../../common/logging/structured.logger.js';
import { AuditService } from '../../../platform/audit/audit.service.js';
import { CLOCK, type Clock } from '../../../platform/identity/ports/clock.port.js';
import { SessionService } from '../../../platform/identity/application/session.service.js';
import {
  DELETION_CONSEQUENCE_KEYS,
  DELETION_GRACE_DAYS,
  canRequestDeletion,
  canRestore,
  erasureDueAt,
  type DeletionRefusal,
} from '../domain/deletion-lifecycle.js';
import {
  ANONYMISABLE,
  type Anonymisable,
  type AnonymisationOutcome,
} from '../ports/anonymisable.port.js';
import {
  DELETION_REPOSITORY,
  type DeletionRepository,
  type DeletionRequestRecord,
} from '../repositories/deletion.repository.port.js';

export type DeleteResult =
  | { status: 'PENDING'; scheduledErasureAt: Date; consequences: readonly string[] }
  | { status: 'REFUSED'; reason: DeletionRefusal };

export type RestoreResult =
  | { status: 'RESTORED' }
  | { status: 'NOT_PENDING' }
  /** The grace period ran out, or the erasure job got there first. */
  | { status: 'GRACE_EXPIRED' };

export interface ErasureReport {
  userId: string;
  dryRun: boolean;
  outcomes: AnonymisationOutcome[];
}

/**
 * Account deletion (SET-FR-004/005 · BR-008/009/046 · PRIV-005/006/007 · ADR-019).
 *
 * THE ONLY IRREVERSIBLE THING IN THE PRODUCT LIVES HERE. Everywhere else, a
 * mistake hides content, marks a case or revokes a session, and somebody can
 * put it back. At day 30 this erases, and nothing puts that back.
 *
 * SO THE DESIGN IS ABOUT MAKING THE IRREVERSIBLE STEP HARD TO REACH BY
 * ACCIDENT:
 *
 *   - the request needs the password again (SET-FR-004), because the phone is
 *     already unlocked and in somebody's hand
 *   - thirty days pass before anything is destroyed, and restoring is
 *     self-service with no administrator involved (SET-FR-005) — a restoration
 *     that needed a support ticket would fail everybody who deleted in a moment
 *     they cannot face explaining
 *   - the erasure job has a DRY RUN that shares every line with the real one,
 *     because a rehearsal of different code is not a rehearsal
 *   - restore and erase cannot interleave: both take a row lock and re-check
 *     the state inside one transaction, so a restore on day 29 and an erasure
 *     on day 30 resolve to whichever commits first (ADR-019 "Concurrency")
 *
 * WHAT IS KEPT, AND WHY. BR-009 anonymises rather than erases posts and
 * comments, and PRIV-006 says users must be told so BEFORE confirming "because
 * it differs from the erasure many will assume". The reason is that a thread is
 * not one person's property: erasing the opening post of a discussion about a
 * water outage destroys eleven other people's record of what was agreed, and on
 * a civic platform that record is sometimes the only evidence a complaint was
 * raised. So `delete` returns the consequences before anything happens.
 */
@Injectable()
export class DeletionService {
  constructor(
    private readonly db: DatabaseService,
    @Inject(DELETION_REPOSITORY) private readonly repo: DeletionRepository,
    @Inject(ANONYMISABLE) private readonly anonymisers: readonly Anonymisable[],
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly logger: StructuredLogger,
  ) {}

  /**
   * What deletion will do — before the user confirms (PRIV-006, UX-SET-009).
   *
   * Served as its own read so the confirmation screen cannot be built without
   * it, and so every client shows the same list rather than each writing its
   * own and omitting the surprising one.
   */
  consequences(): { keys: readonly string[]; graceDays: number } {
    return { keys: DELETION_CONSEQUENCE_KEYS, graceDays: DELETION_GRACE_DAYS };
  }

  /**
   * SET-FR-004 — request deletion.
   *
   * The password check belongs to the CALLER, which has the identity module's
   * verifier; this refuses without one having happened by requiring the flag.
   * Splitting it that way keeps `settings` from learning how a password is
   * stored, and keeps the check from being something this service could be
   * asked to skip.
   */
  async requestDeletion(input: {
    userId: string;
    state: string;
    passwordVerified: boolean;
  }): Promise<DeleteResult> {
    if (!input.passwordVerified) {
      return { status: 'REFUSED', reason: 'PASSWORD_REQUIRED' };
    }

    // BR-008: any state except already-deleted, INCLUDING WHILE SUSPENDED. A
    // suspension must not trap somebody in the product.
    const refusal = canRequestDeletion(input.state);
    if (refusal !== null) return { status: 'REFUSED', reason: refusal };

    const now = this.clock.now();
    const scheduledErasureAt = erasureDueAt(now);

    await this.db.withTransaction(async (client) => {
      await this.repo.createRequest(
        {
          id: randomUUID(),
          userId: input.userId,
          requestedAt: now,
          scheduledErasureAt,
        },
        client,
      );

      // The account becomes invisible IMMEDIATELY: gone from search, feeds,
      // follower lists and suggestions. Every read path already excludes
      // PENDING_DELETION, so this one state change does all of it.
      await this.repo.setState(input.userId, 'PENDING_DELETION', client);

      // EDGE-030, in the SAME transaction as the state change. A request left
      // in somebody's inbox from an account that has just ceased to exist
      // invites a reply into a void. Accepted conversations are untouched —
      // those are a relationship two people have, and BR-046 keeps the
      // counterpart's copy.
      await this.repo.withdrawMessageRequests(input.userId, client);

      await this.audit.append(
        {
          actorType: 'USER',
          actorId: input.userId,
          action: 'ACCOUNT_DELETION_REQUESTED',
          entityType: 'USER',
          entityId: input.userId,
          metadata: { scheduledErasureAt: scheduledErasureAt.toISOString() },
        },
        client,
      );
    });

    // BR-035, and outside the transaction so a revocation failure cannot roll
    // back a deletion the user asked for. Every session goes - the person has
    // said they are leaving, and leaving them signed in on another device would
    // be the product arguing with them.
    await this.sessions.revokeAllForUser(input.userId, 'DELETED');

    this.log('deletion_requested', { graceDays: DELETION_GRACE_DAYS });
    return {
      status: 'PENDING',
      scheduledErasureAt,
      consequences: DELETION_CONSEQUENCE_KEYS,
    };
  }

  /**
   * SET-FR-005 — restore, within the grace period.
   *
   * "Requires the account's OWN CREDENTIALS — no administrator involvement",
   * which the login path has already established by the time this is called.
   *
   * The lock and the state re-check are inside one transaction (ADR-019
   * "Concurrency"): a restore on day 29 and the erasure job on day 30 cannot
   * interleave, and whichever commits first is what happened.
   */
  async restore(userId: string): Promise<RestoreResult> {
    return this.db.withTransaction(async (client) => {
      const request = await this.repo.lockOpenRequest(userId, client);
      if (request === null) return { status: 'NOT_PENDING' } as const;

      if (
        !canRestore({
          scheduledErasureAt: request.scheduledErasureAt,
          restoredAt: request.restoredAt,
          completedAt: request.completedAt,
          now: this.clock.now(),
        })
      ) {
        // Past the grace, or already erased. SET-FR-005's error case: "the
        // account genuinely no longer exists and a neutral not-found response
        // is returned" - the caller turns this into that.
        return { status: 'GRACE_EXPIRED' } as const;
      }

      await this.repo.markRestored(request.id, this.clock.now(), client);
      await this.repo.setState(userId, 'ACTIVE', client);

      // EDGE-030 reversed. Phase one changed only STATE, and this is the one
      // piece of it that is not the user's own row - so putting it back is
      // what keeps "everything is recoverable by logging in" literally true.
      await this.repo.reinstateMessageRequests(userId, client);

      // Nothing to rebuild: profile, followers, following and post attribution
      // were never touched, because phase one changes only the STATE. That is
      // what makes SET-FR-005's criterion - "follower relationships that
      // existed before deletion are present" - true by construction rather
      // than by a restore routine that has to remember everything.
      await this.audit.append(
        {
          actorType: 'USER',
          actorId: userId,
          action: 'ACCOUNT_RESTORED',
          entityType: 'USER',
          entityId: userId,
        },
        client,
      );

      this.log('account_restored', {});
      return { status: 'RESTORED' } as const;
    });
  }

  /** EDGE-003 / EDGE-029 — is this account merely pending, and restorable? */
  async pendingRequestFor(userId: string): Promise<DeletionRequestRecord | null> {
    return this.repo.findOpenRequest(userId);
  }

  /**
   * The day-30 sweep (PRIV-007).
   *
   * `dryRun` is not a debugging aid. ADR-019: erasure "is irreversible, so the
   * job is heavily tested and RUNS DRY-RUN IN STAGING FIRST", and the dry run
   * takes the same lock, reads the same rows and calls the same contributors —
   * only `anonymise` is swapped for `countFor`. A dry run through a different
   * path would be a rehearsal of a different play.
   *
   * EACH ACCOUNT IS ONE TRANSACTION, and every contributor runs inside it. A
   * partial erasure is the worst possible outcome: the account is unusable AND
   * the data is still there, with nothing recording which half succeeded.
   */
  async runErasure(options: { dryRun: boolean; limit?: number }): Promise<ErasureReport[]> {
    const now = this.clock.now();
    const due = await this.repo.findDue(now, options.limit ?? 50);
    const reports: ErasureReport[] = [];

    for (const request of due) {
      const report = await this.db.withTransaction(async (client) => {
        // RE-READ UNDER LOCK. The row was selected outside this transaction,
        // and a restore may have committed in between - ADR-019's concurrency
        // rule is that "the second observes the new state and aborts".
        const locked = await this.repo.lockOpenRequest(request.userId, client);
        if (locked === null || locked.restoredAt !== null || locked.completedAt !== null) {
          this.log('erasure_skipped_restored', {});
          return null;
        }

        const outcomes: AnonymisationOutcome[] = [];
        for (const contributor of this.anonymisers) {
          outcomes.push(
            options.dryRun
              ? await contributor.countFor(request.userId, client)
              : await contributor.anonymise(request.userId, client),
          );
        }

        if (!options.dryRun) {
          await this.repo.markCompleted(locked.id, this.clock.now(), client);

          // The audit row survives the person (ADR-018, OD-019 pseudonymous
          // retention) and is the only remaining evidence the erasure happened.
          // It carries counts, never content.
          await this.audit.append(
            {
              actorType: 'SYSTEM',
              action: 'ACCOUNT_ERASED',
              entityType: 'USER',
              entityId: request.userId,
              metadata: {
                modules: outcomes.map((o) => ({
                  module: o.module,
                  anonymised: o.rowsAnonymised,
                  deleted: o.rowsDeleted,
                })),
              },
            },
            client,
          );
        }

        return { userId: request.userId, dryRun: options.dryRun, outcomes };
      });

      if (report !== null) reports.push(report);
    }

    this.log(options.dryRun ? 'erasure_dry_run' : 'erasure_completed', {
      accounts: reports.length,
      due: due.length,
    });
    return reports;
  }

  private log(event: string, extra: Record<string, unknown>): void {
    // No user id. An application log naming who deleted their account would
    // outlive the erasure it describes - which is precisely what PRIV-007
    // forbids, and log files are not covered by OD-019's pseudonymous
    // retention. The audit log holds the id, under access control.
    this.logger.log(JSON.stringify({ event, ...extra }), 'settings');
  }
}

/** Re-exported so the erasure job and its tests share one definition. */
export type { PoolClient };
