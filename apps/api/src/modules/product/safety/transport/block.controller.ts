import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Put,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { FoundationErrorCode } from '@mohalla/contracts';
import { ZodValidationPipe } from '../../../../common/validation/zod-validation.pipe.js';
import { Principal, RequiresWrite } from '../../../platform/identity/transport/session.guard.js';
import type { AuthenticatedPrincipal } from '../../../platform/identity/application/session.service.js';
import { BlockService } from '../application/block.service.js';

const targetParam = z.object({ id: z.string().uuid() }).strict();
type TargetParam = z.infer<typeof targetParam>;

const listQuery = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).optional(),
    before: z.string().datetime().optional(),
  })
  .strict();
type ListQuery = z.infer<typeof listQuery>;

/**
 * Blocking (SAFETY-FR-005/006).
 *
 * `PUT` and `DELETE` rather than `POST` and `POST /unblock`, because blocking
 * is a STATE and both operations are idempotent. A double-tap on Block, or a
 * retry after a dropped connection, must succeed — a failure would suggest to
 * someone acting for their own safety that the block had not taken effect.
 *
 * NOTHING HERE DISCLOSES A BLOCK. There is no route that answers "has this
 * person blocked me", the block list is only ever the caller's own, and neither
 * operation reveals whether the target exists. The blocked user's experience is
 * that content becomes "not available" — the same neutral state as deleted or
 * never-existed content (BR-025, UX-STATE-001).
 */
@ApiTags('safety')
@Controller()
export class BlockController {
  constructor(private readonly blocks: BlockService) {}

  @Put('users/:id/block')
  @RequiresWrite()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Block a user (SAFETY-FR-005).',
    description:
      'Idempotent. Removes existing follows in BOTH directions in the same transaction ' +
      '(BR-024). Never notifies the blocked user, and does not reveal whether the target ' +
      'exists - probing account existence through the block endpoint would defeat the point.',
  })
  async block(
    @Principal() principal: AuthenticatedPrincipal,
    @Param(new ZodValidationPipe(targetParam)) params: TargetParam,
  ) {
    const result = await this.blocks.block(principal.userId, params.id);
    if (result.status === 'CANNOT_BLOCK_SELF') {
      throw new BadRequestException({
        code: FoundationErrorCode.VALIDATION_FAILED,
        message: 'You cannot block yourself.',
      });
    }
  }

  @Delete('users/:id/block')
  @RequiresWrite()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Unblock a user (SAFETY-FR-006).',
    description:
      'Idempotent, and succeeds even when no block existed - reporting "you were not blocking ' +
      'them" would disclose the ABSENCE of a block, which is the same class of information as ' +
      'its presence. Does NOT restore the follows the block removed: re-creating a ' +
      'relationship the user severed would put someone back in their feed unasked.',
  })
  async unblock(
    @Principal() principal: AuthenticatedPrincipal,
    @Param(new ZodValidationPipe(targetParam)) params: TargetParam,
  ) {
    await this.blocks.unblock(principal.userId, params.id);
  }

  @Get('me/blocks')
  @ApiOperation({
    summary: 'The accounts you have blocked (SAFETY-FR-006).',
    description:
      "Only ever the caller's OWN list. There is deliberately no route for who has blocked a " +
      'given user - that question has no legitimate non-admin caller.',
  })
  async listBlocks(
    @Principal() principal: AuthenticatedPrincipal,
    @Query(new ZodValidationPipe(listQuery)) query: ListQuery,
  ) {
    const rows = await this.blocks.listOwnBlocks(
      principal.userId,
      query.limit ?? 20,
      query.before === undefined ? undefined : new Date(query.before),
    );
    return {
      blocks: rows.map((r) => ({
        blockedUserId: r.blockedUserId,
        createdAt: r.createdAt.toISOString(),
      })),
      nextBefore: rows.length > 0 ? (rows[rows.length - 1]?.createdAt.toISOString() ?? null) : null,
    };
  }
}
