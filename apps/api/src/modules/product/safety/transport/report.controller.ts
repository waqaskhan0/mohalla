import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpException,
  HttpStatus,
  NotFoundException,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { FoundationErrorCode, IdentityErrorCode } from '@mohalla/contracts';
import { ZodValidationPipe } from '../../../../common/validation/zod-validation.pipe.js';
import { Principal, RequiresWrite } from '../../../platform/identity/transport/session.guard.js';
import type { AuthenticatedPrincipal } from '../../../platform/identity/application/session.service.js';
import { ReportService } from '../application/report.service.js';
import { REPORT_NOTE_MAX_LENGTH, REPORT_REASONS, REPORT_TARGETS } from '../domain/report-policy.js';

const reportBody = z
  .object({
    targetType: z.enum(REPORT_TARGETS),
    targetId: z.string().uuid(),
    /**
     * SAFETY-FR-003: "the reporter selects EXACTLY ONE of" eight reasons.
     *
     * An enum rather than free text, because the reason determines severity and
     * severity orders the queue. Free text would put the ordering in the hands
     * of whoever writes the most alarming sentence.
     */
    reasonCode: z.enum(REPORT_REASONS),
    note: z
      .string()
      .max(REPORT_NOTE_MAX_LENGTH * 4)
      .nullish(),
  })
  .strict();
type ReportBody = z.infer<typeof reportBody>;

/**
 * Reporting (SAFE-API-001 · SAFETY-FR-001/002/003).
 *
 * ONE ACKNOWLEDGEMENT, ALWAYS THE SAME. Reported already, just crossed the
 * threshold, nowhere near it — every successful path returns an identical 202
 * with no count and no state.
 *
 * SAFETY-FR-001 requires exactly this: a repeat report shows "the
 * acknowledgement again without incrementing the count, SO THE REPORTER CANNOT
 * INFER THE CURRENT TALLY". The tally is what a coordinated group needs — it
 * tells them how many more accounts to bring — and RSK-010 rates coordinated
 * reporting to silence civic criticism as this platform's characteristic abuse.
 * So the response is deliberately uninformative, and that is a feature rather
 * than an oversight.
 *
 * 202 ACCEPTED, not 201. Nothing addressable is created from the reporter's
 * point of view: they cannot read their report back, and there is no resource
 * to point them at. 202 says "received, and what happens next is not yours to
 * see", which is precisely the contract.
 */
@ApiTags('safety')
@Controller()
export class ReportController {
  constructor(private readonly reports: ReportService) {}

  @Post('reports')
  @RequiresWrite()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Report content, an account or a conversation (SAFE-API-001).',
    description:
      'ALWAYS THE SAME ACKNOWLEDGEMENT. A repeat report from the same account changes nothing ' +
      'and returns the same 202 - SAFETY-FR-001 requires that the reporter cannot infer the ' +
      'tally, because the tally is what tells a coordinated group how many more accounts they ' +
      'need. Posts and comments auto-hide at 3 distinct reporters, events at 2 (BR-044); ' +
      'PROFILES AND CONVERSATIONS NEVER auto-hide, because hiding a whole person on a report ' +
      'count would be trivially weaponised (SAFETY-FR-002) and a threshold between two people ' +
      'is meaningless (MSG-FR-007). Nothing is ever deleted automatically (BR-032).',
  })
  async report(
    @Principal() principal: AuthenticatedPrincipal,
    @Body(new ZodValidationPipe(reportBody)) body: ReportBody,
  ) {
    const result = await this.reports.report({
      reporterId: principal.userId,
      targetType: body.targetType,
      targetId: body.targetId,
      reason: body.reasonCode,
      note: body.note ?? null,
    });

    switch (result.status) {
      case 'RECEIVED':
        // No count, no "already reported", no "this is now hidden". The three
        // things an organised reporter would want are the three things absent.
        return { status: 'RECEIVED' as const };

      case 'NOT_AVAILABLE':
        throw new NotFoundException({
          code: 'RESOURCE_UNAVAILABLE',
          message: 'This content is no longer available.',
        });

      case 'RATE_LIMITED':
        // SAFETY-FR-009: "a clear cool-down message rather than a silent
        // failure", with the limit and the reset time stated.
        throw new HttpException(
          {
            code: IdentityErrorCode.RATE_LIMITED,
            message: `You can send up to ${result.verdict.limit} reports a day.`,
            details: [{ path: 'resetsAt', message: result.verdict.resetsAt.toISOString() }],
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );

      case 'INVALID':
        throw new BadRequestException({
          code: FoundationErrorCode.VALIDATION_FAILED,
          message:
            result.reason === 'CANNOT_REPORT_OWN_CONTENT'
              ? 'You cannot report your own content.'
              : 'Please check the highlighted fields.',
          details: [{ path: 'targetId', message: result.reason }],
        });
    }
  }
}
