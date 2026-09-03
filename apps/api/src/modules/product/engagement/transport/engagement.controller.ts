import {
  BadRequestException,
  Body,
  Controller,
  Delete,
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
import { Principal, RequiresWrite } from '../../../platform/identity/transport/session.guard.js';
import type { AuthenticatedPrincipal } from '../../../platform/identity/application/session.service.js';
import { EngagementService } from '../application/engagement.service.js';
import { COMMENT_BODY_MAX_LENGTH } from '../domain/comment-body.js';

const idParam = z.object({ id: z.string().uuid() }).strict();
type IdParam = z.infer<typeof idParam>;

/** Generous bound; the domain counts grapheme clusters. */
const commentBody = z.object({ body: z.string().max(COMMENT_BODY_MAX_LENGTH * 4) }).strict();
type CommentBody = z.infer<typeof commentBody>;

const listQuery = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).optional(),
    cursorCreatedAt: z.string().datetime().optional(),
    cursorId: z.string().uuid().optional(),
  })
  .strict();
type ListQuery = z.infer<typeof listQuery>;

/**
 * Likes and comments (ENG-API-001…006).
 *
 * `PUT` / `DELETE` for likes, because a like is a STATE and both directions are
 * idempotent. ENGAGE-FR-001's acceptance criterion — six rapid taps change the
 * count by at most one — is satisfied by the composite primary key, so the
 * transport can simply return the same 204 every time without the client
 * needing to serialise its taps.
 *
 * EVERY ROUTE ANSWERS 404 THE SAME WAY when the post cannot be seen: missing,
 * deleted, hidden, banned author, or blocked. Liking is a write, so it would
 * otherwise be a convenient oracle for "does this post id exist" and "has this
 * person blocked me".
 */
@ApiTags('engagement')
@Controller()
export class EngagementController {
  constructor(private readonly engagement: EngagementService) {}

  @Put('posts/:id/like')
  @RequiresWrite()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Like a post (ENG-API-001, ENGAGE-FR-001).',
    description:
      'Idempotent by the composite PRIMARY KEY (BR-031): six rapid taps produce one row and ' +
      'change the count by at most one. A user MAY like their own post. Refused with a ' +
      'neutral 404 across a block.',
  })
  async like(
    @Principal() principal: AuthenticatedPrincipal,
    @Param(new ZodValidationPipe(idParam)) params: IdParam,
  ) {
    const result = await this.engagement.like(principal.userId, params.id);
    if (result.status === 'NOT_AVAILABLE') throw resourceUnavailable();
  }

  @Delete('posts/:id/like')
  @RequiresWrite()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Unlike (ENG-API-002).',
    description:
      'Idempotent, and SILENT — "unliking sends no notification". Succeeds whether or not a ' +
      'like existed: the caller asked for a state, and that state now holds.',
  })
  async unlike(
    @Principal() principal: AuthenticatedPrincipal,
    @Param(new ZodValidationPipe(idParam)) params: IdParam,
  ) {
    const result = await this.engagement.unlike(principal.userId, params.id);
    if (result.status === 'NOT_AVAILABLE') throw resourceUnavailable();
  }

  @Post('posts/:id/comments')
  @RequiresWrite()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Comment on a post (ENG-API-003, ENGAGE-FR-002).',
    description:
      '1-1,000 GRAPHEME CLUSTERS, so Urdu is not penalised. If the post was deleted while the ' +
      'comment was being written the submission is refused - the client keeps the typed text, ' +
      'which the requirement asks for explicitly.',
  })
  async comment(
    @Principal() principal: AuthenticatedPrincipal,
    @Param(new ZodValidationPipe(idParam)) params: IdParam,
    @Body(new ZodValidationPipe(commentBody)) body: CommentBody,
  ) {
    const result = await this.engagement.comment(principal.userId, params.id, body.body);
    if (result.status === 'INVALID_INPUT') throw fieldError(result.field, result.reason);
    if (result.status === 'NOT_AVAILABLE') throw resourceUnavailable();
    return result.comment;
  }

  @Get('posts/:id/comments')
  @ApiOperation({
    summary: "A post's comments (ENG-API-004).",
    description:
      'OLDEST first, because a thread is a conversation and reading it backwards puts replies ' +
      'before what they reply to. Excludes comments from blocked users in either direction.',
  })
  async listComments(
    @Principal() principal: AuthenticatedPrincipal,
    @Param(new ZodValidationPipe(idParam)) params: IdParam,
    @Query(new ZodValidationPipe(listQuery)) query: ListQuery,
  ) {
    const cursor =
      query.cursorCreatedAt !== undefined && query.cursorId !== undefined
        ? { createdAt: new Date(query.cursorCreatedAt), id: query.cursorId }
        : undefined;

    const page = await this.engagement.listComments(
      principal.userId,
      params.id,
      query.limit ?? 20,
      cursor,
    );
    if (page === null) throw resourceUnavailable();
    return page;
  }

  @Post('comments/:id/replies')
  @RequiresWrite()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Reply to a comment (ENG-API-005, ENGAGE-FR-003).',
    description:
      'Exactly ONE level of nesting (BR-033). A reply aimed at a nested comment attaches to ' +
      'the same parent THREAD rather than being refused - the intent is clear, and the ' +
      'database refuses a third level regardless. This is the requirement that solves ' +
      "WhatsApp's lack of threading.",
  })
  async reply(
    @Principal() principal: AuthenticatedPrincipal,
    @Param(new ZodValidationPipe(idParam)) params: IdParam,
    @Body(new ZodValidationPipe(commentBody)) body: CommentBody,
  ) {
    // The post is resolved from the parent comment, so a caller cannot file a
    // reply under a different post than the one it belongs to.
    const parent = await this.engagement.findCommentPost(params.id);
    if (parent === null) throw resourceUnavailable();

    const result = await this.engagement.comment(principal.userId, parent, body.body, params.id);
    if (result.status === 'INVALID_INPUT') throw fieldError(result.field, result.reason);
    if (result.status === 'NOT_AVAILABLE') throw resourceUnavailable();
    return result.comment;
  }

  @Delete('comments/:id')
  @RequiresWrite()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a comment (ENG-API-006, ENGAGE-FR-004/005).',
    description:
      "The comment's author OR the POST's author may delete it (BR-020) - which distributes " +
      'moderation away from administrators. Replies are removed with it. Anyone else gets the ' +
      'same neutral 404 as a missing comment, so a third party cannot probe who wrote what.',
  })
  async deleteComment(
    @Principal() principal: AuthenticatedPrincipal,
    @Param(new ZodValidationPipe(idParam)) params: IdParam,
  ) {
    const result = await this.engagement.deleteComment(principal.userId, params.id);
    if (result.status === 'NOT_AVAILABLE') throw resourceUnavailable();
  }
}

function resourceUnavailable(): NotFoundException {
  return new NotFoundException({
    code: 'RESOURCE_UNAVAILABLE',
    message: 'This content is no longer available.',
  });
}

function fieldError(field: string, reason: string): BadRequestException {
  return new BadRequestException({
    code: FoundationErrorCode.VALIDATION_FAILED,
    message: 'Please check the highlighted fields.',
    details: [{ path: field, message: reason }],
  });
}
