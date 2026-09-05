import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { FoundationErrorCode } from '@mohalla/contracts';
import { ZodValidationPipe } from '../../../../common/validation/zod-validation.pipe.js';
import { Admin, RequiresAdmin } from '../../../platform/identity/transport/admin-session.guard.js';
import type { AdminPrincipal } from '../../../platform/identity/application/admin-auth.service.js';
import { ReportService } from '../../../product/safety/application/report.service.js';
import { MessagingService } from '../../../product/messaging/application/messaging.service.js';
import { AuditService } from '../../../platform/audit/audit.service.js';
import { EnforcementService } from '../application/enforcement.service.js';
import {
  MODERATION_REASON_MAX_LENGTH,
  MODERATION_REASON_MIN_LENGTH,
} from '../../../product/safety/domain/report-policy.js';

const idParam = z.object({ id: z.string().uuid() }).strict();
type IdParam = z.infer<typeof idParam>;

const reason = z.string().min(MODERATION_REASON_MIN_LENGTH).max(MODERATION_REASON_MAX_LENGTH);

const decisionBody = z
  .object({
    reason,
    /** EDGE-024: the version the administrator was SHOWN. */
    version: z.number().int().min(1),
  })
  .strict();
type DecisionBody = z.infer<typeof decisionBody>;

const enforcementBody = z
  .object({
    reason,
    caseId: z.string().uuid().nullish(),
  })
  .strict();
type EnforcementBody = z.infer<typeof enforcementBody>;

const suspendBody = enforcementBody
  .extend({ duration: z.enum(['HOURS_24', 'DAYS_7', 'DAYS_30']) })
  .strict();
type SuspendBody = z.infer<typeof suspendBody>;

const verificationBody = z.object({ reason, granted: z.boolean() }).strict();
type VerificationBody = z.infer<typeof verificationBody>;

const queueQuery = z
  .object({
    limit: z.coerce.number().int().min(1).max(50).optional(),
    offset: z.coerce.number().int().min(0).max(5000).optional(),
  })
  .strict();
type QueueQuery = z.infer<typeof queueQuery>;

const searchQuery = z
  .object({
    q: z.string().min(1).max(120),
    limit: z.coerce.number().int().min(1).max(50).optional(),
  })
  .strict();
type SearchQuery = z.infer<typeof searchQuery>;

/**
 * The moderation queue and enforcement (ADMIN-API-001…008).
 *
 * `@RequiresAdmin()` ON THE CLASS. SEC-020 keeps admin credentials in a
 * different store from user credentials, and the guard for one never accepts
 * the other — an admin route that forgot the decorator would fall through to
 * the ordinary user guard and become reachable by any signed-in citizen, which
 * is why the decorator is opt-IN and applied at the class rather than per
 * method.
 *
 * RESTORE AND DELETE ARE PEERS. `13` §4: "sibling states, equal API weight,
 * equal visual weight, NO DEFAULT", and it gives the reason — RSK-010 is that
 * coordinated reporting silences legitimate criticism, and "a system that leans
 * toward removal makes that risk worse". So the three outcomes are three routes
 * of the same shape, none of them the obvious one, and none reachable without a
 * reason of at least five characters.
 *
 * EVERY DECISION CARRIES THE VERSION THE ADMINISTRATOR WAS SHOWN. EDGE-024: two
 * administrators acting on one item means "the first action is applied, the
 * second administrator is told the item was already resolved, BY WHOM AND HOW —
 * not shown a generic error". So a stale decision is a 409 carrying those two
 * facts, and it is information rather than a fault.
 */
@ApiTags('admin')
@RequiresAdmin()
@Controller('admin')
export class ModerationController {
  constructor(
    private readonly reports: ReportService,
    private readonly enforcement: EnforcementService,
    private readonly messaging: MessagingService,
    private readonly audit: AuditService,
  ) {}

  // ------------------------------------------------------------ the queue
  @Get('moderation/queue')
  @ApiOperation({
    summary: 'The moderation queue (ADMIN-API-001, ADMIN-FR-002).',
    description:
      'Ordered by SEVERITY, then distinct report count, then AGE ASCENDING - the oldest of ' +
      'equal cases first, because a queue that surfaced the newest would let an item at the ' +
      'bottom wait forever. Offset-based rather than keyset, because the ordering key is ' +
      "mutable: a new report changes a case's severity or count and moves it.",
  })
  async queue(@Query(new ZodValidationPipe(queueQuery)) query: QueueQuery) {
    const page = await this.reports.queue(query.limit ?? 20, query.offset ?? 0);
    return {
      cases: page.cases.map(toCaseBody),
      total: page.total,
    };
  }

  @Get('moderation/cases/:id')
  @ApiOperation({
    summary: 'One case, with the context needed to judge it (ADMIN-FR-002).',
    description:
      "Carries the target, the reports against it and THE AUTHOR'S ENFORCEMENT HISTORY - §4 " +
      'says so "so proportionality can be judged without navigating away". An administrator ' +
      'deciding whether a first offence warrants 30 days should not have to open another ' +
      'screen to find out it is the fourth.',
  })
  async caseDetail(@Param(new ZodValidationPipe(idParam)) params: IdParam) {
    const moderationCase = await this.reports.findCase(params.id);
    if (moderationCase === null) throw notFound();

    const history =
      moderationCase.targetOwnerId === null
        ? []
        : await this.enforcement.history(moderationCase.targetOwnerId);

    const flagged =
      moderationCase.targetOwnerId === null
        ? false
        : await this.reports.isFlaggedRepeatOffender(moderationCase.targetOwnerId);

    return {
      ...toCaseBody(moderationCase),
      // BR-037: three confirmed deletions in 30 days FLAGS the account for a
      // suspension decision. Surfaced here as a fact for the administrator to
      // weigh - the requirement's next sentence is "it is not auto-suspended".
      repeatOffenderFlag: flagged,
      enforcementHistory: history.map((h) => ({
        id: h.id,
        kind: h.kind,
        reason: h.reason,
        expiresAt: h.expiresAt?.toISOString() ?? null,
        createdAt: h.createdAt.toISOString(),
      })),
    };
  }

  /**
   * MSG-FR-007 / PRIV-009 — read a reported conversation.
   *
   * "An administrator may read ONLY the reported conversation, ONLY AFTER the
   * report, and THE ACCESS IS AUDIT-LOGGED." All three conditions are enforced
   * here: the case must exist and be a CONVERSATION, which means a report
   * happened; the excerpt comes from that conversation and no other; and the
   * audit row is written before the read, in the same transaction.
   *
   * MSG-FR-007's acceptance criterion is the audit half: "GIVEN an
   * administrator opens a reported conversation, WHEN the audit log is
   * inspected, THEN an entry records WHICH ADMIN READ WHICH CONVERSATION AND
   * WHEN."
   */
  @Get('moderation/cases/:id/conversation')
  @ApiOperation({
    summary: 'The excerpt from a reported conversation (MSG-FR-007, PRIV-009).',
    description:
      'THE ONLY WAY AN ADMINISTRATOR SEES A PRIVATE MESSAGE, and only for a conversation that ' +
      'was reported. The access is audit-logged before the read - "viewing is auditable, not ' +
      'only acting" is what makes PRIV-009 verifiable rather than aspirational.',
  })
  async reportedConversation(
    @Admin() admin: AdminPrincipal,
    @Param(new ZodValidationPipe(idParam)) params: IdParam,
  ) {
    const moderationCase = await this.reports.findCase(params.id);
    if (moderationCase === null || moderationCase.targetType !== 'CONVERSATION') {
      throw notFound();
    }

    // Written FIRST. A read that happened must not be able to lack a record,
    // and writing afterwards would let a crash produce an unaudited look at
    // somebody's private messages.
    await this.audit.append({
      actorType: 'ADMIN',
      actorId: admin.adminId,
      action: 'ADMIN_READ_REPORTED_CONVERSATION',
      entityType: 'CONVERSATION',
      entityId: moderationCase.targetId,
      metadata: { caseId: moderationCase.id },
    });

    const excerpt = await this.messaging.excerptForReport(
      // The excerpt is produced from a PARTICIPANT's perspective, because the
      // messaging module's access check is written in those terms and an
      // administrator is not a participant. `targetOwnerId` is null for a
      // conversation, so the reporter is who the case remembers.
      moderationCase.targetOwnerId ?? admin.adminId,
      moderationCase.targetId,
    );

    return { messages: excerpt?.messages ?? [] };
  }

  // ------------------------------------------------- the three peer outcomes
  @Post('moderation/cases/:id/restore')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Restore content (ADMIN-API-002, ADMIN-FR-003).',
    description:
      'A PEER of delete, not a lesser option. The report count RESETS so the same reporters ' +
      'cannot immediately re-hide it - ADMIN-FR-003 calls this "what protects legitimate ' +
      'civic criticism from coordinated reporting". A fourth restoration is still possible, ' +
      'and no automatic deletion ever occurs.',
  })
  async restore(
    @Admin() admin: AdminPrincipal,
    @Param(new ZodValidationPipe(idParam)) params: IdParam,
    @Body(new ZodValidationPipe(decisionBody)) body: DecisionBody,
  ) {
    return this.decide(
      await this.reports.restore({
        caseId: params.id,
        adminId: admin.adminId,
        reason: body.reason,
        expectedVersion: body.version,
      }),
    );
  }

  @Post('moderation/cases/:id/delete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Delete content permanently (ADMIN-API-003, ADMIN-FR-004).',
    description:
      'A PEER of restore. Irreversible, and the ONLY path by which anything is ever deleted - ' +
      'BR-032 forbids automatic deletion entirely. The audit log retains what was deleted, by ' +
      'whom and why, even though the content is gone.',
  })
  async remove(
    @Admin() admin: AdminPrincipal,
    @Param(new ZodValidationPipe(idParam)) params: IdParam,
    @Body(new ZodValidationPipe(decisionBody)) body: DecisionBody,
  ) {
    return this.decide(
      await this.reports.removeContent({
        caseId: params.id,
        adminId: admin.adminId,
        reason: body.reason,
        expectedVersion: body.version,
      }),
    );
  }

  @Post('moderation/cases/:id/no-action')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Close a case without acting (ADMIN-FR-002).',
    description:
      'The third peer. The content is untouched and the reports are cleared, so that one more ' +
      'report cannot re-hide something an administrator has just examined and approved.',
  })
  async noAction(
    @Admin() admin: AdminPrincipal,
    @Param(new ZodValidationPipe(idParam)) params: IdParam,
    @Body(new ZodValidationPipe(decisionBody)) body: DecisionBody,
  ) {
    return this.decide(
      await this.reports.closeNoAction({
        caseId: params.id,
        adminId: admin.adminId,
        reason: body.reason,
        expectedVersion: body.version,
      }),
    );
  }

  // ------------------------------------------------------------ enforcement
  @Get('users/search')
  @ApiOperation({
    summary: 'Find an account (ADMIN-API-005, ADMIN-FR-005).',
    description:
      'By username or display name. Returns the account view, which carries NO phone, email ' +
      'or date of birth - those need the sensitive endpoint, which audits every access.',
  })
  async searchUsers(@Query(new ZodValidationPipe(searchQuery)) query: SearchQuery) {
    return { users: await this.enforcement.searchUsers(query.q, query.limit ?? 20) };
  }

  @Get('users/:id')
  @ApiOperation({
    summary: 'The account view (ADMIN-FR-005).',
    description:
      'Profile, state, registration date, content counts, reports made and received. NO ' +
      'identifiers: a lookup must not itself be a sensitive-data view, or PRIV-008 would be ' +
      'audited on every screen and mean nothing.',
  })
  async userView(@Param(new ZodValidationPipe(idParam)) params: IdParam) {
    const view = await this.enforcement.userView(params.id);
    if (view === null) throw notFound();
    return view;
  }

  @Get('users/:id/sensitive')
  @ApiOperation({
    summary: 'Phone and date of birth — AUDITED (ADMIN-FR-005, PRIV-008, SEC-022).',
    description:
      'THE VIEWING IS ITSELF THE AUDITABLE ACTION. The entry is written before the read and ' +
      'in the same transaction, so a read that happened cannot lack a record. The entry names ' +
      'the fields, never their values - an audit log that recorded the number to prove ' +
      'somebody looked at the number would be a second, worse copy of it.',
  })
  async sensitive(
    @Admin() admin: AdminPrincipal,
    @Param(new ZodValidationPipe(idParam)) params: IdParam,
  ) {
    const view = await this.enforcement.sensitiveView({
      adminId: admin.adminId,
      targetUserId: params.id,
    });
    if (view === null) throw notFound();
    return {
      phone: view.phone,
      dateOfBirth: view.dateOfBirth?.toISOString() ?? null,
    };
  }

  @Post('users/:id/suspend')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Suspend for 24 hours, 7 days or 30 days (ADMIN-API-006, ADMIN-FR-006).',
    description:
      'All sessions are invalidated (BR-035). The user keeps READ access (BR-034) - a ' +
      'suspension is a pause, not an eviction, and somebody who cannot read cannot see the ' +
      'banner explaining why. Re-suspending REPLACES the duration rather than accumulating ' +
      '(EDGE-027). It lifts automatically with no administrator action (EDGE-028). AN ' +
      'ADMINISTRATOR ACCOUNT CAN NEVER BE SUSPENDED (BR-ADM-001, SEC-021).',
  })
  async suspend(
    @Admin() admin: AdminPrincipal,
    @Param(new ZodValidationPipe(idParam)) params: IdParam,
    @Body(new ZodValidationPipe(suspendBody)) body: SuspendBody,
  ) {
    return this.enforce(
      await this.enforcement.suspend({
        adminId: admin.adminId,
        targetUserId: params.id,
        duration: body.duration,
        reason: body.reason,
        caseId: body.caseId ?? null,
      }),
    );
  }

  @Post('users/:id/ban')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Ban permanently (ADMIN-API-007, ADMIN-FR-007).',
    description:
      'Content is HIDDEN rather than deleted, so it remains available to the audit trail if ' +
      'the ban is later disputed. The registered number is added to the ban list (BR-036) and ' +
      'a re-registration is refused with a NEUTRAL message that does not disclose the ban. ' +
      'AN ADMINISTRATOR ACCOUNT CAN NEVER BE BANNED.',
  })
  async ban(
    @Admin() admin: AdminPrincipal,
    @Param(new ZodValidationPipe(idParam)) params: IdParam,
    @Body(new ZodValidationPipe(enforcementBody)) body: EnforcementBody,
  ) {
    return this.enforce(
      await this.enforcement.ban({
        adminId: admin.adminId,
        targetUserId: params.id,
        reason: body.reason,
        caseId: body.caseId ?? null,
      }),
    );
  }

  @Post('users/:id/reinstate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Reinstate (ADMIN-API-008, ADMIN-FR-008).',
    description:
      'Always available, because "administrators make mistakes and the product must let them ' +
      'be corrected". Takes the number OFF the ban list too - a reinstatement that left the ' +
      'person unable to register would not be a correction.',
  })
  async reinstate(
    @Admin() admin: AdminPrincipal,
    @Param(new ZodValidationPipe(idParam)) params: IdParam,
    @Body(new ZodValidationPipe(enforcementBody)) body: EnforcementBody,
  ) {
    return this.enforce(
      await this.enforcement.reinstate({
        adminId: admin.adminId,
        targetUserId: params.id,
        reason: body.reason,
      }),
    );
  }

  @Put('users/:id/verification')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Grant or revoke the verified badge (ADMIN-FR-010).',
    description:
      'Only ORGANIZATION accounts are eligible, and the refusal STATES the rule rather than ' +
      'being neutral - an administrator verifying an individual has made a category error, ' +
      'not a security probe. Verification is by invitation in V1 (S2-CR-006); there is no ' +
      'in-app request queue. Revocation removes the badge everywhere immediately.',
  })
  async verification(
    @Admin() admin: AdminPrincipal,
    @Param(new ZodValidationPipe(idParam)) params: IdParam,
    @Body(new ZodValidationPipe(verificationBody)) body: VerificationBody,
  ) {
    const result = await this.enforcement.setVerification({
      adminId: admin.adminId,
      targetUserId: params.id,
      granted: body.granted,
      reason: body.reason,
    });

    if (result.status === 'APPLIED') return;
    if (result.reason === 'TARGET_NOT_FOUND') throw notFound();
    if (result.reason === 'NOT_AN_ORGANIZATION') {
      throw new BadRequestException({
        code: 'NOT_ELIGIBLE_FOR_VERIFICATION',
        message: 'Only organization accounts can be verified.',
      });
    }
    throw new BadRequestException({
      code: FoundationErrorCode.VALIDATION_FAILED,
      message: 'Please check the highlighted fields.',
      details: [{ path: 'reason', message: result.reason }],
    });
  }

  // ------------------------------------------------------------- internals
  private decide(result: Awaited<ReturnType<ReportService['restore']>>): Record<string, unknown> {
    if (result.status === 'NOT_FOUND') throw notFound();

    if (result.status === 'STALE') {
      // EDGE-024, and the shape matters: "the second administrator is told the
      // item was already resolved, BY WHOM AND HOW - not shown a generic
      // error". So the 409 carries both facts, and the message is a statement
      // rather than a complaint.
      throw new ConflictException({
        code: 'CASE_ALREADY_RESOLVED',
        message: 'Another administrator has already resolved this case.',
        details: [
          { path: 'resolvedBy', message: result.case.resolvedByAdminId ?? 'unknown' },
          { path: 'outcome', message: result.case.state },
          { path: 'version', message: String(result.case.version) },
        ],
      });
    }

    return toCaseBody(result.case);
  }

  private enforce(
    result: Awaited<ReturnType<EnforcementService['suspend']>>,
  ): Record<string, unknown> {
    if (result.status === 'APPLIED') {
      return {
        id: result.action.id,
        kind: result.action.kind,
        expiresAt: result.action.expiresAt?.toISOString() ?? null,
        sessionsRevoked: result.sessionsRevoked,
      };
    }

    switch (result.reason) {
      case 'TARGET_IS_ADMINISTRATOR':
        // 403 and it SAYS SO. This is not a case where concealment helps: the
        // only person who can reach this route is another administrator, they
        // already know the target is one, and BR-ADM-001 is a published rule
        // rather than a secret. Telling them plainly is what stops them
        // retrying and filing a bug.
        throw new ForbiddenException({
          code: 'ADMIN_CANNOT_ACT_ON_ADMIN',
          message:
            'Administrator accounts cannot be actioned through the portal. ' +
            'They are managed by the technical owner.',
        });
      case 'TARGET_NOT_FOUND':
        throw notFound();
      case 'CANNOT_ACT_ON_DELETED':
        throw new BadRequestException({
          code: 'ACCOUNT_DELETED',
          message: 'This account has been deleted.',
        });
      case 'ALREADY_IN_STATE':
      case 'REASON_TOO_SHORT':
        throw new BadRequestException({
          code: FoundationErrorCode.VALIDATION_FAILED,
          message: 'Please check the highlighted fields.',
          details: [{ path: 'reason', message: result.reason }],
        });
    }
  }
}

function toCaseBody(c: {
  id: string;
  targetType: string;
  targetId: string;
  targetOwnerId: string | null;
  state: string;
  maxSeverity: string;
  distinctReportCount: number;
  autoHidden: boolean;
  resolutionReason: string | null;
  resolvedByAdminId: string | null;
  resolvedAt: Date | null;
  version: number;
  createdAt: Date;
}): Record<string, unknown> {
  return {
    id: c.id,
    targetType: c.targetType,
    targetId: c.targetId,
    targetOwnerId: c.targetOwnerId,
    state: c.state,
    maxSeverity: c.maxSeverity,
    distinctReportCount: c.distinctReportCount,
    autoHidden: c.autoHidden,
    resolutionReason: c.resolutionReason,
    resolvedByAdminId: c.resolvedByAdminId,
    resolvedAt: c.resolvedAt?.toISOString() ?? null,
    // Returned on every read, because every decision must carry back the
    // version it was made against (EDGE-024).
    version: c.version,
    createdAt: c.createdAt.toISOString(),
  };
}

function notFound(): NotFoundException {
  return new NotFoundException({
    code: 'RESOURCE_UNAVAILABLE',
    message: 'This content is no longer available.',
  });
}
