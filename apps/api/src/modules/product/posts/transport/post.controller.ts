import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { FoundationErrorCode } from '@mohalla/contracts';
import { ZodValidationPipe } from '../../../../common/validation/zod-validation.pipe.js';
import { Principal, RequiresWrite } from '../../../platform/identity/transport/session.guard.js';
import type { AuthenticatedPrincipal } from '../../../platform/identity/application/session.service.js';
import { PostService } from '../application/post.service.js';
import { MAX_IMAGES_PER_POST } from '../../../platform/media/domain/upload-limits.js';

/**
 * Generous string bounds. The domain enforces the real §12 limits, in grapheme
 * clusters — a length check here would count code points and penalise Urdu.
 */
const createPostBody = z
  .object({
    body: z.string().max(3000 * 4),
    categorySlug: z.string().min(1).max(64).nullish(),
    mediaIds: z.array(z.string().uuid()).max(MAX_IMAGES_PER_POST).optional(),
  })
  .strict();
type CreatePostBody = z.infer<typeof createPostBody>;

/**
 * Edit. `mediaIds` is deliberately ABSENT (BR-014).
 *
 * `.strict()` means sending it is REJECTED rather than ignored — an author who
 * tries to swap the image must be told it cannot be done, not left believing it
 * worked.
 */
const updatePostBody = z
  .object({
    body: z
      .string()
      .max(3000 * 4)
      .optional(),
    categorySlug: z.string().min(1).max(64).nullish(),
  })
  .strict();
type UpdatePostBody = z.infer<typeof updatePostBody>;

const postIdParam = z.object({ id: z.string().uuid() }).strict();
type PostIdParam = z.infer<typeof postIdParam>;

const listQuery = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).optional(),
    cursorCreatedAt: z.string().datetime().optional(),
    cursorId: z.string().uuid().optional(),
  })
  .strict();
type ListQuery = z.infer<typeof listQuery>;

/**
 * Posts (POST-API-001…004, PROF-API-007).
 *
 * ONE NEUTRAL 404 for a missing post, a deleted one, an admin-removed one, one
 * hidden by moderation, one whose author is banned, and one behind a block
 * (UX-STATE-001, BR-025). POST-FR-009's acceptance criterion is exactly this:
 * a post that reached the auto-hide threshold while open shows "a not-available
 * state" on the next interaction — not a distinct "under review" error that
 * would tell a stranger the post had been reported.
 *
 * `MEDIA_NOT_READY` is a 409 rather than a 404, because it is the one refusal
 * the CLIENT can act on: the attachment has not finished inspection, or failed
 * it, and retrying that one file is the right response (EDGE-013). It says
 * nothing about whether a given media id exists.
 */
@ApiTags('posts')
@Controller()
export class PostController {
  constructor(private readonly posts: PostService) {}

  @Post('posts')
  @RequiresWrite()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Publish a post (POST-API-001, POST-FR-001).',
    description:
      'Body is 1-3,000 GRAPHEME CLUSTERS (BR-012), so Urdu is not penalised. Text is optional ' +
      'when an attachment is present. Up to four images in the order given (BR-013), and each ' +
      'must already be READY - the database refuses a post that references media still under ' +
      'inspection (ADR-013 step 7).',
  })
  async create(
    @Principal() principal: AuthenticatedPrincipal,
    @Body(new ZodValidationPipe(createPostBody)) body: CreatePostBody,
  ) {
    const result = await this.posts.create({
      authorId: principal.userId,
      body: body.body,
      categorySlug: body.categorySlug ?? null,
      mediaIds: body.mediaIds ?? [],
    });

    if (result.status === 'INVALID_INPUT') throw fieldError(result.field, result.reason);
    if (result.status === 'NO_PROFILE') {
      throw new ConflictException({
        code: 'PROFILE_NOT_CREATED',
        message: 'Create your profile before posting.',
      });
    }
    if (result.status === 'MEDIA_NOT_READY') {
      throw new ConflictException({
        code: 'MEDIA_NOT_READY',
        message: 'One of your attachments is still processing.',
      });
    }
    return result.post;
  }

  @Get('posts/:id')
  @ApiOperation({
    summary: 'View a post (POST-API-002, POST-FR-009).',
    description:
      'One neutral 404 for missing, deleted, admin-removed, auto-hidden, banned-author and ' +
      'blocked. The AUTHOR sees their own auto-hidden post with `underReview: true` (BR-032) - ' +
      'so they can appeal what they can see.',
  })
  async view(
    @Principal() principal: AuthenticatedPrincipal,
    @Param(new ZodValidationPipe(postIdParam)) params: PostIdParam,
  ) {
    const result = await this.posts.view(principal.userId, params.id);
    if (result.status === 'NOT_AVAILABLE') throw resourceUnavailable();
    return result.post;
  }

  @Patch('posts/:id')
  @RequiresWrite()
  @ApiOperation({
    summary: 'Edit own post (POST-API-003, POST-FR-008).',
    description:
      'Body and category only. ATTACHMENTS CANNOT BE CHANGED (BR-014), which "prevents ' +
      'bait-and-switch on content that others have already endorsed" - and sending `mediaIds` ' +
      'is rejected rather than ignored. Sets the "edited" marker. Author only: an ' +
      'administrator may remove a post but never edit one.',
  })
  async update(
    @Principal() principal: AuthenticatedPrincipal,
    @Param(new ZodValidationPipe(postIdParam)) params: PostIdParam,
    @Body(new ZodValidationPipe(updatePostBody)) body: UpdatePostBody,
  ) {
    const result = await this.posts.update({
      postId: params.id,
      authorId: principal.userId,
      ...(body.body !== undefined ? { body: body.body } : {}),
      ...('categorySlug' in body ? { categorySlug: body.categorySlug ?? null } : {}),
    });

    if (result.status === 'INVALID_INPUT') throw fieldError(result.field, result.reason);
    // Same neutral answer for "no such post" and "not yours", so a post id
    // cannot be used to probe what exists or who wrote it.
    if (result.status === 'NOT_AVAILABLE') throw resourceUnavailable();
    return result.post;
  }

  @Delete('posts/:id')
  @RequiresWrite()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete own post (POST-API-004, POST-FR-007).',
    description:
      'Permanent and not user-reversible; an administrator cannot restore it (BR-014). ' +
      'Idempotent - deleting an already-deleted post succeeds.',
  })
  async remove(
    @Principal() principal: AuthenticatedPrincipal,
    @Param(new ZodValidationPipe(postIdParam)) params: PostIdParam,
  ) {
    const result = await this.posts.delete(params.id, principal.userId);
    if (result.status === 'NOT_AVAILABLE') throw resourceUnavailable();
  }

  @Get('users/:id/posts')
  @ApiOperation({
    summary: "A profile's posts (PROF-API-007, PROFILE-FR-008).",
    description:
      'Newest first, paginated at 20, keyset-paginated on (createdAt, id). Deleted posts are ' +
      'excluded; auto-hidden posts appear ONLY for their author, marked (BR-032).',
  })
  async byAuthor(
    @Principal() principal: AuthenticatedPrincipal,
    @Param(new ZodValidationPipe(postIdParam)) params: PostIdParam,
    @Query(new ZodValidationPipe(listQuery)) query: ListQuery,
  ) {
    // Both cursor halves or neither: a partial cursor would silently page from
    // the beginning, which looks like duplicated content to the user.
    const cursor =
      query.cursorCreatedAt !== undefined && query.cursorId !== undefined
        ? { createdAt: new Date(query.cursorCreatedAt), id: query.cursorId }
        : undefined;

    const page = await this.posts.listByAuthor(
      principal.userId,
      params.id,
      query.limit ?? 20,
      cursor,
    );
    if (page === null) throw resourceUnavailable();
    return page;
  }
}

/** One neutral state for every reason a post cannot be shown (BR-025). */
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
