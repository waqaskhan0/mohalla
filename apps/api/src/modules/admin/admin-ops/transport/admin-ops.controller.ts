import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { FoundationErrorCode, IdentityErrorCode } from '@mohalla/contracts';
import { ZodValidationPipe } from '../../../../common/validation/zod-validation.pipe.js';
import { Admin, RequiresAdmin } from '../../../platform/identity/transport/admin-session.guard.js';
import type { AdminPrincipal } from '../../../platform/identity/application/admin-auth.service.js';
import { AdminOpsService } from '../application/admin-ops.service.js';
import { BROADCASTS_PER_WEEK } from '../../moderation/domain/enforcement-policy.js';

const announcementBody = z
  .object({
    /**
     * BOTH languages, required by the schema shape rather than by a check.
     *
     * ADMIN-FR-009: "both language versions are required, because a
     * single-language announcement fails half the audience." Making them two
     * required fields means the refusal happens before any handler runs, and
     * the client is told which one is missing.
     */
    titleEn: z.string().min(1).max(200),
    titleUr: z.string().min(1).max(200),
    bodyEn: z.string().min(1).max(2000),
    bodyUr: z.string().min(1).max(2000),
    expiresAt: z.string().datetime(),
    broadcast: z.boolean().optional(),
  })
  .strict();
type AnnouncementBody = z.infer<typeof announcementBody>;

const auditQuery = z
  .object({
    adminId: z.string().uuid().optional(),
    action: z.string().min(1).max(80).optional(),
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
    limit: z.coerce.number().int().min(1).max(200).optional(),
    offset: z.coerce.number().int().min(0).max(10000).optional(),
  })
  .strict();
type AuditQuery = z.infer<typeof auditQuery>;

/**
 * Dashboard, announcements and the audit log (ADMIN-API-009…012).
 *
 * THERE IS NO ROUTE HERE THAT WRITES TO THE AUDIT LOG, and none that edits or
 * deletes one. BR-039: "the log is append-only and NO INTERFACE, PERMISSION OR
 * ADMINISTRATOR can edit or delete an entry", and ADMIN-FR-012's acceptance
 * criterion is a negative — "GIVEN an attempt to delete a log entry through any
 * route, THEN it fails". The way to satisfy that is for no such route to exist
 * at any layer, which is why this controller has one audit method and it is a
 * `@Get`.
 *
 * THE DASHBOARD RETURNS AGGREGATES AND NOTHING ELSE. ADMIN-FR-011: "aggregate
 * figures only; no per-user analytics and no data export in V1", and its
 * criterion is that "no individual user's activity is profiled". No id appears
 * in the response, so that is a property of the shape rather than a promise
 * about what the portal renders.
 */
@ApiTags('admin')
@RequiresAdmin()
@Controller('admin')
export class AdminOpsController {
  constructor(private readonly ops: AdminOpsService) {}

  @Get('dashboard')
  @ApiOperation({
    summary: 'Dashboard counts (ADMIN-API-009, ADMIN-FR-001/011).',
    description:
      'Open reports, new users today and this week, posts today, upcoming events and actions ' +
      'this week. THE OPEN-REPORT COUNT is the primary operational signal - it is the number ' +
      'that tells one moderator whether today is an ordinary day. Aggregates only: no id ' +
      'appears in this response, and there is no export.',
  })
  async dashboard() {
    return this.ops.dashboard();
  }

  @Get('announcements/allowance')
  @ApiOperation({
    summary: 'How many broadcasts remain this week (NOTIF-FR-005).',
    description:
      'So the portal can say so before an administrator writes one, rather than refusing after ' +
      'they have. Two per rolling seven days.',
  })
  async allowance() {
    return this.ops.broadcastAllowance();
  }

  @Post('announcements')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Publish an announcement (ADMIN-API-010, ADMIN-FR-009).',
    description:
      'BOTH LANGUAGES ARE REQUIRED - "a single-language announcement fails half the audience". ' +
      'Optionally broadcast as a push, capped at two per rolling week (NOTIF-FR-005) "because ' +
      'over-use is a direct cause of uninstalls"; the refusal states the limit. Every ' +
      'publication is audit-logged with the publishing administrator.',
  })
  async publish(
    @Admin() admin: AdminPrincipal,
    @Body(new ZodValidationPipe(announcementBody)) body: AnnouncementBody,
  ) {
    const result = await this.ops.publishAnnouncement({
      adminId: admin.adminId,
      titleEn: body.titleEn,
      titleUr: body.titleUr,
      bodyEn: body.bodyEn,
      bodyUr: body.bodyUr,
      expiresAt: new Date(body.expiresAt),
      broadcast: body.broadcast ?? false,
    });

    if (result.status === 'PUBLISHED') {
      return { id: result.id, broadcast: result.broadcast };
    }

    if (result.reason === 'BROADCAST_LIMIT') {
      throw new HttpException(
        {
          code: IdentityErrorCode.RATE_LIMITED,
          message: `Only ${BROADCASTS_PER_WEEK} broadcasts can be sent in a week.`,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    throw new BadRequestException({
      code: FoundationErrorCode.VALIDATION_FAILED,
      message:
        result.reason === 'MISSING_TRANSLATION'
          ? 'An announcement needs both the English and the Urdu version.'
          : 'The expiry date must be in the future.',
      details: [
        {
          path: result.reason === 'MISSING_TRANSLATION' ? 'titleUr' : 'expiresAt',
          message: result.reason,
        },
      ],
    });
  }

  @Get('audit-log')
  @ApiOperation({
    summary: 'Search the audit log (ADMIN-API-012, ADMIN-FR-012).',
    description:
      'By administrator, action and date range. READ ONLY, AND THERE IS NO OTHER ROUTE - no ' +
      'method on this controller or anywhere else writes, edits or deletes an entry (BR-039). ' +
      'The log records enforcement, verification, publication, SENSITIVE-DATA VIEWS and ' +
      'REPORTED-CONVERSATION ACCESS, because "viewing is auditable, not only acting" is what ' +
      'makes PRIV-008 and PRIV-009 verifiable rather than aspirational.',
  })
  async auditLog(@Query(new ZodValidationPipe(auditQuery)) query: AuditQuery) {
    const page = await this.ops.searchAuditLog(
      {
        adminId: query.adminId,
        action: query.action,
        from: query.from === undefined ? undefined : new Date(query.from),
        to: query.to === undefined ? undefined : new Date(query.to),
      },
      query.limit ?? 50,
      query.offset ?? 0,
    );

    return {
      entries: page.entries.map((e) => ({
        id: e.id,
        occurredAt: e.occurredAt.toISOString(),
        actorType: e.actorType,
        actorId: e.actorId,
        action: e.action,
        entityType: e.entityType,
        entityId: e.entityId,
        metadata: e.metadata,
      })),
      total: page.total,
    };
  }
}
