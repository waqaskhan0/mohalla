import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DatabaseService } from '../../../../database/database.service.js';
import { StructuredLogger } from '../../../../common/logging/structured.logger.js';
import { AuditService } from '../../../platform/audit/audit.service.js';
import { CLOCK, type Clock } from '../../../platform/identity/ports/clock.port.js';
import { OutboxService } from '../../../platform/notifications/application/outbox.service.js';
import {
  BROADCAST_WINDOW_DAYS,
  BROADCASTS_PER_WEEK,
  canBroadcast,
} from '../../moderation/domain/enforcement-policy.js';
import {
  ENFORCEMENT_REPOSITORY,
  type DashboardCounts,
  type EnforcementRepository,
} from '../../moderation/repositories/enforcement.repository.port.js';

export type PublishResult =
  | { status: 'PUBLISHED'; id: string; broadcast: boolean }
  | { status: 'REFUSED'; reason: 'MISSING_TRANSLATION' | 'INVALID_EXPIRY' | 'BROADCAST_LIMIT' };

/**
 * Dashboard, announcements and the audit log (ADMIN-FR-001/009/011/012).
 *
 * THREE RULES WORTH STATING BEFORE THE CODE.
 *
 * 1. THE DASHBOARD IS AGGREGATES ONLY. ADMIN-FR-011's acceptance criterion is
 *    that "every figure shown is an aggregate and NO INDIVIDUAL USER'S ACTIVITY
 *    IS PROFILED", and there is deliberately no data export in V1. So this
 *    service returns counts and has no method that returns a list of people who
 *    did something — the criterion is structural rather than a promise about
 *    what the UI happens to render.
 *
 * 2. AN ANNOUNCEMENT IS BILINGUAL OR IT IS NOTHING. ADMIN-FR-009: "both
 *    language versions are required, BECAUSE A SINGLE-LANGUAGE ANNOUNCEMENT
 *    FAILS HALF THE AUDIENCE." Refused here with the missing language named,
 *    and refused again by NOT NULL columns if this check were ever skipped.
 *
 * 3. THE AUDIT LOG IS READ-ONLY THROUGH THIS SERVICE, and there is no other
 *    admin-facing path to it. BR-039: "no interface, permission or
 *    administrator can edit or delete an entry." The runtime role holds SELECT
 *    and INSERT; the INSERT belongs to `AuditService`; this exposes searching
 *    and nothing else.
 */
@Injectable()
export class AdminOpsService {
  constructor(
    private readonly db: DatabaseService,
    @Inject(ENFORCEMENT_REPOSITORY) private readonly repo: EnforcementRepository,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly logger: StructuredLogger,
  ) {}

  /**
   * ADMIN-FR-001/011 — the dashboard.
   *
   * "The open-report count is the primary operational signal and is always
   * visible" — it is the number that tells one moderator whether today is an
   * ordinary day.
   */
  async dashboard(): Promise<DashboardCounts> {
    return this.repo.dashboardCounts(this.clock.now());
  }

  /**
   * ADMIN-FR-009 — publish an announcement, optionally as a broadcast.
   *
   * NOTIF-FR-005 caps broadcasts at two per rolling week "because over-use is a
   * direct cause of uninstalls", and its criterion asks for the limit to be
   * STATED on refusal. A rolling seven days rather than a calendar week: a
   * calendar boundary lets four land within a few hours of each other on Sunday
   * night and Monday morning, which is the pattern the cap exists to prevent.
   */
  async publishAnnouncement(input: {
    adminId: string;
    titleEn: string;
    titleUr: string;
    bodyEn: string;
    bodyUr: string;
    expiresAt: Date;
    broadcast: boolean;
  }): Promise<PublishResult> {
    const missing =
      input.titleEn.trim() === '' ||
      input.titleUr.trim() === '' ||
      input.bodyEn.trim() === '' ||
      input.bodyUr.trim() === '';
    if (missing) return { status: 'REFUSED', reason: 'MISSING_TRANSLATION' };

    const now = this.clock.now();
    if (input.expiresAt.getTime() <= now.getTime()) {
      return { status: 'REFUSED', reason: 'INVALID_EXPIRY' };
    }

    if (input.broadcast) {
      const since = new Date(now.getTime() - BROADCAST_WINDOW_DAYS * 24 * 60 * 60 * 1000);
      const sent = await this.repo.countBroadcastsSince(since);
      if (!canBroadcast(sent)) return { status: 'REFUSED', reason: 'BROADCAST_LIMIT' };
    }

    const id = await this.db.withTransaction(async (client) => {
      const created = await this.repo.publishAnnouncement(
        {
          id: randomUUID(),
          adminId: input.adminId,
          titleEn: input.titleEn.trim(),
          titleUr: input.titleUr.trim(),
          bodyEn: input.bodyEn.trim(),
          bodyUr: input.bodyUr.trim(),
          expiresAt: input.expiresAt,
          broadcast: input.broadcast,
        },
        client,
      );

      if (input.broadcast) {
        // The outbox, in the same transaction as the announcement (ADR-014).
        // A broadcast that commits without its row is an announcement nobody
        // hears about; a row without the announcement is a push pointing at
        // nothing. Both titles travel, because the pipeline renders in each
        // RECIPIENT's language and the server cannot know that per device here.
        await this.outbox.emit(
          {
            topic: 'announcement.broadcast',
            announcementId: created.id,
            titleEn: input.titleEn.trim(),
            titleUr: input.titleUr.trim(),
          },
          client,
        );
      }

      // NOTIF-FR-005: "every broadcast is audit-logged with the publishing
      // administrator". Publication is audited whether or not it was broadcast,
      // because `13` §6 lists publication alongside enforcement.
      await this.audit.append(
        {
          actorType: 'ADMIN',
          actorId: input.adminId,
          action: input.broadcast ? 'ADMIN_BROADCAST_ANNOUNCEMENT' : 'ADMIN_PUBLISHED_ANNOUNCEMENT',
          entityType: 'ANNOUNCEMENT',
          entityId: created.id,
          metadata: { expiresAt: input.expiresAt.toISOString() },
        },
        client,
      );

      return created.id;
    });

    this.log('announcement_published', { broadcast: input.broadcast });
    return { status: 'PUBLISHED', id, broadcast: input.broadcast };
  }

  /** How many broadcasts remain this week — so the UI can say so before trying. */
  async broadcastAllowance(): Promise<{ used: number; limit: number }> {
    const since = new Date(
      this.clock.now().getTime() - BROADCAST_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    );
    return { used: await this.repo.countBroadcastsSince(since), limit: BROADCASTS_PER_WEEK };
  }

  /**
   * ADMIN-FR-012 — search the audit log.
   *
   * READ ONLY. There is no companion method that writes, edits or deletes, and
   * no route reaches one. BR-039's acceptance criterion is a negative — "GIVEN
   * an attempt to delete a log entry through any route, THEN it fails" — and
   * the way to satisfy that is for no such route to exist at any layer.
   *
   * Searching the log is not itself audited, and that is deliberate rather than
   * an omission: `13` §6 lists what is recorded, and an audit of audit reads
   * would grow without bound while telling an investigator nothing they could
   * not get from the access logs.
   */
  async searchAuditLog(
    filter: {
      adminId?: string | undefined;
      action?: string | undefined;
      from?: Date | undefined;
      to?: Date | undefined;
    },
    limit = 50,
    offset = 0,
  ) {
    return this.repo.searchAuditLog(filter, clampLimit(limit, 200), Math.max(0, offset));
  }

  private log(event: string, extra: Record<string, unknown>): void {
    this.logger.log(JSON.stringify({ event, ...extra }), 'admin');
  }
}

function clampLimit(limit: number, max = 50): number {
  if (!Number.isFinite(limit) || limit < 1) return 20;
  return Math.min(Math.floor(limit), max);
}
