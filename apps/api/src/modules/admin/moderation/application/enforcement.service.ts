import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DatabaseService } from '../../../../database/database.service.js';
import { StructuredLogger } from '../../../../common/logging/structured.logger.js';
import { AuditService } from '../../../platform/audit/audit.service.js';
import { CLOCK, type Clock } from '../../../platform/identity/ports/clock.port.js';
import { SessionService } from '../../../platform/identity/application/session.service.js';
import {
  canHoldVerifiedBadge,
  checkEnforceable,
  checkReason,
  suspensionExpiry,
  type EnforcementRejection,
  type SuspensionDuration,
} from '../domain/enforcement-policy.js';
import {
  ENFORCEMENT_REPOSITORY,
  type AdminUserView,
  type EnforcementRecord,
  type EnforcementRepository,
  type SensitiveUserView,
} from '../repositories/enforcement.repository.port.js';

export type EnforcementResult =
  | { status: 'APPLIED'; action: EnforcementRecord; sessionsRevoked: number }
  | { status: 'REFUSED'; reason: EnforcementRejection };

export type VerificationResult =
  | { status: 'APPLIED' }
  | { status: 'REFUSED'; reason: 'NOT_AN_ORGANIZATION' | 'TARGET_NOT_FOUND' | 'REASON_TOO_SHORT' };

/**
 * Enforcement (ADMIN-FR-005…008/010 · BR-034/035/036 · BR-ADM-001 · SEC-021/022).
 *
 * THE FIRST QUESTION EVERY PATH ASKS IS WHETHER THE TARGET IS AN ADMINISTRATOR,
 * and it is asked before the target is even required to exist.
 *
 * BR-ADM-001 forbids one administrator acting on another; SEC-021 says the
 * prohibition "cannot be reached by any request, REGARDLESS OF INTERFACE
 * STATE". The reason is the lockout risk the SRS names under the admin model:
 * all administrators are equal and there is no hierarchy, so one compromised
 * account could suspend every other one and there would be nobody above them to
 * undo it. That is why the check is first, why the schema has no foreign key
 * that could express it, and why `EnforcementTarget` cannot describe an admin.
 *
 * EVERY ACTION IS AUDITED IN THE SAME TRANSACTION AS THE ACTION. An enforcement
 * that commits without its audit row is an invisible act of power; an audit row
 * for an action that rolled back is a false accusation. `13` §6 requires the
 * log to record enforcement, verification, publication, sensitive-data views
 * and every admin login — and "viewing is auditable, not only acting" is what
 * makes PRIV-008 and PRIV-009 verifiable rather than aspirational.
 *
 * SESSIONS ARE REVOKED BEFORE THE STATE IS TRUSTED TO DO IT. BR-035: a
 * suspension, ban or deletion "invalidates every session for that account
 * immediately". The session design would catch it anyway on the next request —
 * authority is re-read from the row every time (ADR-008) — but revoking is what
 * makes AUTH-FR-010's "rejected within one request cycle" true rather than
 * merely likely, and it is what ejects an open socket.
 */
@Injectable()
export class EnforcementService {
  constructor(
    private readonly db: DatabaseService,
    @Inject(ENFORCEMENT_REPOSITORY) private readonly repo: EnforcementRepository,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly logger: StructuredLogger,
  ) {}

  // ------------------------------------------------------------ ADMIN-FR-006
  /**
   * Suspend for 24 hours, 7 days or 30 days.
   *
   * EDGE-027: re-suspending REPLACES the duration rather than accumulating.
   * Two administrators independently applying 30 days would otherwise produce
   * 60, which neither of them decided.
   *
   * EDGE-028 needs no code: the suspension lifts because `suspended_until`
   * passes, and the session guard re-reads it on every request. ADMIN-FR-006's
   * criterion — "full capability returns WITHOUT ANY ADMINISTRATOR
   * INVOLVEMENT" — is satisfied by there being nothing to run.
   */
  async suspend(input: {
    adminId: string;
    targetUserId: string;
    duration: SuspensionDuration;
    reason: string;
    caseId?: string | null;
  }): Promise<EnforcementResult> {
    return this.act({
      ...input,
      kind: 'SUSPEND',
      apply: async (client) => {
        const until = suspensionExpiry(input.duration, this.clock.now());
        await this.repo.suspend(input.targetUserId, until, client);
        return until;
      },
      revokeReason: 'SUSPENDED',
    });
  }

  // ------------------------------------------------------------ ADMIN-FR-007
  /**
   * Ban permanently.
   *
   * The content is HIDDEN rather than deleted, "so that it remains available to
   * the audit trail if the ban is later disputed" — which is the same instinct
   * as BR-032 applied to a person rather than a post. Nothing here deletes
   * anything.
   *
   * BR-036 adds the account's identifier hash to the ban list, so the number
   * cannot register again. The refusal a returning user meets is neutral: the
   * acceptance criterion says registration is "refused with a neutral message
   * that does not disclose the ban", and the registration path already gives
   * every failure the same answer (SEC-006).
   */
  async ban(input: {
    adminId: string;
    targetUserId: string;
    reason: string;
    caseId?: string | null;
  }): Promise<EnforcementResult> {
    return this.act({
      ...input,
      kind: 'BAN',
      apply: async (client) => {
        await this.repo.ban(input.targetUserId, client);
        await this.repo.banIdentifiersOf(input.targetUserId, input.reason, client);
        return null;
      },
      revokeReason: 'BANNED',
    });
  }

  // ------------------------------------------------------------ ADMIN-FR-008
  /**
   * Reinstate — and the requirement says why this exists in so many words:
   * "administrators make mistakes and THE PRODUCT MUST LET THEM BE CORRECTED."
   *
   * So it takes the identifier off the ban list too. A reinstatement that left
   * the person unable to register would not be a correction; it would be a ban
   * with better paperwork.
   */
  async reinstate(input: {
    adminId: string;
    targetUserId: string;
    reason: string;
  }): Promise<EnforcementResult> {
    return this.act({
      ...input,
      kind: 'REINSTATE',
      apply: async (client) => {
        await this.repo.reinstate(input.targetUserId, client);
        await this.repo.unbanIdentifiersOf(input.targetUserId, client);
        return null;
      },
      // No revocation: reinstating gives capability back, and there is no
      // session to eject. Any sessions the account had were revoked when it was
      // suspended or banned, and it will simply log in again.
      revokeReason: null,
    });
  }

  // ------------------------------------------------------------ ADMIN-FR-005
  /** The account view. Carries no phone, no email and no date of birth. */
  async userView(userId: string): Promise<AdminUserView | null> {
    return this.repo.findUserView(userId);
  }

  async searchUsers(query: string, limit = 20): Promise<AdminUserView[]> {
    return this.repo.searchUsers(query, clampLimit(limit));
  }

  async history(userId: string, limit = 20): Promise<EnforcementRecord[]> {
    return this.repo.historyFor(userId, clampLimit(limit));
  }

  /**
   * PRIV-008 / SEC-022 — the identifiers, and THE VIEWING IS THE AUDITABLE
   * EVENT.
   *
   * "Viewing a user's phone number, email or date of birth is ITSELF an
   * auditable action." The audit row is written BEFORE the read and in the same
   * transaction, so a read that happened cannot lack a record — the ordering
   * matters, because writing afterwards would let a crash produce an
   * unrecorded look at somebody's phone number.
   *
   * ADMIN-FR-005's criterion is exactly this: "GIVEN an administrator views a
   * user's phone number, WHEN the audit log is inspected, THEN an entry records
   * that access."
   */
  async sensitiveView(input: {
    adminId: string;
    targetUserId: string;
  }): Promise<SensitiveUserView | null> {
    return this.db.withTransaction(async (client) => {
      await this.audit.append(
        {
          actorType: 'ADMIN',
          actorId: input.adminId,
          action: 'ADMIN_VIEWED_SENSITIVE_DATA',
          entityType: 'USER',
          entityId: input.targetUserId,
          // The metadata says WHICH FIELDS, never their values. An audit log
          // that recorded the phone number to prove somebody looked at the
          // phone number would be a second, worse copy of it - and the log is
          // retained pseudonymously after erasure (OD-019), so it would outlive
          // the deletion that was meant to remove it.
          metadata: { fields: ['phone', 'dateOfBirth'] },
        },
        client,
      );

      return this.repo.findSensitive(input.targetUserId, client);
    });
  }

  // ------------------------------------------------------------ ADMIN-FR-010
  /**
   * Grant or revoke the verified badge.
   *
   * "Only Organization-type accounts are eligible", and the acceptance
   * criterion asks for the eligibility rule to be STATED rather than a neutral
   * refusal — an administrator verifying an individual has made a category
   * error, not a security probe, and telling them why saves a support ticket.
   *
   * S2-CR-006 makes verification invitation-only in V1, so there is no request
   * queue and this is the only path. Revocation "removes it everywhere
   * immediately" because every surface reads the badge from one column.
   */
  async setVerification(input: {
    adminId: string;
    targetUserId: string;
    granted: boolean;
    reason: string;
  }): Promise<VerificationResult> {
    const reasonProblem = checkReason(input.reason);
    if (reasonProblem !== null) return { status: 'REFUSED', reason: 'REASON_TOO_SHORT' };

    const view = await this.repo.findUserView(input.targetUserId);
    if (view === null) return { status: 'REFUSED', reason: 'TARGET_NOT_FOUND' };

    if (input.granted && !canHoldVerifiedBadge(view.accountType)) {
      return { status: 'REFUSED', reason: 'NOT_AN_ORGANIZATION' };
    }

    await this.db.withTransaction(async (client) => {
      await this.repo.setVerifiedBadge(input.targetUserId, input.granted, input.adminId, client);
      await this.audit.append(
        {
          actorType: 'ADMIN',
          actorId: input.adminId,
          action: input.granted ? 'ADMIN_GRANTED_VERIFICATION' : 'ADMIN_REVOKED_VERIFICATION',
          entityType: 'USER',
          entityId: input.targetUserId,
          metadata: { reason: input.reason },
        },
        client,
      );
    });

    this.log('verification_changed', { granted: input.granted });
    return { status: 'APPLIED' };
  }

  // ------------------------------------------------------------- internals
  /**
   * The shape every enforcement action shares.
   *
   * Written once because the order of the steps is the part that matters, and
   * three copies of it would be three chances to put the admin check second:
   *
   *   1. Is the target an administrator?     BR-ADM-001, SEC-021
   *   2. Does it exist, and is the reason valid?
   *   3. Apply the state change
   *   4. Revoke every session                BR-035
   *   5. Record the action
   *   6. Write the audit row                 SEC-022
   *
   * Steps 3 to 6 are ONE transaction. An enforcement that commits without its
   * audit row is an invisible act of power.
   */
  private async act(input: {
    adminId: string;
    targetUserId: string;
    kind: 'SUSPEND' | 'BAN' | 'REINSTATE';
    reason: string;
    caseId?: string | null;
    apply: (client: import('pg').PoolClient) => Promise<Date | null>;
    revokeReason: 'SUSPENDED' | 'BANNED' | null;
  }): Promise<EnforcementResult> {
    // FIRST. Before the target is looked up, before the reason is checked.
    // SEC-021 says the prohibition holds regardless of interface state, so it
    // must not be reachable past a different failure.
    const targetIsAdministrator = await this.repo.isAdministrator(input.targetUserId);

    const target = targetIsAdministrator ? null : await this.repo.findTarget(input.targetUserId);

    const problem = checkEnforceable({
      target,
      targetIsAdministrator,
      reason: input.reason,
    });

    if (problem !== null) {
      if (problem === 'TARGET_IS_ADMINISTRATOR') {
        // Audited even though it was refused. An attempt by one administrator
        // to act on another is exactly the event BR-ADM-001 exists to prevent,
        // and a refusal nobody can see is a refusal nobody can investigate.
        await this.audit.append({
          actorType: 'ADMIN',
          actorId: input.adminId,
          action: 'ADMIN_ON_ADMIN_ACTION_REFUSED',
          entityType: 'ADMIN',
          entityId: input.targetUserId,
          metadata: { attempted: input.kind },
        });
        this.logger.warn(
          JSON.stringify({ event: 'admin_on_admin_refused', attempted: input.kind }),
          'admin',
        );
      }
      return { status: 'REFUSED', reason: problem };
    }

    // BR-035, before the transaction: the revocation is its own transaction and
    // must not be rolled back by a later failure. A session that survives a ban
    // is worse than an enforcement action recorded twice.
    const sessionsRevoked =
      input.revokeReason === null
        ? 0
        : await this.sessions.revokeAllForUser(input.targetUserId, input.revokeReason);

    const action = await this.db.withTransaction(async (client) => {
      const expiresAt = await input.apply(client);

      const recorded = await this.repo.recordAction(
        {
          id: randomUUID(),
          targetUserId: input.targetUserId,
          adminId: input.adminId,
          kind: input.kind,
          reason: input.reason,
          expiresAt,
          caseId: input.caseId ?? null,
        },
        client,
      );

      await this.audit.append(
        {
          actorType: 'ADMIN',
          actorId: input.adminId,
          action: `ADMIN_${input.kind}`,
          entityType: 'USER',
          entityId: input.targetUserId,
          metadata: {
            reason: input.reason,
            ...(expiresAt === null ? {} : { expiresAt: expiresAt.toISOString() }),
            // `caseId` is optional AND nullable, so both absences are
            // checked - an audit row carrying `"caseId": null` says something
            // different from one that omits it.
            ...(input.caseId === null || input.caseId === undefined
              ? {}
              : { caseId: input.caseId }),
          },
        },
        client,
      );

      return recorded;
    });

    // TODO(EPIC-14): notify the target with the reason (ADMIN-FR-004/006's
    // "the author is notified of the removal and the reason", and the
    // suspension banner). The pipeline exists; the enforcement templates and
    // the SAFETY-FR-008 guideline citation wait on OD-015's content.
    this.log('enforcement_applied', { kind: input.kind, sessionsRevoked });
    return { status: 'APPLIED', action, sessionsRevoked };
  }

  private log(event: string, extra: Record<string, unknown>): void {
    // No target id, no admin id, no reason text. The audit log holds all three
    // under access control; an application log line carrying them would be a
    // second copy of the enforcement record in a file with weaker controls, and
    // the reason text can name a person.
    this.logger.log(JSON.stringify({ event, ...extra }), 'admin');
  }
}

function clampLimit(limit: number, max = 50): number {
  if (!Number.isFinite(limit) || limit < 1) return 20;
  return Math.min(Math.floor(limit), max);
}
